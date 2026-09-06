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

/**
 * A `sessions.patch` acknowledgement proving the session now resolves to the
 * on-device model. `resolved` is the gateway's readback of the EFFECTIVE model
 * after the write — the only honest evidence the cutover took, which is why the
 * store checks it instead of treating "the RPC returned" as success.
 */
const PATCH_ACK = {
  ok: true,
  key: 'agent:main:main',
  resolved: { modelProvider: 'ollama', model: 'qwen2.5:3b-instruct' },
};

/**
 * Install a method-keyed rpc mock: `sessions.patch` confirms the cutover, every
 * other method (chat.history, chat.send) gets `rest`. The degrade path awaits a
 * session patch AND a history/send RPC on the same mock, so a bare
 * mockResolvedValue would answer the patch with a history payload and read as a
 * failed cutover.
 */
function mockHistory(rest: unknown) {
  gatewayRpcMock.mockImplementation(async (method: string) =>
    (method === 'sessions.patch' ? PATCH_ACK : rest));
}

/** Paths POSTed/PUT to the host API, in order. */
const calledPaths = () => hostApiFetchMock.mock.calls.map((c) => String(c[0]));
/** `sessions.patch` calls, in order: [{ key, model }]. */
const patchCalls = () => gatewayRpcMock.mock.calls
  .filter((c) => c[0] === 'sessions.patch')
  .map((c) => c[1] as { key?: string; model?: string | null });
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
    mockHistory(undefined);
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
    mockHistory({
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
    mockHistory({
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
    mockHistory({
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
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: true, to: 'on-device' });
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
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: false, to: 'on-device' });
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

  // ── On-device outage direction (K13). A dead local model prompts a switch to
  //    Online; it must NEVER auto-move the channel or send on-device data to the
  //    cloud, so no degradeChannel POST and no preference write may occur. ──
  it('prompts a switch to Online when the on-device model dies, without moving the channel', async () => {
    const store = await loadStore();
    settingsState.preferredChannel = 'on-device'; // running on-device by choice
    emitError(store, 'LLM request failed: network connection error. rawError=Connection error.');
    await settle();

    // The load-bearing privacy invariant: nothing was sent off-box.
    expect(degradeCalls()).toEqual([]);
    expect(preferenceWrites()).toEqual([]);
    expect(settingsState.setPreferredChannel).not.toHaveBeenCalled();
    // The principal gets an actionable, anonymised prompt instead of raw errors.
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: false, to: 'online' });
  });

  it('classifies a fleet 429 on-device outage as rate-limited in the switch prompt', async () => {
    const store = await loadStore();
    settingsState.preferredChannel = 'on-device';
    emitError(store, 'Request failed with status code 429');
    await settle();

    expect(degradeCalls()).toEqual([]);
    expect(store.getState().degradeNotice).toEqual({ reason: 'rate-limited', resent: false, to: 'online' });
  });

  it('surfaces the real error (no switch prompt) when on-device dies and there is no Online account', async () => {
    providerState.accounts = [BOTH_CHANNELS[1]]; // ollama only — nowhere to switch to
    const store = await loadStore();
    settingsState.preferredChannel = 'on-device';
    emitError(store, 'fetch failed');
    await settle();

    expect(degradeCalls()).toEqual([]);
    expect(store.getState().degradeNotice).toBeNull();
    expect(store.getState().error).toBeTruthy();
  });

  it('does not prompt a switch for a real on-device error — the error stays on screen', async () => {
    const store = await loadStore();
    settingsState.preferredChannel = 'on-device';
    emitError(store, 'HTTP 401 Unauthorized');
    await settle();

    expect(degradeCalls()).toEqual([]);
    expect(store.getState().degradeNotice).toBeNull();
    expect(store.getState().error).toContain('401');
  });

  // ── Active channel derives from the runtime default account, not the stored
  //    preference (CLWX-94/96). A boot preflight or an earlier degrade can move
  //    the runtime default onto on-device while `preferredChannel` still reads
  //    "online". Deriving the active channel from the preference would then
  //    mis-read an already-on-device turn as cloud and try to degrade it again
  //    (a redundant channel write + a resend of a turn that already ran local).
  it('treats an unreachable error as an on-device outage when the DEFAULT account is on-device, even if the preference still says online (CLWX-94)', async () => {
    // Runtime truth: the on-device account is marked isDefault (what
    // getActiveChannel reads). The preference lags at "online".
    providerState.accounts = [
      { id: 'google', type: 'google', vendorId: 'google', model: 'gemini-2.5-pro' },
      { id: 'ollama', type: 'ollama', vendorId: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b-instruct', isDefault: true },
    ];
    settingsState.preferredChannel = 'online';
    const store = await loadStore();
    emitError(store, 'LLM request failed: network connection error. rawError=Connection error.');
    await settle();

    // Because the runtime is ACTUALLY on-device, this is the K13 direction: a
    // prompt to switch to Online, never a silent cloud→on-device degrade. If the
    // channel were derived from the (stale) preference it would POST a redundant
    // degradeChannel instead.
    expect(degradeCalls()).toEqual([]);
    expect(preferenceWrites()).toEqual([]);
    expect(settingsState.setPreferredChannel).not.toHaveBeenCalled();
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: false, to: 'online' });
  });

  // ── Run-ownership token (CLWX-94). The degrade path resends the failed turn,
  //    creating a newer run. Until that resend's RPC returns, `activeRunId` still
  //    names the old run, so a late terminal event for the old run passes the
  //    active-run filter. It must not clear the newer send's replay payload. ──
  it('does not let a superseded run\'s late final clear a newer send\'s replay payload (CLWX-94)', async () => {
    const store = await loadStore();

    // Turn one commits generation 1 and binds run-A to it.
    gatewayRpcMock.mockResolvedValueOnce({ runId: 'run-A' });
    await store.getState().sendMessage('first turn');
    expect(store.getState().activeRunId).toBe('run-A');

    // Turn two commits generation 2 (a fresh replay payload) but its RPC hangs,
    // so activeRunId is still 'run-A' — the exact mid-resend window.
    gatewayRpcMock.mockImplementationOnce(() => new Promise<{ runId: string }>(() => {}));
    void store.getState().sendMessage('second turn');
    await settle();
    expect(store.getState().lastSentPayload?.text).toBe('second turn');

    // A late clean final for the SUPERSEDED run-A arrives. It clears the
    // active-run filter (activeRunId is still run-A) but belongs to generation 1,
    // so it must NOT wipe the generation-2 payload the newer send may replay.
    store.getState().handleChatEvent({
      state: 'final',
      runId: 'run-A',
      sessionKey: 'agent:main:main',
      message: { role: 'assistant', id: 'a-A', stopReason: 'stop', content: [{ type: 'text', text: 'stale answer' }] },
    });
    await settle();

    expect(store.getState().lastSentPayload?.text).toBe('second turn');
  });

  it('clears the replay payload when the owning run finishes cleanly (CLWX-94)', async () => {
    const store = await loadStore();

    gatewayRpcMock.mockResolvedValueOnce({ runId: 'run-A' });
    await store.getState().sendMessage('only turn');
    expect(store.getState().lastSentPayload?.text).toBe('only turn');

    // The run that still owns the payload produces a real answer → payload is no
    // longer needed for replay and must be cleared.
    store.getState().handleChatEvent({
      state: 'final',
      runId: 'run-A',
      sessionKey: 'agent:main:main',
      message: { role: 'assistant', id: 'a-A', stopReason: 'stop', content: [{ type: 'text', text: 'here is your answer' }] },
    });
    await settle();

    expect(store.getState().lastSentPayload).toBeNull();
  });

  // ── Runtime cutover (cross-model adversarial review, 2026-09-06). Writing the
  //    four config stores does NOT move the running gateway: it resolves each
  //    turn from a snapshot pinned at boot, and the only external-write pickup is
  //    a watcher that debounces, batches, and can be switched off. So the degrade
  //    pins the SESSION model over the RPC and waits for the acknowledgement.
  //    Without that, the "failover" resends on the provider that just failed. ──
  it('pins the session onto the on-device model and only resends AFTER the gateway acknowledges', async () => {
    const store = await loadStore();
    emitError(store, 'fetch failed');
    await settle();

    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' }]);
    // Order is the whole point: a resend dispatched before the cutover lands
    // runs on the failed cloud provider. (chat.history from the recovery poll
    // is unrelated traffic on the same mock.)
    expect(gatewayRpcMock.mock.calls.map((c) => c[0]).filter((m) => m !== 'chat.history'))
      .toEqual(['sessions.patch', 'chat.send']);
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: true, to: 'on-device' });
  });

  it('does NOT resend when the gateway acknowledges a DIFFERENT model than requested', async () => {
    // The patch can succeed and still land elsewhere (alias, allowlist rewrite,
    // a ref the model catalogue does not carry). The ack's `resolved` block is
    // the effective model, so a mismatch means the turn would still run online.
    const store = await loadStore();
    gatewayRpcMock.mockImplementation(async (method: string) => (method === 'sessions.patch'
      ? { ok: true, resolved: { modelProvider: 'google', model: 'gemini-2.5-pro' } }
      : undefined));

    emitError(store, 'fetch failed');
    await settle();

    expect(degradeCalls()).toHaveLength(1);
    expect(patchCalls()).toHaveLength(1);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    // Honest copy: the switch could not be completed, and the real error stays.
    expect(store.getState().degradeNotice)
      .toEqual({ reason: 'unreachable', resent: false, to: 'on-device', cutoverConfirmed: false });
    expect(store.getState().error).toContain('fetch failed');
  });

  it('does NOT resend when the session patch itself fails', async () => {
    const store = await loadStore();
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.patch') throw new Error('RPC timeout: sessions.patch');
      return undefined;
    });

    emitError(store, 'fetch failed');
    await settle();

    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().degradeNotice)
      .toEqual({ reason: 'unreachable', resent: false, to: 'on-device', cutoverConfirmed: false });
  });

  it('does NOT resend when the degrade route returns no model ref to pin', async () => {
    // Nothing to patch means nothing can be proven; claiming the switch anyway
    // is the failure this path exists to prevent.
    hostApiFetchMock.mockResolvedValue({ success: true });
    const store = await loadStore();

    emitError(store, 'fetch failed');
    await settle();

    expect(patchCalls()).toEqual([]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().degradeNotice?.cutoverConfirmed).toBe(false);
  });

  it('pins the session even when the turn is NOT replayed (tools already ran)', async () => {
    // The principal's own retry must land on-device too, so the cutover is not
    // conditional on the replay.
    const store = await loadStore();
    store.setState({
      streamingTools: [{ name: 'outlook.read_inbox', status: 'completed', updatedAt: Date.now() }],
    });

    emitError(store, 'fetch failed');
    await settle();

    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' }]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: false, to: 'on-device' });
  });

  it('clears the session pin when the principal picks a channel explicitly', async () => {
    // A pin outranks the config default on every turn, so a toggle that only
    // rewrote the four stores would look applied and change nothing.
    const store = await loadStore();

    await expect(store.getState().clearSessionModelPin()).resolves.toBe(true);

    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: null }]);
  });

  it('reports a failed pin clear rather than assuming it worked', async () => {
    const store = await loadStore();
    gatewayRpcMock.mockImplementation(async () => { throw new Error('gateway not connected'); });

    await expect(store.getState().clearSessionModelPin()).resolves.toBe(false);
  });

  it('drops a pin left by an earlier app run on the first send, once, and only when the default is Online', async () => {
    // A pin lives on disk and survives quitting the app, and the boot preflight
    // that re-applies preferredChannel cannot see it. Without this a school that
    // lost the network on Monday would answer from the on-device model all week
    // with the composer still reading Online.
    providerState.accounts = [
      { id: 'google', type: 'google', vendorId: 'google', model: 'gemini-2.5-pro', isDefault: true },
      { id: 'ollama', type: 'ollama', vendorId: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b-instruct' },
    ];
    const store = await loadStore();

    await store.getState().sendMessage('first turn');
    await store.getState().sendMessage('second turn');

    // One reconcile for the session, not one per send.
    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: null }]);
  });

  it('does NOT drop the pin while the configured channel is still on-device (mid-outage)', async () => {
    // Clearing here would undo a legitimate failover and send the next turn back
    // out on the dead cloud provider.
    providerState.accounts = [
      { id: 'google', type: 'google', vendorId: 'google', model: 'gemini-2.5-pro' },
      { id: 'ollama', type: 'ollama', vendorId: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b-instruct', isDefault: true },
    ];
    const store = await loadStore();

    await store.getState().sendMessage('a turn during the outage');

    expect(patchCalls()).toEqual([]);
  });
});

