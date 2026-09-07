/**
 * Per-day idempotency ledger for moe-form-filler. Prevents accidental
 * double-submission of the daily report when the user re-runs the flow.
 */
import type Store from 'electron-store';
import type { FormKind, IdempotencyLedgerEntry } from './types';

interface FormFillerStoreShape {
  schemaVersion: number;
  ledger: IdempotencyLedgerEntry[];
  /**
   * Ministry form response links for the signed-in principal profile. These may
   * be admin-provisioned per deployment or saved from Settings; never log them
   * because Forms links can expose tenant-specific workflow details.
   */
  formUrls: {
    dailyReport?: string;
    suspension?: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storeInstance: any = null;

async function getStore(): Promise<Store<FormFillerStoreShape>> {
  if (!storeInstance) {
    const Module = (await import('electron-store')).default;
    storeInstance = new Module<FormFillerStoreShape>({
      name: 'clawx-moe-form-filler',
      defaults: {
        schemaVersion: 1,
        ledger: [],
        formUrls: {},
      },
    });
  }
  return storeInstance;
}

export async function recordSubmission(entry: IdempotencyLedgerEntry): Promise<void> {
  const store = await getStore();
  const ledger = store.get('ledger');
  ledger.push(entry);
  // Keep last 200 entries — generous for the ~2 forms/day workflow.
  if (ledger.length > 200) ledger.splice(0, ledger.length - 200);
  store.set('ledger', ledger);
}

export async function findRecentSubmission(
  kind: FormKind,
  key: string,
): Promise<IdempotencyLedgerEntry | null> {
  const store = await getStore();
  const ledger = store.get('ledger');
  return ledger.find((e) => e.kind === kind && e.key === key) ?? null;
}

export async function getFormUrls(): Promise<FormFillerStoreShape['formUrls']> {
  const store = await getStore();
  return store.get('formUrls');
}

export async function setFormUrls(
  urls: Partial<FormFillerStoreShape['formUrls']>,
): Promise<void> {
  const store = await getStore();
  const current = store.get('formUrls');
  store.set('formUrls', { ...current, ...urls });
}
