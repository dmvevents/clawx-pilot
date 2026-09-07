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
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    // Real member of the store surface: a proven cutover re-reads the provider
    // snapshot so a second failure this turn is judged against the runtime it
    // actually has. A mock missing it would throw inside the failover.
    refreshProviderSnapshot: vi.fn(async () => undefined),
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
 * The same two accounts with the cloud one PROVABLY default — the shape the
 * stale-pin reconcile is allowed to act on. Most degrade rows deliberately omit
 * `isDefault` (unproven default, reconcile stands down), so any row that has to
 * exercise the reconcile alongside a degrade must opt into this fixture.
 */
const ONLINE_DEFAULT = [
  { id: 'google', type: 'google', vendorId: 'google', model: 'gemini-2.5-pro', isDefault: true },
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
  gatewayRpcMock.mockImplementation(async (method: string, params: unknown) =>
    (method === 'sessions.patch' ? ackFor(params) : rest));
}

/**
 * Build the acknowledgement a healthy gateway would return for THIS patch, by
 * echoing the ref that was actually requested. A constant ack would confirm the
 * cutover no matter what the store asked for, so a mutation that corrupted the
 * requested ref (swapping provider and model, lowercasing it) would still read
 * as proven — the gate compares the ack against the ref it INTENDED to pin, so
 * the ack has to follow the request for that comparison to mean anything
 * (falsifiability lens, 2026-09-06).
 */
function ackFor(params: unknown) {
  const requested = String((params as { model?: unknown } | undefined)?.model ?? '');
  const slash = requested.indexOf('/');
  const key = (params as { key?: string } | undefined)?.key ?? 'agent:main:main';
  return {
    ok: true,
    key,
    entry: slash > 0
      ? { key, modelOverride: requested, providerOverride: requested.slice(0, slash) }
      : { key },
    resolved: slash > 0
      ? { modelProvider: requested.slice(0, slash), model: requested.slice(slash + 1) }
      : {},
  };
}

/** Paths POSTed/PUT to the host API, in order. */
const calledPaths = () => hostApiFetchMock.mock.calls.map((c) => String(c[0]));
/** `sessions.patch` calls, in order: [{ key, model }]. */
const patchCalls = () => gatewayRpcMock.mock.calls
  .filter((c) => c[0] === 'sessions.patch')
  .map((c) => c[1] as { key?: string; model?: string | null });
/**
 * `sessions.patch` calls as [model, timeoutMs] pairs. The budget is part of the
 * contract, not a detail: the pin WRITE sits in front of the first send of the
 * app run, so it gets a short budget, while the cutover happens inside an
 * already-failed turn and gets the full one. Neither is observable from the
 * model/key alone, so without this the numbers could be swapped or dropped and
 * every other row would stay green.
 */
const patchBudgets = () => gatewayRpcMock.mock.calls
  .filter((c) => c[0] === 'sessions.patch')
  .map((c) => [(c[1] as { model?: string | null }).model ?? null, c[2]] as [string | null, unknown]);
