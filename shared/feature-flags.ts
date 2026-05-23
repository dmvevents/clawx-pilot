/**
 * Pilot-mode feature flags.
 *
 * The principals' pilot deployment hides developer-facing surfaces (Models
 * page, full skills marketplace, etc.) without removing the underlying
 * functionality. Each flag is a single boolean; flip to false to restore the
 * original ClawX behaviour.
 *
 * Where to flip:
 *   - manually edit this file and rebuild, OR
 *   - set the corresponding env var at build time (intentionally undocumented
 *     for the pilot — keeps it out of principal-facing settings UIs)
 */

const env = (typeof process !== 'undefined' && process.env) ? process.env : {} as Record<string, string | undefined>;

function flagFromEnv(name: string, defaultValue: boolean): boolean {
  const raw = env[name];
  if (raw == null || raw === '') return defaultValue;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/** Master pilot toggle. Flip this single flag to restore developer-mode UI. */
export const PILOT_MODE = flagFromEnv('CLAWX_PILOT_MODE', true);

/**
 * Prefer OS-native ASR (Apple Speech.framework on macOS, Windows.Media.SpeechRecognition
 * on Windows) over the Python whisper CLI. On supported platforms this is faster
 * and keeps audio on-device with no extra dependencies. Falls back to the whisper
 * CLI automatically if the native helper binary is missing or fails.
 *
 * Default: true on darwin and win32 (the platforms we ship native helpers for),
 * false elsewhere (linux still goes through whisper).
 */
const isNativeAsrPlatform =
  typeof process !== 'undefined' &&
  (process.platform === 'darwin' || process.platform === 'win32');
export const PREFER_NATIVE_ASR = flagFromEnv('CLAWX_PREFER_NATIVE_ASR', isNativeAsrPlatform);

/**
 * Cloud fallback ASR: Azure Speech-to-Text.
 *
 * When `true`, the `asr:transcribe` handler attempts Azure first (assuming a
 * region + apiKey are configured under Settings → Azure Speech) and only falls
 * back to native / whisper if Azure fails or is not configured.
 *
 * When `false` (the default), Azure is only invoked via the explicit
 * `azure-speech:test` channel or via the streaming channel
 * `asr:transcribe-stream`. Existing single-shot `asr:transcribe` callers are
 * unaffected — native (or whisper) remains primary.
 *
 * Opt-in per deployment: set `CLAWX_PREFER_AZURE_SPEECH=1` at build time. The
 * Ministry of Education Trinidad & Tobago pilot will likely flip this on once
 * a Speech resource is provisioned in their Azure tenant.
 */
export const PREFER_AZURE_SPEECH = flagFromEnv('CLAWX_PREFER_AZURE_SPEECH', false);

// Models nav was hidden during early pilot scoping; re-enabled by request so
// principals (and us) can see which provider/model is actually in play. Set
// CLAWX_HIDE_MODELS_NAV=1 at build time to hide it again.
export const HIDE_MODELS_NAV = flagFromEnv('CLAWX_HIDE_MODELS_NAV', false);

/**
 * Hide per-request USD/cost figures from every renderer surface that currently
 * displays them (today: the Models → token usage history list).
 *
 * Backend cost calculation in `electron/utils/token-usage*.ts` and
 * `electron/api/routes/usage.ts` is intentionally left untouched — we still
 * compute and log per-request cost so MoE's metrics server can ingest it once
 * the telemetry pipeline lands. This flag only governs renderer visibility.
 *
 * Precedence (flag wins, dev-mode is the only escape):
 *   - HIDE_COST_IN_UI === false  →  cost is always rendered.
 *   - HIDE_COST_IN_UI === true   →  cost is hidden, UNLESS the user has
 *                                   unlocked developer mode in Settings
 *                                   (`useSettingsStore().devModeUnlocked`),
 *                                   in which case cost is rendered.
 *
 * Default tracks PILOT_MODE so the principals' build hides cost out of the
 * box. Override with `CLAWX_HIDE_COST_IN_UI=0` (e.g. internal QA builds) or
 * `CLAWX_HIDE_COST_IN_UI=1` to force-hide regardless of pilot status.
 */
export const HIDE_COST_IN_UI = flagFromEnv('CLAWX_HIDE_COST_IN_UI', PILOT_MODE);

/**
 * One-shot seed of a local OpenAI-compatible LLM provider (Ollama running
 * `nora:4b-v3.2` at http://127.0.0.1:11434/v1). When enabled, the app seeds
 * the provider account on first launch (idempotent — only when no account
 * with that baseUrl already exists). It is marked as default ONLY if no
 * other default already exists; otherwise it is added as a non-default
 * fallback. Set `CLAWX_SEED_LOCAL_LLM_PROVIDER=0` to disable.
 */
export const SEED_LOCAL_LLM_PROVIDER = flagFromEnv('CLAWX_SEED_LOCAL_LLM_PROVIDER', true);

/**
 * Auto-update is OFF by default in the MoE pilot. Reasons:
 *   1. The publish target in electron-builder.yml still points at the
 *      upstream Chinese OSS server (oss.intelli-spectrum.com) and the
 *      ValueCell-ai/ClawX GitHub repo. Until we own a release channel,
 *      a remote update could clobber the pilot with non-MoE upstream
 *      builds.
 *   2. The pilot binary is unsigned on Windows. SmartScreen will warn
 *      users on every auto-installed update — confusing and undermines
 *      trust.
 *   3. Updates to the pilot are delivered in person over Cat-5 today.
 *
 * Override with CLAWX_ENABLE_AUTO_UPDATE=1 for dev sessions where you
 * actually want to test the updater path.
 */
export const ENABLE_AUTO_UPDATE = flagFromEnv('CLAWX_ENABLE_AUTO_UPDATE', !PILOT_MODE);

/**
 * Agents and Cron stay visible by request — principals may need to manage
 * scheduled tasks and switch agents. Models is the only nav item we hide.
 * These flags remain for future tightening; default false keeps them shown.
 */
export const HIDE_AGENTS_NAV = flagFromEnv('CLAWX_HIDE_AGENTS_NAV', false);
export const HIDE_CRON_NAV = flagFromEnv('CLAWX_HIDE_CRON_NAV', false);

/**
 * Filter the Skills page to a curated set. When true, only the listed slugs
 * are visible; everything else is still installed and reachable
 * programmatically by the agent. Update PRINCIPAL_SKILL_ALLOWLIST below to
 * change the visible set without touching code.
 */
export const FILTER_SKILLS_TO_ALLOWLIST = flagFromEnv('CLAWX_FILTER_SKILLS', PILOT_MODE);

/**
 * Skills the principal sees on the Skills page. Includes the seven
 * preinstalled (pdf/xlsx/docx/pptx/find-skills/self-improving-agent/tavily-search)
 * plus the eleven explicitly chosen by the customer.
 */
export const PRINCIPAL_SKILL_ALLOWLIST = new Set<string>([
  // Preinstalled — auto-enabled at first run
  'pdf',
  'xlsx',
  'docx',
  'pptx',
  'find-skills',
  'self-improving-agent',
  'tavily-search',
  // Customer keep-list
  'blogwatcher',
  'bluebubbles',
  'goplaces',
  'imsg',
  'nano-pdf',
  'openai-whisper',
  'skill-creator',
  'summarize',
  'taskflow',
  'taskflow-inbox-triage',
  'weather',
  // Outlook (browser-session) — Phase-1 Outlook integration. The actual
  // outlook.* tools registered by the moe-principal-assistant plugin are
  // gated on this slug being present; remove it to disable outlook.* end
  // to end without changing code in the plugin.
  'outlook',
]);

/**
 * Reasoning visibility — three-state policy that controls whether the agent's
 * chain-of-thought (Apple's `<think>` blocks for Nora, Anthropic-shaped
 * thinking blocks for Claude, OpenAI's `reasoning` field for o3/GPT-5) shows
 * up in the chat UI.
 *
 *   - `hidden`    — strip reasoning entirely; user sees only the answer.
 *                   Gateway also sends thinking="off" so we don't pay
 *                   reasoning tokens we'll just throw away.
 *   - `condensed` — current behaviour: collapsed Execution Graph chip the
 *                   user can click to expand. Reasoning is *requested* from
 *                   the model but rendered as a small affordance.
 *   - `expanded`  — Execution Graph open by default; reasoning streams live
 *                   above the answer.
 *
 * Precedence (last writer wins):
 *   per-message brain-icon override
 *     → per-session thinkingLevel (chat store)
 *       → per-user setting (electron-store: reasoningVisibility)
 *         → global default (this flag)
 */
export type ReasoningVisibility = 'hidden' | 'condensed' | 'expanded';

const REASONING_VIS_VALUES: ReasoningVisibility[] = ['hidden', 'condensed', 'expanded'];

function reasoningVisFromEnv(name: string, fallback: ReasoningVisibility): ReasoningVisibility {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return (REASONING_VIS_VALUES as string[]).includes(raw) ? (raw as ReasoningVisibility) : fallback;
}

export const DEFAULT_REASONING_VISIBILITY: ReasoningVisibility = reasoningVisFromEnv(
  'CLAWX_REASONING_VIS',
  'condensed',
);
