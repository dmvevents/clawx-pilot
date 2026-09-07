/**
 * On-device tool-catalog trim.
 *
 * The default on-device model (qwen2.5:3b-instruct) tool-cascades when the full
 * built-in catalog is injected: it wraps its answer in a spurious tool_call and
 * loops `process -> sessions_list -> sessions_yield -> subagents` (or hangs on a `tts` call that
 * has no provider), so the chat turn never terminates. See
 * skills/laptop/evidence/2026-08-03-windows-install-ui-flows/REPORT.md.
 *
 * The gateway resolves an effective tool policy from, among other layers,
 * `config.tools` (global) and `config.tools.byProvider[<providerKey>]`
 * (per-provider). Both feed `filterToolsByPolicy`, which gates EVERY tool —
 * including core built-ins like `tts`, `process`, `subagents`, `sessions_list`.
 * A per-provider `deny` list therefore trims the catalog for the on-device
 * model only, leaving cloud providers (Gemini/Sonnet) on the full catalog.
 *
 * IMPORTANT — why not the sandbox path: `agents.defaults.tools.sandbox.tools`
 * does NOT gate these tools. Tool-policy resolution never reads
 * `agents.defaults.tools`, and the `sandbox.tools` sub-path only binds when a
 * sandbox backend is active. The desktop app runs no sandbox, so that policy is
 * never applied. This was proven live on 2026-08-03.
 *
 * This module is intentionally pure (no I/O): `applyOnDeviceToolTrim` takes a
 * config object and returns a new one, so it is trivially unit-testable and
 * idempotent (running it twice yields identical state).
 */

/**
 * Tools denied for the on-device model. Chosen to remove exactly the
 * orchestration / media / web surfaces a principal chat turn never needs, while
 * keeping the tools that make the assistant useful:
 *
 *   Kept: read/write/edit (documents), message, exec/process-free reply path,
 *         and every plugin tool (outlook.*, forms.*, moe_* — plugin tools are
 *         not in this list, so they survive the deny filter).
 *   Denied: agent-orchestration + media + web tools the 3B model mis-fires on.
 *
 * `process` is denied to stop the `process -> sessions_list -> sessions_yield -> subagents`
 * cascade at its root. `exec` is intentionally NOT denied — a denied `exec`
 * degrades the coding/file tools the model legitimately uses, and `exec`
 * alone did not trigger the cascade in the direct-API repro.
 */
export const ONDEVICE_DENIED_TOOLS: readonly string[] = [
  // Speech — hangs the turn (no TTS provider registered on the desktop build).
  'tts',
  // Agent orchestration — the observed infinite-cascade tools.
  'process',
  'subagents',
  'sessions_list',
  'sessions_spawn',
  'sessions_yield',
  // Web/media — the 3B model reaches for these instead of answering.
  'web_search',
  'web_fetch',
  'image',
  'canvas',
] as const;

interface ToolPolicy {
  allow?: unknown;
  deny?: unknown;
  [key: string]: unknown;
}

interface ByProviderTools {
  [providerKey: string]: ToolPolicy | undefined;
}

interface ToolsConfig {
  byProvider?: ByProviderTools;
  [key: string]: unknown;
}

interface ConfigWithTools {
  tools?: ToolsConfig;
  [key: string]: unknown;
}

/** Union two string arrays, preserving order and dropping duplicates. */
function unionDeny(existing: unknown, additions: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  if (Array.isArray(existing)) existing.forEach(push);
  additions.forEach(push);
  return out;
}

/**
 * Returns true when `policy.deny` already contains every entry in
 * ONDEVICE_DENIED_TOOLS (so a re-apply would be a no-op).
 */
export function hasOnDeviceTrim(policy: ToolPolicy | undefined): boolean {
  if (!policy || !Array.isArray(policy.deny)) return false;
  const denySet = new Set(
    policy.deny.filter((v): v is string => typeof v === 'string').map((v) => v.trim()),
  );
  return ONDEVICE_DENIED_TOOLS.every((tool) => denySet.has(tool));
}

export interface OnDeviceToolTrimResult<T> {
  /** The (possibly new) config object. Referentially identical to the input when no change was needed. */
  config: T;
  /** true when this call added deny entries; false when it was already trimmed. */
  changed: boolean;
}

/**
 * Add the on-device deny list to `config.tools.byProvider[providerKey]`,
 * merging with (never clobbering) any existing allow/deny for that provider.
 *
 * Pure and idempotent:
 *   - Never mutates the input; returns a new object graph when it changes.
 *   - Returns the SAME reference with `changed:false` when the trim is already
 *     present, so callers can skip an unnecessary disk write.
 *   - Only touches the one `byProvider[providerKey]` entry — global `tools`,
 *     other providers, and every non-`tools` key are preserved verbatim.
 */
export function applyOnDeviceToolTrim<T extends ConfigWithTools>(
  config: T,
  providerKey: string,
): OnDeviceToolTrimResult<T> {
  const key = providerKey.trim();
  if (!key) return { config, changed: false };

  const existingProviderPolicy = config.tools?.byProvider?.[key];
  if (hasOnDeviceTrim(existingProviderPolicy)) {
    return { config, changed: false };
  }

  const nextDeny = unionDeny(existingProviderPolicy?.deny, ONDEVICE_DENIED_TOOLS);
  const nextProviderPolicy: ToolPolicy = {
    ...(existingProviderPolicy ?? {}),
    deny: nextDeny,
  };

  const nextByProvider: ByProviderTools = {
    ...(config.tools?.byProvider ?? {}),
    [key]: nextProviderPolicy,
  };

  const nextTools: ToolsConfig = {
    ...(config.tools ?? {}),
    byProvider: nextByProvider,
  };

  return {
    config: { ...config, tools: nextTools },
    changed: true,
  };
}
