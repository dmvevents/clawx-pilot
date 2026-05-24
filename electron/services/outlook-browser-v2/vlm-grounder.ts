/**
 * VLM grounder — uses Claude Sonnet 4.5 vision to locate UI elements in a
 * screenshot and return a bounding box / target description we can hand to
 * Playwright.
 *
 * Why this exists: hand-rolled DOM selectors against Outlook Web break every
 * few weeks (the audit at /tmp/outlook-deep-audit.md catalogued ~6 critical
 * issues caused by selector drift). Asking a vision model "where is the New
 * mail button?" is robust to layout changes, locale switches, and theme
 * updates that would otherwise fail a brittle CSS selector.
 *
 * Flow:
 *   1. outlook-actions.ts tries a fast-path semantic locator (Playwright's
 *      getByRole with a regex). If that finds a unique target, no VLM call.
 *   2. On miss, screenshot the visible viewport and ask the VLM to locate
 *      the target. The VLM returns a bbox in image-pixel coordinates plus
 *      a confidence score and short reasoning trace.
 *   3. outlook-actions.ts maps the bbox centre back to viewport coords and
 *      clicks via Playwright.
 *
 * Cost / latency budget: each grounding call is one Sonnet vision request,
 * roughly 800 input tokens (image + ~200 token system prompt) and 150 output
 * tokens. At Sonnet 4.5 pricing that's ~0.5¢ per call. We add a per-(hash,
 * question) cache with 60s TTL so retries within a single action don't
 * re-pay; the cache is intentionally short because UI state changes fast.
 *
 * Testability: the SDK call is wrapped behind a function-typed property on
 * the grounder instance, so tests can inject a mock without touching the
 * network. See tests/unit/outlook-vlm-grounder.test.ts.
 */
import { createHash } from 'crypto';
import { logger } from '../../utils/logger';

/** Pixel-space bounding box returned by the VLM. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GroundResult {
  found: boolean;
  /** Pixel-space bounding box. Present iff found === true. */
  bbox?: BoundingBox;
  /** 0-1, model self-reported. We treat <0.5 as a miss. */
  confidence: number;
  /** Short rationale, useful in logs but not exposed to renderer. */
  reasoning: string;
  /** Echoed for debugging. */
  question: string;
}

export interface GroundQuery {
  /** PNG screenshot bytes of the visible viewport. */
  screenshotPng: Buffer;
  /** Width of the screenshot in pixels (for coordinate sanity-check). */
  imageWidth: number;
  /** Height of the screenshot in pixels. */
  imageHeight: number;
  /** Plain-language description of what to find. */
  question: string;
}

/**
 * Function shape the grounder uses to invoke the VLM. Default impl calls
 * Anthropic's SDK; tests inject a mock that returns canned responses.
 */
export type VlmCaller = (args: {
  systemPrompt: string;
  userPrompt: string;
  screenshotBase64: string;
  mediaType: 'image/png';
}) => Promise<{ text: string }>;

/**
 * VLM provider selection.
 *
 * Default: Bedrock-hosted Claude Sonnet 4.5 vision. It's the strongest
 * UI-grounding model right now and the dev environment has AWS_PROFILE=bedrock
 * already configured. Sonnet is preferred over Gemini Flash because:
 *  - Better at ambiguous Outlook DOM (custom themes, localised labels).
 *  - The "anthropic-tools-100..." computer-use lineage was trained on
 *    UI-screenshot-to-coordinate tasks specifically.
 *  - No cost ceiling on this project; we can spend the extra ~$0.005/call
 *    in exchange for fewer false negatives.
 *
 * Fallback: Gemini 2.5 Flash via GEMINI_API_KEY. Used when CLAWX_VLM_PROVIDER
 * is set to 'gemini', or when Bedrock creds are unavailable. Cheaper, faster,
 * but less accurate on ambiguous targets.
 *
 * Override the model per-instance for experiments.
 */
type VlmProvider = 'bedrock' | 'gemini';

const BEDROCK_DEFAULT_MODEL = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const SYSTEM_PROMPT = `You are a UI grounding model. The user shows you a
screenshot of a web page and asks where to find a specific element.

Reply with a single JSON object on one line — no prose, no markdown fence —
matching this schema:

{ "found": boolean, "bbox": {"x": int, "y": int, "width": int, "height": int}, "confidence": float, "reasoning": "short string" }

- Coordinates are pixel-space, top-left origin, of the screenshot you were
  shown. Do not invent coordinates if the element is not visible — set
  found=false and omit bbox.
- bbox should be tight around the clickable target. Prefer the smallest
  bounding box that fully contains the click target.
- confidence is 0-1. Below 0.5 means "I think it might be here but I'm not
  sure". Above 0.8 means clearly visible and unambiguous.
- reasoning is one short sentence. Do not list alternatives.

If you find multiple candidates, pick the one most likely to match the
user's intent. If unsure, say found=false rather than guess.`;

