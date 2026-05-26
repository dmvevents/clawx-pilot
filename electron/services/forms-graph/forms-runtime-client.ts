/**
 * forms-runtime-client: API-only Microsoft Forms response submission.
 *
 * ============================================================================
 * PHASE 2 STATUS — fully captured and confirmed (2026-05-25 22:27 UTC)
 * ============================================================================
 *
 * Captured by scripts/forms-auto-fill-and-capture.ts hitting a real submission
 * (POST 201 Created). Shape preserved at:
 *   extensions/moe-principal-assistant/forms/.captured-submit-shape.json
 *
 * CONFIRMED endpoint (NOT /runtime/api/ — same /formapi/ host as design):
 *   POST https://forms.office.com/formapi/api/{tenantId}/users/{userId}/forms('{formId}')/responses
 *
 * CONFIRMED auth (same as design API):
 *   - Cookie: __RequestVerificationToken (session)
 *   - Header: __requestverificationtoken = window.OfficeFormServerInfo.antiForgeryToken
 *   - Header: authorization = Bearer <jwt> (auto-attached when fetch runs in
 *     the page context with credentials:'include')
 *
 * CONFIRMED body shape:
 *   {
 *     "startDate":  "2026-05-25T22:26:37.751Z",  // ISO when form opened
 *     "submitDate": "2026-05-26T00:27:11.781Z",  // ISO when Submit clicked
 *     "answers":    "[{\"questionId\":\"r{32hex}\",\"answer1\":\"<value>\"}]"
 *   }
 *   answers is a JSON-STRINGIFIED string (double-encoded).
 *
 * CONFIRMED answer1 encoding by question type:
 *   - Question.TextField           → literal value string
 *   - Question.Choice (single)     → option's Description (display text, not an id)
 *   - Question.Choice (multi)      → JSON-stringified array of Description strings
 *                                    (e.g. answer1: "[\"Arson\",\"Vandalism\"]")
 *   - Question.DateTime            → ISO YYYY-MM-DD string (NOT locale m/d/yyyy)
 *
 * Tenant + user IDs (cached for the test.fac@fac.edu.tt account):
 *   TENANT = 9590bb09-ce2c-40e2-8181-fad0a7edebfe
 *   USER   = 0e48d4db-698a-44ca-ba0b-ae905cd07817
 * For other accounts these come from window.OfficeFormServerInfo or are
 * derivable from the form URL's identity prefix.
 *
 * ============================================================================
 *
 * Why page.evaluate (and NOT request.post):
 *   The `__requestverificationtoken` value lives on the page as
 *   `window.OfficeFormServerInfo.antiForgeryToken`. Forms' anti-forgery
 *   double-submit pattern requires the COOKIE `__RequestVerificationToken`
 *   AND the header to match. Playwright's `request.post()` does not carry
 *   the page's JS-cached state; it sends only the cookie. By running fetch
 *   INSIDE the page (page.evaluate(inlineJs)), we inherit cookies AND can
 *   read OfficeFormServerInfo from window.
 *
 * Hard-confirm gate:
 *   submitFormResponse refuses unless `confirm: true`. Same pattern as
 *   outlook-browser-v2 sendEmail / downloadAttachment. The agent must
 *   surface a preview to the principal, get a yes, THEN re-call with
 *   confirm:true.
 */
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';
import { logger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Public API surface (matches MSFORMS_API_FILL_PLAN.md spec)
// ---------------------------------------------------------------------------

export interface SubmitArgs {
  /** Any of: /r/SHORT, /Pages/ResponsePage.aspx?id=…, /Pages/DesignPageV2.aspx?id=… */
  formUrl: string;
  /** User-supplied answers. Keys are question LABELS (substring match), values are strings or string-arrays. */
  answers: Record<string, string | string[]>;
  /** Hard-confirm gate. Must be `true` or the call is refused without any network IO. */
  confirm: boolean;
  /** Optional override: CDP endpoint to attach to. Defaults to the OpenClaw managed Chrome. */
  cdpEndpoint?: string;
  /** Optional override: tenant id. Defaults to the cached test.fac value. */
  tenantId?: string;
  /** Optional override: user id (form owner). Defaults to the cached test.fac value. */
  userId?: string;
  /**
   * Pre-loaded form schema. If provided, we skip the /formapi/api/ schema GET
   * (which requires the form OWNER's auth — the response page doesn't have it).
   * Use this when running from a respondent context with a cached schema.
   */
  schema?: FormSchema;
}

export interface SubmitResult {
  status: 'submitted' | 'refused' | 'error';
  responseId?: string;
  reason?: string;
  /** When status='submitted', which candidate URL succeeded — useful for telemetry until we lock the shape. */
  endpointUsed?: string;
  /** Raw HTTP status from the runtime POST (for debugging when status='error'). */
  httpStatus?: number;
}

export interface FormQuestion {
  /** Internal Forms id, shape "r" + 32 hex chars. */
  questionId: string;
  /** "Question.TextField" | "Question.Choice" | "Question.DateTime" | etc. */
  type: string;
  /** Human-readable label shown on the page. */
  title: string;
  /** Display order. */
  order: number;
  /** True if the form requires this answer. */
  required: boolean;
  /** Choice options (only present for Question.Choice). */
  choices?: Array<{ description: string; isGenerated: boolean }>;
  /** ChoiceType: 1 = single_choice, 2 = multi_choice. */
  choiceType?: 1 | 2;
}

export interface FormSchema {
  formId: string;
  tenantId: string;
  userId: string;
  questions: FormQuestion[];
}

// ---------------------------------------------------------------------------
// Constants and defaults
// ---------------------------------------------------------------------------

const CDP_DEFAULT = 'http://127.0.0.1:18792';

/** Cached test.fac tenant — same value used by every other forms script. */
const DEFAULT_TENANT = '9590bb09-ce2c-40e2-8181-fad0a7edebfe';
const DEFAULT_USER = '0e48d4db-698a-44ca-ba0b-ae905cd07817';

/** Runtime shape capture. If this file exists, we trust its endpoint+body shape over the inferred candidates. */
const CAPTURED_SHAPE_PATH = '/tmp/forms-submit-shape.json';

/** Page filter for "is this a Forms tab we can run page.evaluate against?" */
const FORMS_PAGE_PATTERNS = [
  /forms\.office\.com\/Pages\/(ResponsePage|DesignPageV2)/i,
  /forms\.cloud\.microsoft\/Pages\/(ResponsePage|DesignPageV2)/i,
  /forms\.office\.com\/r\//i,
  /forms\.cloud\.microsoft\/r\//i,
];

// ---------------------------------------------------------------------------
// URL parsing — extract the form id from any of the variant URL shapes
// ---------------------------------------------------------------------------

/**
 * Parse a form URL to extract the form id. Handles:
 *   - /r/SHORT                                (collect-responses short link, the id IS the SHORT token)
 *   - /Pages/ResponsePage.aspx?id={LONG_ID}   (responder URL with long id)
 *   - /Pages/DesignPageV2.aspx?id={LONG_ID}   (editor URL with long id)
 *
 * The "long id" is the form id we use in /formapi/api/.../forms('{id}'). The
 * short token from /r/ links is NOT directly substitutable — it requires a
 * resolution step (the response page redirects to the long id on first GET).
 * For Phase 1 we accept ResponsePage / DesignPageV2 only and surface a clear
 * error for short links. Phase 2 can add the resolution hop.
 */
export function parseFormUrl(formUrl: string): { kind: 'long_id'; formId: string } | { kind: 'short_token'; token: string } | { kind: 'unknown'; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(formUrl);
  } catch {
    return { kind: 'unknown', reason: `invalid URL: ${formUrl.slice(0, 120)}` };
  }
  const host = parsed.host.toLowerCase();
  if (!/forms\.(office\.com|cloud\.microsoft)$/.test(host)) {
    return { kind: 'unknown', reason: `not a forms.office.com / forms.cloud.microsoft URL: host=${host}` };
  }
  // Long-id case: ?id= query param on either ResponsePage or DesignPageV2
  if (/^\/Pages\/(ResponsePage|DesignPageV2)\.aspx$/i.test(parsed.pathname)) {
    const id = parsed.searchParams.get('id');
    if (id) return { kind: 'long_id', formId: id };
    return { kind: 'unknown', reason: 'ResponsePage/DesignPageV2 URL had no ?id= query' };
  }
  // Short-token case: /r/{TOKEN}
  const m = /^\/r\/([A-Za-z0-9_-]+)\/?$/.exec(parsed.pathname);
  if (m) return { kind: 'short_token', token: m[1] };
  return { kind: 'unknown', reason: `unrecognized Forms URL path: ${parsed.pathname}` };
}

