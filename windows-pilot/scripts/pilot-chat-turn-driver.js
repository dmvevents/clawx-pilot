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
 *     [--outdir C:\path\to\evidence] [--new-session]
 *
 * --new-session is REQUIRED for any document/tool leg. Without it the turn
 * lands in whatever session was last open, and a session that already holds a
 * failed attempt makes the model echo its own prior apology ("still
 * encountering the same technical error") WITHOUT calling the tool — a false
 * FAIL that has cost two verify rounds (moe.17 and again moe.19). The flag
 * fails LOUDLY when the session cannot be proven empty, because contaminated
 * evidence is worse than no evidence.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function parseArgs(argv) {
  const args = { port: 9223, turnTimeout: 180, composerTimeout: 180, outdir: process.cwd(), prompt: '', newSession: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--prompt') args.prompt = String(argv[++i] ?? '');
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--turn-timeout') args.turnTimeout = Number(argv[++i]);
    else if (a === '--composer-timeout') args.composerTimeout = Number(argv[++i]);
    else if (a === '--outdir') args.outdir = String(argv[++i] ?? process.cwd());
    else if (a === '--new-session') args.newSession = true;
  }
  if (!args.prompt) {
    console.error('FATAL: --prompt is required');
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
  message: '[data-testid^="chat-message-"]',
  degrade: '[data-testid="chat-degrade-notice"]',
  runError: '[data-testid="chat-run-error"]',
  newChat: '[data-testid="sidebar-new-chat"]',
  executionStep: '[data-testid="chat-execution-step"]',
  errorChip: '[data-testid="chat-message-error-chip"]',
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

function truncate(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

async function main() {
  const args = parseArgs(process.argv);
  const { chromium } = resolvePlaywrightCore();
  fs.mkdirSync(args.outdir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = {
    prompt: args.prompt,
    startedAt: new Date().toISOString(),
    cdpPort: args.port,
    appVersion: null,
    requestedNewSession: args.newSession,
    freshSession: null,
    composerPlaceholder: null,
    messagesBefore: 0,
    messagesAfter: 0,
    executionSteps: [],
    toolNames: [],
    errorChipSeen: false,
    assistantPromptEcho: false,
    degradeNoticeSeen: false,
    degradeNoticeText: null,
    runErrorSeen: false,
    runErrorText: null,
    answerText: null,
    settled: false,
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
      const newChat = page.locator(SEL.newChat);
      if (await newChat.count() === 0) {
        result.verdict = 'FAILED_NO_NEW_CHAT_CONTROL';
        result.freshSession = false;
        return result;
      }
      await newChat.first().click();
      await page.waitForTimeout(2_500);
      const remaining = await page.locator(SEL.message).count();
      result.freshSession = remaining === 0;
      if (!result.freshSession) {
        // Refuse to run: a non-empty session can produce a refusal that echoes
        // its own history instead of exercising the tool.
        result.messagesBefore = remaining;
        result.verdict = 'FAILED_SESSION_NOT_FRESH';
        return result;
      }
    }
    result.messagesBefore = await page.locator(SEL.message).count();

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

    // The turn is settled when the message count has grown by >= 2 (user +
    // assistant) and the last message's text stops changing between polls.
    const deadline = Date.now() + args.turnTimeout * 1000;
    const promptNormalized = args.prompt.replace(/\s+/g, ' ').trim();
    let lastText = '';
    let stableSince = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2_000);
      result.messagesAfter = await page.locator(SEL.message).count();
      if (await page.locator(SEL.degrade).count() > 0) {
        result.degradeNoticeSeen = true;
        result.degradeNoticeText = truncate(await page.locator(SEL.degrade).innerText().catch(() => ''), 300);
      }
      if (await page.locator(SEL.runError).count() > 0) {
        result.runErrorSeen = true;
        result.runErrorText = truncate(await page.locator(SEL.runError).innerText().catch(() => ''), 300);
      }
      if (result.messagesAfter >= result.messagesBefore + 2) {
        const raw = await page.locator(SEL.message).last().innerText().catch(() => '');
        const text = raw.replace(/\s+/g, ' ').trim();
        // Reject "Thinking…"/"Working" placeholders and sub-40-char fragments:
        // the streaming placeholder is momentarily stable and would otherwise
        // false-settle the turn (IF-8). Real answers are longer and non-placeholder.
        const isPlaceholder = /Thinking\s*[.…]|^\s*Working\b/i.test(text) || text.length < 40;
        // An empty assistant bubble leaves the USER's own message as the last
        // rendered text (plus its "just now" stamp). That is silence-on-send,
        // not an answer — settling on it reports ANSWERED for a failed turn
        // (observed on the moe.19 VM run, 2026-09-06).
        const isPromptEcho = text.replace(/\s*just now\s*$/i, '').trim() === promptNormalized;
        if (isPromptEcho) result.assistantPromptEcho = true;
        if (text && text === lastText && !isPlaceholder && !isPromptEcho) {
          if (stableSince === 0) stableSince = Date.now();
          // 3 consecutive stable polls (~9s) of real content = streaming finished.
          if (Date.now() - stableSince >= 9_000) {
            result.settled = true;
            result.answerText = truncate(text, 800);
            break;
          }
        } else {
          lastText = text;
          stableSince = 0;
        }
      }
    }
    // Never record the prompt echo as an answer — that is the silence case.
    if (!result.settled && lastText && !result.assistantPromptEcho) result.answerText = truncate(lastText, 800);

    // Tool-call evidence: the execution graph is the only renderer-visible
    // proof that the model actually CALLED a tool rather than answering (or
    // refusing) from its own context.
    try {
      const steps = await page.locator(SEL.executionStep).allInnerTexts();
      result.executionSteps = steps.map((s) => truncate(s, 200));
      const names = new Set();
      for (const step of result.executionSteps) {
        for (const m of step.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g)) names.add(m[1]);
      }
      result.toolNames = [...names];
    } catch {
      // execution graph may be collapsed or absent; leave the arrays empty
    }
    result.errorChipSeen = await page.locator(SEL.errorChip).count() > 0;

    if (result.settled) {
      result.verdict = result.runErrorSeen ? 'ANSWERED_WITH_RUN_ERROR' : 'ANSWERED';
    } else if (result.assistantPromptEcho) {
      // Messages grew but no assistant content ever rendered: the principal
      // sees their own prompt and nothing else.
      result.verdict = 'ASSISTANT_EMPTY_SILENCE_ON_SEND';
    } else {
      result.verdict = result.messagesAfter > result.messagesBefore ? 'TIMED_OUT_MID_TURN' : 'NO_RESPONSE';
    }

    await page.screenshot({ path: path.join(args.outdir, `chat-turn-${stamp}.png`), fullPage: true }).catch(() => {});
    return result;
  } finally {
    result.finishedAt = new Date().toISOString();
    const outPath = path.join(args.outdir, `chat-turn-${stamp}.json`);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`RESULT ${result.verdict}`);
    console.log(JSON.stringify(result, null, 2));
    console.log(`WROTE ${outPath}`);
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`FATAL: ${error && error.message ? error.message : error}`);
  process.exit(1);
});
