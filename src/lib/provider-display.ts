/**
 * Provider display helpers — anonymised user-facing labels.
 *
 * Replaces vendor / model names with neutral "Online" / "On this device"
 * labels in surfaces visible to non-developer users. The underlying model
 * name remains accessible via dev-mode (see useSettingsStore.devModeUnlocked).
 */

export type ProviderClass = 'online' | 'on-device';

const ONLINE_VENDOR_IDS: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ark',
  'moonshot',
  'moonshot-global',
  'siliconflow',
  'deepseek',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
]);

const LOCAL_VENDOR_IDS: ReadonlySet<string> = new Set(['ollama']);

const LOCAL_HOST_PATTERN = /^(?:https?:\/\/)?(?:127(?:\.\d{1,3}){3}|localhost|::1|\[::1\])(?::\d+)?(?:\/|$)/i;

function baseUrlIsLocalhost(baseUrl: string | undefined | null): boolean {
  if (!baseUrl) return false;
  const trimmed = baseUrl.trim();
  if (!trimmed) return false;
  return LOCAL_HOST_PATTERN.test(trimmed);
}

/**
 * Classify a provider account as either "online" (cloud routed) or
 * "on-device" (local routed) for anonymised display.
 *
 * Rules (in order):
 *  1. baseUrl pointing at localhost / 127.0.0.1 → on-device
 *  2. vendorId === 'ollama' → on-device
 *  3. vendorId in known cloud set → online
 *  4. vendorId === 'custom' with non-localhost baseUrl → online
 *  5. fallback → online (safer default for an unknown remote endpoint)
 */
export function classifyProvider(account: {
  vendorId?: string;
  baseUrl?: string;
} | null | undefined): ProviderClass {
  if (!account) return 'online';
  const vendorId = (account.vendorId || '').trim().toLowerCase();
  const baseUrl = account.baseUrl;

  if (baseUrlIsLocalhost(baseUrl)) return 'on-device';
  if (LOCAL_VENDOR_IDS.has(vendorId)) return 'on-device';
  if (ONLINE_VENDOR_IDS.has(vendorId)) return 'online';
  if (vendorId === 'custom') return 'online';
  return 'online';
}

/** Human-readable label for a provider class. */
export function publicLabel(c: ProviderClass): string {
  return c === 'on-device' ? 'On this device' : 'Online';
}

/**
 * Return a Tailwind colour token (bg-* class) for the status dot.
 * `online === false` forces a disconnected red dot regardless of class.
 */
export function publicStatusDot(c: ProviderClass, online: boolean): string {
  if (!online) return 'bg-red-500';
  return c === 'on-device' ? 'bg-zinc-400' : 'bg-emerald-500';
}

/**
 * Pick the best provider account in a given channel from the available
 * accounts list.
 *
 * Selection rules (in priority order):
 *  1. The default account (`isDefault: true`) if it matches the channel
 *  2. The first enabled account in that channel
 *  3. Any account in that channel
 *  4. `null` if no account exists in that channel
 *
 * Used to map the principal's `Online`/`On this device` toggle to a concrete
 * runtime provider account on the send path.
 */
export function pickAccountForChannel<
  T extends { vendorId?: string; baseUrl?: string; isDefault?: boolean; enabled?: boolean }
>(
  accounts: ReadonlyArray<T>,
  channel: ProviderClass,
): T | null {
  const inChannel = accounts.filter((a) => classifyProvider(a) === channel);
  if (inChannel.length === 0) return null;

  const defaultMatch = inChannel.find((a) => a.isDefault === true);
  if (defaultMatch) return defaultMatch;

  const firstEnabled = inChannel.find((a) => a.enabled !== false);
  if (firstEnabled) return firstEnabled;

  return inChannel[0] ?? null;
}