// ---------------------------------------------------------------------------
// Page acquisition — connect to Chrome via CDP, find or open the right tab
// ---------------------------------------------------------------------------

interface AttachedPage {
  browser: Browser;
  page: Page;
}

async function attachAndFindFormsPage(formUrl: string, cdpEndpoint: string): Promise<AttachedPage> {
  const browser = await chromium.connectOverCDP(cdpEndpoint);
  const allPages = browser.contexts().flatMap((c) => c.pages());
  // Prefer an already-open tab on the same form. Fall back to ANY forms tab
  // (we just need OfficeFormServerInfo + the cookie to be present in JS scope).
  let page = allPages.find((p) => normalizeFormsUrl(p.url()) === normalizeFormsUrl(formUrl));
  if (!page) {
    page = allPages.find((p) => FORMS_PAGE_PATTERNS.some((re) => re.test(p.url())));
  }
  if (!page) {
    // Open a new tab on the form URL.
    const ctx = browser.contexts()[0];
    if (!ctx) {
      await browser.close().catch(() => null);
      throw new Error('CDP attach succeeded but no browser contexts were found.');
    }
    page = await ctx.newPage();
    await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => null);
  }
  await page.bringToFront().catch(() => null);
  return { browser, page };
}

function normalizeFormsUrl(u: string): string {
  try {
    const x = new URL(u);
    return x.origin + x.pathname + (x.searchParams.get('id') ? `?id=${x.searchParams.get('id')}` : '');
  } catch {
    return u;
  }
}

