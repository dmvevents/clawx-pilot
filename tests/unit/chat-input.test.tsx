import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ChatInput } from '@/pages/Chat/ChatInput';
import { TooltipProvider } from '@/components/ui/tooltip';
import { hostApiFetch } from '@/lib/host-api';
import { useSettingsStore } from '@/stores/settings';

const { agentsState, chatState, gatewayState, providersState, artifactPanelMocks } = vi.hoisted(() => ({
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: null as string | null,
    updateAgentModel: vi.fn(),
    fetchAgents: vi.fn(async () => undefined),
  },
  chatState: {
    currentAgentId: 'main',
    currentSessionKey: 'agent:main:main',
    // Set only after a degrade's session cutover is ACKNOWLEDGED: which channel
    // the runtime is really on, as opposed to which one the principal chose.
    runtimeChannelPin: null as { sessionKey: string; channel: 'online' | 'on-device' } | null,
    clearSessionModelPin: vi.fn(async () => true),
  },
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    defaultAccountId: null as string | null,
    refreshProviderSnapshot: vi.fn(),
  },
  artifactPanelMocks: {
    openPreview: vi.fn(),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/chat', () => ({
  // getState() is part of the surface the composer uses: the channel pick calls
  // useChatStore.getState().clearSessionModelPin(). A selector-only mock would
  // make that call throw into the handler's catch and turn a silent regression
  // into a passing test.
  useChatStore: Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    { getState: () => chatState },
  ),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState) => unknown) => selector(providersState),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: typeof artifactPanelMocks) => unknown) => selector(artifactPanelMocks),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
}));