export class VlmGrounder {
  private cache = new Map<string, { value: GroundResult; expiresAt: number }>();
  private readonly cacheTtlMs = 60_000;
  private readonly model: string;
  private readonly caller: VlmCaller;
  /**
   * Optional fallback caller. When the primary caller throws, we try
   * this one before giving up. Used in production to fall through
   * Bedrock → Gemini if AWS auth fails or the region is unreachable.
   * In test paths (where caller is injected directly) the fallback
   * stays null.
   */
  private readonly fallbackCaller: VlmCaller | null = null;
  private readonly fallbackModel: string | null = null;

  constructor(opts?: {
    model?: string;
    caller?: VlmCaller;
    apiKey?: string;
    provider?: VlmProvider;
    /** Set false to disable the auto Bedrock→Gemini fallback. Default true. */
    enableFallback?: boolean;
  }) {
    const provider: VlmProvider =
      opts?.provider ?? (process.env.CLAWX_VLM_PROVIDER === 'gemini' ? 'gemini' : 'bedrock');
    this.model = opts?.model
      ?? (provider === 'bedrock' ? BEDROCK_DEFAULT_MODEL : GEMINI_DEFAULT_MODEL);

    if (opts?.caller) {
      this.caller = opts.caller;
      return;
    }

    // Build a Gemini fallback caller when:
    //   - primary is Bedrock (Bedrock can fail on auth / region issues
    //     more often than Gemini's API-key path)
    //   - GEMINI_API_KEY is present in env
    //   - opts.enableFallback isn't explicitly false
    // This makes the agent gracefully degrade rather than blow up the
    // whole Outlook flow when AWS SSO has expired or the laptop is
    // offline-ish.
    const wantFallback = opts?.enableFallback !== false
      && provider === 'bedrock'
      && Boolean(process.env.GEMINI_API_KEY);
    if (wantFallback) {
      this.fallbackModel = GEMINI_DEFAULT_MODEL;
      this.fallbackCaller = this.buildGeminiCaller(process.env.GEMINI_API_KEY!);
    }

    if (provider === 'bedrock') {
      this.caller = this.buildBedrockCaller();
      return;
    }

    // Gemini path (kept inline below; should match buildGeminiCaller).
    {
      const apiKey = opts?.apiKey ?? process.env.GEMINI_API_KEY;
      if (!apiKey) {
        this.caller = () => Promise.reject(
          new Error('VlmGrounder: GEMINI_API_KEY not set. Set it in env or pass apiKey to the constructor.'),
        );
      } else {
        this.caller = this.buildGeminiCaller(apiKey);
      }
    }
  }

