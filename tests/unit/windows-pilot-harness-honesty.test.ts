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
import { JSDOM } from 'jsdom';
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
  chatReadyBlockersFor: (state: Record<string, unknown>) => string[];
  freshSessionBlockersFor: (before: Record<string, unknown>, after: Record<string, unknown>) => string[];
  isFreshSessionKey: (value: string) => boolean;
  semanticMessageTextFromElement: (element: Element) => string;
  semanticAnswerStillLatest: (latestText: string, expectedText: string) => boolean;
  terminalLatestText: (surface: { lastMessageText?: string; lastMessageTextFull?: string }) => string;
  collectCurrentTurnErrorChipEvidenceFromDocument: (doc: Document, options?: {
    selectors?: Record<string, string>;
    preSendMessageTestIds?: string[];
    preSendMessageCount?: number;
  }) => {
    errorChipSeen: boolean;
    errorChipText: string;
    errorChipCount: number;
    historicalErrorChipCount: number;
    messageTestIds: string[];
    hasPreSendScope: boolean;
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

  it('extracts assistant prose without hover timestamp chrome for candidate and terminal checks', () => {
    const answer = 'I have received and acknowledged acceptance token CLWX96-ONLINE-MOE21-34134725489.';
    const dom = new JSDOM(`
      <div data-testid="chat-message-1">
        <div class="space-y-2">
          <div class="relative rounded-2xl">
            <div class="prose prose-sm dark:prose-invert max-w-none break-words"><p>${answer}</p></div>
          </div>
          <div class="opacity-0"><span>just now</span><button>Copy</button></div>
        </div>
      </div>
    `);
    const message = dom.window.document.querySelector('[data-testid="chat-message-1"]');
    expect(message).not.toBeNull();
    // The container text includes timestamp/copy UI; exact spacing depends on
    // innerText vs textContent in Chromium. The semantic extractor follows the
    // ChatMessage DOM contract and reads only the answer body.
    expect(message?.textContent).toContain('just now');
    const semantic = driver.semanticMessageTextFromElement(message as Element);

    expect(semantic).toBe(answer);
    expect(driver.semanticAnswerStillLatest(semantic, answer)).toBe(true);
  });

  it('rejects a later terminal answer change instead of accepting substring containment', () => {
    const answer = 'The ordinary online acceptance token is CLWX96-ONLINE-MOE21-34134725489.';

    expect(driver.semanticAnswerStillLatest(`${answer} A newer assistant update appeared.`, answer))
      .toBe(false);
    expect(driver.semanticAnswerStillLatest('A different terminal answer appeared.', answer))
      .toBe(false);
  });

  it('compares the full semantic terminal text for answers longer than the evidence preview', () => {
    const answer = `The long answer starts here. ${'word '.repeat(190)}CLWX96-LONG-ANSWER-END`;
    expect(answer.length).toBeGreaterThan(800);
    const preview = answer.slice(0, 800);

    const latest = driver.terminalLatestText({
      lastMessageText: preview,
      lastMessageTextFull: answer,
    });

    expect(latest).toBe(answer.trim());
    expect(driver.semanticAnswerStillLatest(latest, answer)).toBe(true);
  });

  it('rejects long terminal answers whose suffix changes beyond the evidence preview', () => {
    const answer = `The long answer starts here. ${'word '.repeat(190)}CLWX96-LONG-ANSWER-END`;
    const changed = `${answer.slice(0, -3)}BAD`;
    expect(answer.slice(0, 800)).toBe(changed.slice(0, 800));

    const latest = driver.terminalLatestText({
      lastMessageText: changed.slice(0, 800),
      lastMessageTextFull: changed,
    });

    expect(driver.semanticAnswerStillLatest(latest, answer)).toBe(false);
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
      genericErrorSeen: false,
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
      genericErrorSeen: false,
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
      'MISSING_TERMINAL_SIGNAL_GENERIC_ERROR',
      'MISSING_TERMINAL_SIGNAL_ERROR_CHIP',
    ]));
    expect(driver.verdictFor({
      settled: true,
      runErrorSeen: false,
      terminalStable: true,
      terminalBlockers: blockers,
    })).toBe('TIMED_OUT_MID_TURN');
  });


  it('ignores inline error chips owned by pre-send history when checking terminal blockers', () => {
    const answer = 'The current Online turn completed with token CLWX125-CURRENT-ANSWER-0042.';
    const dom = new JSDOM(`
      <main data-testid="chat-page">
        <div data-testid="chat-message-0"><p class="whitespace-pre-wrap">Old prompt</p></div>
        <div data-testid="chat-message-1">
          <div class="prose"><p>Old failed answer.</p></div>
          <div data-testid="chat-message-error-chip">${CHIP}</div>
        </div>
        <div data-testid="chat-message-2"><p class="whitespace-pre-wrap">${PROMPT}</p></div>
        <div data-testid="chat-message-3"><div class="prose"><p>${answer}</p></div></div>
      </main>
    `);

    const evidence = driver.collectCurrentTurnErrorChipEvidenceFromDocument(dom.window.document, {
      selectors: driver.SEL,
      preSendMessageTestIds: ['chat-message-0', 'chat-message-1'],
    });

    expect(evidence.errorChipSeen).toBe(false);
    expect(evidence.errorChipCount).toBe(0);
    expect(evidence.historicalErrorChipCount).toBe(1);
    expect(driver.terminalBlockersFor({
      rootPresent: true,
      channel: 'online',
      degradeNoticeSeen: false,
      degradeInProgress: false,
      sending: false,
      pendingFinal: false,
      activeRunIdPresent: false,
      activeExecutionGraph: false,
      runErrorSeen: false,
      genericErrorSeen: false,
      errorChipSeen: evidence.errorChipSeen,
    }, 'online')).toEqual([]);
  });

  it('keeps a post-send inline error chip as a terminal blocker for the current turn', () => {
    const dom = new JSDOM(`
      <main data-testid="chat-page">
        <div data-testid="chat-message-0"><p class="whitespace-pre-wrap">Old prompt</p></div>
        <div data-testid="chat-message-1"><div class="prose"><p>Old answer.</p></div></div>
        <div data-testid="chat-message-2"><p class="whitespace-pre-wrap">${PROMPT}</p></div>
        <div data-testid="chat-message-3">
          <div class="prose"><p>New failed answer.</p></div>
          <div data-testid="chat-message-error-chip">${CHIP}</div>
        </div>
      </main>
    `);

    const evidence = driver.collectCurrentTurnErrorChipEvidenceFromDocument(dom.window.document, {
      selectors: driver.SEL,
      preSendMessageTestIds: ['chat-message-0', 'chat-message-1'],
    });
    const blockers = driver.terminalBlockersFor({
      rootPresent: true,
      channel: 'online',
      degradeNoticeSeen: false,
      degradeInProgress: false,
      sending: false,
      pendingFinal: false,
      activeRunIdPresent: false,
      activeExecutionGraph: false,
      runErrorSeen: false,
      genericErrorSeen: false,
      errorChipSeen: evidence.errorChipSeen,
    }, 'online');

    expect(evidence.errorChipSeen).toBe(true);
    expect(evidence.errorChipText).toBe(CHIP);
    expect(evidence.messageTestIds).toEqual(['chat-message-3']);
    expect(blockers).toContain('ERROR_CHIP_VISIBLE');
  });

  it('fails closed for inline error chips when no pre-send history scope is available', () => {
    const dom = new JSDOM(`
      <main data-testid="chat-page">
        <div data-testid="chat-message-4">
          <div class="prose"><p>Unknown turn owner.</p></div>
          <div data-testid="chat-message-error-chip">${CHIP}</div>
        </div>
      </main>
    `);

    const evidence = driver.collectCurrentTurnErrorChipEvidenceFromDocument(dom.window.document, {
      selectors: driver.SEL,
      preSendMessageTestIds: [],
    });

    expect(evidence.hasPreSendScope).toBe(false);
    expect(evidence.errorChipSeen).toBe(true);
    expect(evidence.errorChipText).toBe(CHIP);
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
      genericErrorSeen: false,
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
      genericErrorSeen: false,
      errorChipSeen: true,
    }, 'online');
    const genericErrorBlockers = driver.terminalBlockersFor({
      rootPresent: true,
      channel: 'online',
      degradeNoticeSeen: false,
      degradeInProgress: false,
      sending: false,
      pendingFinal: false,
      activeRunIdPresent: false,
      activeExecutionGraph: false,
      runErrorSeen: false,
      genericErrorSeen: true,
      errorChipSeen: false,
    }, 'online');

    expect(runErrorBlockers).toContain('RUN_ERROR_VISIBLE');
    expect(chipBlockers).toContain('ERROR_CHIP_VISIBLE');
    expect(genericErrorBlockers).toContain('GENERIC_ERROR_VISIBLE');
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
    expect(driver.verdictFor({
      settled: false,
      genericErrorSeen: true,
      assistantPromptEcho: false,
      errorChipOnly: false,
      messagesBefore: 0,
      messagesAfter: 1,
    })).toBe('FAILED_GENERIC_ERROR');
    expect(driver.verdictFor({
      settled: true,
      terminalStable: true,
      terminalBlockers: [],
      genericErrorSeen: true,
      runErrorSeen: false,
      messagesBefore: 0,
      messagesAfter: 2,
    })).toBe('FAILED_GENERIC_ERROR');
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

  it('does not treat an empty DOM as a fresh session when the session key did not change', () => {
    const blockers = driver.freshSessionBlockersFor(
      { rootPresent: true, sessionKey: 'agent:main:main', loadingHistory: false, composerEnabled: true, messageCount: 0 },
      { rootPresent: true, sessionKey: 'agent:main:main', loadingHistory: false, composerEnabled: true, messageCount: 0 },
    );

    expect(blockers).toContain('SESSION_KEY_DID_NOT_CHANGE');
  });

  it('keeps NewSession blocked while chat history is still hydrating', () => {
    const blockers = driver.chatReadyBlockersFor({
      rootPresent: true,
      sessionKey: 'agent:main:main',
      loadingHistory: true,
      composerEnabled: true,
      messageCount: 0,
    });

    expect(blockers).toEqual(['SESSION_HISTORY_STILL_LOADING']);
  });

  it('accepts only a stable empty agent session key transition as a fresh session', () => {
    const before = {
      rootPresent: true,
      sessionKey: 'agent:main:main',
      loadingHistory: false,
      composerEnabled: true,
      messageCount: 1,
    };
    const after = {
      rootPresent: true,
      sessionKey: 'agent:main:session-1788847885527',
      loadingHistory: false,
      composerEnabled: true,
      messageCount: 0,
    };

    expect(driver.isFreshSessionKey(after.sessionKey)).toBe(true);
    expect(driver.freshSessionBlockersFor(before, after)).toEqual([]);
    expect(driver.freshSessionBlockersFor(before, { ...after, messageCount: 1 }))
      .toContain('NEW_SESSION_NOT_EMPTY');
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
      'FAILED_GENERIC_ERROR',
      'BLOCKED_CHAT_NOT_READY',
      'FAILED_NEW_SESSION_NOT_PROVEN',
      'INCOMPLETE',
    ]) {
      expect(driver.exitCodeFor(verdict)).toBe(40);
    }
  });
});

