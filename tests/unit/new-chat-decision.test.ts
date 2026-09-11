import { describe, expect, it } from 'vitest';
import { shouldStartNewSession } from '@/components/layout/new-chat-decision';

const LAUNCH = 1_757_500_000_000;
const mintedNow = `agent:main:session-${LAUNCH + 5_000}`;
const mintedEarlierRun = `agent:main:session-${LAUNCH - 3_600_000}`;
const empty = { messages: [], sessionLastActivity: {}, sessionLabels: {} };

describe('New Chat decision (CLWX-140)', () => {
  it('starts a new session from the main session even when its history has not loaded yet', () => {
    // First minute after launch on the installed build: gateway not ready,
    // transcript empty, principal clicks New Chat. This used to be a no-op.
    expect(shouldStartNewSession({ currentSessionKey: 'agent:main:main', ...empty }, LAUNCH)).toBe(true);
  });

  it('starts a new session from the main session when it has messages', () => {
    expect(shouldStartNewSession({
      currentSessionKey: 'agent:main:main',
      messages: [{ role: 'user' }],
      sessionLastActivity: { 'agent:main:main': 1 },
      sessionLabels: {},
    }, LAUNCH)).toBe(true);
  });

  it('is a no-op only on a fresh, empty session minted during this run', () => {
    expect(shouldStartNewSession({ currentSessionKey: mintedNow, ...empty }, LAUNCH)).toBe(false);
  });

  it('treats a session restored from an earlier run as a real conversation even while it looks empty', () => {
    // Its history and label hydrate late, exactly like main's; "empty" is not evidence.
    expect(shouldStartNewSession({ currentSessionKey: mintedEarlierRun, ...empty }, LAUNCH)).toBe(true);
  });

  it('treats a minted session with activity, a label or messages as a real conversation', () => {
    expect(shouldStartNewSession({ currentSessionKey: mintedNow, messages: [], sessionLastActivity: { [mintedNow]: 5 }, sessionLabels: {} }, LAUNCH)).toBe(true);
    expect(shouldStartNewSession({ currentSessionKey: mintedNow, messages: [], sessionLastActivity: {}, sessionLabels: { [mintedNow]: 'Staff meeting' } }, LAUNCH)).toBe(true);
    expect(shouldStartNewSession({ currentSessionKey: mintedNow, messages: [{ role: 'user' }], sessionLastActivity: {}, sessionLabels: {} }, LAUNCH)).toBe(true);
  });

  it('always starts a new session from keys newSession never mints', () => {
    for (const key of ['', 'main', 'agent:main:cron:job-1', 'agent:writer:main', 'agent:main:session-abc', 'session-123']) {
      expect(shouldStartNewSession({ currentSessionKey: key, ...empty }, LAUNCH)).toBe(true);
    }
    // Other agents' minted sessions follow the same rule as main's.
    expect(shouldStartNewSession({ currentSessionKey: `agent:writer:session-${LAUNCH + 1}`, ...empty }, LAUNCH)).toBe(false);
    expect(shouldStartNewSession({ currentSessionKey: `agent:writer:session-${LAUNCH - 1}`, ...empty }, LAUNCH)).toBe(true);
  });

  it('uses the renderer launch time by default', () => {
    // Minted "in the future" relative to launch → fresh; minted at epoch 0 → restored.
    expect(shouldStartNewSession({ currentSessionKey: `agent:main:session-${Date.now() + 1_000}`, ...empty })).toBe(false);
    expect(shouldStartNewSession({ currentSessionKey: 'agent:main:session-0', ...empty })).toBe(true);
  });
});
