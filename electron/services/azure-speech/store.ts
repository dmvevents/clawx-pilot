/**
 * Persistent store for the optional Azure Speech-to-Text fallback ASR.
 *
 * Kept in its own electron-store file (`clawx-azure-speech.json`) so that:
 *   - Azure Speech credentials (region + subscription key) live independently
 *     of the LLM provider store and the Microsoft Graph (Outlook) store. They
 *     are billed against the tenant's Azure subscription, not against an LLM
 *     vendor account.
 *   - A future migration to the OS keychain only has to move this one file.
 *
 * Default locale is `en-TT` (Trinidad & Tobago English) because the customer
 * is the Ministry of Education Trinidad & Tobago. Azure Speech has supported
 * en-TT since 2022.
 */
import type Store from 'electron-store';

export interface AzureSpeechConfig {
  /** Azure region short name (e.g. "eastus", "southcentralus"). */
  region: string;
  /** Speech resource subscription key (sometimes called "Key 1" / "Key 2"). */
  apiKey: string;
  /** BCP-47 language tag — defaults to en-TT. */
  locale: string;
}

interface AzureSpeechStoreShape {
  schemaVersion: number;
  config: AzureSpeechConfig;
}

const DEFAULT_CONFIG: AzureSpeechConfig = {
  region: '',
  apiKey: '',
  locale: 'en-TT',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storeInstance: any = null;

async function getStore(): Promise<Store<AzureSpeechStoreShape>> {
  if (!storeInstance) {
    const Module = (await import('electron-store')).default;
    storeInstance = new Module<AzureSpeechStoreShape>({
      name: 'clawx-azure-speech',
      defaults: {
        schemaVersion: 1,
        config: { ...DEFAULT_CONFIG },
      },
    });
  }
  return storeInstance;
}

export async function getAzureSpeechConfig(): Promise<AzureSpeechConfig> {
  const store = await getStore();
  const persisted = (store.get('config') as AzureSpeechConfig | undefined) ?? DEFAULT_CONFIG;
  return {
    region: (persisted.region ?? '').trim(),
    apiKey: (persisted.apiKey ?? '').trim(),
    locale: (persisted.locale ?? '').trim() || 'en-TT',
  };
}

export async function setAzureSpeechConfig(config: AzureSpeechConfig): Promise<void> {
  const store = await getStore();
  const region = (config.region ?? '').trim();
  const apiKey = (config.apiKey ?? '').trim();
  const locale = (config.locale ?? '').trim() || 'en-TT';
  store.set('config', { region, apiKey, locale });
}

export function isAzureSpeechConfigured(config: AzureSpeechConfig): boolean {
  return Boolean(config.region && config.apiKey);
}