describe('pilot-chat-turn-driver: execution graph evidence is scoped to the current prompt', () => {
  const selectors = driver.SEL;
  const prompt = 'Read the PDF and summarize the attendance anomalies.';

  function extract(html: string, preSendMessageTestIds: string[] = [], promptNormalized = prompt) {
    const dom = new JSDOM(html);
    return driver.extractExecutionGraphEvidenceFromDocument(dom.window.document, {
      selectors,
      promptNormalized,
      preSendMessageTestIds,
    });
  }

  function message(index: number, text: string, graph = '') {
    return `
      <div data-testid="chat-message-${index}">
        <p class="whitespace-pre-wrap">${text}</p>
        ${graph}
      </div>
    `;
  }

  function expandedGraph(labels: string[]) {
    return `
      <div data-testid="chat-execution-graph" data-collapsed="false">
        ${labels.map((label) => `
          <div data-testid="chat-execution-step">
            <button><div><p class="font-medium">${label}</p><span>completed</span></div></button>
          </div>
        `).join('')}
      </div>
    `;
  }

  it('does not borrow a prior expanded graph when the current prompt graph is collapsed', () => {
    const html = `
      <main data-testid="chat-page">
        ${message(0, 'Older document prompt', expandedGraph(['document.read_pdf']))}
        <div data-testid="chat-message-1"><div class="prose"><p>Old answer.</p></div></div>
        ${message(2, prompt, '<button data-testid="chat-execution-graph" data-collapsed="true">2 tool calls · 1 process messages</button>')}
        <div data-testid="chat-message-3"><div class="prose"><p>Fresh answer.</p></div></div>
      </main>
    `;

    const evidence = extract(html, ['chat-message-0', 'chat-message-1']);

    expect(evidence.currentPromptMatched).toBe(true);
    expect(evidence.graphPresent).toBe(true);
    expect(evidence.graphCollapsed).toBe(true);
    expect(evidence.steps).toEqual([]);
    expect(evidence.toolNames).toEqual([]);
  });

  it('uses post-send data-testid identity, not visible count or numeric index, with non-contiguous reused sessions', () => {
    const html = `
      <main data-testid="chat-page">
        ${message(0, 'Earlier prompt', expandedGraph(['exec']))}
        ${message(4, prompt, expandedGraph(['old_tool']))}
        <div data-testid="chat-message-7"><div class="prose"><p>Prior identical answer.</p></div></div>
        ${message(9, prompt, expandedGraph(['document.read_docx']))}
        <div data-testid="chat-message-10"><div class="prose"><p>Fresh answer.</p></div></div>
      </main>
    `;

    const evidence = extract(html, ['chat-message-0', 'chat-message-4', 'chat-message-7']);

    expect(evidence.currentPromptMatched).toBe(true);
    expect(evidence.promptMessageTestId).toBe('chat-message-9');
    expect(evidence.promptMessageIndex).toBe(9);
    expect(evidence.promptDomOrdinal).toBe(3);
    expect(evidence.toolNames).toEqual(['document.read_docx']);
    expect(evidence.toolNames).not.toContain('old_tool');
  });

  it('extracts simple and dotted tool labels from the exact current graph', () => {
    const html = `
      <main data-testid="chat-page">
        ${message(0, 'Prior prompt', expandedGraph(['old_tool']))}
        <div data-testid="chat-message-1"><div class="prose"><p>Old answer.</p></div></div>
        ${message(2, prompt, expandedGraph(['exec', 'read', 'document.read_docx']))}
        <div data-testid="chat-message-3"><div class="prose"><p>Fresh answer.</p></div></div>
      </main>
    `;

    const evidence = extract(html, ['chat-message-0', 'chat-message-1']);

    expect(evidence.currentPromptMatched).toBe(true);
    expect(evidence.graphCollapsed).toBe(false);
    expect(evidence.steps.map((step) => step.label)).toEqual(['exec', 'read', 'document.read_docx']);
    expect(evidence.toolNames).toEqual(['exec', 'read', 'document.read_docx']);
  });

  it('fails closed when the indexed current prompt does not match, even if that container has graph rows', () => {
    const html = `
      <main data-testid="chat-page">
        ${message(0, 'Different prompt', expandedGraph(['document.read_docx']))}
        <div data-testid="chat-message-1"><div class="prose"><p>Answer.</p></div></div>
      </main>
    `;

    const evidence = driver.extractExecutionGraphEvidenceFromDocument(new JSDOM(html).window.document, {
      selectors,
      promptNormalized: prompt,
      promptMessageIndex: 0,
    });

    expect(evidence.currentPromptMatched).toBe(false);
    expect(evidence.diagnostics).toContain('CURRENT_PROMPT_CONTAINER_MISMATCH');
    expect(evidence.steps).toEqual([]);
    expect(evidence.toolNames).toEqual([]);
  });

  it('reports no graph on the current prompt instead of reading later prose or prior rows', () => {
    const html = `
      <main data-testid="chat-page">
        ${message(0, 'Prior prompt', expandedGraph(['document.read_pdf']))}
        ${message(1, prompt)}
        <div data-testid="chat-message-2"><div class="prose"><p>I used document.read_docx to answer.</p></div></div>
      </main>
    `;

    const evidence = extract(html, ['chat-message-0']);

    expect(evidence.currentPromptMatched).toBe(true);
    expect(evidence.graphPresent).toBe(false);
    expect(evidence.diagnostics).toContain('CURRENT_PROMPT_GRAPH_MISSING');
    expect(evidence.toolNames).toEqual([]);
  });

  it('does not turn process narration rows into tool names', () => {
    const html = `
      <main data-testid="chat-page">
        ${message(0, prompt, `
          <div data-testid="chat-execution-graph" data-collapsed="false">
            <div data-testid="chat-execution-step">
              <button><div><p class="text-meta">exec</p></div></button>
            </div>
          </div>
        `)}
      </main>
    `;

    const evidence = extract(html);

    expect(evidence.steps).toHaveLength(1);
    expect(evidence.steps[0].label).toBe('');
    expect(evidence.toolNames).toEqual([]);
  });

  it('expands the current collapsed graph via UI and restores it after capture', async () => {
    let expanded = false;
    let restored = false;
    const collapsedEvidence = {
      currentPromptMatched: true,
      graphPresent: true,
      graphCollapsed: true,
      promptMessageTestId: 'chat-message-9',
      promptMessageIndex: 9,
      promptDomOrdinal: 2,
      steps: [],
      toolNames: [],
      diagnostics: [],
    };
    const expandedEvidence = {
      currentPromptMatched: true,
      graphPresent: true,
      graphCollapsed: false,
      promptMessageTestId: 'chat-message-9',
      promptMessageIndex: 9,
      promptDomOrdinal: 2,
      steps: [{ index: 0, label: 'document.read_docx', text: 'document.read_docx completed' }],
      toolNames: ['document.read_docx'],
      diagnostics: [],
    };
    const fakeClick = async () => {
      if (!expanded) {
        expanded = true;
      } else {
        restored = true;
        expanded = false;
      }
    };
    const page = {
      evaluate: async () => (expanded ? expandedEvidence : collapsedEvidence),
      locator: (selector: string) => {
        expect(selector).toBe('[data-testid="chat-message-9"]');
        return {
          first: () => ({
            locator: () => ({ first: () => ({ click: fakeClick }) }),
          }),
        };
      },
      waitForFunction: async () => undefined,
    };

    const evidence = await driver.collectExecutionGraphEvidence(page, {
      prompt,
      preSendMessageTestIds: ['chat-message-0', 'chat-message-4', 'chat-message-7'],
    });

    expect(evidence.expandedForCapture).toBe(true);
    expect(evidence.restoredCollapsed).toBe(true);
    expect(restored).toBe(true);
    expect(evidence.toolNames).toEqual(['document.read_docx']);
    expect(evidence.steps?.[0].label).toBe('document.read_docx');
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