// ---------------------------------------------------------------------------
// Schema reader — uses the proven /formapi/api/ design endpoint
// ---------------------------------------------------------------------------

/**
 * Read a form's question schema via the design API. Returns the question id,
 * type, title, and (for Choice) the options. This is the SAME endpoint we
 * already exercise in scripts/forms-list-and-cleanup.ts so it's known-good.
 *
 * The caller may pass a pre-attached `page` (e.g. from a flow that already
 * has the form open). If not, we attach via CDP and reuse the user's session.
 */
export async function getFormSchema(
  formId: string,
  page: Page,
  opts: { tenantId?: string; userId?: string } = {},
): Promise<FormSchema> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT;
  const userId = opts.userId ?? DEFAULT_USER;
  const base = `https://forms.office.com/formapi/api/${tenantId}/users/${userId}/forms('${formId}')`;
  const endpoint = `${base}/questions`;

  const inlineJs = `(async function() {
    var ofi = window.OfficeFormServerInfo || {};
    var headers = { 'accept': 'application/json' };
    if (ofi.antiForgeryToken) headers['__requestverificationtoken'] = ofi.antiForgeryToken;
    try {
      const r = await fetch(${JSON.stringify(endpoint)}, { credentials: 'include', headers: headers });
      const text = await r.text();
      return { status: r.status, text: text };
    } catch (e) {
      return { status: 0, text: 'fetch threw: ' + (e && e.message ? e.message : String(e)) };
    }
  })()`;

  const result = (await page.evaluate(inlineJs)) as { status: number; text: string };
  if (result.status !== 200) {
    throw new Error(`getFormSchema: HTTP ${result.status} from ${endpoint}: ${result.text.slice(0, 300)}`);
  }
  let payload: { value?: Array<Record<string, unknown>> };
  try {
    payload = JSON.parse(result.text);
  } catch {
    throw new Error(`getFormSchema: non-JSON response from ${endpoint}: ${result.text.slice(0, 200)}`);
  }
  const rawQuestions = payload.value ?? [];
  const questions: FormQuestion[] = rawQuestions.map((raw) => {
    const q: FormQuestion = {
      questionId: String(raw.id ?? ''),
      type: String(raw.type ?? ''),
      title: String(raw.title ?? ''),
      order: Number(raw.order ?? 0),
      required: raw.required === true,
    };
    // questionInfo is a JSON string for Choice/TextField/etc. Parse Choices out
    // for Question.Choice so the runtime mapper can resolve label → Description.
    if (q.type === 'Question.Choice' && typeof raw.questionInfo === 'string') {
      try {
        const info = JSON.parse(raw.questionInfo) as {
          Choices?: Array<{ Description?: string; IsGenerated?: boolean }>;
          ChoiceType?: number;
        };
        q.choices = (info.Choices ?? []).map((c) => ({
          description: String(c.Description ?? ''),
          isGenerated: c.IsGenerated === true,
        }));
        q.choiceType = info.ChoiceType === 2 ? 2 : 1;
      } catch {
        /* leave choices undefined */
      }
    }
    return q;
  });
  questions.sort((a, b) => a.order - b.order);
  return { formId, tenantId, userId, questions };
}