describe('chat store: run-error banner lifecycle from history (moe.18 Finding D0)', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    gatewayRpcMock.mockReset();
    mockHistory(undefined);
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue({ success: true, modelRef: 'ollama/qwen2.5:3b-instruct' });
    agentsState.agents = [];
    settingsState.preferredChannel = 'online';
    settingsState.setPreferredChannel.mockReset();
    providerState.accounts = [...BOTH_CHANNELS];
  });

  const ERRORED_HISTORY = {
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
  };

  it('paints the banner when an ACTIVE own turn dies silently and no on-device fallback exists', async () => {
    const store = await loadStore();
    store.setState({ lastUserMessageAt: Date.now(), runError: null });
    providerState.accounts = [BOTH_CHANNELS[0]]; // online only — nothing to fail over to
    mockHistory(ERRORED_HISTORY);

    await store.getState().loadHistory(true);
    await settle();

    expect(store.getState().runError).toContain('network connection error');
    expect(degradeCalls().length).toBe(0);
  });

  it('clears the banner when the same discovery successfully resends on-device (notice replaces it)', async () => {
    // With a warm on-device model the failover replays the turn and the amber
    // notice takes over — a red banner alongside it is exactly the D1 stack.
    const store = await loadStore();
    store.setState({ lastUserMessageAt: Date.now(), runError: null });
    mockHistory(ERRORED_HISTORY);

    await store.getState().loadHistory(true);
    await settle();

    expect(degradeCalls().length).toBe(1);
    expect(store.getState().runError).toBeNull();
    expect(store.getState().degradeNotice?.resent).toBe(true);
  });

  it('does NOT re-seed the banner on a later reload of the same window (post-gateway-restart / K12 shape)', async () => {
    // After the first discovery the store nulls lastUserMessageAt; the
    // retained lastSentPayload alone must not repaint a stale banner on the
    // next history reload (moe.18: banner survived a gateway restart and
    // cleared only on app relaunch). Failover is disabled (online-only) so
    // this row FAILS on the old unconditional seed instead of passing
    // vacuously via the auto-resend's own banner clear (Codex lane finding).
    const store = await loadStore();
    store.setState({ sending: false, activeRunId: null, lastUserMessageAt: null, runError: null });
    providerState.accounts = [BOTH_CHANNELS[0]];
    mockHistory(ERRORED_HISTORY);

    await store.getState().loadHistory(true);
    await settle();

    expect(store.getState().runError).toBeNull();
  });

  it('paints the banner for an attachment-only own send (empty text, payload present)', async () => {
    // Ownership for painting is payload PRESENCE; the text gate belongs only
    // to the replay decision. An attachment-only send whose run dies silently
    // must still surface (Codex lane finding: it was the only visible
    // surface — empty-content error messages render nothing in-line).
    const store = await loadStore();
    store.setState({
      lastUserMessageAt: Date.now(),
      runError: null,
      lastSentPayload: { text: '', attachments: [{ path: '/tmp/report.pdf' }], targetAgentId: null } as never,
    });
    providerState.accounts = [BOTH_CHANNELS[0]];
    mockHistory(ERRORED_HISTORY);

    await store.getState().loadHistory(true);
    await settle();

    expect(store.getState().runError).toContain('network connection error');
    // No replayable text → the failover must not have been attempted.
    expect(degradeCalls().length).toBe(0);
  });

  it('clears a success-claiming resent notice when the resend itself fails terminally', async () => {
    // After a cloud→on-device failover the notice says the answer came from
    // this device. If the resent run then dies, that notice explains nothing
    // and must not outlive (and thereby suppress) the new failure (Codex
    // lane finding: the failed resend was invisible behind the stale notice).
    const store = await loadStore();
    store.setState({
      degradeNotice: { reason: 'unreachable', resent: true, to: 'on-device' } as never,
      degradedThisTurn: true,
      runError: null,
    });

    emitError(store, 'Connection error.');
    await settle();

    // This event shape (no terminal assistant message) surfaces via the
    // error bar; either red surface satisfies visibility — the point is the
    // stale notice is gone so nothing suppresses it.
    expect(store.getState().error).toBe('Connection error.');
    expect(store.getState().runError).toBeNull();
    expect(store.getState().degradeNotice).toBeNull();
  });

  it('does NOT paint the banner from a historical error on session re-open (nothing sent this window)', async () => {
    const store = await loadStore();
    store.setState({ sending: false, activeRunId: null, lastSentPayload: null, lastUserMessageAt: null, runError: null });
    mockHistory(ERRORED_HISTORY);

    await store.getState().loadHistory(true);
    await settle();

    expect(store.getState().runError).toBeNull();
  });

  it('clears rather than paints for an adopted console turn (CLWX-93 discipline)', async () => {
    // Adoption can flip sending/lastUserMessageAt for a turn the principal
    // never typed here; without lastSentPayload the banner must not paint.
    const store = await loadStore();
    store.setState({ sending: true, activeRunId: 'run-console', lastSentPayload: null, lastUserMessageAt: Date.now(), runError: 'stale from a previous own turn' });
    mockHistory(ERRORED_HISTORY);

    await store.getState().loadHistory(true);
    await settle();

    expect(store.getState().runError).toBeNull();
  });

  it('preserves an existing banner while no turn is active (history stays non-authoritative)', async () => {
    // The banner's owner is the turn that raised it; an idle-window reload
    // neither re-seeds nor wipes it. New chat / next send / dismiss clear it.
    const store = await loadStore();
    store.setState({ sending: false, activeRunId: null, lastUserMessageAt: null, runError: 'own turn error painted earlier' });
    mockHistory({ messages: [] });

    await store.getState().loadHistory(true);
    await settle();

    expect(store.getState().runError).toBe('own turn error painted earlier');
  });
});
