import { beforeEach, describe, expect, it, vi } from 'vitest';

const { subscribedHandlers, hostApiFetchMock } = vi.hoisted(() => ({
  subscribedHandlers: new Map<string, (payload: unknown) => void>(),
  hostApiFetchMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: hostApiFetchMock,
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (eventName: string, handler: (payload: unknown) => void) => {
    subscribedHandlers.set(eventName, handler);
    return () => {
      subscribedHandlers.delete(eventName);
    };
  },
}));

import { useGatewayStore } from '@/stores/gateway';

describe('gateway store health recovery (CLWX-75)', () => {
  beforeEach(async () => {
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue({ state: 'running', port: 18789, gatewayReady: true });
    await useGatewayStore.getState().init();
  });

  it('clears a stale ok:false when a presence event proves the gateway is alive', () => {
    // Regression: the presence handler used to spread the previous health,
    // preserving ok:false from a failed checkHealth() forever — the header
    // badge stayed on "Disconnected" while turns executed fine.
    useGatewayStore.setState({ health: { ok: false, error: 'transient host-api failure' } });

    const presenceHandler = subscribedHandlers.get('gateway:presence');
    expect(presenceHandler).toBeTypeOf('function');
    presenceHandler!({ agents: 1 });

    expect(useGatewayStore.getState().health?.ok).toBe(true);
  });

  it('marks health ok on an explicit gateway:health event', () => {
    useGatewayStore.setState({ health: { ok: false, error: 'transient' } });

    const healthHandler = subscribedHandlers.get('gateway:health');
    expect(healthHandler).toBeTypeOf('function');
    healthHandler!({ status: 'healthy' });

    expect(useGatewayStore.getState().health?.ok).toBe(true);
  });
});