function translate(key: string, vars?: Record<string, unknown>): string {
  switch (key) {
    case 'composer.attachFiles':
      return 'Attach files';
    case 'composer.pickSkill':
      return 'Choose skill';
    case 'composer.skillButton':
      return 'Skill';
    case 'composer.skillPickerTitle':
      return `Quick skill access for ${String(vars?.agent ?? '')}`;
    case 'composer.skillSearchPlaceholder':
      return 'Search skills';
    case 'composer.skillLoading':
      return 'Loading skills...';
    case 'composer.skillEmpty':
      return 'No matching skills found';
    case 'composer.pickAgent':
      return 'Choose agent';
    case 'composer.clearTarget':
      return 'Clear target agent';
    case 'composer.targetChip':
      return `@${String(vars?.agent ?? '')}`;
    case 'composer.agentPickerTitle':
      return 'Route the next message to another agent';
    case 'composer.gatewayDisconnectedPlaceholder':
      return 'Gateway not connected...';
    case 'composer.send':
      return 'Send';
    case 'composer.stop':
      return 'Stop';
    case 'composer.gatewayConnected':
      return 'connected';
    case 'composer.gatewayStatus':
      return `gateway ${String(vars?.state ?? '')} | port: ${String(vars?.port ?? '')} ${String(vars?.pid ?? '')}`.trim();
    case 'composer.retryFailedAttachments':
      return 'Retry failed attachments';
    case 'composer.skillPreviewTooltip':
      return 'Preview SKILL.md';
    case 'composer.skillPreviewNotFound':
      return 'Skill not found';
    default:
      return key;
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const CHANNEL_ACCOUNTS = [
  {
    id: 'google01', vendorId: 'google', label: 'Online', authMode: 'api_key',
    model: 'google-google01/gemini-2.5-pro', enabled: true, isDefault: true,
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'ollama01', vendorId: 'ollama', label: 'Local', authMode: 'none',
    baseUrl: 'http://127.0.0.1:11434', model: 'ollama-ollama01/qwen2.5:3b-instruct',
    enabled: true, isDefault: false,
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  },
];

function renderChatInput(onSend = vi.fn()) {
  return render(
    <TooltipProvider>
      <ChatInput onSend={onSend} />
    </TooltipProvider>,
  );
}

describe('ChatInput agent targeting', () => {
  beforeEach(() => {
    agentsState.agents = [];
    agentsState.defaultModelRef = null;
    agentsState.updateAgentModel.mockReset();
    chatState.currentAgentId = 'main';
    chatState.currentSessionKey = 'agent:main:main';
    chatState.runtimeChannelPin = null;
    chatState.clearSessionModelPin.mockClear();
    agentsState.fetchAgents.mockClear();
    gatewayState.status = { state: 'running', port: 18789 };
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.defaultAccountId = null;
    providersState.refreshProviderSnapshot.mockReset();
    vi.mocked(hostApiFetch).mockReset();
    artifactPanelMocks.openPreview.mockReset();
    useSettingsStore.setState({ devModeUnlocked: false, preferredChannel: 'on-device' });
  });

  it('hides the @agent picker when only one agent is configured', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    renderChatInput();

    expect(screen.queryByTitle('Choose agent')).not.toBeInTheDocument();
  });

  it('uses native textarea rendering when no skill token is present', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: '我没有填写Skill' } });

    expect(textbox).toHaveValue('我没有填写Skill');
    expect(screen.queryByTestId('chat-composer-skill-token')).not.toBeInTheDocument();
    expect(textbox.className).not.toContain('text-transparent');
  });

  it('lets the user select an agent target and sends it with the message', () => {
    const onSend = vi.fn();
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'Claude',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace-research',
        agentDir: '~/.openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:desk',
        channelTypes: [],
      },
    ];

    renderChatInput(onSend);

    fireEvent.click(screen.getByTitle('Choose agent'));
    fireEvent.click(screen.getByText('Research'));

    expect(screen.getByText('@Research')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello direct agent' } });
    fireEvent.click(screen.getByTitle('Send'));

    expect(onSend).toHaveBeenCalledWith('Hello direct agent', undefined, 'research');
  });

  it('disables the input while gateway is running but not yet ready', () => {
    // Dev mode so the raw-id model picker renders and its disabled state can
    // be asserted alongside the other composer controls.
    useSettingsStore.setState({ devModeUnlocked: true });
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    agentsState.defaultModelRef = 'custom-aaaaaaaa/gpt-a';
    const now = '2025-01-01T00:00:00.000Z';
    providersState.accounts = [
      {
        id: 'aaaaaaaa',
        vendorId: 'custom',
        label: 'Alpha',
        authMode: 'api_key',
        baseUrl: 'http://127.0.0.1:1/v1',
        model: 'custom-aaaaaaaa/gpt-a',
        enabled: true,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'bbbbbbbb',
        vendorId: 'custom',
        label: 'Beta',
        authMode: 'api_key',
        baseUrl: 'http://127.0.0.1:2/v1',
        model: 'custom-bbbbbbbb/gpt-b',
        enabled: true,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
    ];
    providersState.statuses = [
      { id: 'aaaaaaaa', name: 'Alpha', type: 'custom', hasKey: true, keyMasked: 'sk-***', enabled: true, createdAt: now, updatedAt: now },
      { id: 'bbbbbbbb', name: 'Beta', type: 'custom', hasKey: true, keyMasked: 'sk-***', enabled: true, createdAt: now, updatedAt: now },
    ];
    providersState.defaultAccountId = 'aaaaaaaa';

    renderChatInput();

    expect(screen.getByTestId('chat-composer-input')).toBeDisabled();
    expect(screen.getByTestId('chat-composer-skill')).toBeDisabled();
    expect(screen.getByTestId('chat-model-picker-button')).toBeDisabled();
  });

  it('hides the raw-id model picker and any model id when dev mode is locked (CLWX-52)', () => {
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-a',
        modelRef: 'custom-aaaaaaaa/gpt-a',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'gpt-b',
        modelRef: 'custom-bbbbbbbb/gpt-b',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace-research',
        agentDir: '~/.openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:desk',
        channelTypes: [],
      },
    ];
    agentsState.defaultModelRef = 'custom-aaaaaaaa/gpt-a';
    const now = '2025-01-01T00:00:00.000Z';
    providersState.accounts = [
      {
        id: 'aaaaaaaa',
        vendorId: 'custom',
        label: 'Alpha',
        authMode: 'api_key',
        baseUrl: 'http://127.0.0.1:1/v1',
        model: 'custom-aaaaaaaa/gpt-a',
        enabled: true,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'bbbbbbbb',
        vendorId: 'custom',
        label: 'Beta',
        authMode: 'api_key',
        baseUrl: 'http://127.0.0.1:2/v1',
        model: 'custom-bbbbbbbb/gpt-b',
        enabled: true,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
    ];
    providersState.statuses = [
      { id: 'aaaaaaaa', name: 'Alpha', type: 'custom', hasKey: true, keyMasked: 'sk-***', enabled: true, createdAt: now, updatedAt: now },
      { id: 'bbbbbbbb', name: 'Beta', type: 'custom', hasKey: true, keyMasked: 'sk-***', enabled: true, createdAt: now, updatedAt: now },
    ];
    providersState.defaultAccountId = 'aaaaaaaa';

    renderChatInput();

    expect(screen.queryByTestId('chat-model-picker-button')).not.toBeInTheDocument();
    expect(screen.queryByText(/gpt-a/)).not.toBeInTheDocument();
    expect(screen.queryByText(/gpt-b/)).not.toBeInTheDocument();

    // The @-agent picker anonymises each agent's model line the same way.
    fireEvent.click(screen.getByTitle('Choose agent'));
    expect(screen.queryByText(/gpt-b/)).not.toBeInTheDocument();
    expect(screen.getAllByText('On this device').length).toBeGreaterThan(0);
  });

  it('channel pill tracks live preferredChannel even when the agent modelRef is a stale cloud ref (KR2 by-catch)', () => {
    // KR2 recording (2026-09-03): fresh install routed on-device, but the
    // composer chip still showed the cached cloud provider name. The chip is
    // dev-gated now; the pill must derive from the live settings store, not
    // any modelRef cached on the agent.
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'moe-demo-pro',
        modelRef: 'custom-demopro1/moe-demo-pro',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    agentsState.defaultModelRef = 'custom-demopro1/moe-demo-pro';
    const now = '2025-01-01T00:00:00.000Z';
    providersState.accounts = [
      {
        id: 'demopro1',
        vendorId: 'custom',
        label: 'MoE Demo Pro',
        authMode: 'api_key',
        baseUrl: 'https://demo.example.com/v1',
        model: 'custom-demopro1/moe-demo-pro',
        enabled: true,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'ollama01',
        vendorId: 'ollama',
        label: 'Local',
        authMode: 'none',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'ollama-ollama01/qwen2.5:3b-instruct',
        enabled: true,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
    ];
    providersState.statuses = [
      { id: 'demopro1', name: 'MoE Demo Pro', type: 'custom', hasKey: true, keyMasked: 'sk-***', enabled: true, createdAt: now, updatedAt: now },
      { id: 'ollama01', name: 'Local', type: 'ollama', hasKey: false, keyMasked: '', enabled: true, createdAt: now, updatedAt: now },
    ];
    providersState.defaultAccountId = 'ollama01';

    renderChatInput();

    // The stale cloud provider name never renders anywhere.
    expect(screen.queryByText(/moe-demo-pro/)).not.toBeInTheDocument();
    const channelPill = screen.getByTestId('chat-composer-channel');
    expect(channelPill).toHaveTextContent('On this device');
    expect(channelPill).toHaveAttribute('data-channel', 'on-device');

    // Live subscription: flipping the settings store re-renders the pill.
    act(() => {
      useSettingsStore.setState({ preferredChannel: 'online' });
    });
    expect(screen.getByTestId('chat-composer-channel')).toHaveTextContent('Online');
    expect(screen.getByTestId('chat-composer-channel')).toHaveAttribute('data-channel', 'online');
    expect(screen.queryByText(/moe-demo-pro/)).not.toBeInTheDocument();
  });

  it('pill reads the RUNTIME channel when a degrade pinned this session on-device (CLWX-95)', () => {
    // The failover moves the runtime without touching `preferredChannel` — that
    // stays the principal's own choice. Deriving the pill from the preference
    // alone therefore says "Online" over a thread the gateway is answering from
    // the local model, and the principal reads the weaker answers as the Online
    // model having got worse. The pin is a fact about the runtime, so it wins.
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    providersState.accounts = [...CHANNEL_ACCOUNTS];
    useSettingsStore.setState({ preferredChannel: 'online' });
    chatState.runtimeChannelPin = { sessionKey: 'agent:main:main', channel: 'on-device' };

    renderChatInput();

    const pill = screen.getByTestId('chat-composer-channel');
    expect(pill).toHaveTextContent('On this device');
    expect(pill).toHaveAttribute('data-channel', 'on-device');
  });

  it('ignores a runtime pin that belongs to a different session (CLWX-95)', () => {
    // Pins are per-session. A pin left on the letter thread must not relabel a
    // brand-new chat that is running Online exactly as configured.
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    providersState.accounts = [...CHANNEL_ACCOUNTS];
    useSettingsStore.setState({ preferredChannel: 'online' });
    chatState.currentSessionKey = 'agent:main:main';
    chatState.runtimeChannelPin = { sessionKey: 'agent:main:letters', channel: 'on-device' };

    renderChatInput();

    const pill = screen.getByTestId('chat-composer-channel');
    expect(pill).toHaveTextContent('Online');
    expect(pill).toHaveAttribute('data-channel', 'online');
  });

  it('clears the session model pin when the principal picks a channel (CLWX-95)', async () => {
    // A send-time degrade pins the SESSION onto the on-device model, and a
    // session pin outranks the config default on every turn. So the four-store
    // write this toggle performs is not enough on its own: without the pin
    // clear, a principal who degraded on Monday morning is stuck on-device all
    // week while the composer cheerfully reads "Online". The clear is the only
    // thing that makes their own pick take effect, so pin it here.
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    const now = '2025-01-01T00:00:00.000Z';
    providersState.accounts = [
      {
        id: 'demopro1',
        vendorId: 'custom',
        label: 'MoE Demo Pro',
        authMode: 'api_key',
        baseUrl: 'https://demo.example.com/v1',
        model: 'custom-demopro1/moe-demo-pro',
        enabled: true,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'ollama01',
        vendorId: 'ollama',
        label: 'Local',
        authMode: 'none',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'ollama-ollama01/qwen2.5:3b-instruct',
        enabled: true,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
    ];
    providersState.defaultAccountId = 'ollama01';
    useSettingsStore.setState({ preferredChannel: 'on-device' });
    vi.mocked(hostApiFetch).mockResolvedValue({ success: true } as never);

    renderChatInput();
    expect(chatState.clearSessionModelPin).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-composer-channel'));
    });

    expect(useSettingsStore.getState().preferredChannel).toBe('online');
    expect(chatState.clearSessionModelPin).toHaveBeenCalledTimes(1);
  });

  it('shows the raw model id in the picker when dev mode is unlocked', () => {
    useSettingsStore.setState({ devModeUnlocked: true });
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-a',
        modelRef: 'custom-aaaaaaaa/gpt-a',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    agentsState.defaultModelRef = 'custom-aaaaaaaa/gpt-a';
    const now = '2025-01-01T00:00:00.000Z';
    providersState.accounts = [
      {
        id: 'aaaaaaaa',
        vendorId: 'custom',
        label: 'Alpha',
        authMode: 'api_key',
        baseUrl: 'http://127.0.0.1:1/v1',
        model: 'custom-aaaaaaaa/gpt-a',
        enabled: true,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'bbbbbbbb',
        vendorId: 'custom',
        label: 'Beta',
        authMode: 'api_key',
        baseUrl: 'http://127.0.0.1:2/v1',
        model: 'custom-bbbbbbbb/gpt-b',
        enabled: true,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
    ];
    providersState.statuses = [
      { id: 'aaaaaaaa', name: 'Alpha', type: 'custom', hasKey: true, keyMasked: 'sk-***', enabled: true, createdAt: now, updatedAt: now },
      { id: 'bbbbbbbb', name: 'Beta', type: 'custom', hasKey: true, keyMasked: 'sk-***', enabled: true, createdAt: now, updatedAt: now },
    ];
    providersState.defaultAccountId = 'aaaaaaaa';

    renderChatInput();

    expect(screen.getByTestId('chat-model-picker-button')).toHaveTextContent('gpt-a');
  });

  it('shows starting status while gateway is running but not yet ready', () => {
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    renderChatInput();

    expect(screen.getByText(/gateway starting \| port: 18789/i)).toBeInTheDocument();
  });

  it('renders the skill trigger after the @ agent picker', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'Claude',
        inheritedModel: false,
        workspace: '~/.openclaw/workspace-research',
        agentDir: '~/.openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:desk',
        channelTypes: [],
      },
    ];

    renderChatInput();

    const agentTrigger = screen.getByTestId('chat-composer-agent');
    const skillTrigger = screen.getByTestId('chat-composer-skill');

    expect(skillTrigger).toHaveTextContent('Skill');
    expect(agentTrigger.compareDocumentPosition(skillTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('inserts the selected skill at the current cursor position and prefixes sends', async () => {
    const onSend = vi.fn();
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'create-skill',
          description: 'Create and refine reusable skills.',
          source: 'workspace',
          sourceLabel: 'Workspace',
          manifestPath: '/tmp/workspace/skill/create-skill/SKILL.md',
          baseDir: '/tmp/workspace/skill/create-skill',
        },
      ],
    });

    renderChatInput(onSend);

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: 'Draft a new helper' } });
    textbox.focus();
    textbox.setSelectionRange('Draft '.length, 'Draft '.length);

    fireEvent.click(screen.getByTitle('Choose skill'));
    expect(await screen.findByText('/create-skill')).toBeInTheDocument();

    fireEvent.click(screen.getByText('/create-skill'));
    expect(screen.getByTestId('chat-composer-skill')).toHaveTextContent('Skill');
    expect(textbox).toHaveValue('Draft /create-skill  a new helper');
    expect(screen.getByTestId('chat-composer-skill-token')).toHaveTextContent('/create-skill');

    fireEvent.click(screen.getByTitle('Send'));

    expect(onSend).toHaveBeenCalledWith('Draft /create-skill  a new helper', undefined, null);
    expect(hostApiFetch).toHaveBeenCalledWith(
      '/api/skills/quick-access',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
  });

  it('removes the full inline skill token with one backspace', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'create-skill',
          description: 'Create and refine reusable skills.',
          source: 'workspace',
          sourceLabel: 'Workspace',
          manifestPath: '/tmp/workspace/skill/create-skill/SKILL.md',
          baseDir: '/tmp/workspace/skill/create-skill',
        },
      ],
    });

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: 'Draft a new helper' } });
    textbox.focus();
    textbox.setSelectionRange('Draft '.length, 'Draft '.length);

    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByText('/create-skill'));

    expect(textbox).toHaveValue('Draft /create-skill  a new helper');
    textbox.setSelectionRange('Draft /create-skill  '.length, 'Draft /create-skill  '.length);
    fireEvent.keyDown(textbox, { key: 'Backspace' });

    expect(textbox).toHaveValue('Draft a new helper');
  });

  it('skips across the inline skill block with arrow keys', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'create-skill',
          description: 'Create and refine reusable skills.',
          source: 'workspace',
          sourceLabel: 'Workspace',
          manifestPath: '/tmp/workspace/skill/create-skill/SKILL.md',
          baseDir: '/tmp/workspace/skill/create-skill',
        },
      ],
    });

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: 'Draft a new helper' } });
    textbox.focus();
    textbox.setSelectionRange('Draft '.length, 'Draft '.length);

    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByText('/create-skill'));

    textbox.setSelectionRange('Draft '.length, 'Draft '.length);
    fireEvent.keyDown(textbox, { key: 'ArrowRight' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textbox.selectionStart).toBe('Draft /create-skill  '.length);

    fireEvent.keyDown(textbox, { key: 'ArrowLeft' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(textbox.selectionStart).toBe('Draft '.length);
  });

  it('adds left spacing when inserting a skill after adjacent text', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'docx',
          description: 'Work with Word documents.',
          source: 'legacy',
          sourceLabel: 'Legacy',
          manifestPath: '/tmp/openclaw/skills/docx/SKILL.md',
          baseDir: '/tmp/openclaw/skills/docx',
        },
      ],
    });

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: '哈哈哈哈你好' } });
    textbox.focus();
    textbox.setSelectionRange('哈哈哈哈'.length, '哈哈哈哈'.length);

    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByText('/docx'));

    expect(textbox).toHaveValue('哈哈哈哈 /docx  你好');
  });

  it('allows inserting the same skill multiple times as separate blocks', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'create-rule',
          description: 'Create Cursor rules.',
          source: 'workspace',
          sourceLabel: 'Workspace',
          manifestPath: '/tmp/workspace/skill/create-rule/SKILL.md',
          baseDir: '/tmp/workspace/skill/create-rule',
        },
      ],
    });

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByTestId('chat-composer-skill-option-create-rule'));

    textbox.setSelectionRange(textbox.value.length, textbox.value.length);
    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByTestId('chat-composer-skill-option-create-rule'));

    expect(textbox).toHaveValue('/create-rule  /create-rule  ');
    expect(screen.getAllByTestId('chat-composer-skill-token')).toHaveLength(2);
  });

  it('opens the artifact preview panel when the inline skill token is clicked', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    vi.mocked(hostApiFetch).mockResolvedValue({
      success: true,
      skills: [
        {
          name: 'create-skill',
          description: 'Create and refine reusable skills.',
          source: 'workspace',
          sourceLabel: 'Workspace',
          manifestPath: '/tmp/workspace/skill/create-skill/SKILL.md',
          baseDir: '/tmp/workspace/skill/create-skill',
        },
      ],
    });

    renderChatInput();

    const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: 'Draft a new helper' } });
    textbox.focus();
    textbox.setSelectionRange('Draft '.length, 'Draft '.length);

    fireEvent.click(screen.getByTitle('Choose skill'));
    fireEvent.click(await screen.findByText('/create-skill'));

    fireEvent.click(screen.getByTestId('chat-composer-skill-token'));

    expect(artifactPanelMocks.openPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/workspace/skill/create-skill/SKILL.md',
        fileName: 'SKILL.md',
      }),
    );
  });
});
