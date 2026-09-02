#!/usr/bin/env node
/**
 * Recorded-use-case driver for the Ministry of Education app on Windows.
 *
 * Extends pilot-chat-turn-driver.js with the owner-directed ANTI-STUCK rule:
 * every 15s capture a CDP screenshot server-side and classify the turn state
 * as reply-rendered / still-thinking / ERROR-BANNER. On ERROR-BANNER
 * (chat-run-error) it ABORTS immediately with the screenshot as evidence
 * instead of waiting for the full timeout.
 *
 * Also: waits for the composer to be ENABLED before sending (IF-5), and reads
 * (and if needed switches) the channel toggle to Online, recording which
 * channel served the turn.
 *
 * Safe: types ONE prompt into the chat composer. No Outlook/Forms/send/submit.
 * Runs with the app's bundled node.exe; app must be up with --remote-debugging-port.
 *
 * Usage: node clawx-recorded-usecase-driver.js --prompt "..." [--port 9223]
 *          [--turn-timeout 240] [--outdir C:\path] [--prefer-online]
 */
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { port: 9223, turnTimeout: 240, outdir: process.cwd(), prompt: '', preferOnline: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--prompt') args.prompt = String(argv[++i] ?? '');
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--turn-timeout') args.turnTimeout = Number(argv[++i]);
    else if (a === '--outdir') args.outdir = String(argv[++i] ?? process.cwd());
    else if (a === '--prefer-online') args.preferOnline = true;
  }
  if (!args.prompt) { console.error('FATAL: --prompt is required'); process.exit(2); }
  return args;
}

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
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, 'package.json'))) return require(c); } catch { /* keep walking */ }
  }
  console.error('FATAL: playwright-core not found'); process.exit(3);
}

const SEL = {
  composer: '[data-testid="chat-composer-input"]',
  send: '[data-testid="chat-composer-send"]',
  message: '[data-testid^="chat-message-"]',
  degrade: '[data-testid="chat-degrade-notice"]',
  runError: '[data-testid="chat-run-error"]',
  channel: '[data-testid="chat-composer-channel"]',
};

async function findChatPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      try { if (await page.locator(SEL.composer).count() > 0) return page; } catch { /* skip */ }
    }
  }
  return null;
}

