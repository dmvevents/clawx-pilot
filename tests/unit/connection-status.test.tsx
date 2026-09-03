import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from '@/components/chat/ConnectionStatus';
import { useSettingsStore } from '@/stores/settings';

const { agentsState, chatState, gatewayState, providersState } = vi.hoisted(() => ({
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
  },
  chatState: {
    currentAgentId: 'main',
  },
  gatewayState: {
    status: { state: 'running', port: 18789, gatewayReady: true } as Record<string, unknown>,
    health: null as Record<string, unknown> | null,
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    defaultAccountId: null as string | null,
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState) => unknown) => selector(providersState),
}));

const now = '2026-01-01T00:00:00.000Z';

function googleAccount(): Record<string, unknown> {
  return {
    id: 'g1',
    vendorId: 'google',
    label: 'Gemini',
    authMode: 'api_key',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

function ollamaAccount(): Record<string, unknown> {
  return {
    id: 'ollama-abcd1234',
    vendorId: 'ollama',
    label: 'Local',
    authMode: 'local',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'hermes3:8b',
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe('ConnectionStatus header badge (CLWX-75)', () => {
  beforeEach(() => {
    agentsState.agents = [];
    chatState.currentAgentId = 'main';
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    gatewayState.health = null;
    providersState.accounts = [googleAccount()];
    providersState.defaultAccountId = 'g1';
    useSettingsStore.setState({ devModeUnlocked: false });
  });

  it('shows Online while the gateway is running and ready with a cloud account', () => {
    render(<ConnectionStatus />);
    const badge = screen.getByTestId('chat-connection-status');
    expect(badge).toHaveAttribute('data-state', 'online');
    expect(badge).toHaveTextContent('Online');
  });

  it('shows On this device for a local account', () => {
    providersState.accounts = [ollamaAccount()];
    providersState.defaultAccountId = 'ollama-abcd1234';
    render(<ConnectionStatus />);
    const badge = screen.getByTestId('chat-connection-status');
    expect(badge).toHaveAttribute('data-state', 'on-device');
    expect(badge).toHaveTextContent('On this device');
  });

  it('never issues a renderer-side network probe', () => {
    // The old implementation HEAD-probed the provider baseUrl from the
    // renderer; a single blocked fetch latched the badge on "Disconnected"
    // while turns kept executing through the gateway process.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<ConnectionStatus />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('agrees with the footer: running but not-yet-ready is Reconnecting, not Disconnected', () => {
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: false };
    render(<ConnectionStatus />);
    const badge = screen.getByTestId('chat-connection-status');
    expect(badge).toHaveAttribute('data-state', 'reconnecting');
    expect(badge).toHaveTextContent('Reconnecting');
  });

  it('shows Reconnecting while starting and Disconnected when stopped', () => {
    gatewayState.status = { state: 'starting', port: 18789 };
    const { rerender } = render(<ConnectionStatus />);
    expect(screen.getByTestId('chat-connection-status')).toHaveAttribute('data-state', 'reconnecting');

    gatewayState.status = { state: 'stopped', port: 18789 };
    rerender(<ConnectionStatus />);
    expect(screen.getByTestId('chat-connection-status')).toHaveAttribute('data-state', 'disconnected');
  });

  it('does not go Disconnected on a failed host-API health check while running and ready', () => {
    // CLWX-75 core: the composer footer's `isGatewayUsable` is
    // `state === 'running' && gatewayReady !== false` — it never consults
    // `health.ok`. A failed renderer-side /api/gateway/health poll must NOT
    // drive the header badge red while the footer reads "connected" and turns
    // still execute over the gateway WS. The badge tracks the same signal as
    // the footer, so it stays on the provider class.
    gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
    gatewayState.health = { ok: false, error: 'transient host-api hiccup' };
    render(<ConnectionStatus />);
    const badge = screen.getByTestId('chat-connection-status');
    expect(badge).toHaveAttribute('data-state', 'online');
    expect(badge).toHaveTextContent('Online');
    expect(badge).not.toHaveTextContent('Disconnected');
  });

  it('header/footer single source of truth: agree across a running turn regardless of health', () => {
    // Mirror the footer predicate exactly and assert the header never claims a
    // hard "Disconnected" while the footer would show "connected".
    const footerUsable = (status: Record<string, unknown>) =>
      status.state === 'running' && status.gatewayReady !== false;

    for (const health of [null, { ok: true }, { ok: false, error: 'x' }] as Array<Record<string, unknown> | null>) {
      gatewayState.status = { state: 'running', port: 18789, gatewayReady: true };
      gatewayState.health = health;
      const { unmount } = render(<ConnectionStatus />);
      const badge = screen.getByTestId('chat-connection-status');
      // Footer would be green/"connected" here…
      expect(footerUsable(gatewayState.status)).toBe(true);
      // …so the header must never be the hard-red "disconnected".
      expect(badge).not.toHaveAttribute('data-state', 'disconnected');
      unmount();
    }
  });

  it('keeps raw model ids out of the badge unless dev mode is unlocked', () => {
    const { rerender } = render(<ConnectionStatus />);
    expect(screen.queryByText(/gemini-2\.5-flash/)).not.toBeInTheDocument();

    useSettingsStore.setState({ devModeUnlocked: true });
    rerender(<ConnectionStatus />);
    expect(screen.getByText(/gemini-2\.5-flash/)).toBeInTheDocument();
  });
});
