/**
 * Renderer-side Microsoft Graph client.
 *
 * Just a thin typed wrapper around the IPC channels exposed by
 * electron/main/microsoft-graph-ipc.ts. All real work happens in the main
 * process (token cache, refresh, REST calls). Tools the agent invokes go
 * through the same `msgraph:rpc` channel so there's a single audit point.
 */

type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface MicrosoftGraphConfig {
  tenantId: string;
  clientId: string;
  scopes?: string[];
  redirectUri?: string;
  /** When true, inbox reads go through Microsoft Graph instead of the Chrome tab. */
  graphOutlookRead?: boolean;
  /** When true, draft/send go through Microsoft Graph instead of the Chrome tab. */
  graphOutlookCompose?: boolean;
}

export interface MicrosoftGraphAccount {
  accountId: string;
  email?: string;
  tenantId: string;
}

/**
 * Deterministic connection state derived in the main process from persisted
 * facts (config presence, token presence, token expiry). "authenticating" is
 * renderer-local while the sign-in invoke is pending; a cancelled sign-in
 * resolves that invoke with error code `CANCELLED`.
 */
export type MicrosoftGraphConnectionState =
  | 'unconfigured'
  | 'signed_out'
  | 'signed_in'
  | 'expired';

export interface MicrosoftGraphStatus {
  configured: boolean;
  signedIn: boolean;
  account: MicrosoftGraphAccount | null;
  expiresAt: number | null;
  mockMailbox: boolean;
  effectiveMock: boolean;
  /** Delegated scopes granted at sign-in; empty when signed out. */
  grantedScopes: string[];
  connectionState: MicrosoftGraphConnectionState;
}

export interface ManualCodePrompt {
  authorizationUrl: string;
  reason: 'port_in_use' | 'callback_timeout';
}

function bridge() {
  const renderer = (window as { electron?: { ipcRenderer?: unknown } }).electron?.ipcRenderer as
    | {
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
        on: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
        off: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
      }
    | undefined;
  if (!renderer) {
    throw new Error('Microsoft Graph requires the Electron IPC bridge (renderer-only API)');
  }
  return renderer;
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const env = (await bridge().invoke(channel, ...args)) as IpcEnvelope<T>;
  if (!env || env.ok !== true) {
    const error = env && 'error' in env ? env.error : { code: 'UNKNOWN', message: 'IPC failed' };
    const err = new Error(error.message);
    (err as Error & { code?: string }).code = error.code;
    throw err;
  }
  return env.data;
}

export const microsoftGraph = {
  status: () => call<MicrosoftGraphStatus>('msgraph:status'),
  getConfig: () => call<MicrosoftGraphConfig | null>('msgraph:get-config'),
  setConfig: (config: MicrosoftGraphConfig | null) =>
    call<undefined>('msgraph:set-config', config),
  signIn: (opts?: { promptSelectAccount?: boolean }) =>
    call<MicrosoftGraphAccount>('msgraph:sign-in', opts ?? {}),
  signOut: () => call<undefined>('msgraph:sign-out'),
  submitManualCode: (code: string) => call<undefined>('msgraph:submit-manual-code', code),
  setMockMailbox: (enabled: boolean) =>
    call<undefined>('msgraph:set-mock-mailbox', enabled),

  rpc: {
    me: () => call<Record<string, unknown>>('msgraph:rpc', 'me', undefined),
    listMessages: (args?: { top?: number; filter?: string; search?: string }) =>
      call<{ value: unknown[] }>('msgraph:rpc', 'listMessages', args ?? {}),
    getMessage: (id: string) => call<Record<string, unknown>>('msgraph:rpc', 'getMessage', id),
    createDraft: (args: {
      subject: string;
      body: string;
      to: string | string[];
      cc?: string | string[];
      bcc?: string | string[];
    }) => call<Record<string, unknown>>('msgraph:rpc', 'createDraft', args),
    sendMail: (args: {
      subject: string;
      body: string;
      to: string | string[];
      cc?: string | string[];
      bcc?: string | string[];
      saveToSent?: boolean;
    }) => call<{ ok: true }>('msgraph:rpc', 'sendMail', args),
  },

  on: {
    code: (listener: (payload: ManualCodePrompt) => void) => {
      const wrapped = (_: unknown, payload: unknown) => listener(payload as ManualCodePrompt);
      bridge().on('msgraph:code', wrapped);
      return () => bridge().off('msgraph:code', wrapped);
    },
    signedIn: (listener: (payload: MicrosoftGraphAccount) => void) => {
      const wrapped = (_: unknown, payload: unknown) =>
        listener(payload as MicrosoftGraphAccount);
      bridge().on('msgraph:signed-in', wrapped);
      return () => bridge().off('msgraph:signed-in', wrapped);
    },
    signedOut: (listener: () => void) => {
      const wrapped = () => listener();
      bridge().on('msgraph:signed-out', wrapped);
      return () => bridge().off('msgraph:signed-out', wrapped);
    },
    error: (listener: (payload: { message: string }) => void) => {
      const wrapped = (_: unknown, payload: unknown) =>
        listener(payload as { message: string });
      bridge().on('msgraph:error', wrapped);
      return () => bridge().off('msgraph:error', wrapped);
    },
  },
};
