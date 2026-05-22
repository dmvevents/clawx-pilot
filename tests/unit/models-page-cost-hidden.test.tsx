/**
 * Task #53 — HIDE_COST_IN_UI feature flag.
 *
 * Verifies that when HIDE_COST_IN_UI=true and devModeUnlocked=false, the
 * Models token-usage history bubble does NOT expose any USD figure to the
 * principal. Backend cost calculation (electron/utils/token-usage*.ts) is
 * unaffected — that is asserted by absence of changes there, not by this
 * test.
 *
 * Dev-mode escape is exercised separately to confirm the flag is not a
 * one-way gate.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const trackUiEventMock = vi.fn();

const { gatewayState, settingsState, flagState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789, connectedAt: 1, pid: 1234 },
  },
  settingsState: {
    devModeUnlocked: false,
  },
  flagState: {
    HIDE_COST_IN_UI: true,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/telemetry', () => ({
  trackUiEvent: (...args: unknown[]) => trackUiEventMock(...args),
}));

vi.mock('@/components/settings/ProvidersSettings', () => ({
  ProvidersSettings: () => null,
}));

vi.mock('@/components/common/FeedbackState', () => ({
  FeedbackState: ({ title }: { title: string }) => <div>{title}</div>,
}));

// Mock the feature-flags module so each test can flip HIDE_COST_IN_UI without
// touching process.env. We re-export every other flag the importer might
// pull in transitively as a passthrough — but Models/index.tsx only imports
// HIDE_COST_IN_UI, so a single export is sufficient.
vi.mock('../../shared/feature-flags', () => ({
  get HIDE_COST_IN_UI() {
    return flagState.HIDE_COST_IN_UI;
  },
}));

// Translation mock: interpolate `{{amount}}` so we can assert against the
// fully-rendered string ("Cost $0.0023") rather than the bare key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> | string) => {
      if (typeof options === 'string') return options;
      if (key === 'dashboard:recentTokenHistory.cost' && options && typeof options === 'object') {
        const amount = (options as { amount?: string | number }).amount;
        return `Cost $${amount}`;
      }
      if (options && typeof options === 'object') {
        const value = (options as Record<string, unknown>).value;
        if (value !== undefined) return `${key} ${String(value)}`;
      }
      return key;
    },
  }),
}));

function createUsageEntry(costUsd: number) {
  // Use "now" so the default 7-day window includes the entry.
  return {
    timestamp: new Date().toISOString(),
    sessionId: `session-${costUsd}`,
    agentId: 'main',
    model: 'gpt-5',
    provider: 'openai',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 150,
    costUsd,
  };
}

describe('Models page — HIDE_COST_IN_UI flag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789, connectedAt: 1, pid: 1234 };
    settingsState.devModeUnlocked = false;
    flagState.HIDE_COST_IN_UI = true;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    hostApiFetchMock.mockResolvedValue([createUsageEntry(0.0234)]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides the per-request USD cost when HIDE_COST_IN_UI=true and devMode=false', async () => {
    const { Models } = await import('@/pages/Models/index');
    const { container } = render(<Models />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? '';
    // Backend log format would be "Cost $0.0234" — make sure no such string is
    // exposed to the renderer when the flag is on and dev-mode is off.
    expect(text).not.toMatch(/\$\d+\.\d+/);
    expect(text).not.toMatch(/USD/i);
  });

  it('shows the per-request USD cost when HIDE_COST_IN_UI=true and devModeUnlocked=true', async () => {
    settingsState.devModeUnlocked = true;
    flagState.HIDE_COST_IN_UI = true;

    const { Models } = await import('@/pages/Models/index');
    const { container } = render(<Models />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? '';
    expect(text).toMatch(/\$0\.0234/);
  });

  it('shows the per-request USD cost when HIDE_COST_IN_UI=false regardless of dev-mode', async () => {
    settingsState.devModeUnlocked = false;
    flagState.HIDE_COST_IN_UI = false;

    const { Models } = await import('@/pages/Models/index');
    const { container } = render(<Models />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? '';
    expect(text).toMatch(/\$0\.0234/);
  });
});