const degradeCalls = () => hostApiFetchMock.mock.calls.filter((c) => String(c[0]) === '/api/settings/degradeChannel');
const preferenceWrites = () => hostApiFetchMock.mock.calls.filter((c) => String(c[0]).includes('preferredChannel'));
const storedProviderProbeCalls = () => hostApiFetchMock.mock.calls.filter((c) => String(c[0]) === '/api/provider-accounts/default/probe');

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
    hostApiFetchMock.mockImplementation((path: unknown) => {
      if (String(path) === '/api/settings/degradeChannel') {
        return Promise.resolve({ success: true, modelRef: 'ollama/qwen2.5:3b-instruct' });
      }
      if (String(path) === '/api/provider-accounts/default/probe') {
        return Promise.resolve({ success: true, valid: true, accountId: 'google', channel: 'online', status: 200, reason: 'ok' });
      }
      return Promise.resolve({ success: true });
    });
    agentsState.agents = [];
    settingsState.preferredChannel = 'online';
    settingsState.setPreferredChannel.mockReset();
    providerState.accounts = [...BOTH_CHANNELS];
    providerState.refreshProviderSnapshot.mockReset();
    providerState.refreshProviderSnapshot.mockResolvedValue(undefined);
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

  // ── The switch is not instantaneous, and the wait used to be invisible. The
  //    config transaction plus the acknowledged cutover (15s budget) are both
  //    awaited inside the failed turn, behind a frozen error with nothing on
  //    screen moving. At 3:40pm against a 3:45pm deadline that reads as a hung
  //    app (principal-proxy trust lens, 2026-09-06). Both rows below fail if the
  //    notice is set after the awaits instead of before them. ──
  it('puts a progress notice up BEFORE the config transaction returns', async () => {
    const store = await loadStore();
    let releaseDegrade: (value: unknown) => void = () => {};
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/settings/degradeChannel'
      ? new Promise((resolve) => { releaseDegrade = resolve; })
      : Promise.resolve({ success: true })));

    emitError(store, 'fetch failed');
    await settle();

    // Mid-flight: nothing is proven yet, so the notice claims nothing — it only
    // says a switch is happening, and `inProgress` is what makes the UI spin.
    expect(store.getState().degradeNotice)
      .toEqual({ reason: 'unreachable', resent: false, to: 'on-device', inProgress: true });

    releaseDegrade({ success: true, modelRef: 'ollama/qwen2.5:3b-instruct' });
    await settle();

    // Replaced by the outcome, never left spinning.
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: true, to: 'on-device' });
  });

  it('keeps the progress notice up for the whole acknowledgement wait, then replaces it', async () => {
    const store = await loadStore();
    let releasePatch: (value: unknown) => void = () => {};
    gatewayRpcMock.mockImplementation((method: string) => (method === 'sessions.patch'
      ? new Promise((resolve) => { releasePatch = resolve; })
      : Promise.resolve(undefined)));

    emitError(store, 'fetch failed');
    await settle();

    // The config write has landed and the cutover RPC is outstanding — the part
    // of the window that can legitimately last seconds.
    expect(store.getState().degradeNotice?.inProgress).toBe(true);
    expect(patchCalls()).toHaveLength(1);

    releasePatch(PATCH_ACK);
    await settle();

    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: true, to: 'on-device' });
  });

  it('cancels a pending degrade when the original cloud run finishes through streaming', async () => {
    const store = await loadStore();
    let releaseDegrade: (value: unknown) => void = () => {};
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/settings/degradeChannel'
      ? new Promise((resolve) => { releaseDegrade = resolve; })
      : Promise.resolve({ success: true })));

    emitError(store, 'fetch failed');
    await settle();
    expect(store.getState().degradeNotice)
      .toEqual({ reason: 'unreachable', resent: false, to: 'on-device', inProgress: true });

    store.getState().handleChatEvent({
      state: 'final',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      message: { role: 'assistant', id: 'a-cloud', stopReason: 'stop', content: [{ type: 'text', text: 'cloud recovered' }] },
    });
    await settle();

    expect(store.getState().lastSentPayload).toBeNull();
    expect(store.getState().degradeNotice).toBeNull();

    releaseDegrade({
      success: true,
      modelRef: 'ollama/qwen2.5:3b-instruct',
      accountId: 'ollama-local',
      preferredChannelUnchanged: 'online',
    });
    await settle();

    expect(degradeCalls()).toHaveLength(1);
    expect(patchCalls()).toEqual([]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().runtimeChannelPin).toBeNull();
    expect(store.getState().degradeNotice).toBeNull();
  });

  it('cancels a pending degrade when history discovers the original cloud success', async () => {
    const store = await loadStore();
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/settings/degradeChannel'
      ? Promise.resolve({
        success: true,
        modelRef: 'ollama/qwen2.5:3b-instruct',
        accountId: 'ollama-local',
        preferredChannelUnchanged: 'online',
      })
      : Promise.resolve({ success: true })));
    let releasePatch: (value: unknown) => void = () => {};
    let patchCount = 0;
    let history = {
      messages: [
        { role: 'user', id: 'u1', content: [{ type: 'text', text: 'summarise my last 5 emails' }], timestamp: Date.now() / 1000 },
        {
          role: 'assistant',
          id: 'a1',
          stopReason: 'error',
          errorMessage: 'LLM request failed: network connection error. rawError=Connection error.',
          content: [],
          timestamp: Date.now() / 1000,
        },
      ],
    };
    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method === 'sessions.patch') {
        patchCount += 1;
        if (patchCount === 1) {
          return new Promise((resolve) => { releasePatch = resolve; });
        }
        return Promise.resolve(ackFor(params));
      }
      return Promise.resolve(history);
    });

    await store.getState().loadHistory(true);
    await settle();
    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' }]);
    expect(store.getState().degradeNotice?.inProgress).toBe(true);

    const now = Date.now();
    store.setState({
      sending: true,
      activeRunId: 'run-1',
      pendingFinal: true,
      lastUserMessageAt: now,
    });
    history = {
      messages: [
        { role: 'user', id: 'u1', content: [{ type: 'text', text: 'summarise my last 5 emails' }], timestamp: now / 1000 },
        {
          role: 'assistant',
          id: 'a-cloud',
          stopReason: 'stop',
          content: [{ type: 'text', text: 'cloud recovered from history' }],
          timestamp: (now + 1) / 1000,
        },
      ],
    };

    await store.getState().loadHistory(false);
    expect(store.getState().lastSentPayload).toBeNull();
    expect(store.getState().degradeNotice).toBeNull();

    releasePatch(PATCH_ACK);
    await settle();

    expect(patchCalls()).toEqual([
      { key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' },
      { key: 'agent:main:main', model: null },
    ]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().runtimeChannelPin).toBeNull();
    expect(store.getState().degradeNotice).toBeNull();
  });

  it('clears the stale session pin when cloud success arrives after the on-device pin is set', async () => {
    const store = await loadStore();
    let releaseClear: (value: unknown) => void = () => {};
    let patchCount = 0;
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/settings/degradeChannel'
      ? Promise.resolve({
        success: true,
        modelRef: 'ollama/qwen2.5:3b-instruct',
        accountId: 'ollama-local',
        preferredChannelUnchanged: 'online',
      })
      : Promise.resolve({ success: true })));
    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method !== 'sessions.patch') return Promise.resolve(undefined);
      patchCount += 1;
      if (patchCount === 2) {
        return new Promise((resolve) => { releaseClear = resolve; });
      }
      return Promise.resolve(ackFor(params));
    });
    providerState.refreshProviderSnapshot.mockImplementationOnce(() => {
      store.getState().handleChatEvent({
        state: 'final',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', id: 'a-cloud', stopReason: 'stop', content: [{ type: 'text', text: 'cloud recovered after pin' }] },
      });
      return Promise.resolve();
    });

    emitError(store, 'fetch failed');
    await settle();

    expect(degradeCalls()).toHaveLength(1);
    expect(patchCalls()).toEqual([
      { key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' },
      { key: 'agent:main:main', model: null },
    ]);
    expect(store.getState().degradeNotice)
      .toEqual({ reason: 'unreachable', resent: false, to: 'on-device', inProgress: true });
    expect(store.getState().runtimeChannelPin).toEqual({ sessionKey: 'agent:main:main', channel: 'on-device' });

    releaseClear(ackFor({ key: 'agent:main:main', model: null }));
    await settle();

    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().runtimeChannelPin).toBeNull();
    expect(store.getState().degradeNotice).toBeNull();
  });

  it('clears a stale pin without forcing an online model when the principal picked on-device before cleanup', async () => {
    const store = await loadStore();
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/settings/degradeChannel'
      ? Promise.resolve({
        success: true,
        modelRef: 'ollama/qwen2.5:3b-instruct',
        accountId: 'ollama-local',
        preferredChannelUnchanged: 'online',
      })
      : Promise.resolve({ success: true })));
    providerState.refreshProviderSnapshot.mockImplementationOnce(() => {
      settingsState.preferredChannel = 'on-device';
      store.getState().handleChatEvent({
        state: 'final',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', id: 'a-cloud', stopReason: 'stop', content: [{ type: 'text', text: 'cloud recovered after pin' }] },
      });
      return Promise.resolve();
    });

    emitError(store, 'fetch failed');
    await settle();

    expect(patchCalls()).toEqual([
      { key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' },
      { key: 'agent:main:main', model: null },
    ]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().runtimeChannelPin).toBeNull();
    expect(store.getState().degradeNotice).toBeNull();
  });

  it('keeps recovery observable when a new send resets the stale degrade notice before clear ack', async () => {
    const store = await loadStore();
    let releaseClear: (value: unknown) => void = () => {};
    let patchCount = 0;
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/settings/degradeChannel'
      ? Promise.resolve({
        success: true,
        modelRef: 'ollama/qwen2.5:3b-instruct',
        accountId: 'ollama-local',
      })
      : Promise.resolve({ success: true })));
    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method === 'sessions.patch') {
        patchCount += 1;
        if (patchCount === 2) {
          return new Promise((resolve) => { releaseClear = resolve; });
        }
        return Promise.resolve(ackFor(params));
      }
      if (method === 'chat.send') return Promise.resolve({ runId: 'run-new' });
      return Promise.resolve(undefined);
    });
    providerState.refreshProviderSnapshot.mockImplementationOnce(() => {
      store.getState().handleChatEvent({
        state: 'final',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', id: 'a-cloud', stopReason: 'stop', content: [{ type: 'text', text: 'cloud recovered after pin' }] },
      });
      return Promise.resolve();
    });

    emitError(store, 'fetch failed');
    await settle();

    expect(patchCalls()).toEqual([
      { key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' },
      { key: 'agent:main:main', model: null },
    ]);
    expect(store.getState().degradeNotice)
      .toEqual({ reason: 'unreachable', resent: false, to: 'on-device', inProgress: true });
    expect(store.getState().pendingChannelRecoveryBySession['agent:main:main']).toBe(1);

    await store.getState().sendMessage('new turn while restore is pending');
    expect(store.getState().degradeNotice).toBeNull();
    expect(store.getState().pendingChannelRecoveryBySession['agent:main:main']).toBe(1);

    releaseClear(ackFor({ key: 'agent:main:main', model: null }));
    await settle();

    expect(patchCalls()).toEqual([
      { key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' },
      { key: 'agent:main:main', model: null },
    ]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).toContain('chat.send');
    expect(store.getState().runtimeChannelPin).toBeNull();
    expect(store.getState().degradeNotice).toBeNull();
    expect(store.getState().pendingChannelRecoveryBySession['agent:main:main']).toBeUndefined();
  });

  it('clears the owned stale pin but preserves a newer notice while clear is pending', async () => {
    const store = await loadStore();
    let releaseClear: (value: unknown) => void = () => {};
    let patchCount = 0;
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/settings/degradeChannel'
      ? Promise.resolve({
        success: true,
        modelRef: 'ollama/qwen2.5:3b-instruct',
        accountId: 'ollama-local',
      })
      : Promise.resolve({ success: true })));
    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method !== 'sessions.patch') return Promise.resolve(undefined);
      patchCount += 1;
      if (patchCount === 2) {
        return new Promise((resolve) => { releaseClear = resolve; });
      }
      return Promise.resolve(ackFor(params));
    });
    providerState.refreshProviderSnapshot.mockImplementationOnce(() => {
      store.getState().handleChatEvent({
        state: 'final',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', id: 'a-cloud', stopReason: 'stop', content: [{ type: 'text', text: 'cloud recovered after pin' }] },
      });
      return Promise.resolve();
    });

    emitError(store, 'fetch failed');
    await settle();

    const newerNotice = { reason: 'rate-limited' as const, resent: false, to: 'on-device' as const, inProgress: true };
    store.setState({
      degradeNotice: newerNotice,
      lastSentPayload: { text: 'new turn', attachments: undefined, targetAgentId: null, generation: 999 },
    });
    releaseClear(ackFor({ key: 'agent:main:main', model: null }));
    await settle();

    expect(patchCalls()).toEqual([
      { key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' },
      { key: 'agent:main:main', model: null },
    ]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().runtimeChannelPin).toBeNull();
    expect(store.getState().degradeNotice).toBe(newerNotice);
    expect(store.getState().pendingChannelRecoveryBySession['agent:main:main']).toBeUndefined();
  });

  it('does not clear a newer pin object while a stale clear is pending', async () => {
    const store = await loadStore();
    let releaseClear: (value: unknown) => void = () => {};
    let patchCount = 0;
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/settings/degradeChannel'
      ? Promise.resolve({
        success: true,
        modelRef: 'ollama/qwen2.5:3b-instruct',
        accountId: 'ollama-local',
      })
      : Promise.resolve({ success: true })));
    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method !== 'sessions.patch') return Promise.resolve(undefined);
      patchCount += 1;
      if (patchCount === 2) {
        return new Promise((resolve) => { releaseClear = resolve; });
      }
      return Promise.resolve(ackFor(params));
    });
    providerState.refreshProviderSnapshot.mockImplementationOnce(() => {
      store.getState().handleChatEvent({
        state: 'final',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', id: 'a-cloud', stopReason: 'stop', content: [{ type: 'text', text: 'cloud recovered after pin' }] },
      });
      return Promise.resolve();
    });

    emitError(store, 'fetch failed');
    await settle();

    const newerPin = { sessionKey: 'agent:main:main', channel: 'on-device' as const };
    store.setState({ runtimeChannelPin: newerPin });
    releaseClear(ackFor({ key: 'agent:main:main', model: null }));
    await settle();

    expect(patchCalls()).toEqual([
      { key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' },
      { key: 'agent:main:main', model: null },
    ]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().runtimeChannelPin).toBe(newerPin);
    expect(store.getState().degradeNotice).toBeNull();
  });

  it('keeps the stale on-device pin visible when the cleanup clear fails', async () => {
    const store = await loadStore();
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/settings/degradeChannel'
      ? Promise.resolve({
        success: true,
        modelRef: 'ollama/qwen2.5:3b-instruct',
        accountId: 'ollama-local',
      })
      : Promise.resolve({ success: true })));
    let patchCount = 0;
    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method !== 'sessions.patch') return Promise.resolve(undefined);
      patchCount += 1;
      if (patchCount === 2) throw new Error('RPC timeout: sessions.patch');
      return Promise.resolve(ackFor(params));
    });
    providerState.refreshProviderSnapshot.mockImplementationOnce(() => {
      store.getState().handleChatEvent({
        state: 'final',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', id: 'a-cloud', stopReason: 'stop', content: [{ type: 'text', text: 'cloud recovered after pin' }] },
      });
      return Promise.resolve();
    });

    emitError(store, 'fetch failed');
    await settle();

    expect(patchCalls()).toEqual([
      { key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' },
      { key: 'agent:main:main', model: null },
    ]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().runtimeChannelPin).toEqual({ sessionKey: 'agent:main:main', channel: 'on-device' });
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: false, to: 'on-device' });
  });

  it('keeps the stale on-device pin visible when the cleanup clear ack still has an override', async () => {
    const store = await loadStore();
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/settings/degradeChannel'
      ? Promise.resolve({
        success: true,
        modelRef: 'ollama/qwen2.5:3b-instruct',
        accountId: 'ollama-local',
      })
      : Promise.resolve({ success: true })));
    let patchCount = 0;
    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method !== 'sessions.patch') return Promise.resolve(undefined);
      patchCount += 1;
      if (patchCount === 2) {
        return Promise.resolve({
          ok: true,
          key: 'agent:main:main',
          entry: {
            key: 'agent:main:main',
            modelOverride: 'ollama/qwen2.5:3b-instruct',
            providerOverride: 'ollama',
          },
          resolved: { modelProvider: 'ollama', model: 'qwen2.5:3b-instruct' },
        });
      }
      return Promise.resolve(ackFor(params));
    });
    providerState.refreshProviderSnapshot.mockImplementationOnce(() => {
      store.getState().handleChatEvent({
        state: 'final',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', id: 'a-cloud', stopReason: 'stop', content: [{ type: 'text', text: 'cloud recovered after pin' }] },
      });
      return Promise.resolve();
    });

    emitError(store, 'fetch failed');
    await settle();

    expect(patchCalls()).toEqual([
      { key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' },
      { key: 'agent:main:main', model: null },
    ]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().runtimeChannelPin).toEqual({ sessionKey: 'agent:main:main', channel: 'on-device' });
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: false, to: 'on-device' });
  });

  it('never leaves the progress notice spinning when the host API never answers', async () => {
    // The notice is deliberately not dismissible while it claims to be working,
    // and the host-API transport has no timeout of its own, so an unbounded wait
    // would strand the principal behind a permanent spinner — worse than the
    // frozen error this fix replaced. The failover bounds itself and falls back
    // to the honest outcome: no notice, real error, nothing resent.
    vi.useFakeTimers();
    try {
      const store = await loadStore();
      hostApiFetchMock.mockImplementation(() => new Promise(() => { /* never settles */ }));

      emitError(store, 'fetch failed');
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().degradeNotice?.inProgress).toBe(true);

      await vi.advanceTimersByTimeAsync(20_000);

      expect(store.getState().degradeNotice).toBeNull();
      expect(store.getState().error).toContain('fetch failed');
      expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    } finally {
      vi.useRealTimers();
    }
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
    // The principal's own retry must land on-device too while the Online
    // provider is still unavailable, so the cutover is not conditional on the
    // replay.
    providerState.accounts = [...ONLINE_DEFAULT];
    hostApiFetchMock.mockImplementation((path: unknown) => {
      if (String(path) === '/api/provider-accounts/default/probe') {
        return Promise.resolve({ success: true, valid: false, accountId: 'google', channel: 'online', status: 503, reason: 'unavailable' });
      }
      if (String(path) === '/api/settings/degradeChannel') {
        return Promise.resolve({ success: true, modelRef: 'ollama/qwen2.5:3b-instruct' });
      }
      return Promise.resolve({ success: true });
    });
    const store = await loadStore();
    store.setState({
      streamingTools: [{ name: 'outlook.read_inbox', status: 'completed', updatedAt: Date.now() }],
    });

    emitError(store, 'fetch failed');
    await settle();

    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' }]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).not.toContain('chat.send');
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: false, to: 'on-device' });

    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method === 'sessions.patch') return Promise.resolve(ackFor(params));
      if (method === 'chat.send') return Promise.resolve({ runId: 'run-retry' });
      return Promise.resolve(undefined);
    });
    await store.getState().sendMessage('manual retry');

    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' }]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).toContain('chat.send');

    store.getState().handleChatEvent({
      state: 'error',
      runId: 'run-retry',
      sessionKey: 'agent:main:main',
      errorMessage: 'fetch failed',
    });
    await settle();

    expect(degradeCalls()).toHaveLength(1);
    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' }]);
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: false, to: 'online' });
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

  it('clears an inactive same-session runtime pin on the next send after the stored Online provider is healthy', async () => {
    providerState.accounts = [...ONLINE_DEFAULT];
    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method === 'sessions.patch') return Promise.resolve(ackFor(params));
      if (method === 'chat.send') return Promise.resolve({ runId: 'run-after-runtime-pin-clear' });
      return Promise.resolve(undefined);
    });
    const store = await loadStore();
    const stalePin = { sessionKey: 'agent:main:main', channel: 'on-device' as const };
    store.setState({
      sending: false,
      activeRunId: null,
      lastSentPayload: null,
      runtimeChannelPin: stalePin,
      degradeNotice: { reason: 'unreachable', resent: false, to: 'on-device' },
    });

    await store.getState().sendMessage('retry after fallback completed');

    expect(storedProviderProbeCalls()).toHaveLength(1);
    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: null }]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).toContain('chat.send');
    expect(store.getState().runtimeChannelPin).toBeNull();
  });

  it('retries inactive runtime-pin recovery after a failed stored provider probe', async () => {
    providerState.accounts = [...ONLINE_DEFAULT];
    let probeCount = 0;
    hostApiFetchMock.mockImplementation((path: unknown) => {
      if (String(path) === '/api/provider-accounts/default/probe') {
        probeCount += 1;
        return Promise.resolve(probeCount === 1
          ? { success: true, valid: false, accountId: 'google', channel: 'online', status: 503, reason: 'unavailable' }
          : { success: true, valid: true, accountId: 'google', channel: 'online', status: 200, reason: 'ok' });
      }
      return Promise.resolve({ success: true, modelRef: 'ollama/qwen2.5:3b-instruct' });
    });
    const store = await loadStore();
    const stalePin = { sessionKey: 'agent:main:main', channel: 'on-device' as const };
    store.setState({ sending: false, activeRunId: null, lastSentPayload: null, runtimeChannelPin: stalePin });

    await store.getState().sendMessage('first retry while provider unavailable');
    expect(storedProviderProbeCalls()).toHaveLength(1);
    expect(patchCalls()).toEqual([]);
    expect(store.getState().runtimeChannelPin).toBe(stalePin);

    store.setState({ sending: false, activeRunId: null, lastSentPayload: null });
    await store.getState().sendMessage('second retry after provider recovers');

    expect(storedProviderProbeCalls()).toHaveLength(2);
    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: null }]);
    expect(store.getState().runtimeChannelPin).toBeNull();
  });

  it('does not spend the stale-pin clear budget on failed stored provider probes', async () => {
    providerState.accounts = [...ONLINE_DEFAULT];
    let probeCount = 0;
    hostApiFetchMock.mockImplementation((path: unknown) => {
      if (String(path) === '/api/provider-accounts/default/probe') {
        probeCount += 1;
        return Promise.resolve(probeCount <= 3
          ? { success: true, valid: false, accountId: 'google', channel: 'online', status: 503, reason: 'unavailable' }
          : { success: true, valid: true, accountId: 'google', channel: 'online', status: 200, reason: 'ok' });
      }
      return Promise.resolve({ success: true, modelRef: 'ollama/qwen2.5:3b-instruct' });
    });
    const store = await loadStore();
    const stalePin = { sessionKey: 'agent:main:main', channel: 'on-device' as const };
    store.setState({ sending: false, activeRunId: null, lastSentPayload: null, runtimeChannelPin: stalePin });

    for (const text of ['probe one', 'probe two', 'probe three', 'healthy fourth']) {
      await store.getState().sendMessage(text);
      if (store.getState().runtimeChannelPin) {
        store.setState({ sending: false, activeRunId: null, lastSentPayload: null });
      }
    }

    expect(storedProviderProbeCalls()).toHaveLength(4);
    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: null }]);
    expect(store.getState().runtimeChannelPin).toBeNull();
  });

  it('keeps a stale disk pin when the stored Online provider probe fails, then clears after a healthy probe', async () => {
    providerState.accounts = [...ONLINE_DEFAULT];
    let probeCount = 0;
    hostApiFetchMock.mockImplementation((path: unknown) => {
      if (String(path) === '/api/provider-accounts/default/probe') {
        probeCount += 1;
        return Promise.resolve(probeCount === 1
          ? { success: true, valid: false, accountId: 'google', channel: 'online', status: 503, reason: 'unavailable' }
          : { success: true, valid: true, accountId: 'google', channel: 'online', status: 200, reason: 'ok' });
      }
      return Promise.resolve({ success: true, modelRef: 'ollama/qwen2.5:3b-instruct' });
    });
    const store = await loadStore();

    await store.getState().sendMessage('first turn while online provider is still unhealthy');

    expect(storedProviderProbeCalls()).toHaveLength(1);
    expect(patchCalls()).toEqual([]);

    await store.getState().sendMessage('second turn after online provider recovers');

    expect(storedProviderProbeCalls()).toHaveLength(2);
    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: null }]);
  });

  it('does not clear a stale pin when the stored provider probe proves a different default account', async () => {
    providerState.accounts = [...ONLINE_DEFAULT];
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/provider-accounts/default/probe'
      ? Promise.resolve({ success: true, valid: true, accountId: 'anthropic', channel: 'online', status: 200, reason: 'ok' })
      : Promise.resolve({ success: true, modelRef: 'ollama/qwen2.5:3b-instruct' })));
    const store = await loadStore();

    await store.getState().sendMessage('turn during provider account race');

    expect(storedProviderProbeCalls()).toHaveLength(1);
    expect(patchCalls()).toEqual([]);
  });

  it('keeps a stale pin when the stored provider probe is healthy but the clear ack is not proven', async () => {
    providerState.accounts = [...ONLINE_DEFAULT];
    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method === 'sessions.patch') {
        return Promise.resolve({
          ok: true,
          key: 'agent:main:main',
          entry: { key: 'agent:main:main', modelOverride: 'ollama/qwen2.5:3b-instruct', providerOverride: 'ollama' },
          resolved: { modelProvider: 'ollama', model: 'qwen2.5:3b-instruct' },
        });
      }
      return Promise.resolve(params && undefined);
    });
    const store = await loadStore();

    await store.getState().sendMessage('turn with failed clear ack');

    expect(storedProviderProbeCalls()).toHaveLength(1);
    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: null }]);
    await store.getState().sendMessage('retry after failed clear ack');
    expect(patchCalls()).toEqual([
      { key: 'agent:main:main', model: null },
      { key: 'agent:main:main', model: null },
    ]);
  });

  it('keeps a stale pin and still sends when the stored provider probe route is absent', async () => {
    providerState.accounts = [...ONLINE_DEFAULT];
    hostApiFetchMock.mockImplementation((path: unknown) => (String(path) === '/api/provider-accounts/default/probe'
      ? Promise.reject(new Error('No route for GET /api/provider-accounts/default/probe'))
      : Promise.resolve({ success: true, modelRef: 'ollama/qwen2.5:3b-instruct' })));
    const store = await loadStore();

    await store.getState().sendMessage('turn with legacy main process');

    expect(storedProviderProbeCalls()).toHaveLength(1);
    expect(patchCalls()).toEqual([]);
    expect(gatewayRpcMock.mock.calls.map((c) => c[0])).toContain('chat.send');
  });

  it('does not clobber a newer runtime pin that appears while pre-send reconcile is clearing disk state', async () => {
    providerState.accounts = [...ONLINE_DEFAULT];
    let releaseClear: (value: unknown) => void = () => {};
    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method === 'sessions.patch') {
        return new Promise((resolve) => { releaseClear = () => resolve(ackFor(params)); });
      }
      if (method === 'chat.send') return Promise.resolve({ runId: 'run-after-reconcile' });
      return Promise.resolve(undefined);
    });
    const store = await loadStore();

    const send = store.getState().sendMessage('turn while stale disk pin is clearing');
    await settle();
    const newerPin = { sessionKey: 'agent:main:main', channel: 'on-device' as const };
    store.setState({ runtimeChannelPin: newerPin });

    releaseClear(ackFor({ key: 'agent:main:main', model: null }));
    await send;

    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: null }]);
    expect(store.getState().runtimeChannelPin).toBe(newerPin);
  });

  it('marks pre-send stale-pin recovery pending while the reconcile clear is in flight', async () => {
    providerState.accounts = [...ONLINE_DEFAULT];
    let releaseClear: (value: unknown) => void = () => {};
    gatewayRpcMock.mockImplementation((method: string, params: unknown) => {
      if (method === 'sessions.patch') {
        return new Promise((resolve) => { releaseClear = () => resolve(ackFor(params)); });
      }
      if (method === 'chat.send') return Promise.resolve({ runId: 'run-after-reconcile' });
      return Promise.resolve(undefined);
    });
    const store = await loadStore();

    const send = store.getState().sendMessage('first turn after restart');
    await settle();

    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: null }]);
    expect(store.getState().pendingChannelRecoveryBySession['agent:main:main']).toBe(1);

    releaseClear(ackFor({ key: 'agent:main:main', model: null }));
    await send;

    expect(store.getState().pendingChannelRecoveryBySession['agent:main:main']).toBeUndefined();
  });

  it('does NOT let the pre-send reconcile undo the pin the degrade just installed', async () => {
    // The worst reachable state of the pin machinery: the default is (still)
    // Online, so the once-per-run reconcile is armed, and the failover's own
    // replay re-enters sendMessage. Unfenced, the reconcile clears the pin
    // between the proven cutover and the send — the replay goes back out on the
    // provider that just failed, under a notice saying it was answered on this
    // device (code-review + falsifiability lenses, 2026-09-06).
    providerState.accounts = [...ONLINE_DEFAULT];
    const store = await loadStore();

    emitError(store, 'fetch failed');
    await settle();

    // Exactly the pin. No `model: null` anywhere in the sequence.
    expect(patchCalls()).toEqual([{ key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' }]);
    const methods = gatewayRpcMock.mock.calls.map((c) => c[0]);
    expect(methods).toContain('chat.send');
    expect(methods.indexOf('sessions.patch')).toBeLessThan(methods.indexOf('chat.send'));
    expect(store.getState().degradeNotice).toEqual({ reason: 'unreachable', resent: true, to: 'on-device' });
  });

  it('records the on-device runtime for the session so the pill and Settings stop reading Online', async () => {
    // The pin moves the RUNTIME; `preferredChannel` stays the principal's own
    // choice. Nothing else in the app could tell the two apart, so the composer
    // kept reading "Online" over an on-device thread and the principal reads the
    // weaker answers as "the Online model got worse".
    const store = await loadStore();

    emitError(store, 'fetch failed');
    await settle();

    expect(store.getState().runtimeChannelPin).toEqual({ sessionKey: 'agent:main:main', channel: 'on-device' });
    // And the principal's stored preference is untouched.
    expect(preferenceWrites()).toHaveLength(0);
    expect(settingsState.setPreferredChannel).not.toHaveBeenCalled();
  });

  it('does NOT record an on-device runtime when the cutover was never proven', async () => {
    // Unproven cutover means the runtime may still be Online — claiming
    // on-device here would make the pill lie in the other direction.
    const store = await loadStore();
    gatewayRpcMock.mockImplementation(async (method: string) => (method === 'sessions.patch'
      ? { ok: true, resolved: { modelProvider: 'google', model: 'gemini-2.5-pro' } }
      : undefined));

    emitError(store, 'fetch failed');
    await settle();

    expect(store.getState().runtimeChannelPin).toBeNull();
  });

  it('drops the recorded on-device runtime when the pin is cleared, and keeps it when the clear fails', async () => {
    const store = await loadStore();
    store.setState({ runtimeChannelPin: { sessionKey: 'agent:main:main', channel: 'on-device' } });

    await expect(store.getState().clearSessionModelPin()).resolves.toBe(true);
    expect(store.getState().runtimeChannelPin).toBeNull();

    // A clear the gateway never accepted leaves the runtime where it was: the
    // pill must not go back to reading Online on an unproven claim.
    store.setState({ runtimeChannelPin: { sessionKey: 'agent:main:main', channel: 'on-device' } });
    gatewayRpcMock.mockImplementation(async () => { throw new Error('gateway not connected'); });
    await expect(store.getState().clearSessionModelPin()).resolves.toBe(false);
    expect(store.getState().runtimeChannelPin)
      .toEqual({ sessionKey: 'agent:main:main', channel: 'on-device' });
  });

  it('re-opens the once-per-run reconcile for OTHER sessions when a channel is picked explicitly', async () => {
    // A pick is a statement about the whole app but a pin is per-session, and
    // only the current session's can be cleared from the toggle. Degrade in the
    // letter thread, open a new chat, press Online there: without this the
    // letter thread keeps answering on-device for the rest of the run with its
    // composer reading Online.
    providerState.accounts = [...ONLINE_DEFAULT];
    const store = await loadStore();

    await store.getState().sendMessage('first turn');            // reconciles agent:main:main
    await store.getState().clearSessionModelPin('agent:main:other'); // explicit pick elsewhere
    await store.getState().sendMessage('second turn');           // main is eligible again

    expect(patchCalls()).toEqual([
      { key: 'agent:main:main', model: null },
      { key: 'agent:main:other', model: null },
      { key: 'agent:main:main', model: null },
    ]);
  });

  it('retries the reconcile on a later send when the gateway refused the first clear', async () => {
    // The gateway is commonly mid-restart when the first send of an app run
    // lands. Memoising the attempt (rather than the success) burned the
    // session's one chance and left the stale pin in place for the whole run.
    providerState.accounts = [...ONLINE_DEFAULT];
    let patches = 0;
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method !== 'sessions.patch') return undefined;
      patches += 1;
      if (patches === 1) throw new Error('RPC timeout: sessions.patch');
      return ackFor({ key: 'agent:main:main', model: null });
    });
    const store = await loadStore();

    await store.getState().sendMessage('one');   // attempt 1 — refused
    await store.getState().sendMessage('two');   // attempt 2 — accepted
    await store.getState().sendMessage('three'); // nothing left to do

    expect(patchCalls()).toHaveLength(2);
  });

  it('gives up after a bounded number of reconcile attempts instead of writing before every send', async () => {
    // The retry above must not become an unbounded write in front of every send
    // against a gateway that is never going to accept it.
    providerState.accounts = [...ONLINE_DEFAULT];
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.patch') throw new Error('RPC timeout: sessions.patch');
      return undefined;
    });
    const store = await loadStore();

    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      await store.getState().sendMessage(text);
    }

    expect(patchCalls()).toHaveLength(3);
  });

  it('starts a fresh clear budget after a newly acknowledged fallback pin', async () => {
    providerState.accounts = [...ONLINE_DEFAULT];
    let clearAttempts = 0;
    gatewayRpcMock.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'sessions.patch') {
        const requested = (params as { model?: string | null }).model ?? null;
        if (requested === null) {
          clearAttempts += 1;
          return clearAttempts <= 3
            ? { ok: true, key: 'agent:main:main', entry: { key: 'agent:main:main', modelOverride: 'ollama/qwen2.5:3b-instruct', providerOverride: 'ollama' }, resolved: { modelProvider: 'ollama', model: 'qwen2.5:3b-instruct' } }
            : ackFor(params);
        }
        return ackFor(params);
      }
      if (method === 'chat.send') return { runId: 'run-after-pin-budget' };
      return undefined;
    });
    const store = await loadStore();

    for (const text of ['bad clear one', 'bad clear two', 'bad clear three', 'capped clear four']) {
      await store.getState().sendMessage(text);
    }
    expect(patchCalls().filter((call) => call.model === null)).toHaveLength(3);

    store.setState({
      sending: true,
      activeRunId: 'run-1',
      lastSentPayload: { text: 'cloud fails into a fresh fallback episode', attachments: undefined, targetAgentId: null, generation: 999 },
      degradedThisTurn: false,
      degradeNotice: null,
      streamingTools: [{ name: 'outlook.read_inbox', status: 'running', updatedAt: Date.now() }],
    });
    emitError(store, 'fetch failed');
    await settle();

    expect(patchCalls().at(-1)).toEqual({ key: 'agent:main:main', model: 'ollama/qwen2.5:3b-instruct' });
    expect(store.getState().runtimeChannelPin).toEqual({ sessionKey: 'agent:main:main', channel: 'on-device' });

    store.setState({ sending: false, activeRunId: null, lastSentPayload: null, degradedThisTurn: false });
    await store.getState().sendMessage('healthy online after fresh fallback');

    expect(patchCalls().filter((call) => call.model === null)).toHaveLength(4);
    expect(store.getState().runtimeChannelPin).toBeNull();
  });

  it('supports repeated fallback and heal episodes in one app run', async () => {
    providerState.accounts = [...ONLINE_DEFAULT];
    gatewayRpcMock.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'sessions.patch') return ackFor(params);
      if (method === 'chat.send') return { runId: 'run-repeated-episode' };
      return undefined;
    });
    const store = await loadStore();

    for (let episode = 1; episode <= 4; episode += 1) {
      const runId = `run-repeated-fallback-${episode}`;
      store.setState({
        sending: true,
        activeRunId: runId,
        lastSentPayload: { text: `cloud failure ${episode}`, attachments: undefined, targetAgentId: null, generation: 1000 + episode },
        degradedThisTurn: false,
        degradeNotice: null,
        streamingTools: [{ name: 'outlook.read_inbox', status: 'running', updatedAt: Date.now() }],
      });
      store.getState().handleChatEvent({
        state: 'error',
        runId,
        sessionKey: 'agent:main:main',
        errorMessage: 'fetch failed',
      });
      await vi.waitFor(() => {
        expect(store.getState().runtimeChannelPin).toEqual({ sessionKey: 'agent:main:main', channel: 'on-device' });
      });

      store.setState({ sending: false, activeRunId: null, lastSentPayload: null, degradedThisTurn: false });
      await store.getState().sendMessage(`online recovered ${episode}`);
      expect(store.getState().runtimeChannelPin).toBeNull();
    }

    expect(patchCalls().filter((call) => call.model === 'ollama/qwen2.5:3b-instruct')).toHaveLength(4);
    expect(patchCalls().filter((call) => call.model === null)).toHaveLength(4);
  });

  it('budgets the pre-send reconcile far shorter than the in-turn cutover', async () => {
    // The reconcile write sits in FRONT of the first send of the run: a stalled
    // gateway would hold the principal's message for the full cutover budget
    // with no spinner and no watchdog in range (30s/90s both fire later). The
    // cutover keeps the long budget — it runs inside an already-failed turn,
    // behind a progress notice, and giving up early there means falsely
    // reporting that the switch failed.
    providerState.accounts = [...ONLINE_DEFAULT];
    const store = await loadStore();

    await store.getState().sendMessage('first turn of the run');
    store.setState({ sending: true, activeRunId: 'run-1', lastSentPayload: { text: 'a turn', targetAgentId: null } });
    emitError(store, 'fetch failed');
    await settle();

    expect(patchBudgets()).toEqual([
      [null, 3_000],
      ['ollama/qwen2.5:3b-instruct', 15_000],
    ]);
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

  it('turns a completed tool-only stall into a visible terminal failure instead of spinning forever', async () => {
    vi.useFakeTimers();
    try {
      providerState.accounts = [BOTH_CHANNELS[0]];
      gatewayRpcMock.mockImplementation(async (method: string) => {
        if (method === 'chat.send') return { runId: 'run-tool-only' };
        return undefined;
      });
      const store = await loadStore();
      store.setState({ sending: false, activeRunId: null, lastSentPayload: null });

      await store.getState().sendMessage('check the inbox');
      store.getState().handleChatEvent({
        state: 'final',
        runId: 'run-tool-only',
        sessionKey: 'agent:main:main',
        message: {
          role: 'toolresult',
          toolName: 'sessions_yield',
          toolCallId: 'yield-1',
          content: [{ type: 'text', text: 'yielded to a subtask' }],
        },
      });

      expect(store.getState().sending).toBe(true);
      expect(store.getState().pendingFinal).toBe(true);

      await vi.advanceTimersByTimeAsync(120_000);

      expect(store.getState().sending).toBe(false);
      expect(store.getState().pendingFinal).toBe(false);
      expect(store.getState().activeRunId).toBeNull();
      expect(store.getState().error).toContain('No response received from the model');
      expect(degradeCalls()).toEqual([]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps a stream alive while owned progress continues within the watchdog budget', async () => {
    vi.useFakeTimers();
    try {
      gatewayRpcMock.mockImplementation(async (method: string) => {
        if (method === 'chat.send') return { runId: 'run-streaming' };
        return undefined;
      });
      const store = await loadStore();
      store.setState({ sending: false, activeRunId: null, lastSentPayload: null });

      await store.getState().sendMessage('draft a note');
      store.getState().handleChatEvent({
        state: 'delta',
        runId: 'run-streaming',
        sessionKey: 'agent:main:main',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'I am drafting the note.' }],
        },
      });

      await vi.advanceTimersByTimeAsync(80_000);
      store.getState().handleChatEvent({
        state: 'delta',
        runId: 'run-streaming',
        sessionKey: 'agent:main:main',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'I am still drafting the note.' }],
        },
      });
      await vi.advanceTimersByTimeAsync(80_000);

      expect(store.getState().sending).toBe(true);
      expect(store.getState().activeRunId).toBe('run-streaming');
      expect(store.getState().error).toBeNull();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('turns stale partial text into a visible terminal failure after the watchdog budget', async () => {
    vi.useFakeTimers();
    try {
      gatewayRpcMock.mockImplementation(async (method: string) => {
        if (method === 'chat.send') return { runId: 'run-partial' };
        return undefined;
      });
      const store = await loadStore();
      store.setState({ sending: false, activeRunId: null, lastSentPayload: null });

      await store.getState().sendMessage('draft a note');
      store.getState().handleChatEvent({
        state: 'delta',
        runId: 'run-partial',
        sessionKey: 'agent:main:main',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'I am drafting the note.' }],
        },
      });

      await vi.advanceTimersByTimeAsync(120_000);

      expect(store.getState().sending).toBe(false);
      expect(store.getState().activeRunId).toBeNull();
      expect(store.getState().pendingFinal).toBe(false);
      expect(store.getState().streamingMessage).toBeNull();
      expect(store.getState().error).toContain('No response received from the model');
      expect(degradeCalls()).toEqual([]);
      expect(gatewayRpcMock.mock.calls).toContainEqual(['chat.abort', { sessionKey: 'agent:main:main', runId: 'run-partial' }]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('turns an observed assistant tool-call graph with no terminal event into a visible failure', async () => {
    vi.useFakeTimers();
    try {
      gatewayRpcMock.mockImplementation(async (method: string) => {
        if (method === 'chat.send') return { runId: 'run-tool-call' };
        return undefined;
      });
      const store = await loadStore();
      store.setState({ sending: false, activeRunId: null, lastSentPayload: null });

      await store.getState().sendMessage('check the inbox');
      store.getState().handleChatEvent({
        state: 'delta',
        runId: 'run-tool-call',
        sessionKey: 'agent:main:main',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'yield-call',
            name: 'sessions_yield',
            input: { message: 'waiting for child task' },
          }],
        },
      });

      expect(store.getState().streamingTools).toEqual([expect.objectContaining({
        name: 'sessions_yield',
        status: 'running',
      })]);

      await vi.advanceTimersByTimeAsync(120_000);

      expect(store.getState().sending).toBe(false);
      expect(store.getState().activeRunId).toBeNull();
      expect(store.getState().streamingTools).toEqual([]);
      expect(store.getState().error).toContain('No response received from the model');
      expect(degradeCalls()).toEqual([]);
      expect(gatewayRpcMock.mock.calls).toContainEqual(['chat.abort', { sessionKey: 'agent:main:main', runId: 'run-tool-call' }]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps a running tool alive while tool progress continues within the watchdog budget', async () => {
    vi.useFakeTimers();
    try {
      gatewayRpcMock.mockImplementation(async (method: string) => {
        if (method === 'chat.send') return { runId: 'run-tool-progress' };
        return undefined;
      });
      const store = await loadStore();
      store.setState({ sending: false, activeRunId: null, lastSentPayload: null });

      await store.getState().sendMessage('check the inbox');
      const toolDelta = (text: string) => ({
        state: 'delta',
        runId: 'run-tool-progress',
        sessionKey: 'agent:main:main',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text }, {
            type: 'tool_use',
            id: 'inbox-call',
            name: 'outlook.read_inbox',
            input: {},
          }],
        },
      });
      store.getState().handleChatEvent(toolDelta('Reading inbox…'));
      await vi.advanceTimersByTimeAsync(80_000);
      store.getState().handleChatEvent(toolDelta('Still reading inbox…'));
      await vi.advanceTimersByTimeAsync(80_000);

      expect(store.getState().sending).toBe(true);
      expect(store.getState().activeRunId).toBe('run-tool-progress');
      expect(store.getState().streamingTools).toEqual([expect.objectContaining({
        name: 'outlook.read_inbox',
        status: 'running',
      })]);
      expect(store.getState().error).toBeNull();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not let an older watchdog timer terminate a newer send', async () => {
    vi.useFakeTimers();
    try {
      let runIndex = 0;
      gatewayRpcMock.mockImplementation(async (method: string) => {
        if (method === 'chat.send') {
          runIndex += 1;
          return { runId: `run-${runIndex}` };
        }
        return undefined;
      });
      const store = await loadStore();
      store.setState({ sending: false, activeRunId: null, lastSentPayload: null });

      await store.getState().sendMessage('first turn');
      await store.getState().sendMessage('second turn');
      await vi.advanceTimersByTimeAsync(35_000);

      expect(store.getState().sending).toBe(true);
      expect(store.getState().activeRunId).toBe('run-2');
      expect(store.getState().lastSentPayload?.text).toBe('second turn');
      expect(store.getState().error).toBeNull();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not let owned no-op heartbeat events keep a stalled run alive', async () => {
    vi.useFakeTimers();
    try {
      providerState.accounts = [BOTH_CHANNELS[0]];
      gatewayRpcMock.mockImplementation(async (method: string) => {
        if (method === 'chat.send') return { runId: 'run-heartbeat' };
        return undefined;
      });
      const store = await loadStore();
      store.setState({ sending: false, activeRunId: null, lastSentPayload: null });

      await store.getState().sendMessage('heartbeat only');
      await vi.advanceTimersByTimeAsync(80_000);
      store.getState().handleChatEvent({
        state: 'delta',
        runId: 'run-heartbeat',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', tool_calls: [], toolCalls: [] },
      });
      await vi.advanceTimersByTimeAsync(40_000);

      expect(store.getState().sending).toBe(false);
      expect(store.getState().activeRunId).toBeNull();
      expect(store.getState().error).toContain('No response received from the model');
      expect(gatewayRpcMock.mock.calls).toContainEqual(['chat.abort', { sessionKey: 'agent:main:main', runId: 'run-heartbeat' }]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('makes an accepted send with no events visible through the terminal watchdog', async () => {
    vi.useFakeTimers();
    try {
      providerState.accounts = [BOTH_CHANNELS[0]];
      gatewayRpcMock.mockImplementation(async (method: string) => {
        if (method === 'chat.send') return { runId: 'run-no-events' };
        return undefined;
      });
      const store = await loadStore();
      store.setState({ sending: false, activeRunId: null, lastSentPayload: null });

      await store.getState().sendMessage('will not stream');
      await vi.advanceTimersByTimeAsync(120_000);

      expect(store.getState().sending).toBe(false);
      expect(store.getState().activeRunId).toBeNull();
      expect(store.getState().pendingFinal).toBe(false);
      expect(store.getState().error).toContain('No response received from the model');
      expect(degradeCalls()).toEqual([]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('ignores late events from a run already terminated by the watchdog', async () => {
    vi.useFakeTimers();
    try {
      providerState.accounts = [BOTH_CHANNELS[0]];
      gatewayRpcMock.mockImplementation(async (method: string) => {
        if (method === 'chat.send') return { runId: 'run-late' };
        return undefined;
      });
      const store = await loadStore();
      store.setState({ sending: false, activeRunId: null, lastSentPayload: null });

      await store.getState().sendMessage('will finish too late');
      await vi.advanceTimersByTimeAsync(120_000);
      const terminalError = store.getState().error;

      store.getState().handleChatEvent({
        state: 'final',
        runId: 'run-late',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', id: 'late-final', content: [{ type: 'text', text: 'late answer' }] },
      });
      store.getState().handleChatEvent({
        state: 'aborted',
        runId: 'run-late',
        sessionKey: 'agent:main:main',
      });

      expect(store.getState().sending).toBe(false);
      expect(store.getState().activeRunId).toBeNull();
      expect(store.getState().error).toBe(terminalError);
      expect(store.getState().messages.some((message) => message.id === 'late-final')).toBe(false);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not adopt a chat.send run id that arrives after the watchdog made the turn terminal', async () => {
    vi.useFakeTimers();
    try {
      providerState.accounts = [BOTH_CHANNELS[0]];
      let releaseSend: (value: { runId: string }) => void = () => {};
      gatewayRpcMock.mockImplementation((method: string) => {
        if (method === 'chat.send') {
          return new Promise((resolve) => { releaseSend = resolve; });
        }
        return Promise.resolve(undefined);
      });
      const store = await loadStore();
      store.setState({ sending: false, activeRunId: null, lastSentPayload: null });

      const send = store.getState().sendMessage('run id will arrive late');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(store.getState().sending).toBe(false);
      expect(store.getState().activeRunId).toBeNull();
      expect(store.getState().error).toContain('No response received from the model');

      releaseSend({ runId: 'run-after-terminal' });
      await send;

      expect(store.getState().sending).toBe(false);
      expect(store.getState().activeRunId).toBeNull();
      expect(gatewayRpcMock.mock.calls).toContainEqual(['chat.abort', {
        sessionKey: 'agent:main:main',
        runId: 'run-after-terminal',
      }]);

      store.getState().handleChatEvent({
        state: 'final',
        runId: 'run-after-terminal',
        sessionKey: 'agent:main:main',
        message: { role: 'assistant', id: 'too-late', content: [{ type: 'text', text: 'too late' }] },
      });
      expect(store.getState().messages.some((message) => message.id === 'too-late')).toBe(false);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('chat store: run-error banner lifecycle from history (moe.18 Finding D0)', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    gatewayRpcMock.mockReset();
    mockHistory(undefined);
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation((path: unknown) => {
      if (String(path) === '/api/settings/degradeChannel') {
        return Promise.resolve({ success: true, modelRef: 'ollama/qwen2.5:3b-instruct' });
      }
      if (String(path) === '/api/provider-accounts/default/probe') {
        return Promise.resolve({ success: true, valid: true, accountId: 'google', channel: 'online', status: 200, reason: 'ok' });
      }
      return Promise.resolve({ success: true });
    });
    agentsState.agents = [];
    settingsState.preferredChannel = 'online';
    settingsState.setPreferredChannel.mockReset();
    providerState.accounts = [...BOTH_CHANNELS];
    providerState.refreshProviderSnapshot.mockReset();
    providerState.refreshProviderSnapshot.mockResolvedValue(undefined);
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

  it('clears a stale success-claiming notice when history discovers a terminal local error', async () => {
    const store = await loadStore();
    providerState.accounts = [BOTH_CHANNELS[0]];
    store.setState({
      lastUserMessageAt: Date.now(),
      runError: null,
      degradeNotice: { reason: 'unreachable', resent: true, to: 'on-device' } as never,
      degradedThisTurn: true,
    });
    mockHistory(ERRORED_HISTORY);

    await store.getState().loadHistory(true);
    await settle();

    expect(degradeCalls().length).toBe(0);
    expect(store.getState().runError).toContain('network connection error');
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

/**
 * A session model pin outranks the config default on every turn, so ANY surface
 * that changes the channel or the default provider has to drop it as well —
 * otherwise that surface writes the four stores, reports success, and changes
 * nothing the principal can see. Discovered rather than listed: a fourth surface
 * added later fails this row instead of shipping the same bug again (code-review
 * lens finding 4, 2026-09-06).
 */
describe('every renderer surface that changes the channel drops the session pin (CLWX-95)', () => {
  const SRC = `${resolve(__dirname, '../../src')}/`;

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = `${dir}${entry.name}`;
      if (entry.isDirectory()) return walk(`${full}/`);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it('leaves no channel writer without a pin clear', () => {
    const writers = walk(SRC)
      // The stores DEFINE these actions; the invariant is about their callers.
      .filter((f) => !f.endsWith('src/stores/providers.ts') && !f.endsWith('src/stores/settings.ts'))
      .map((f) => [f, readFileSync(f, 'utf8')] as const)
      .filter(([, src]) => /setPreferredChannel\(|setDefaultAccount\(/.test(src));

    // Sanity: the discovery itself must not silently find nothing.
    expect(writers.length).toBeGreaterThanOrEqual(3);
    const missing = writers
      .filter(([, src]) => !src.includes('clearSessionModelPin'))
      .map(([file]) => file.slice(file.indexOf('/src/') + 1));
    expect(missing).toEqual([]);
  });
});
