// @vitest-environment node
/**
 * Harness-honesty regression tests for the two Windows pilot scripts that
 * certify a chat turn.
 *
 * Both defects here were found by a cross-model adversarial review of the
 * moe.19 verify tick (2026-09-06) and both had the same shape as the bug they
 * were meant to catch: the harness reported success for a turn the principal
 * would call broken.
 *
 *   1. `pilot-chat-turn-driver.js` matched messages with a bare
 *      `[data-testid^="chat-message-"]`, which also matches the inline
 *      `chat-message-error-chip`. The chip is a DESCENDANT of the last message
 *      container, so it sorted last, and its error text is long and stable —
 *      satisfying the "answer settled" heuristic. Verdict: ANSWERED, with the
 *      error string recorded as the answer.
 *   2. `pilot-set-channel.js` trusted the composer pill's `data-channel`, which
 *      is the effective *preference*, not the runtime. A send-time degrade
 *      deliberately leaves the preference on "online" while moving the runtime
 *      to on-device, so `--channel online` exited 0 having changed nothing.
 *
 * These tests pin the decision logic, not the browser plumbing.
 */
import { describe, expect, it } from 'vitest';

/* eslint-disable @typescript-eslint/no-require-imports -- both are CommonJS Windows CLI scripts. */
const driver = require('../../windows-pilot/scripts/pilot-chat-turn-driver.js') as {
  classifyTurnText: (input: { text: string; promptNormalized: string; chipText: string }) => {
    isPlaceholder: boolean;
    isPromptEcho: boolean;
    isErrorChipOnly: boolean;
    acceptable: boolean;
  };
  terminalBlockersFor: (surface: Record<string, unknown>, expectedChannel?: string) => string[];
  verdictFor: (result: Record<string, unknown>) => string;
  exitCodeFor: (verdict: string) => number;
  parseArgs: (argv: string[]) => {
    expectedChannel: string;
    terminalQuiet: number;
  };
  SEL: Record<string, string>;
};
const channel = require('../../windows-pilot/scripts/pilot-set-channel.js') as {
  classifyAccount: (account: Record<string, unknown>) => string;
  runtimeChannelFromStore: (raw: unknown) => string | null;
  legsFor: (pill: string, runtime: string, target: string) => string[];
};
/* eslint-enable @typescript-eslint/no-require-imports */

const CHIP = 'Model call failed Connection error.';
const PROMPT = 'What is the deadline for the daily report?';

function shape(text: string, chipText = '') {
  return driver.classifyTurnText({ text, promptNormalized: PROMPT, chipText });
}