function truncate(text, max) {
  const v = String(text ?? '').replace(/\s+/g, ' ').trim();
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

async function main() {
  const args = parseArgs(process.argv);
  const { chromium } = resolvePlaywrightCore();
  fs.mkdirSync(args.outdir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = {
    prompt: args.prompt, startedAt: new Date().toISOString(), cdpPort: args.port,
    appVersion: null, composerEnabledAfterMs: null,
    channelBefore: null, channelAfter: null, channelSwitched: false,
    messagesBefore: 0, messagesAfter: 0,
    degradeNoticeSeen: false, degradeNoticeText: null,
    runErrorSeen: false, runErrorText: null,
    answerText: null, settled: false, abortedOnError: false,
    stateSamples: [], verdict: 'INCOMPLETE',
  };

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port}`, { timeout: 15_000 });
  try {
    const page = await findChatPage(browser);
    if (!page) { result.verdict = 'FAILED_NO_CHAT_PAGE'; return result; }
    result.appVersion = await page.evaluate(() => navigator.userAgent).catch(() => null);

    // --- IF-5: wait for the composer to be ENABLED, not just present ---
    const enableDeadline = Date.now() + 150_000;
    let enabled = false;
    while (Date.now() < enableDeadline) {
      enabled = await page.locator(SEL.composer).isEnabled().catch(() => false);
      if (enabled) { result.composerEnabledAfterMs = Date.now() - Date.parse(result.startedAt); break; }
      await page.waitForTimeout(2_000);
    }
    if (!enabled) { result.verdict = 'COMPOSER_NEVER_ENABLED'; return result; }

    // --- read channel; switch to Online if requested and currently on-device ---
    try {
      if (await page.locator(SEL.channel).count() > 0) {
        result.channelBefore = await page.locator(SEL.channel).getAttribute('data-channel');
        if (args.preferOnline && result.channelBefore === 'on-device') {
          await page.locator(SEL.channel).click();
          await page.waitForTimeout(1_500);
          result.channelSwitched = true;
        }
        result.channelAfter = await page.locator(SEL.channel).getAttribute('data-channel');
      }
    } catch { /* channel toggle may be hidden if only one class configured */ }

    result.messagesBefore = await page.locator(SEL.message).count();
    await page.locator(SEL.composer).click();
    await page.locator(SEL.composer).fill(args.prompt);
    await page.locator(SEL.send).click();

    const deadline = Date.now() + args.turnTimeout * 1000;
    let lastText = '';
    let stableSince = 0;
    let nextShot = 0;   // capture a state screenshot on 15s boundaries
    let shotSeq = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2_000);
      const elapsed = Date.now() - Date.parse(result.startedAt);
      result.messagesAfter = await page.locator(SEL.message).count();

      if (await page.locator(SEL.degrade).count() > 0) {
        result.degradeNoticeSeen = true;
        result.degradeNoticeText = truncate(await page.locator(SEL.degrade).innerText().catch(() => ''), 300);
      }
      const hasRunError = (await page.locator(SEL.runError).count()) > 0;
      if (hasRunError) {
        result.runErrorSeen = true;
        result.runErrorText = truncate(await page.locator(SEL.runError).innerText().catch(() => ''), 300);
      }

      const lastRaw = await page.locator(SEL.message).last().innerText().catch(() => '');
      const text = lastRaw.replace(/\s+/g, ' ').trim();
      const isPlaceholder = /Thinking\s*[.…]|^\s*Working\b/i.test(text) || text.length < 40;

      // --- ANTI-STUCK: 15s state screenshot + classification ---
      if (elapsed >= nextShot) {
        shotSeq += 1;
        const cls = hasRunError ? 'ERROR-BANNER'
          : (result.messagesAfter >= result.messagesBefore + 2 && !isPlaceholder) ? 'reply-rendered'
          : 'still-thinking';
        const shotName = `state-${String(shotSeq).padStart(2, '0')}-${cls}.png`;
        await page.screenshot({ path: path.join(args.outdir, shotName), fullPage: false }).catch(() => {});
        result.stateSamples.push({ seq: shotSeq, elapsedMs: elapsed, classification: cls, shot: shotName });
        console.log(`STATE_SAMPLE seq=${shotSeq} elapsedMs=${elapsed} class=${cls}`);
        // Abort immediately on an error banner rather than waiting out the timeout.
        if (cls === 'ERROR-BANNER') {
          result.abortedOnError = true;
          result.answerText = truncate(text, 800);
          result.verdict = 'ABORTED_ERROR_BANNER';
          break;
        }
        nextShot = elapsed + 15_000;
      }

      if (result.messagesAfter >= result.messagesBefore + 2) {
        if (text && text === lastText && !isPlaceholder) {
          if (stableSince === 0) stableSince = Date.now();
          if (Date.now() - stableSince >= 9_000) {
            result.settled = true;
            result.answerText = truncate(text, 800);
            break;
          }
        } else { lastText = text; stableSince = 0; }
      }
    }

    if (!result.abortedOnError) {
      if (!result.settled && lastText) result.answerText = truncate(lastText, 800);
      result.verdict = result.settled
        ? (result.runErrorSeen ? 'ANSWERED_WITH_RUN_ERROR' : 'ANSWERED')
        : (result.messagesAfter > result.messagesBefore ? 'TIMED_OUT_MID_TURN' : 'NO_RESPONSE');
    }

    await page.screenshot({ path: path.join(args.outdir, `final-${stamp}.png`), fullPage: false }).catch(() => {});
    return result;
  } finally {
    result.finishedAt = new Date().toISOString();
    const outPath = path.join(args.outdir, `usecase-${stamp}.json`);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`RESULT ${result.verdict}`);
    console.log(JSON.stringify(result, null, 2));
    console.log(`WROTE ${outPath}`);
    await browser.close().catch(() => {});
  }
}
main().catch((e) => { console.error(`FATAL: ${e && e.message ? e.message : e}`); process.exit(1); });