  private buildBedrockCaller(): VlmCaller {
    return async ({ systemPrompt, userPrompt, screenshotBase64, mediaType }) => {
        // Lazy import so the SDK is only loaded when actually used (saves
        // ~50ms on every test run that mocks the caller).
        const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
        const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-2';
        const client = new BedrockRuntimeClient({ region });
        const body = {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 256,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mediaType, data: screenshotBase64 },
                },
                { type: 'text', text: userPrompt },
              ],
            },
          ],
        };
        const cmd = new InvokeModelCommand({
          modelId: this.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: new TextEncoder().encode(JSON.stringify(body)),
        });
        const resp = await client.send(cmd);
        const textBytes = resp.body;
        if (!textBytes) {
          throw new Error('VlmGrounder: empty Bedrock response body');
        }
        const decoded = new TextDecoder().decode(textBytes);
        const parsed = JSON.parse(decoded) as {
          content?: Array<{ type?: string; text?: string }>;
        };
        const block = parsed.content?.find((c) => c.type === 'text');
        if (!block || typeof block.text !== 'string') {
          throw new Error('VlmGrounder: unexpected Bedrock response shape');
        }
      return { text: block.text };
    };
  }

  private buildGeminiCaller(apiKey: string): VlmCaller {
    return async ({ systemPrompt, userPrompt, screenshotBase64, mediaType }) => {
      // The fallback uses the Gemini default model regardless of what
      // this.model says — so when Bedrock fails over to Gemini, we
      // don't accidentally pass a Bedrock model id to the Gemini API.
      const modelToUse = this.fallbackModel ?? this.model;
      const url = `${GEMINI_BASE_URL}/models/${modelToUse}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: systemPrompt + '\n\n' + userPrompt },
              { inlineData: { mimeType: mediaType, data: screenshotBase64 } },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 256,
          responseMimeType: 'application/json',
        },
      };
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`Gemini ${resp.status}: ${errText.slice(0, 200)}`);
      }
      const data = await resp.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') {
        throw new Error('VlmGrounder: unexpected Gemini response shape');
      }
      return { text };
    };
  }

  /**
   * Locate the target described by `query.question` in the screenshot.
   *
   * Cached by sha256(image)+question for 60s. Cache misses make one VLM
   * call. On VLM error, returns { found: false, confidence: 0 } and logs;
   * the caller decides whether to retry or surface the error.
   */
  async ground(query: GroundQuery): Promise<GroundResult> {
    const cacheKey = this.makeCacheKey(query);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const userPrompt = `Find: "${query.question}". Reply with the JSON object only.`;
    const screenshotBase64 = query.screenshotPng.toString('base64');
    const callArgs = {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      screenshotBase64,
      mediaType: 'image/png' as const,
    };
    let parsed: GroundResult;
    try {
      const { text } = await this.caller(callArgs);
      parsed = this.parseResponse(text, query);
    } catch (primaryErr) {
      const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      // Fallback path: when primary (typically Bedrock) fails AND we have
      // a Gemini fallback configured. Production-grade graceful
      // degradation: AWS SSO expired? Region temporarily unreachable?
      // Bedrock rate-limited? Don't blow up the whole Outlook flow —
      // try Gemini and only fail if it ALSO breaks.
      if (this.fallbackCaller) {
        logger.warn(
          `[outlook-v2] primary VLM caller failed (${primaryMsg}) — trying Gemini fallback`,
        );
        try {
          const { text } = await this.fallbackCaller(callArgs);
          parsed = this.parseResponse(text, query);
        } catch (fallbackErr) {
          const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          logger.warn(
            `[outlook-v2] VLM fallback ALSO failed for "${query.question}": primary=${primaryMsg} fallback=${fbMsg}`,
          );
          parsed = {
            found: false,
            confidence: 0,
            reasoning: 'VLM call failed (both primary and fallback)',
            question: query.question,
          };
        }
      } else {
        logger.warn(
          `[outlook-v2] VlmGrounder.ground failed for "${query.question}": ${primaryMsg}`,
        );
        parsed = {
          found: false,
          confidence: 0,
          reasoning: 'VLM call failed',
          question: query.question,
        };
      }
    }

    this.cache.set(cacheKey, { value: parsed, expiresAt: Date.now() + this.cacheTtlMs });
    this.evictExpired();
    return parsed;
  }

  /** Drop expired entries; keeps the cache from growing unbounded. */
  private evictExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.cache) {
      if (v.expiresAt <= now) this.cache.delete(k);
    }
  }

  private makeCacheKey(q: GroundQuery): string {
    const h = createHash('sha256');
    h.update(q.screenshotPng);
    h.update('|');
    h.update(q.question);
    return h.digest('hex');
  }

  private parseResponse(text: string, query: GroundQuery): GroundResult {
    // Strip optional markdown fences just in case the model decided to be
    // helpful despite the instruction.
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let raw: unknown;
    try {
      raw = JSON.parse(cleaned);
    } catch {
      return {
        found: false,
        confidence: 0,
        reasoning: 'VLM response was not valid JSON',
        question: query.question,
      };
    }
    if (!raw || typeof raw !== 'object') {
      return {
        found: false,
        confidence: 0,
        reasoning: 'VLM response was not an object',
        question: query.question,
      };
    }
    const obj = raw as Record<string, unknown>;
    const found = obj.found === true;
    const confidence = typeof obj.confidence === 'number' ? obj.confidence : 0;
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';

    if (!found) {
      return { found: false, confidence, reasoning, question: query.question };
    }

    const bbox = obj.bbox;
    if (
      !bbox || typeof bbox !== 'object'
      || typeof (bbox as Record<string, unknown>).x !== 'number'
      || typeof (bbox as Record<string, unknown>).y !== 'number'
      || typeof (bbox as Record<string, unknown>).width !== 'number'
      || typeof (bbox as Record<string, unknown>).height !== 'number'
    ) {
      return {
        found: false,
        confidence: 0,
        reasoning: 'VLM said found but bbox malformed',
        question: query.question,
      };
    }
    const b = bbox as { x: number; y: number; width: number; height: number };

    // Sanity: clamp to image bounds. A model that hallucinates a bbox
    // outside the visible viewport should not produce an off-screen click.
    if (
      b.x < 0 || b.y < 0
      || b.x + b.width > query.imageWidth
      || b.y + b.height > query.imageHeight
      || b.width <= 0 || b.height <= 0
    ) {
      return {
        found: false,
        confidence: 0,
        reasoning: 'VLM bbox outside image bounds',
        question: query.question,
      };
    }

    return {
      found: true,
      bbox: { x: b.x, y: b.y, width: b.width, height: b.height },
      confidence,
      reasoning,
      question: query.question,
    };
  }
}

/** Pixel-space centre of a bounding box — what we'd hand to a Playwright click. */
export function bboxCentre(b: BoundingBox): { x: number; y: number } {
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}
