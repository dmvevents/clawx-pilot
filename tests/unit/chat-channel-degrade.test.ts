/**
 * Integration test for the send-time cloud → on-device failover wired into the
 * chat store (`docs/OFFLINE_ARCHITECTURE.md` §3.1).
 *
 * The pure policy is covered in `channel-degrade.test.ts`. What can only be
 * tested here is the plumbing invariant that actually matters in the field:
 * **degrading must not rewrite the principal's stored `preferredChannel`.** If
 * it ever does, a single dropped packet silently converts an Online user into
 * an on-device user forever, and nobody finds out until they ask why the
 * assistant "got worse".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, hostApiFetchMock, agentsState, settingsState, providerState } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  agentsState: { agents: [] as Array<Record<string, unknown>> },
  settingsState: {
    preferredChannel: 'online' as 'online' | 'on-device',
    setPreferredChannel: vi.fn(),
  },
  providerState: {
    accounts: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({ status: { state: 'running', port: 18789 }, rpc: gatewayRpcMock }),
  },
}));
vi.mock('@/stores/agents', () => ({
  useAgentsStore: { getState: () => agentsState },
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => settingsState },
}));
vi.mock('@/stores/providers', () => ({
  useProviderStore: { getState: () => providerState },
}));
vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

const BOTH_CHANNELS = [
  { id: 'google', type: 'google', vendorId: 'google', model: 'gemini-2.5-pro' },
  { id: 'ollama', type: 'ollama', vendorId: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b-instruct' },
];

/** Paths POSTed/PUT to the host API, in order. */
const calledPaths = () => hostApiFetchMock.mock.calls.map((c) => String(c[0]));
const degradeCalls = () => hostApiFetchMock.mock.calls.filter((c) => String(c[0]) === '/api/settings/degradeChannel');
const preferenceWrites = () => hostApiFetchMock.mock.calls.filter((c) => String(c[0]).includes('preferredChannel'));

async function loadStore() {
  const { useChatStore } = await import('@/stores/chat');
  useChatStore.setState({
    currentSessionKey: 'agent:main:main',
    currentAgentId: 'main',
    sending: true,
    activeRunId: 'run-1',
    messages: [],
    streamingTools: [],
    pendingToolImages: [],
    lastSentPayload: { text: 'summarise my last 5 emails', attachments: undefined, targetAgentId: null },
    degradedThisTurn: false,
    degradeNotice: null,
  });
  return useChatStore;
}

/** Emit the terminal error event the gateway sends when a model call dies. */
function emitError(store: Awaited<ReturnType<typeof loadStore>>, errorMessage: string) {
  store.getState().handleChatEvent({
    state: 'error',
    runId: 'run-1',
    sessionKey: 'agent:main:main',
    errorMessage,
  });
}