// ---------------------------------------------------------------------------
// Answer mapping — user-friendly labels → Forms-internal questionId/answer1
// ---------------------------------------------------------------------------

interface ApiAnswer {
  questionId: string;
  answer1: string;
  // Future: answer2 etc. for multi-part questions. Keep open-ended.
}

interface MappingError {
  label: string;
  reason: string;
}

interface MappingResult {
  apiAnswers: ApiAnswer[];
  errors: MappingError[];
}

/**
 * Map a user's label-keyed answer dict onto the form's questionId-keyed
 * shape. For Question.Choice we resolve the user's value to an option
 * Description (case-insensitive substring match).
 *
 * Errors do not throw — they're collected so the caller can surface a
 * complete report ("3 of 4 mapped; couldn't find option 'Sevre' in field
 * 'Level of offence'").
 */
function mapAnswersToApi(answers: Record<string, string | string[]>, schema: FormSchema): MappingResult {
  const errors: MappingError[] = [];
  const apiAnswers: ApiAnswer[] = [];

  for (const [label, rawValue] of Object.entries(answers)) {
    const q = findQuestionByLabel(label, schema.questions);
    if (!q) {
      errors.push({ label, reason: `no question matched label "${label.slice(0, 80)}"` });
      continue;
    }

    if (q.type === 'Question.Choice' && q.choices && q.choices.length > 0) {
      const targetValues = Array.isArray(rawValue) ? rawValue : [String(rawValue)];
      const matchedDescriptions: string[] = [];
      for (const t of targetValues) {
        const opt = q.choices.find(
          (c) => c.description.toLowerCase() === String(t).toLowerCase().trim(),
        ) ?? q.choices.find(
          (c) => c.description.toLowerCase().includes(String(t).toLowerCase().trim()),
        );
        if (opt) {
          matchedDescriptions.push(opt.description);
        } else {
          errors.push({
            label,
            reason: `choice "${String(t).slice(0, 60)}" not in options [${q.choices.map((c) => c.description.slice(0, 30)).slice(0, 8).join(', ')}…]`,
          });
        }
      }
      if (matchedDescriptions.length > 0) {
        // For multi_choice, Forms encodes selections as a JSON-stringified
        // array of strings in answer1. For single_choice, just the string.
        // (This is the inferred shape — capture confirms.)
        const value =
          q.choiceType === 2
            ? JSON.stringify(matchedDescriptions)
            : matchedDescriptions[0];
        apiAnswers.push({ questionId: q.questionId, answer1: value });
      }
      continue;
    }

    if (q.type === 'Question.DateTime') {
      // Forms expects ISO 8601. Accept YYYY-MM-DD or full ISO; normalize.
      const v = String(Array.isArray(rawValue) ? rawValue[0] : rawValue);
      const iso = normalizeDateToIso(v);
      if (!iso) {
        errors.push({ label, reason: `could not parse date "${v.slice(0, 40)}"` });
        continue;
      }
      apiAnswers.push({ questionId: q.questionId, answer1: iso });
      continue;
    }

    // Default: TextField / Number / anything else — pass the string straight through.
    const v = Array.isArray(rawValue) ? rawValue.join(', ') : String(rawValue);
    apiAnswers.push({ questionId: q.questionId, answer1: v });
  }

  return { apiAnswers, errors };
}

