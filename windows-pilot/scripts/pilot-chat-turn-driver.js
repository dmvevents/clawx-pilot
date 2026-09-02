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
 *     [--turn-timeout 180] [--outdir C:\path\to\evidence]
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function parseArgs(argv) {
  const args = { port: 9223, turnTimeout: 180, outdir: process.cwd(), prompt: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--prompt') args.prompt = String(argv[++i] ?? '');
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--turn-timeout') args.turnTimeout = Number(argv[++i]);
    else if (a === '--outdir') args.outdir = String(argv[++i] ?? process.cwd());
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
        // eslint-disable-next-line global-require, import/no-dynamic-require
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
    messagesBefore: 0,
    messagesAfter: 0,
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
    result.messagesBefore = await page.locator(SEL.message).count();

    await page.locator(SEL.composer).click();
    await page.locator(SEL.composer).fill(args.prompt);
    await page.locator(SEL.send).click();

    // The turn is settled when the message count has grown by >= 2 (user +
    // assistant) and the last message's text stops changing between polls.
    const deadline = Date.now() + args.turnTimeout * 1000;
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
        if (text && text === lastText && !isPlaceholder) {
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
    if (!result.settled && lastText) result.answerText = truncate(lastText, 800);
    result.verdict = result.settled
      ? (result.runErrorSeen ? 'ANSWERED_WITH_RUN_ERROR' : 'ANSWERED')
      : (result.messagesAfter > result.messagesBefore ? 'TIMED_OUT_MID_TURN' : 'NO_RESPONSE');

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
