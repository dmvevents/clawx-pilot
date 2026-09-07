/**
 * Persistent Storage
 * Electron-store wrapper for application settings
 */

import { randomBytes } from 'crypto';
import { app } from 'electron';
import { resolveSupportedLanguage } from '../../shared/language';

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let settingsStoreInstance: any = null;

/**
 * Generate a random token for gateway authentication
 */
function generateToken(): string {
  return `clawx-${randomBytes(16).toString('hex')}`;
}

/**
 * Application settings schema
 */
export interface AppSettings {
  // General
  theme: 'light' | 'dark' | 'system';
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;
  machineId: string;
  hasReportedInstall: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  gatewayToken: string;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: 'stable' | 'beta' | 'dev';
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  skippedVersions: string[];

  // UI State
  sidebarCollapsed: boolean;
  devModeUnlocked: boolean;
  setupComplete: boolean;

  // Presets
  selectedBundles: string[];
  enabledSkills: string[];
  disabledSkills: string[];

  // Reasoning display
  // 'auto' = inherit from DEFAULT_REASONING_VISIBILITY (feature flag).
  // Other values override the global default for this user.
  reasoningVisibility: 'auto' | 'hidden' | 'condensed' | 'expanded';

  // Preferred chat channel — Online (cloud) vs On this device (local Ollama).
  // Maps to a concrete provider account at send time via pickAccountForChannel.
  // Default 'on-device' for the principals' pilot (Hermes 3 8B).
  // Optional on purpose: an ABSENT value means "the principal has not chosen a
  // channel yet", which the cloud-gateway seed keys on to make Online the launch
  // default. A concrete value is only ever written by an explicit user toggle
  // (settings PUT) — never by a default — so a persisted value is authoritative
  // ONCE the one-time migration below has run (see channelDefaultMigrated).
  preferredChannel?: 'online' | 'on-device';

  // One-time marker, set the first time the cloud-gateway seed applies the
  // launch-channel default on this box. It gates a legacy-upgrade migration in
  // cloud-gateway-provider-seed.ts: an OLDER build's store constructor persisted
  // preferredChannel:'on-device' to disk (electron-store/conf writes the whole
  // defaults object at construction), which on an in-place upgrade is
  // indistinguishable from an explicit choice and would otherwise pin the box
  // on-device forever. The migration flips such a legacy value to Online exactly
  // once; after the marker is set, an explicit "On this device" toggle is
  // respected (moe.13 no-clobber). Optional + never defaulted, same reasoning as
  // preferredChannel.
  channelDefaultMigrated?: boolean;
}

/**
 * Default settings
 */
function getSystemLocale(): string {
  const preferredLanguages = typeof app.getPreferredSystemLanguages === 'function'
    ? app.getPreferredSystemLanguages()
    : [];
  return preferredLanguages[0]
    || (typeof app.getLocale === 'function' ? app.getLocale() : '')
    || Intl.DateTimeFormat().resolvedOptions().locale
    || 'en';
}

export function createDefaultSettings(): AppSettings {
  return {
    // General
    theme: 'system',
    language: resolveSupportedLanguage(getSystemLocale()),
    startMinimized: false,
    launchAtStartup: false,
    telemetryEnabled: true,
    machineId: '',
    hasReportedInstall: false,

    // Gateway
    gatewayAutoStart: true,
    gatewayPort: 18789,
    gatewayToken: generateToken(),
    proxyEnabled: false,
    proxyServer: '',
    proxyHttpServer: '',
    proxyHttpsServer: '',
    proxyAllServer: '',
    proxyBypassRules: '<local>;localhost;127.0.0.1;::1',

    // Update
    updateChannel: 'stable',
    autoCheckUpdate: true,
    autoDownloadUpdate: false,
    skippedVersions: [],

    // UI State
    sidebarCollapsed: false,
    devModeUnlocked: false,
    setupComplete: false,

    // Presets
    selectedBundles: ['principal'],
    enabledSkills: [],
    disabledSkills: [],

    // Reasoning display — auto inherits from feature-flag default.
    reasoningVisibility: 'auto',

    // preferredChannel is deliberately NOT defaulted here. electron-store's
    // `defaults` are returned by `.get()` even when a key was never written, so
    // defaulting it to 'on-device' made getSetting('preferredChannel') never
    // return undefined — which silently killed the cloud-gateway seed's
    // "set Online only when no choice exists yet" guard, leaving the shipped
    // pilot build on the on-device model despite seeding a working cloud
    // gateway. Callers that need a concrete launch value fall back to
    // 'on-device' explicitly (main/index.ts preflight); an explicit user toggle
    // persists a concrete value via the settings PUT.
  };
}

/**
 * Get the settings store instance (lazy initialization)
 */
async function getSettingsStore() {
  if (!settingsStoreInstance) {
    const Store = (await import('electron-store')).default;
    settingsStoreInstance = new Store<AppSettings>({
      name: 'settings',
      defaults: createDefaultSettings(),
    });
  }
  return settingsStoreInstance;
}

/**
 * Get a setting value
 */
export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const store = await getSettingsStore();
  return store.get(key);
}

/**
 * Set a setting value
 */
export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  const store = await getSettingsStore();
  store.set(key, value);
}

/**
 * Get all settings
 */
export async function getAllSettings(): Promise<AppSettings> {
  const store = await getSettingsStore();
  return store.store;
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<void> {
  const store = await getSettingsStore();
  store.clear();
}

/**
 * Export settings to JSON
 */
export async function exportSettings(): Promise<string> {
  const store = await getSettingsStore();
  return JSON.stringify(store.store, null, 2);
}

/**
 * Import settings from JSON
 */
export async function importSettings(json: string): Promise<void> {
  try {
    const settings = JSON.parse(json);
    const store = await getSettingsStore();
    store.set(settings);
  } catch {
    throw new Error('Invalid settings JSON');
  }
}