describe('pilot-chat-turn-driver: an error chip is not an answer', () => {
  it('rejects a bubble whose only content is the inline error chip', () => {
    // What the container's innerText actually looks like: the chip text plus the
    // timestamp the bubble always renders.
    const result = shape(`${CHIP} just now`, CHIP);
    expect(result.isErrorChipOnly).toBe(true);
    expect(result.acceptable).toBe(false);
  });

  it('still accepts a real answer that happens to sit beside an error chip', () => {
    const answer =
      'The daily report is due by 3:45pm each school day. I can remind you at 3:30pm if that helps.';
    const result = shape(`${answer} ${CHIP}`, CHIP);
    expect(result.isErrorChipOnly).toBe(false);
    expect(result.acceptable).toBe(true);
  });

  it('rejects the streaming placeholder and the echoed prompt', () => {
    expect(shape('Thinking…').acceptable).toBe(false);
    expect(shape(`${PROMPT} just now`).isPromptEcho).toBe(true);
    expect(shape(`${PROMPT} just now`).acceptable).toBe(false);
  });

  it('excludes the error chip from the message selector', () => {
    // The chip's testid shares the container prefix (ChatMessage.tsx:436 vs
    // Chat/index.tsx:791), so the selector must exclude it explicitly.
    expect(driver.SEL.message).toContain(':not([data-testid="chat-message-error-chip"])');
  });

  it('reports FAILED_ERROR_CHIP_ONLY and a non-zero exit for a chip-only turn', () => {
    const verdict = driver.verdictFor({
      settled: false,
      errorChipOnly: true,
      assistantPromptEcho: false,
      runErrorSeen: false,
      messagesBefore: 0,
      messagesAfter: 2,
    });
    expect(verdict).toBe('FAILED_ERROR_CHIP_ONLY');
    expect(driver.exitCodeFor(verdict)).not.toBe(0);
  });

  it('fails a settled online turn when the UI already degraded to on-device', () => {
    const blockers = driver.terminalBlockersFor({
      rootPresent: true,
      channel: 'on-device',
      degradeNoticeSeen: true,
      degradeInProgress: false,
      sending: false,
      pendingFinal: false,
      activeRunIdPresent: false,
      processingToolResults: false,
      activeExecutionGraph: false,
      runErrorSeen: false,
      errorChipSeen: false,
    }, 'online');

    expect(blockers).toEqual([
      'UNEXPECTED_CHANNEL_ON_DEVICE',
      'UNEXPECTED_DEGRADE_TO_ON_DEVICE',
    ]);
    const verdict = driver.verdictFor({
      settled: true,
      runErrorSeen: false,
      terminalStable: true,
      terminalBlockers: blockers,
    });
    expect(verdict).toBe('FAILED_UNEXPECTED_DEGRADE');
    expect(driver.exitCodeFor(verdict)).toBe(40);
  });

  it('does not accept stable answer text while resend/degrade surfaces are still active', () => {
    const blockers = driver.terminalBlockersFor({
      rootPresent: true,
      channel: 'online',
      degradeNoticeSeen: true,
      degradeInProgress: true,
      sending: true,
      pendingFinal: true,
      activeRunIdPresent: true,
      activeExecutionGraph: true,
      runErrorSeen: false,
      errorChipSeen: false,
    }, 'online');

    expect(blockers).toEqual(expect.arrayContaining([
      'UNEXPECTED_DEGRADE_TO_ON_DEVICE',
      'DEGRADE_IN_PROGRESS',
      'SEND_STILL_IN_PROGRESS',
      'PENDING_TOOL_FINAL',
      'ACTIVE_RUN_STILL_PRESENT',
      'EXECUTION_GRAPH_STILL_ACTIVE',
    ]));
    expect(driver.verdictFor({
      settled: true,
      runErrorSeen: false,
      terminalStable: false,
      terminalBlockers: blockers,
    })).toBe('FAILED_UNEXPECTED_DEGRADE');
  });

  it('blocks success when the exact terminal state attributes are missing', () => {
    const blockers = driver.terminalBlockersFor({
      channel: 'online',
      degradeNoticeSeen: false,
    }, 'online');

    expect(blockers).toEqual(expect.arrayContaining([
      'MISSING_TERMINAL_STATE_ROOT',
      'MISSING_TERMINAL_SIGNAL_SENDING',
      'MISSING_TERMINAL_SIGNAL_PENDING_FINAL',
      'MISSING_TERMINAL_SIGNAL_ACTIVE_RUN',
      'MISSING_TERMINAL_SIGNAL_DEGRADE_IN_PROGRESS',
      'MISSING_TERMINAL_SIGNAL_ACTIVE_GRAPH',
      'MISSING_TERMINAL_SIGNAL_RUN_ERROR',
      'MISSING_TERMINAL_SIGNAL_ERROR_CHIP',
    ]));
    expect(driver.verdictFor({
      settled: true,
      runErrorSeen: false,
      terminalStable: true,
      terminalBlockers: blockers,
    })).toBe('TIMED_OUT_MID_TURN');
  });

  it('rejects a later terminal run error or error chip even after stable answer text', () => {
    const runErrorBlockers = driver.terminalBlockersFor({
      rootPresent: true,
      channel: 'online',
      degradeNoticeSeen: false,
      degradeInProgress: false,
      sending: false,
      pendingFinal: false,
      activeRunIdPresent: false,
      activeExecutionGraph: false,
      runErrorSeen: true,
      errorChipSeen: false,
    }, 'online');
    const chipBlockers = driver.terminalBlockersFor({
      rootPresent: true,
      channel: 'online',
      degradeNoticeSeen: false,
      degradeInProgress: false,
      sending: false,
      pendingFinal: false,
      activeRunIdPresent: false,
      activeExecutionGraph: false,
      runErrorSeen: false,
      errorChipSeen: true,
    }, 'online');

    expect(runErrorBlockers).toContain('RUN_ERROR_VISIBLE');
    expect(chipBlockers).toContain('ERROR_CHIP_VISIBLE');
    expect(driver.verdictFor({
      settled: true,
      terminalStable: false,
      terminalBlockers: runErrorBlockers,
    })).toBe('TIMED_OUT_MID_TURN');
    expect(driver.verdictFor({
      settled: true,
      terminalStable: false,
      terminalBlockers: chipBlockers,
    })).toBe('TIMED_OUT_MID_TURN');
  });

  it('treats post-answer instability as a mid-turn timeout, not a clean answer', () => {
    const verdict = driver.verdictFor({
      settled: true,
      runErrorSeen: false,
      terminalStable: false,
      terminalBlockers: [],
    });

    expect(verdict).toBe('TIMED_OUT_MID_TURN');
    expect(driver.exitCodeFor(verdict)).toBe(40);
  });

  it('parses expected-channel and terminal quiet options for the VM wrapper', () => {
    const args = driver.parseArgs([
      'node',
      'pilot-chat-turn-driver.js',
      '--prompt',
      'hello',
      '--expected-channel',
      'online',
      '--terminal-quiet',
      '12',
    ]);

    expect(args.expectedChannel).toBe('online');
    expect(args.terminalQuiet).toBe(12);
  });

  it('exits 0 only for a clean answer', () => {
    expect(driver.exitCodeFor('ANSWERED')).toBe(0);
    // Answered, but the principal also saw a red banner: distinct, non-zero.
    expect(driver.exitCodeFor('ANSWERED_WITH_RUN_ERROR')).toBe(41);
    for (const verdict of [
      'TIMED_OUT_MID_TURN',
      'NO_RESPONSE',
      'ASSISTANT_EMPTY_SILENCE_ON_SEND',
      'BLOCKED_COMPOSER_DISABLED',
      'FAILED_SESSION_NOT_FRESH',
      'FAILED_UNEXPECTED_DEGRADE',
      'FAILED_UNEXPECTED_CHANNEL',
      'INCOMPLETE',
    ]) {
      expect(driver.exitCodeFor(verdict)).toBe(40);
    }
  });
});