function findQuestionByLabel(label: string, questions: FormQuestion[]): FormQuestion | null {
  const needle = label.toLowerCase().trim();
  // Exact match first.
  const exact = questions.find((q) => q.title.toLowerCase().trim() === needle);
  if (exact) return exact;
  // Substring (forward and reverse) — handles "Date of suspension" matching
  // "Date of issue of suspension" etc.
  const sub = questions.find((q) => q.title.toLowerCase().includes(needle));
  if (sub) return sub;
  return questions.find((q) => needle.includes(q.title.toLowerCase().slice(0, Math.min(40, q.title.length)))) ?? null;
}

function normalizeDateToIso(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  // YYYY-MM-DD → midnight UTC of that day (Forms accepts dateTime, will render as date for Question.DateTime)
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return `${t}T00:00:00.000Z`;
  }
  // Full ISO already.
  const d = new Date(t);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

// ---------------------------------------------------------------------------
// Captured shape loader — if we have a real submit captured, use it
// ---------------------------------------------------------------------------

interface CapturedShape {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  status?: number;
}

function loadCapturedShape(): CapturedShape | null {
  if (!existsSync(CAPTURED_SHAPE_PATH)) return null;
  try {
    const text = readFileSync(CAPTURED_SHAPE_PATH, 'utf-8');
    const parsed = JSON.parse(text) as CapturedShape;
    if (!parsed.url) return null;
    return parsed;
  } catch (err) {
    logger.warn(`[forms-runtime] captured shape at ${CAPTURED_SHAPE_PATH} present but unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Build the candidate endpoint URLs to try, in priority order.
 *
 * Priority:
 *   1. If /tmp/forms-submit-shape.json exists with a captured `url`, use it
 *      AS the only candidate (we have ground truth — don't guess).
 *   2. Otherwise try the documented "runtime" path first, fall back to
 *      "formapi" (we've seen /formapi/api/.../{form}/responses references in
 *      some Forms internal docs).
 */
function buildCandidateEndpoints(
  formId: string,
  tenantId: string,
  userId: string,
  captured: CapturedShape | null,
): string[] {
  if (captured?.url) {
    // Substitute the formId from the captured URL with our target formId.
    const subst = captured.url.replace(/forms\('[^']+'\)/, `forms('${formId}')`);
    return [subst];
  }
  // CONFIRMED via live capture 2026-05-25 22:27 UTC:
  // POST /formapi/api/{tenant}/users/{user}/forms('{form}')/responses
  // (NOT /runtime/api/, NOT path-without-users-segment).
  return [
    `https://forms.office.com/formapi/api/${tenantId}/users/${userId}/forms('${formId}')/responses`,
  ];
}

// ---------------------------------------------------------------------------
// Submit driver
// ---------------------------------------------------------------------------

/**
 * Submit a form response via the runtime API. Hard-confirm gated.
 *
 * The flow:
 *   1. Refuse if confirm:false. (no IO)
 *   2. Parse formUrl → formId.
 *   3. Attach to the user's Chrome via CDP.
 *   4. GET the form schema (proven design endpoint).
 *   5. Map user answers → Forms internal shape.
 *   6. POST to runtime endpoint candidates. First 200/201 wins.
 *   7. Return responseId on success.
 *
 * On 404 from ALL candidates: throw CAPTURE_NEEDED with a pointer at
 *   scripts/forms-capture-submit.ts so the operator can lock in the shape.
 */
export async function submitFormResponse(args: SubmitArgs): Promise<SubmitResult> {
  // 1. Hard-confirm gate — refuse before any network IO.
  if (args.confirm !== true) {
    return {
      status: 'refused',
      reason:
        'Submit blocked: confirm flag not set. Show the principal the mapped answers and re-call submitFormResponse with confirm:true after they say yes.',
    };
  }

  // 2. URL parse.
  const parsed = parseFormUrl(args.formUrl);
  if (parsed.kind === 'unknown') {
    return { status: 'error', reason: `Could not parse form URL: ${parsed.reason}` };
  }
  if (parsed.kind === 'short_token') {
    return {
      status: 'error',
      reason:
        `Short-link Forms URL (/r/${parsed.token}) not yet supported by the API driver. Open the form in Chrome once so it redirects to /Pages/ResponsePage.aspx?id=… and pass that long-id URL instead. (Phase 2 will resolve short tokens automatically.)`,
    };
  }
  const formId = parsed.formId;

  const tenantId = args.tenantId ?? DEFAULT_TENANT;
  const userId = args.userId ?? DEFAULT_USER;
  const cdpEndpoint = args.cdpEndpoint ?? CDP_DEFAULT;
  logger.info(`[forms-runtime] submitFormResponse formId=${formId.slice(0, 16)}… answers=${Object.keys(args.answers).length}`);

  // 3. Attach.
  let attached: AttachedPage | null = null;
  try {
    attached = await attachAndFindFormsPage(args.formUrl, cdpEndpoint);
  } catch (err) {
    return {
      status: 'error',
      reason: `CDP attach failed: ${err instanceof Error ? err.message : String(err)}. Is Chrome running with --remote-debugging-port=18792?`,
    };
  }
  const { browser, page } = attached;

  try {
    // 4. Schema fetch — skip if caller pre-loaded one (e.g., from a cached
    // schema file, since the design API requires the form OWNER's auth which
    // the response page doesn't have).
    let schema: FormSchema;
    if (args.schema) {
      schema = args.schema;
    } else {
      try {
        schema = await getFormSchema(formId, page, { tenantId, userId });
      } catch (err) {
        return {
          status: 'error',
          reason: `Schema fetch failed: ${err instanceof Error ? err.message : String(err)}. If the response page can't reach the design API, pass a pre-loaded schema in args.schema.`,
        };
      }
    }

    if (schema.questions.length === 0) {
      return { status: 'error', reason: 'Form schema returned 0 questions. Form may be empty or schema endpoint is misbehaving.' };
    }

    // 5. Map answers.
    const { apiAnswers, errors: mappingErrors } = mapAnswersToApi(args.answers, schema);
    if (apiAnswers.length === 0) {
      return {
        status: 'error',
        reason: `No answers could be mapped onto the form schema. Mapping errors: ${mappingErrors.map((e) => `[${e.label}: ${e.reason}]`).join(' ')}`,
      };
    }
    if (mappingErrors.length > 0) {
      logger.warn(`[forms-runtime] partial mapping: ${apiAnswers.length}/${apiAnswers.length + mappingErrors.length} mapped. Errors: ${JSON.stringify(mappingErrors).slice(0, 400)}`);
    }

    // 6. Build the body. Captured shape (if present) is authoritative for
    // structure; otherwise we use the inferred Phase-1 shape from the plan doc.
    const captured = loadCapturedShape();
    const startDate = new Date(Date.now() - 60_000).toISOString(); // pretend the form was opened 60s ago
    const submitDate = new Date().toISOString();
    const body = {
      startDate,
      submitDate,
      // Forms double-encodes `answers` as a JSON STRING (this is the inferred
      // shape; if the capture shows it's a real array, swap once we lock it in).
      answers: JSON.stringify(apiAnswers),
    };
    const bodyJson = JSON.stringify(body);

    const candidates = buildCandidateEndpoints(formId, tenantId, userId, captured);
    const attempts: Array<{ url: string; status: number; text: string }> = [];

    for (const endpoint of candidates) {
      const inlineJs = `(async function() {
        var ofi = window.OfficeFormServerInfo || {};
        var headers = { 'content-type': 'application/json', 'accept': 'application/json' };
        if (ofi.antiForgeryToken) headers['__requestverificationtoken'] = ofi.antiForgeryToken;
        // Best-effort Bearer pull from MSAL cache (same approach as forms-bulk-add.ts).
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && /accesstoken|bearer/i.test(k)) {
              var v = localStorage.getItem(k);
              if (v && v.length > 200) {
                try { var parsed = JSON.parse(v); if (parsed.secret && parsed.secret.length > 200) { headers['authorization'] = 'Bearer ' + parsed.secret; break; } } catch(e) {}
                if (v.startsWith('eyJ')) { headers['authorization'] = 'Bearer ' + v; break; }
              }
            }
          }
        } catch(e) {}
        try {
          const r = await fetch(${JSON.stringify(endpoint)}, {
            method: 'POST',
            credentials: 'include',
            headers: headers,
            body: ${JSON.stringify(bodyJson)},
          });
          const text = await r.text();
          return { status: r.status, text: text.slice(0, 1000), hasAFT: !!headers['__requestverificationtoken'], hasAuth: !!headers['authorization'] };
        } catch (e) {
          return { status: 0, text: 'fetch threw: ' + (e && e.message ? e.message : String(e)), hasAFT: false, hasAuth: false };
        }
      })()`;

      const result = (await page.evaluate(inlineJs)) as {
        status: number;
        text: string;
        hasAFT: boolean;
        hasAuth: boolean;
      };
      attempts.push({ url: endpoint, status: result.status, text: result.text });
      logger.info(`[forms-runtime] POST ${endpoint.slice(0, 100)} → ${result.status} (AFT=${result.hasAFT} Auth=${result.hasAuth})`);

      if (result.status === 200 || result.status === 201) {
        // Try to pull responseId out of the body.
        let responseId: string | undefined;
        try {
          const parsed_ = JSON.parse(result.text) as { id?: string; responseId?: string };
          responseId = parsed_.id ?? parsed_.responseId;
        } catch {
          /* leave undefined */
        }
        return {
          status: 'submitted',
          responseId,
          endpointUsed: endpoint,
          httpStatus: result.status,
        };
      }
      // 404 means "wrong endpoint, try next candidate". Other 4xx/5xx are
      // real errors we should bubble up immediately (auth, bad body, etc.).
      if (result.status !== 404) {
        return {
          status: 'error',
          reason: `Runtime POST ${result.status} from ${endpoint}: ${result.text.slice(0, 400)}`,
          endpointUsed: endpoint,
          httpStatus: result.status,
        };
      }
    }

    // 7. All candidates 404'd. Capture is needed.
    return {
      status: 'error',
      reason:
        `CAPTURE_NEEDED: all ${candidates.length} candidate runtime endpoints returned 404. ` +
        `The runtime POST shape has not been locked in yet. ` +
        `Run: pnpm exec tsx scripts/forms-capture-submit.ts, fill the form by hand, click Submit. ` +
        `That writes /tmp/forms-submit-shape.json which this client picks up automatically. ` +
        `Attempts: ${JSON.stringify(attempts.map((a) => ({ url: a.url, status: a.status }))).slice(0, 400)}`,
    };
  } finally {
    // We connected via CDP — closing here detaches but does NOT kill the user's Chrome.
    await browser.close().catch(() => null);
  }
}

// ---------------------------------------------------------------------------
// Convenience: schema fetch with auto-attach (for callers without a Page in hand)
// ---------------------------------------------------------------------------

export async function getFormSchemaByUrl(
  formUrl: string,
  opts: { cdpEndpoint?: string; tenantId?: string; userId?: string } = {},
): Promise<FormSchema> {
  const parsed = parseFormUrl(formUrl);
  if (parsed.kind !== 'long_id') {
    throw new Error(`Cannot fetch schema for ${parsed.kind} URL — pass a /Pages/ResponsePage.aspx?id=… or /Pages/DesignPageV2.aspx?id=… URL`);
  }
  const cdp = opts.cdpEndpoint ?? CDP_DEFAULT;
  const attached = await attachAndFindFormsPage(formUrl, cdp);
  try {
    return await getFormSchema(parsed.formId, attached.page, opts);
  } finally {
    await attached.browser.close().catch(() => null);
  }
}
