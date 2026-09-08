#!/usr/bin/env node
/**
 * Drive a real chat turn through the packaged renderer over CDP and record
 * what happened. This is the lane-F closer: the eval suite proxies tool
 * selection with BM25; this script exercises the live model path a principal
 * actually hits (composer -> gateway -> LLM -> tools -> answer).
 *
 * Runs on the Windows pilot host with the app's bundled node.exe. Requires the
 * app to be running with --remote-debugging-port (see pilot-run-chat-turn.ps1).
 *
 * Safe by default: types into the chat composer and sends one prompt. Does not
 * touch Outlook, Forms, or any external surface. Output JSON carries message
 * text truncated to 800 chars and never logs credentials.
 *
 * Usage:
 *   node pilot-chat-turn-driver.js --prompt "..." [--port 9223]
 *     [--turn-timeout 180] [--composer-timeout 180]
 *     [--terminal-quiet 30] [--expected-channel online|on-device]
 *     [--outdir C:\path\to\evidence] [--new-session]
 *
 * Exit codes: 0 = ANSWERED, 41 = ANSWERED_WITH_RUN_ERROR (answered, but the
 * principal also saw a red banner), 40 = any non-answer verdict, 1/2/3 =
 * infrastructure (fatal / bad args / no playwright-core). Never exit 0 for a
 * turn the principal would call broken.
 *
 * --new-session is REQUIRED for any document/tool leg. Without it the turn
 * lands in whatever session was last open, and a session that already holds a
 * failed attempt makes the model echo its own prior apology ("still
 * encountering the same technical error") WITHOUT calling the tool — a false
 * FAIL that has cost two verify rounds (moe.17 and again moe.19). The flag
 * fails LOUDLY when the session cannot be proven empty, because contaminated
 * evidence is worse than no evidence.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function parseArgs(argv) {
  const args = {
    port: 9223,
    turnTimeout: 180,
    composerTimeout: 180,
    terminalQuiet: 30,
    expectedChannel: '',
    outdir: process.cwd(),
    prompt: '',
    newSession: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--prompt') args.prompt = String(argv[++i] ?? '');
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--turn-timeout') args.turnTimeout = Number(argv[++i]);
    else if (a === '--composer-timeout') args.composerTimeout = Number(argv[++i]);
    else if (a === '--terminal-quiet') args.terminalQuiet = Number(argv[++i]);
    else if (a === '--expected-channel') args.expectedChannel = String(argv[++i] ?? '').trim().toLowerCase();
    else if (a === '--outdir') args.outdir = String(argv[++i] ?? process.cwd());
    else if (a === '--new-session') args.newSession = true;
  }
  if (!args.prompt) {
    console.error('FATAL: --prompt is required');
    process.exit(2);
  }
  if (args.expectedChannel && !['online', 'on-device'].includes(args.expectedChannel)) {
    console.error('FATAL: --expected-channel must be online or on-device');
    process.exit(2);
  }
  if (!Number.isFinite(args.terminalQuiet) || args.terminalQuiet < 0) {
    console.error('FATAL: --terminal-quiet must be a non-negative number');
    process.exit(2);
  }
  return args;
}

// Same resolution ladder as pilot-electron-cdp-probe.js: prefer the
// playwright-core the installed app ships so this needs no npm install.
function resolvePlaywrightCore() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const resourceRoots = [
    path.join(localAppData, 'Programs', 'Ministry of Education', 'resources'),
    'C:\\Program Files\\Ministry of Education\\resources',
  ];
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'playwright-core'),
    path.join(__dirname, 'node_modules', 'playwright-core'),
  ];
  for (const resources of resourceRoots) {
    candidates.push(
      path.join(resources, 'node_modules', 'playwright-core'),
      path.join(resources, 'app.asar.unpacked', 'node_modules', 'playwright-core'),
      path.join(resources, 'openclaw', 'node_modules', 'playwright-core'),
      path.join(resources, 'openclaw', 'dist', 'extensions', 'browser', 'node_modules', 'playwright-core'),
    );
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        return require(candidate);
      }
    } catch {
      // keep walking the ladder
    }
  }
  console.error('FATAL: playwright-core not found in any known location');
  process.exit(3);
}

const SEL = {
  composer: '[data-testid="chat-composer-input"]',
  send: '[data-testid="chat-composer-send"]',
  // The error chip's testid ALSO starts with "chat-message-"
  // (src/pages/Chat/ChatMessage.tsx:436) while real message containers are
  // "chat-message-<idx>" (src/pages/Chat/index.tsx:791). A bare prefix match
  // therefore counted the chip as an extra message and — because a chip is a
  // DESCENDANT of the last container, so it sorts after it in document order —
  // made `.last()` return the chip's own error text. That text is over 40 chars
  // and stops changing, so a failed turn whose only assistant content was an
  // inline error chip settled as ANSWERED with the error string recorded as the
  // answer (found by cross-model adversarial review, 2026-09-06).
  message: '[data-testid^="chat-message-"]:not([data-testid="chat-message-error-chip"])',
  degrade: '[data-testid="chat-degrade-notice"]',
  runError: '[data-testid="chat-run-error"]',
  genericError: '[data-testid="chat-error-bar"]',
  newChat: '[data-testid="sidebar-new-chat"]',
  executionStep: '[data-testid="chat-execution-step"]',
  executionGraph: '[data-testid="chat-execution-graph"]',
  errorChip: '[data-testid="chat-message-error-chip"]',
  channel: '[data-testid="chat-composer-channel"]',
  page: '[data-testid="chat-page"]',
};

async function findChatPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      try {
        if (await page.locator(SEL.composer).count() > 0) return page;
      } catch {
        // page may be a devtools target or mid-navigation; skip
      }
    }
  }
  return null;
}

function normalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(text, max) {
  const value = normalize(text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function trimObservations(observations, max = 40) {
  if (!Array.isArray(observations) || observations.length <= max) return observations;
  return observations.slice(observations.length - max);
}

/**
 * Extract the semantic chat message text from a rendered message container.
 * ChatMessage renders assistant answer markdown inside `.prose`; timestamp/copy
 * UI sits in the sibling hover bar and must not be part of the answer. User
 * bubbles render the prompt in the direct whitespace-pre-wrap paragraph. If the
 * markup changes, fall back only after removing known chrome/error-chip nodes.
 */