describe('pilot-set-channel: the runtime is the truth, not the pill', () => {
  it('classifies a local ollama account as on-device and a cloud one as online', () => {
    expect(channel.classifyAccount({ vendorId: 'ollama' })).toBe('on-device');
    expect(channel.classifyAccount({ vendorId: 'openai', baseUrl: 'http://127.0.0.1:11434/v1' }))
      .toBe('on-device');
    expect(channel.classifyAccount({ vendorId: 'google' })).toBe('online');
  });

  it('reads the runtime channel from the default provider ACCOUNT', () => {
    const store = {
      defaultProviderAccountId: 'acct-local',
      providerAccounts: {
        'acct-local': { vendorId: 'ollama', model: 'qwen2.5:3b-instruct' },
        'acct-cloud': { vendorId: 'google', model: 'gemini-2.5-pro' },
      },
    };
    expect(channel.runtimeChannelFromStore(store)).toBe('on-device');
  });

  it('returns null — never a guess — when the store cannot prove a default', () => {
    expect(channel.runtimeChannelFromStore({})).toBeNull();
    expect(channel.runtimeChannelFromStore({ defaultProviderAccountId: 'missing' })).toBeNull();
    expect(channel.runtimeChannelFromStore(null)).toBeNull();
  });

  it('does nothing when the runtime is already on the requested channel', () => {
    expect(channel.legsFor('online', 'on-device', 'on-device')).toEqual([]);
  });

  it('clicks once in the ordinary case', () => {
    expect(channel.legsFor('online', 'online', 'on-device')).toEqual(['on-device']);
  });

  it('round-trips when the pill already reads the target but the runtime does not', () => {
    // The post-degrade state: preference (and so the pill) says online, runtime
    // is on-device. A single click would move the pill to on-device — the wrong
    // way — so the runtime must be walked back through the other channel.
    expect(channel.legsFor('online', 'on-device', 'online')).toEqual(['on-device', 'online']);
  });
});