/** The failover runs in a floating promise; let the microtask queue drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('chat store: send-time channel degradation', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    gatewayRpcMock.mockReset();
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue({ success: true, modelRef: 'ollama/qwen2.5:3b-instruct' });
    agentsState.agents = [];
    settingsState.preferredChannel = 'online';
    settingsState.setPreferredChannel.mockReset();
    providerState.accounts = [...BOTH_CHANNELS];
  });

  it('degrades when the run dies with NO terminal event and the history poll finds the error (moe.16 gap)', async () => {
    // The hosts-blocked cloud run on the moe.16 VM ended with no 'error' or
    // 'final' stream event at all: only chat.history carried the
    // error-stopped assistant message. The loadHistory path set the banner
    // and never called maybeDegradeChannel — banner shown, channel stayed
    // Online, warm on-device model unused. This pins the catch-all wiring.
    const store = await loadStore();
    gatewayRpcMock.mockResolvedValue({
      messages: [
        { role: 'user', id: 'u1', content: [{ type: 'text', text: 'summarise my last 5 emails' }] },
        {
          role: 'assistant',
          id: 'a1',
          stopReason: 'error',
          errorMessage: 'LLM request failed: network connection error. rawError=Connection error.',
          content: [],
        },
      ],
    });

    await store.getState().loadHistory(true);
    await settle();

    expect(degradeCalls().length).toBe(1);
    expect(preferenceWrites().length).toBe(0);
  });

  it('does NOT degrade from a history-discovered error on session re-open (nothing sent this window)', async () => {
    // Re-opening a session whose LAST turn failed yesterday must not fail
    // over: the error is historical, not ours to act on. On a real re-open
    // this client has sent nothing, so lastSentPayload is null — that is the
    // signal we gate on (CLWX-93), not `sending`.
    const store = await loadStore();
    store.setState({ sending: false, activeRunId: null, lastSentPayload: null });
    gatewayRpcMock.mockResolvedValue({
      messages: [
        {
          role: 'assistant',
          id: 'a1',
          stopReason: 'error',
          errorMessage: 'LLM request failed: network connection error. rawError=Connection error.',
          content: [],
        },
      ],
    });

    await store.getState().loadHistory(true);
    await settle();

    expect(degradeCalls().length).toBe(0);
  });

  it('does NOT degrade a history-discovered error for a run adopted from the console (CLWX-93)', async () => {
    // The store flips `sending` true for a turn started on the gateway console
    // (adoption). If the loadHistory path gated on `sending`, it would resend a
    // message the principal never typed in this window. It gates on
    // lastSentPayload instead, which adoption never sets — so an adopted run's
    // terminal error surfaced by the poll must NOT fail over here.
    const store = await loadStore();
    store.setState({ sending: true, activeRunId: 'run-console', lastSentPayload: null });
    gatewayRpcMock.mockResolvedValue({
      messages: [
        {
          role: 'assistant',
          id: 'a1',
          stopReason: 'error',
          errorMessage: 'LLM request failed: network connection error. rawError=Connection error.',
          content: [],
        },
      ],
    });

    await store.getState().loadHistory(true);
    await settle();

    expect(degradeCalls().length).toBe(0);
  });

  it('NEVER writes preferredChannel when degrading', async () => {
    // The load-bearing assertion of this file.
    const store = await loadStore();
    emitError(store, 'TypeError: fetch failed');
    await settle();

    expect(degradeCalls()).toHaveLength(1);
    expect(preferenceWrites()).toEqual([]);
    expect(settingsState.setPreferredChannel).not.toHaveBeenCalled();
    // The renderer's own copy of the preference is untouched too.
    expect(settingsState.preferredChannel).toBe('online');
  });

  it('degrades and resends a clean turn that lost the network', async () => {
    const store = await loadStore();
    emitError(store, 'connect ECONNREFUSED 127.0.0.1:443');
    await settle();

    const [, init] = degradeCalls()[0] as [string, { method?: string; body?: string }];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({ channel: 'on-device', reason: 'unreachable' });

    // Resent, so the principal's message ran on-device rather than being lost.
    expect(calledPaths()).toContain('/api/settings/degradeChannel');
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: true });
    expect(store.getState().degradedThisTurn).toBe(true);
  });

  it('reports a fleet 429 as rate-limited, not as an unreachable network', async () => {
    // These get different user-facing copy: "no internet" vs "service busy".
    // Telling a principal on a working network that they are offline is a
    // support call waiting to happen.
    const store = await loadStore();
    emitError(store, 'Request failed with status code 429');
    await settle();

    expect(JSON.parse(String((degradeCalls()[0] as [string, { body: string }])[1].body)))
      .toMatchObject({ reason: 'rate-limited' });
    expect(store.getState().degradeNotice?.reason).toBe('rate-limited');
  });

  it('does not degrade on an auth failure — the real error stays on screen', async () => {
    // A 401 from APIM means a wrong subscription key. Degrading would hide a
    // misconfiguration indefinitely.
    const store = await loadStore();
    emitError(store, 'HTTP 401 Unauthorized');
    await settle();

    expect(degradeCalls()).toEqual([]);
    expect(store.getState().degradeNotice).toBeNull();
    expect(store.getState().error).toContain('401');
  });

  it('does not degrade when no on-device model is configured', async () => {
    providerState.accounts = [BOTH_CHANNELS[0]];
    const store = await loadStore();
    emitError(store, 'fetch failed');
    await settle();

    expect(degradeCalls()).toEqual([]);
    expect(store.getState().error).toBeTruthy();
  });

  it('moves the channel but does not replay a turn that already ran tools', async () => {
    const store = await loadStore();
    store.setState({
      streamingTools: [{ name: 'outlook.read_inbox', status: 'completed', updatedAt: Date.now() }],
    });
    emitError(store, 'fetch failed');
    await settle();

    expect(degradeCalls()).toHaveLength(1);
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: false });
  });

  it('leaves the original error visible when the failover itself fails', async () => {
    // If we cannot even reach the local host API, the honest thing to show is
    // the model error — not a cheerful "switched to this device" that is false.
    hostApiFetchMock.mockRejectedValue(new Error('host API unreachable'));
    const store = await loadStore();
    emitError(store, 'fetch failed');
    await settle();

    expect(store.getState().degradeNotice).toBeNull();
    expect(store.getState().error).toContain('fetch failed');
  });

  it('does not degrade twice for the same turn', async () => {
    const store = await loadStore();
    emitError(store, 'fetch failed');
    await settle();
    const first = degradeCalls().length;

    // A second terminal error arrives (e.g. the on-device retry also died).
    emitError(store, 'fetch failed');
    await settle();

    expect(degradeCalls().length).toBe(first);
  });

  it('does not fail over a run adopted from another client', async () => {
    // The store adopts runs started elsewhere (the gateway console on :18789)
    // by flipping `sending` true when an event arrives for a run it did not
    // start. Failing over one of those would resend whatever payload this
    // client happens to still be holding — a message the principal never typed
    // in this window.
    const store = await loadStore();
    store.setState({ sending: false, activeRunId: null });
    emitError(store, 'fetch failed');
    await settle();

    expect(degradeCalls()).toEqual([]);
    // Adoption itself still happened; we only declined to act on it.
    expect(store.getState().degradeNotice).toBeNull();
  });
});