function semanticMessageTextFromElement(el) {
  const textOf = (node) => (typeof node?.innerText === 'string' ? node.innerText : (node?.textContent || '')).replace(/\s+/g, ' ').trim();
  const assistantBody = el?.querySelector?.('.prose');
  if (assistantBody) return textOf(assistantBody);
  const userBody = el?.querySelector?.('p.whitespace-pre-wrap');
  if (userBody) return textOf(userBody);
  const clone = el?.cloneNode?.(true);
  if (!clone) return textOf(el);
  clone.querySelectorAll?.('[data-testid="chat-message-error-chip"], .opacity-0, button, [role="button"]').forEach((node) => node.remove());
  return textOf(clone);
}

function semanticAnswerStillLatest(latestText, expectedText) {
  const expected = normalize(expectedText || '');
  if (!expected) return true;
  return normalize(latestText || '') === expected;
}

function textDigest(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function terminalLatestText(surface) {
  return normalize(surface?.lastMessageTextFull || surface?.lastMessageText || '');
}



function stableTextFingerprint(value) {
  const text = normalize(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return { hash: hash.toString(16).padStart(8, '0'), length: text.length };
}

function messageFingerprintFromElement(el, selectors = SEL) {
  const testId = el?.getAttribute?.('data-testid') || '';
  const semanticText = semanticMessageTextFromElement(el);
  const chipTexts = Array.from(el?.querySelectorAll?.(selectors.errorChip) || [])
    .map((chip) => normalize(chip.textContent || ''))
    .filter(Boolean)
    .join('\n');
  const semantic = stableTextFingerprint(semanticText);
  const chips = stableTextFingerprint(chipTexts);
  return {
    testId,
    semanticHash: semantic.hash,
    semanticLength: semantic.length,
    chipHash: chips.hash,
    chipLength: chips.length,
    chipCount: chipTexts ? chipTexts.split('\n').length : 0,
  };
}

function collectMessageScopeFromDocument(doc, options = {}) {
  const selectors = options.selectors || SEL;
  const root = doc.querySelector(selectors.page);
  const sessionKey = options.sessionKey ?? root?.getAttribute?.('data-current-session-key') ?? null;
  const messages = Array.from(doc.querySelectorAll(selectors.message)).map((el, domOrdinal) => ({
    domOrdinal,
    ...messageFingerprintFromElement(el, selectors),
  }));
  return { sessionKey, messageCount: messages.length, messages };
}

function prefixScopeBlockers(currentScope, preSendScope) {
  const blockers = [];
  const beforeMessages = Array.isArray(preSendScope?.messages) ? preSendScope.messages : [];
  const currentMessages = Array.isArray(currentScope?.messages) ? currentScope.messages : [];
  const beforeSessionKey = preSendScope?.sessionKey || null;
  const currentSessionKey = currentScope?.sessionKey || null;

  if (!beforeSessionKey || !currentSessionKey) blockers.push('ERROR_CHIP_SCOPE_SESSION_MISSING');
  else if (beforeSessionKey !== currentSessionKey) blockers.push('ERROR_CHIP_SCOPE_SESSION_CHANGED');
  if (beforeMessages.length === 0) blockers.push('ERROR_CHIP_SCOPE_PREFIX_MISSING');
  if (currentMessages.length < beforeMessages.length) blockers.push('ERROR_CHIP_SCOPE_NON_MONOTONIC_HISTORY');

  for (let i = 0; i < beforeMessages.length && i < currentMessages.length; i += 1) {
    const before = beforeMessages[i];
    const current = currentMessages[i];
    if (
      before?.testId !== current?.testId
      || before?.semanticHash !== current?.semanticHash
      || before?.semanticLength !== current?.semanticLength
      || before?.chipHash !== current?.chipHash
      || before?.chipLength !== current?.chipLength
      || before?.chipCount !== current?.chipCount
    ) {
      blockers.push('ERROR_CHIP_SCOPE_PREFIX_CHANGED');
      break;
    }
  }

  return blockers;
}

function browserTurnDriverHelpersSource() {
  return `(() => {
    const normalize = ${normalize.toString()};
    const semanticMessageTextFromElement = ${semanticMessageTextFromElement.toString()};
    const stableTextFingerprint = ${stableTextFingerprint.toString()};
    const messageFingerprintFromElement = ${messageFingerprintFromElement.toString()};
    const collectMessageScopeFromDocument = ${collectMessageScopeFromDocument.toString()};
    const prefixScopeBlockers = ${prefixScopeBlockers.toString()};
    const collectCurrentTurnErrorChipEvidenceFromDocument = ${collectCurrentTurnErrorChipEvidenceFromDocument.toString()};
    return {
      semanticMessageTextFromElement,
      collectMessageScopeFromDocument,
      collectCurrentTurnErrorChipEvidenceFromDocument,
    };
  })()`;
}

function collectCurrentTurnErrorChipEvidenceFromDocument(doc, options = {}) {
  const selectors = options.selectors || SEL;
  const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const currentScope = collectMessageScopeFromDocument(doc, {
    selectors,
    sessionKey: options.currentSessionKey,
  });
  const preSendScope = options.preSendMessageScope || (
    Array.isArray(options.preSendMessages)
      ? { sessionKey: options.preSendSessionKey ?? null, messages: options.preSendMessages }
      : null
  );
  const preSendMessageTestIds = new Set(Array.isArray(options.preSendMessageTestIds) ? options.preSendMessageTestIds : []);
  const explicitPreSendCount = Number(options.preSendMessageCount);
  const legacyPreSendCount = Number.isFinite(explicitPreSendCount) && explicitPreSendCount >= 0
    ? explicitPreSendCount
    : preSendMessageTestIds.size;
  const hasStablePrefixScope = Array.isArray(preSendScope?.messages);
  const legacyHasPreSendScope = !hasStablePrefixScope && (preSendMessageTestIds.size > 0 || legacyPreSendCount > 0);
  const scopeBlockers = hasStablePrefixScope ? prefixScopeBlockers(currentScope, preSendScope) : [];
  if (!hasStablePrefixScope && !legacyHasPreSendScope) scopeBlockers.push('ERROR_CHIP_SCOPE_PREFIX_MISSING');
  const errorChipScopeValid = hasStablePrefixScope ? scopeBlockers.length === 0 : legacyHasPreSendScope;
  const preSendCount = hasStablePrefixScope ? preSendScope.messages.length : legacyPreSendCount;

  const messages = Array.from(doc.querySelectorAll(selectors.message)).map((el, domOrdinal) => {
    const testId = el.getAttribute('data-testid') || '';
    const presentBeforeSend = errorChipScopeValid
      && (hasStablePrefixScope ? domOrdinal < preSendCount : (preSendMessageTestIds.has(testId) || domOrdinal < preSendCount));
    const chips = Array.from(el.querySelectorAll(selectors.errorChip)).map((chip) => ({
      text: textOf(chip),
      ownerTestId: testId || null,
      ownerDomOrdinal: domOrdinal,
      presentBeforeSend,
    }));
    return { testId, domOrdinal, presentBeforeSend, chips };
  });
  const chips = messages.flatMap((message) => message.chips);
  const currentChips = errorChipScopeValid ? chips.filter((chip) => !chip.presentBeforeSend) : chips;
  const chipText = currentChips.map((chip) => chip.text).filter(Boolean).at(-1) || '';

  return {
    errorChipSeen: currentChips.length > 0,
    errorChipText: chipText,
    errorChipCount: currentChips.length,
    historicalErrorChipCount: errorChipScopeValid ? chips.length - currentChips.length : 0,
    messageTestIds: currentChips.map((chip) => chip.ownerTestId).filter(Boolean),
    hasPreSendScope: errorChipScopeValid,
    errorChipScopeValid,
    errorChipScopeBlockers: scopeBlockers,
    preSendMessageCount: preSendCount,
    currentMessageCount: currentScope.messageCount,
  };
}

function extractExecutionGraphEvidenceFromDocument(doc, options) {
  const selectors = options?.selectors || SEL;
  const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const promptNormalized = normalizeText(options?.promptNormalized || options?.prompt || '');
  const preSendMessageTestIds = new Set(Array.isArray(options?.preSendMessageTestIds) ? options.preSendMessageTestIds : []);
  const fallbackPromptMessageIndex = Number(options?.promptMessageIndex);
  const diagnostics = [];
  const textOf = (node) => (typeof node?.innerText === 'string' ? node.innerText : (node?.textContent || '')).replace(/\s+/g, ' ').trim();
  const semanticText = (el) => {
    const assistantBody = el?.querySelector?.('.prose');
    if (assistantBody) return textOf(assistantBody);
    const userBody = el?.querySelector?.('p.whitespace-pre-wrap');
    if (userBody) return textOf(userBody);
    const clone = el?.cloneNode?.(true);
    if (!clone) return textOf(el);
    clone.querySelectorAll?.('[data-testid="chat-message-error-chip"], .opacity-0, button, [role="button"]').forEach((node) => node.remove());
    return textOf(clone);
  };
  const labelFromStep = (step) => {
    // ExecutionGraphCard gives tool/system labels a font-medium paragraph.
    // Narration is a separate plain paragraph and may itself be a tool name.
    const label = step.querySelector('p.font-medium');
    return label ? textOf(label) : '';
  };
  const stepToRecord = (step, index) => ({
    index,
    label: labelFromStep(step),
    text: textOf(step),
  });
  const labelLooksLikeTool = (label) => {
    const value = normalizeText(label);
    if (!value || /\s/.test(value)) return false;
    if (/^(thinking|completed|running|error|failed|pending)$/i.test(value)) return false;
    return /^[a-z][a-z0-9-]*(?:[._][a-z0-9-]+)*$/i.test(value);
  };
  const numericIndexFromTestId = (testId) => {
    const match = /^chat-message-(\d+)$/.exec(String(testId || ''));
    return match ? Number(match[1]) : null;
  };

  const messages = Array.from(doc.querySelectorAll(selectors.message)).map((el, domOrdinal) => {
    const testId = el.getAttribute('data-testid') || '';
    return {
      el,
      domOrdinal,
      testId,
      numericIndex: numericIndexFromTestId(testId),
      text: semanticText(el),
    };
  });
  const matchingPrompts = messages.filter((entry) => promptNormalized && normalizeText(entry.text) === promptNormalized);
  const newPromptMatches = matchingPrompts.filter((entry) => entry.testId && !preSendMessageTestIds.has(entry.testId));
  let selected = null;
  if (newPromptMatches.length === 1) {
    selected = newPromptMatches[0];
  } else if (newPromptMatches.length > 1) {
    diagnostics.push(`AMBIGUOUS_NEW_PROMPT_MATCHES:${newPromptMatches.map((entry) => entry.testId || entry.domOrdinal).join(',')}`);
  } else if (preSendMessageTestIds.size > 0) {
    diagnostics.push('NEW_PROMPT_MATCH_NOT_FOUND');
  } else if (Number.isInteger(fallbackPromptMessageIndex) && fallbackPromptMessageIndex >= 0 && fallbackPromptMessageIndex < messages.length) {
    selected = messages[fallbackPromptMessageIndex];
    diagnostics.push('PROMPT_SELECTION_FELL_BACK_TO_DOM_ORDINAL');
  }

  if (!selected) {
    return {
      source: 'chat-execution-graph',
      promptMessageIndex: Number.isInteger(fallbackPromptMessageIndex) ? fallbackPromptMessageIndex : null,
      promptMessageTestId: null,
      promptDomOrdinal: null,
      messageCount: messages.length,
      currentPromptMatched: false,
      graphPresent: false,
      graphCollapsed: null,
      steps: [],
      toolNames: [],
      diagnostics,
    };
  }

  const currentPromptMatched = Boolean(promptNormalized) && normalizeText(selected.text) === promptNormalized;
  if (!currentPromptMatched) diagnostics.push('CURRENT_PROMPT_CONTAINER_MISMATCH');

  const graph = selected.el.querySelector(selectors.executionGraph);
  if (!graph) diagnostics.push('CURRENT_PROMPT_GRAPH_MISSING');
  const graphCollapsed = graph ? graph.getAttribute('data-collapsed') === 'true' : null;
  if (!currentPromptMatched) {
    return {
      source: 'chat-execution-graph',
      promptMessageIndex: selected.numericIndex,
      promptMessageTestId: selected.testId || null,
      promptDomOrdinal: selected.domOrdinal,
      messageCount: messages.length,
      currentPromptMatched,
      promptTextLength: selected.text.length,
      graphPresent: Boolean(graph),
      graphCollapsed,
      steps: [],
      toolNames: [],
      diagnostics,
    };
  }
  const stepElements = graph ? Array.from(graph.querySelectorAll(selectors.executionStep)) : [];
  const steps = stepElements.map(stepToRecord);
  const toolNames = [...new Set(steps.map((step) => step.label).filter(labelLooksLikeTool))];
  if (graph && !graphCollapsed && steps.length === 0) diagnostics.push('CURRENT_PROMPT_GRAPH_HAS_NO_STEPS');

  return {
    source: 'chat-execution-graph',
    promptMessageIndex: selected.numericIndex,
    promptMessageTestId: selected.testId || null,
    promptDomOrdinal: selected.domOrdinal,
    messageCount: messages.length,
    currentPromptMatched,
    promptTextLength: selected.text.length,
    graphPresent: Boolean(graph),
    graphCollapsed,
    steps,
    toolNames,
    diagnostics,
  };
}

function redactExecutionGraphEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return evidence;
  return {
    ...evidence,
    steps: Array.isArray(evidence.steps)
      ? evidence.steps.map((step) => ({
        index: step.index,
        label: step.label,
        text: truncate(step.text, 200),
      }))
      : [],
  };
}

function redactTerminalSurface(surface) {
  if (!surface || typeof surface !== 'object') return surface;
  const full = typeof surface.lastMessageTextFull === 'string' ? surface.lastMessageTextFull : '';
  if (!full) return surface;
  const { lastMessageTextFull, ...rest } = surface;
  return {
    ...rest,
    lastMessageTextHash: textDigest(lastMessageTextFull),
    lastMessageTextLength: normalize(lastMessageTextFull).length,
  };
}

async function readSemanticMessageText(locator) {
  return normalize(await locator.evaluate(semanticMessageTextFromElement));
}

/**
 * Classify the last rendered message text. Pure so the three ways a non-answer
 * can masquerade as an answer are unit-testable without a browser:
 *  - streaming placeholder ("Thinking…") is momentarily stable;
 *  - the user's own prompt is what remains visible when the assistant bubble is
 *    empty (silence-on-send);
 *  - an inline error chip's text is long and stable, and the container's
 *    innerText includes it.
 */
function classifyTurnText({ text, promptNormalized, chipText }) {
  const value = normalize(text);
  const isPlaceholder = /Thinking\s*[.…]|^\s*Working\b/i.test(value) || value.length < 40;
  const isPromptEcho = value.replace(/\s*just now\s*$/i, '').trim() === normalize(promptNormalized)
    && normalize(promptNormalized).length > 0;
  const chip = normalize(chipText);
  const isErrorChipOnly = Boolean(chip)
    && value.includes(chip)
    && normalize(value.split(chip).join(' ')).length < 40;
  return {
    isPlaceholder,
    isPromptEcho,
    isErrorChipOnly,
    // Only this combination may be recorded as the principal's answer.
    acceptable: Boolean(value) && !isPlaceholder && !isPromptEcho && !isErrorChipOnly,
  };
}

function terminalBlockersFor(surface, expectedChannel = '') {
  const blockers = [];
  const channel = normalize(surface?.channel).toLowerCase();
  const want = normalize(expectedChannel).toLowerCase();
  const requiredSignals = [
    ['sending', 'MISSING_TERMINAL_SIGNAL_SENDING'],
    ['pendingFinal', 'MISSING_TERMINAL_SIGNAL_PENDING_FINAL'],
    ['activeRunIdPresent', 'MISSING_TERMINAL_SIGNAL_ACTIVE_RUN'],
    ['degradeInProgress', 'MISSING_TERMINAL_SIGNAL_DEGRADE_IN_PROGRESS'],
    ['activeExecutionGraph', 'MISSING_TERMINAL_SIGNAL_ACTIVE_GRAPH'],
    ['runErrorSeen', 'MISSING_TERMINAL_SIGNAL_RUN_ERROR'],
    ['genericErrorSeen', 'MISSING_TERMINAL_SIGNAL_GENERIC_ERROR'],
    ['errorChipSeen', 'MISSING_TERMINAL_SIGNAL_ERROR_CHIP'],
    ['errorChipScopeValid', 'MISSING_TERMINAL_SIGNAL_ERROR_CHIP_SCOPE'],
  ];

  if (!surface?.rootPresent) blockers.push('MISSING_TERMINAL_STATE_ROOT');
  for (const [field, blocker] of requiredSignals) {
    if (surface?.[field] !== true && surface?.[field] !== false) blockers.push(blocker);
  }

  if (want && !channel) {
    blockers.push('MISSING_CHANNEL_STATE');
  } else if (want && channel !== want) {
    blockers.push(`UNEXPECTED_CHANNEL_${channel.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`);
  }
  if (want === 'online' && surface?.degradeNoticeSeen) {
    blockers.push('UNEXPECTED_DEGRADE_TO_ON_DEVICE');
  }
  if (surface?.degradeInProgress) blockers.push('DEGRADE_IN_PROGRESS');
  if (surface?.sending) blockers.push('SEND_STILL_IN_PROGRESS');
  if (surface?.pendingFinal) blockers.push('PENDING_TOOL_FINAL');
  if (surface?.activeRunIdPresent) blockers.push('ACTIVE_RUN_STILL_PRESENT');
  if (surface?.activeExecutionGraph) blockers.push('EXECUTION_GRAPH_STILL_ACTIVE');
  if (surface?.runErrorSeen) blockers.push('RUN_ERROR_VISIBLE');
  if (surface?.genericErrorSeen) blockers.push('GENERIC_ERROR_VISIBLE');
  if (surface?.errorChipScopeValid === false) blockers.push('ERROR_CHIP_SCOPE_UNPROVEN');
  if (surface?.errorChipSeen) blockers.push('ERROR_CHIP_VISIBLE');
  return blockers;
}

/** The verdict for a completed observation. Pure; mirrors main()'s ladder. */
function verdictFor(result) {
  if (Array.isArray(result.terminalBlockers) && result.terminalBlockers.length > 0) {
    if (result.terminalBlockers.includes('UNEXPECTED_DEGRADE_TO_ON_DEVICE')) return 'FAILED_UNEXPECTED_DEGRADE';
    if (result.terminalBlockers.some((item) => String(item).startsWith('UNEXPECTED_CHANNEL_'))) {
      return 'FAILED_UNEXPECTED_CHANNEL';
    }
    return 'TIMED_OUT_MID_TURN';
  }
  if (result.genericErrorSeen) return 'FAILED_GENERIC_ERROR';
  if (result.settled && result.terminalStable === false) return 'TIMED_OUT_MID_TURN';
  if (result.settled) return result.runErrorSeen ? 'ANSWERED_WITH_RUN_ERROR' : 'ANSWERED';
  if (result.errorChipOnly) return 'FAILED_ERROR_CHIP_ONLY';
  if (result.assistantPromptEcho) return 'ASSISTANT_EMPTY_SILENCE_ON_SEND';
  return result.messagesAfter > result.messagesBefore ? 'TIMED_OUT_MID_TURN' : 'NO_RESPONSE';
}

/**
 * Verdict -> process exit code. A caller that only checks $LASTEXITCODE
 * (pilot-run-chat-turn.ps1 propagates it) must never read a failed or blocked
 * turn as success.
 */
function exitCodeFor(verdict) {
  if (verdict === 'ANSWERED') return 0;
  if (verdict === 'ANSWERED_WITH_RUN_ERROR') return 41;
  return 40;
}

function isFreshSessionKey(value) {
  return /^agent:[^:]+:session-\d+$/.test(String(value || ''));
}

function chatReadyBlockersFor(state) {
  const blockers = [];
  if (!state?.rootPresent) blockers.push('MISSING_CHAT_ROOT');
  if (!state?.sessionKey) blockers.push('MISSING_SESSION_KEY');
  if (state?.loadingHistory !== false) blockers.push('SESSION_HISTORY_STILL_LOADING');
  if (state?.composerEnabled !== true) blockers.push('COMPOSER_NOT_READY');
  return blockers;
}

function freshSessionBlockersFor(before, after) {
  const blockers = [];
  if (!after?.rootPresent) blockers.push('MISSING_CHAT_ROOT');
  if (!before?.sessionKey) blockers.push('MISSING_PREVIOUS_SESSION_KEY');
  if (!after?.sessionKey) blockers.push('MISSING_SESSION_KEY');
  if (after?.loadingHistory !== false) blockers.push('SESSION_HISTORY_STILL_LOADING');
  if (Number(after?.messageCount) !== 0) blockers.push('NEW_SESSION_NOT_EMPTY');
  if (before?.sessionKey && after?.sessionKey && before.sessionKey === after.sessionKey) {
    blockers.push('SESSION_KEY_DID_NOT_CHANGE');
  }
  if (after?.sessionKey && !isFreshSessionKey(after.sessionKey)) blockers.push('NEW_SESSION_KEY_NOT_FRESH');
  return blockers;
}

async function captureChatState(page) {
  return page.evaluate(({ selectors }) => {
    const readBool = (value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return null;
    };
    const root = document.querySelector(selectors.page);
    const composer = document.querySelector(selectors.composer);
    const messages = Array.from(document.querySelectorAll(selectors.message));
    return {
      at: new Date().toISOString(),
      rootPresent: Boolean(root),
      sessionKey: root?.getAttribute('data-current-session-key') || null,
      loadingHistory: root ? readBool(root.getAttribute('data-loading-history')) : null,
      composerEnabled: composer ? !composer.disabled : null,
      composerPlaceholder: composer?.getAttribute('placeholder') || null,
      messageCount: messages.length,
    };
  }, { selectors: SEL });
}

async function waitForStableChatReady(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  let latestBlockers = [];
  let stableSince = 0;
  let lastSignature = '';

  while (Date.now() <= deadline) {
    latest = await captureChatState(page).catch((error) => ({
      at: new Date().toISOString(),
      captureError: error instanceof Error ? error.message : String(error),
    }));
    latestBlockers = chatReadyBlockersFor(latest);
    const signature = JSON.stringify({
      sessionKey: latest.sessionKey,
      loadingHistory: latest.loadingHistory,
      composerEnabled: latest.composerEnabled,
      messageCount: latest.messageCount,
    });

    if (latestBlockers.length === 0) {
      if (signature === lastSignature) {
        if (stableSince === 0) stableSince = Date.now();
      } else {
        stableSince = Date.now();
        lastSignature = signature;
      }
      if (Date.now() - stableSince >= 1_000) {
        return { ok: true, state: latest, blockers: [] };
      }
    } else {
      stableSince = 0;
      lastSignature = signature;
    }

    await page.waitForTimeout(500);
  }

  return { ok: false, state: latest, blockers: latestBlockers };
}

async function waitForFreshSessionProof(page, before, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  let latestBlockers = [];
  let stableSince = 0;
  let lastSignature = '';

  while (Date.now() <= deadline) {
    latest = await captureChatState(page).catch((error) => ({
      at: new Date().toISOString(),
      captureError: error instanceof Error ? error.message : String(error),
    }));
    latestBlockers = freshSessionBlockersFor(before, latest);
    const signature = JSON.stringify({
      sessionKey: latest.sessionKey,
      loadingHistory: latest.loadingHistory,
      messageCount: latest.messageCount,
    });

    if (latestBlockers.length === 0) {
      if (signature === lastSignature) {
        if (stableSince === 0) stableSince = Date.now();
      } else {
        stableSince = Date.now();
        lastSignature = signature;
      }
      if (Date.now() - stableSince >= 1_000) {
        return { ok: true, state: latest, blockers: [] };
      }
    } else {
      stableSince = 0;
      lastSignature = signature;
    }

    await page.waitForTimeout(500);
  }

  return { ok: false, state: latest, blockers: latestBlockers };
}

async function captureCurrentTurnErrorChipEvidence(page, preSendMessageScope = null) {
  return page.evaluate(({ selectors, helpersSource, preSendScope }) => {
    const helpers = (0, eval)(helpersSource);
    return helpers.collectCurrentTurnErrorChipEvidenceFromDocument(document, {
      selectors,
      preSendMessageScope: preSendScope,
    });
  }, {
    selectors: SEL,
    helpersSource: browserTurnDriverHelpersSource(),
    preSendScope: preSendMessageScope,
  });
}

async function captureTerminalSurface(page, preSendMessageScope = null) {
  return page.evaluate(({ selectors, helpersSource, preSendScope }) => {
    const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const helpers = (0, eval)(helpersSource);
    const semanticMessageText = helpers.semanticMessageTextFromElement;
    const collectErrorChips = helpers.collectCurrentTurnErrorChipEvidenceFromDocument;
    const readBool = (value) => {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return null;
    };
    const root = document.querySelector(selectors.page);
    const channel = document.querySelector(selectors.channel);
    const degrade = document.querySelector(selectors.degrade);
    const composer = document.querySelector(selectors.composer);
    const runError = document.querySelector(selectors.runError);
    const genericError = document.querySelector(selectors.genericError);
    const currentErrorChips = collectErrorChips(document, {
      selectors,
      preSendMessageScope: preSendScope,
    });
    const messages = Array.from(document.querySelectorAll(selectors.message)).map((el) => semanticMessageText(el));
    const runErrorState = root ? readBool(root.getAttribute('data-run-error-present')) : null;

    return {
      at: new Date().toISOString(),
      rootPresent: Boolean(root),
      channel: channel?.getAttribute('data-channel') || textOf(channel) || null,
      composerEnabled: composer ? !composer.disabled : null,
      sending: root ? readBool(root.getAttribute('data-sending')) : null,
      pendingFinal: root ? readBool(root.getAttribute('data-pending-final')) : null,
      activeRunIdPresent: root ? readBool(root.getAttribute('data-active-run-id-present')) : null,
      activeExecutionGraph: root ? readBool(root.getAttribute('data-active-execution-graph')) : null,
      degradeInProgress: root ? readBool(root.getAttribute('data-degrade-in-progress')) : null,
      runErrorSeen: runErrorState === true || (runErrorState === false ? false : Boolean(runError)),
      errorChipSeen: currentErrorChips.errorChipSeen,
      errorPresent: root ? readBool(root.getAttribute('data-error-present')) : null,
      degradeNoticeSeen: Boolean(degrade),
      degradeNoticeInProgressAttr: degrade ? degrade.getAttribute('data-in-progress') === 'true' : false,
      degradeNoticeText: degrade ? textOf(degrade).slice(0, 300) : null,
      runErrorText: runError ? textOf(runError).slice(0, 300) : null,
      genericErrorSeen: Boolean(genericError),
      genericErrorText: genericError ? textOf(genericError).slice(0, 300) : null,
      errorChipText: currentErrorChips.errorChipText ? currentErrorChips.errorChipText.slice(0, 300) : null,
      historicalErrorChipCount: currentErrorChips.historicalErrorChipCount,
      errorChipScopeValid: currentErrorChips.errorChipScopeValid,
      errorChipScopeBlockers: currentErrorChips.errorChipScopeBlockers,
      messageCount: messages.length,
      lastMessageText: messages.length ? messages[messages.length - 1].slice(0, 800) : '',
      lastMessageTextFull: messages.length ? messages[messages.length - 1] : '',
    };
  }, {
    selectors: SEL,
    helpersSource: browserTurnDriverHelpersSource(),
    preSendScope: preSendMessageScope,
  });
}

async function waitForTerminalAcceptance(page, args, answerText, preSendMessageScope = null) {
  const quietMs = args.terminalQuiet * 1000;
  const deadline = Date.now() + Math.max(quietMs + 10_000, 10_000);
  const startedAt = new Date().toISOString();
  const observations = [];
  let stableSince = 0;
  let lastSignature = '';
  let finalBlockers = [];

  while (Date.now() <= deadline) {
    const surface = await captureTerminalSurface(page, preSendMessageScope).catch((error) => ({
      at: new Date().toISOString(),
      captureError: error instanceof Error ? error.message : String(error),
    }));
    const blockers = terminalBlockersFor(surface, args.expectedChannel);
    finalBlockers = blockers;
    const latestText = terminalLatestText(surface);
    observations.push({ ...redactTerminalSurface(surface), blockers });

    const expectedText = normalize(answerText || '');
    const answerStillLatest = semanticAnswerStillLatest(latestText, expectedText);
    const signature = JSON.stringify({
      messageCount: surface.messageCount,
      lastMessageText: normalize(surface.lastMessageText || ''),
      lastMessageTextHash: surface.lastMessageTextFull ? textDigest(surface.lastMessageTextFull) : undefined,
      lastMessageTextLength: latestText.length,
      channel: surface.channel,
      blockers,
    });

    if (blockers.length === 0 && answerStillLatest) {
      if (signature === lastSignature) {
        if (stableSince === 0) stableSince = Date.now();
      } else {
        stableSince = Date.now();
        lastSignature = signature;
      }
      if (Date.now() - stableSince >= quietMs) {
        return {
          stable: true,
          blockers: [],
          finalSurface: redactTerminalSurface(surface),
          observations: trimObservations(observations),
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }
    } else {
      stableSince = 0;
      lastSignature = signature;
    }

    await page.waitForTimeout(2_000);
  }

  return {
    stable: false,
    blockers: finalBlockers,
    finalSurface: observations[observations.length - 1] || null,
    observations: trimObservations(observations),
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

async function captureMessageTestIds(page) {
  return page.evaluate((selector) => Array.from(document.querySelectorAll(selector))
    .map((el) => el.getAttribute('data-testid') || '')
    .filter(Boolean), SEL.message);
}

async function captureMessageScope(page) {
  return page.evaluate(({ selectors, helpersSource }) => {
    const helpers = (0, eval)(helpersSource);
    return helpers.collectMessageScopeFromDocument(document, { selectors });
  }, {
    selectors: SEL,
    helpersSource: browserTurnDriverHelpersSource(),
  });
}

async function collectExecutionGraphEvidence(page, { prompt, preSendMessageTestIds }) {
  const promptNormalized = normalize(prompt);
  const evaluate = () => page.evaluate(({ selectors, extractorSource, promptNormalized: expectedPrompt, preSendMessageTestIds: beforeIds }) => {
    const extract = (0, eval)(`(${extractorSource})`);
    return extract(document, {
      selectors,
      promptNormalized: expectedPrompt,
      preSendMessageTestIds: beforeIds,
    });
  }, {
    selectors: SEL,
    extractorSource: extractExecutionGraphEvidenceFromDocument.toString(),
    promptNormalized,
    preSendMessageTestIds,
  });

  const first = await evaluate();
  const evidence = { ...first, expandedForCapture: false, restoredCollapsed: false };
  if (!first.currentPromptMatched || !first.graphPresent || !first.promptMessageTestId) return redactExecutionGraphEvidence(evidence);

  const promptContainer = page.locator(`[data-testid="${first.promptMessageTestId}"]`).first();
  if (first.graphCollapsed) {
    const graph = promptContainer.locator(SEL.executionGraph).first();
    await graph.click();
    await page.waitForFunction(({ selectors, testId }) => {
      const container = document.querySelector(`[data-testid="${testId}"]`);
      const currentGraph = container?.querySelector?.(selectors.executionGraph);
      return currentGraph?.getAttribute('data-collapsed') === 'false';
    }, { selectors: SEL, testId: first.promptMessageTestId }, { timeout: 10_000 }).catch(() => undefined);
  }

  const afterExpand = await evaluate();
  const next = { ...afterExpand, expandedForCapture: first.graphCollapsed === true, restoredCollapsed: false };
  if (first.graphCollapsed === true && afterExpand.graphCollapsed === false) {
    await promptContainer.locator('[data-testid="chat-execution-graph-collapse"]').first().click().catch(() => undefined);
    const restored = await evaluate().catch(() => null);
    next.restoredCollapsed = restored?.graphCollapsed === true;
  }
  return redactExecutionGraphEvidence(next);
}

async function main() {
  const args = parseArgs(process.argv);
  const { chromium } = resolvePlaywrightCore();
  fs.mkdirSync(args.outdir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = {
    prompt: args.prompt,
    startedAt: new Date().toISOString(),
    sentAt: null,
    candidateAnswerAt: null,
    answerLatencyMs: null,
    cdpPort: args.port,
    appVersion: null,
    requestedNewSession: args.newSession,
    expectedChannel: args.expectedChannel || null,
    freshSession: null,
    newSessionBefore: null,
    newSessionAfter: null,
    newSessionBlockers: [],
    composerPlaceholder: null,
    messagesBefore: 0,
    messageTestIdsBefore: [],
    messageSnapshotBefore: null,
    messagesAfter: 0,
    executionSteps: [],
    toolNames: [],
    executionEvidence: null,
    errorChipSeen: false,
    errorChipText: null,
    errorChipScopeValid: null,
    errorChipScopeBlockers: [],
    errorChipOnly: false,
    assistantPromptEcho: false,
    degradeNoticeSeen: false,
    degradeNoticeText: null,
    runErrorSeen: false,
    runErrorText: null,
    genericErrorSeen: false,
    genericErrorText: null,
    answerText: null,
    settled: false,
    terminalStable: null,
    terminalBlockers: [],
    terminalState: null,
    terminalObservations: [],
    terminalCheckStartedAt: null,
    terminalCheckFinishedAt: null,
    terminalCheckDurationMs: null,
    verdict: 'INCOMPLETE',
  };

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port}`, { timeout: 15_000 });
  try {
    const page = await findChatPage(browser);
    if (!page) {
      result.verdict = 'FAILED_NO_CHAT_PAGE';
      return result;
    }
    result.appVersion = await page.evaluate(() => navigator.userAgent).catch(() => null);

    if (args.newSession) {
      const ready = await waitForStableChatReady(page, args.composerTimeout * 1000);
      result.newSessionBefore = ready.state;
      result.newSessionBlockers = ready.blockers;
      if (!ready.ok) {
        result.freshSession = false;
        result.composerPlaceholder = ready.state?.composerPlaceholder ?? null;
        result.verdict = 'BLOCKED_CHAT_NOT_READY';
        return result;
      }

      const newChat = page.locator(SEL.newChat);
      if (await newChat.count() === 0) {
        result.verdict = 'FAILED_NO_NEW_CHAT_CONTROL';
        result.freshSession = false;
        return result;
      }
      await newChat.first().click();

      const proof = await waitForFreshSessionProof(
        page,
        ready.state,
        Math.min(args.composerTimeout * 1000, 30_000),
      );
      result.newSessionAfter = proof.state;
      result.newSessionBlockers = proof.blockers;
      result.freshSession = proof.ok;
      if (!proof.ok) {
        result.messagesBefore = Number(proof.state?.messageCount ?? 0);
        result.verdict = proof.blockers.includes('NEW_SESSION_NOT_EMPTY')
          ? 'FAILED_SESSION_NOT_FRESH'
          : 'FAILED_NEW_SESSION_NOT_PROVEN';
        return result;
      }
    }
    result.messageSnapshotBefore = await captureMessageScope(page);
    result.messageTestIdsBefore = result.messageSnapshotBefore.messages.map((message) => message.testId).filter(Boolean);
    result.messagesBefore = result.messageSnapshotBefore.messageCount;

    // Wait for the composer to be ENABLED, not just present. A listening port
    // 18789 is NOT readiness: the renderer disables the composer (placeholder
    // "Gateway not connected...") until its WS handshake completes, which on
    // the CPU-bound VM lags the port by minutes after a gateway restart.
    // Without this the click times out with a raw playwright FATAL and the run
    // records verdict INCOMPLETE, which reads like a product failure when it
    // is really "we sent too early" (moe.19 VM, 2026-09-06).
    const composer = page.locator(SEL.composer).first();
    const readyDeadline = Date.now() + args.composerTimeout * 1000;
    while (Date.now() < readyDeadline) {
      if (await composer.isEnabled().catch(() => false)) break;
      await page.waitForTimeout(2_000);
    }
    if (!(await composer.isEnabled().catch(() => false))) {
      result.composerPlaceholder = await composer.getAttribute('placeholder').catch(() => null);
      result.verdict = 'BLOCKED_COMPOSER_DISABLED';
      return result;
    }

    await page.locator(SEL.composer).click();
    await page.locator(SEL.composer).fill(args.prompt);
    await page.locator(SEL.send).click();
    result.sentAt = new Date().toISOString();

    // The turn is settled when the message count has grown by >= 2 (user +
    // assistant) and the last message's text stops changing between polls.
    const deadline = Date.now() + args.turnTimeout * 1000;
    const promptNormalized = normalize(args.prompt);
    let lastText = '';
    let stableSince = 0;
    let chipTextRaw = '';
    while (Date.now() < deadline) {
      await page.waitForTimeout(2_000);
      result.messagesAfter = await page.locator(SEL.message).count();
      // Read only post-send inline chips. Historical Main errors remain visible
      // in reused sessions and must not invalidate the current turn, but a new
      // chip in the current turn still blocks acceptance. The container's
      // innerText includes its chip text, so the current chip string is needed
      // to distinguish an answer from a bare inline failure.
      const chipEvidence = await captureCurrentTurnErrorChipEvidence(page, result.messageSnapshotBefore).catch(() => null);
      if (chipEvidence?.errorChipSeen) {
        result.errorChipSeen = true;
        chipTextRaw = normalize(chipEvidence.errorChipText || '');
        result.errorChipText = truncate(chipTextRaw, 300);
      }
      if (chipEvidence) {
        result.errorChipScopeValid = chipEvidence.errorChipScopeValid;
        result.errorChipScopeBlockers = chipEvidence.errorChipScopeBlockers || [];
      }
      if (await page.locator(SEL.degrade).count() > 0) {
        result.degradeNoticeSeen = true;
        result.degradeNoticeText = truncate(await page.locator(SEL.degrade).innerText().catch(() => ''), 300);
      }
      if (await page.locator(SEL.runError).count() > 0) {
        result.runErrorSeen = true;
        result.runErrorText = truncate(await page.locator(SEL.runError).innerText().catch(() => ''), 300);
      }
      if (await page.locator(SEL.genericError).count() > 0) {
        result.genericErrorSeen = true;
        result.genericErrorText = truncate(await page.locator(SEL.genericError).innerText().catch(() => ''), 300);
      }
      if (result.messagesAfter >= result.messagesBefore + 2) {
        const text = await readSemanticMessageText(page.locator(SEL.message).last()).catch(() => '');
        // Placeholders ("Thinking…"), the user's own echoed prompt (empty
        // assistant bubble = silence-on-send), and an assistant bubble holding
        // nothing but its inline error chip are all NON-answers that would
        // otherwise satisfy the stability heuristic. See classifyTurnText.
        const shape = classifyTurnText({ text, promptNormalized, chipText: chipTextRaw });
        if (shape.isPromptEcho) result.assistantPromptEcho = true;
        result.errorChipOnly = shape.isErrorChipOnly;
        if (text === lastText && shape.acceptable) {
          if (stableSince === 0) stableSince = Date.now();
          // 3 consecutive stable polls (~9s) of real content = streaming finished.
          if (Date.now() - stableSince >= 9_000) {
            result.settled = true;
            result.candidateAnswerAt = new Date().toISOString();
            result.answerLatencyMs = Date.parse(result.candidateAnswerAt) - Date.parse(result.sentAt);
            result.answerText = truncate(text, 800);
            break;
          }
        } else {
          lastText = text;
          stableSince = 0;
        }
      }
    }
    // Never record the prompt echo (silence-on-send) or a bare error chip
    // (failed turn) as an answer.
    if (!result.settled && lastText && !result.assistantPromptEcho && !result.errorChipOnly) {
      result.answerText = truncate(lastText, 800);
    }

    if (result.settled) {
      const terminal = await waitForTerminalAcceptance(page, args, lastText, result.messageSnapshotBefore);
      result.terminalStable = terminal.stable;
      result.terminalBlockers = terminal.blockers;
      result.terminalState = terminal.finalSurface;
      result.terminalObservations = terminal.observations;
      result.terminalCheckStartedAt = terminal.startedAt;
      result.terminalCheckFinishedAt = terminal.finishedAt;
      result.terminalCheckDurationMs = Date.parse(terminal.finishedAt) - Date.parse(terminal.startedAt);
    }

    // Tool-call evidence: the execution graph is the only renderer-visible
    // proof that the model actually CALLED a tool rather than answering (or
    // refusing) from its own context. The graph belongs under the user prompt
    // container that triggered this turn; never read a prior turn's graph.
    try {
      const evidence = await collectExecutionGraphEvidence(page, {
        prompt: args.prompt,
        preSendMessageTestIds: result.messageTestIdsBefore,
      });
      result.executionEvidence = evidence;
      result.executionSteps = Array.isArray(evidence.steps)
        ? evidence.steps.map((step) => truncate(step.text, 200))
        : [];
      result.toolNames = Array.isArray(evidence.toolNames) ? evidence.toolNames : [];
    } catch (error) {
      result.executionEvidence = {
        source: 'chat-execution-graph',
        preSendMessageTestIds: result.messageTestIdsBefore,
        diagnostics: [`CAPTURE_FAILED:${error && error.message ? error.message : error}`],
      };
    }
    const finalChipEvidence = await captureCurrentTurnErrorChipEvidence(page, result.messageSnapshotBefore).catch(() => null);
    if (finalChipEvidence?.errorChipSeen) {
      result.errorChipSeen = true;
      result.errorChipText = truncate(finalChipEvidence.errorChipText || result.errorChipText || '', 300);
    }
    if (finalChipEvidence) {
      result.errorChipScopeValid = finalChipEvidence.errorChipScopeValid;
      result.errorChipScopeBlockers = finalChipEvidence.errorChipScopeBlockers || [];
    }
    if (await page.locator(SEL.genericError).count() > 0) result.genericErrorSeen = true;

    result.verdict = verdictFor(result);

    await page.screenshot({ path: path.join(args.outdir, `chat-turn-${stamp}.png`), fullPage: true }).catch(() => {});
    return result;
  } finally {
    result.finishedAt = new Date().toISOString();
    const outPath = path.join(args.outdir, `chat-turn-${stamp}.json`);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`RESULT ${result.verdict}`);
    console.log(JSON.stringify(result, null, 2));
    console.log(`WROTE ${outPath}`);
    process.exitCode = exitCodeFor(result.verdict);
    await browser.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FATAL: ${error && error.message ? error.message : error}`);
    process.exit(1);
  });
}

module.exports = {
  classifyTurnText,
  terminalBlockersFor,
  verdictFor,
  exitCodeFor,
  normalize,
  SEL,
  parseArgs,
  semanticMessageTextFromElement,
  semanticAnswerStillLatest,
  terminalLatestText,
  stableTextFingerprint,
  messageFingerprintFromElement,
  collectMessageScopeFromDocument,
  extractExecutionGraphEvidenceFromDocument,
  collectExecutionGraphEvidence,
  captureMessageTestIds,
  captureChatState,
  chatReadyBlockersFor,
  freshSessionBlockersFor,
  isFreshSessionKey,
  waitForStableChatReady,
  waitForFreshSessionProof,
  redactTerminalSurface,
  collectCurrentTurnErrorChipEvidenceFromDocument,
  captureCurrentTurnErrorChipEvidence,
  captureMessageScope,
  captureTerminalSurface,
};
