#!/usr/bin/env node
/**
 * Set the chat channel through the principal's OWN control (the composer pill),
 * not by editing config files.
 *
 * Why a script instead of a file edit: the four stores must stay coherent
 * (CLAUDE.md engineering invariants). Clicking the pill runs the real
 * channel transaction (`applyChannelChange`) through the host API, so
 * clawx-providers.json, openclaw.json defaults, every agent's models.json and
 * the persisted preference all move together. A hand-edited JSON file moves
 * exactly one of them and re-creates the drift we are trying to clear.
 *
 * The toggle DOES bounce the gateway (by design — it is a deliberate change
 * outside a turn), so callers must wait for port 18789 to come back before
 * sending. Use pilot-run-chat-turn.ps1's readiness loop, or poll the port.
 *
 * Usage:
 *   node pilot-set-channel.js --channel on-device [--port 9223]
 * Exit: 0 channel is now the requested one; 1 could not set it; 2 bad args.
 */

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { port: 9223, channel: '' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--channel') args.channel = String(argv[++i] ?? '');
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
  }
  if (args.channel !== 'online' && args.channel !== 'on-device') {
    console.error('FATAL: --channel must be "online" or "on-device"');
    process.exit(2);
  }
  return args;
}

function resolvePlaywrightCore() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const roots = [
    path.join(localAppData, 'Programs', 'Ministry of Education', 'resources'),
    'C:\\Program Files\\Ministry of Education\\resources',
  ];
  const candidates = [path.join(process.cwd(), 'node_modules', 'playwright-core')];
  for (const r of roots) {
    candidates.push(
      path.join(r, 'node_modules', 'playwright-core'),
      path.join(r, 'app.asar.unpacked', 'node_modules', 'playwright-core'),
      path.join(r, 'openclaw', 'node_modules', 'playwright-core'),
    );
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'package.json'))) return require(c);
    } catch { /* keep walking */ }
  }
  console.error('FATAL: playwright-core not found');
  process.exit(3);
}

const TOGGLE = '[data-testid="chat-composer-channel"]';

(async () => {
  const args = parseArgs(process.argv);
  const { chromium } = resolvePlaywrightCore();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port}`, { timeout: 15_000 });
  try {
    let page = null;
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) {
        try {
          if (await p.locator(TOGGLE).count() > 0) { page = p; break; }
        } catch { /* devtools target */ }
      }
      if (page) break;
    }
    if (!page) {
      // Hidden when NEITHER channel has an account — that is a config problem,
      // not a click problem, so say which.
      console.log('STATE: NO_CHANNEL_TOGGLE (no page exposes it — either the app is not on the chat view, or no provider account is configured for either channel)');
      process.exit(1);
    }

    const toggle = page.locator(TOGGLE).first();
    const before = await toggle.getAttribute('data-channel');
    console.log(`STATE: CHANNEL_BEFORE ${before}`);
    if (before === args.channel) {
      console.log(`STATE: CHANNEL_ALREADY ${args.channel}`);
      process.exit(0);
    }

    await toggle.click();
    // The click round-trips through the host API channel transaction (four
    // stores + a gateway refresh), so give it real time before reading back.
    let after = before;
    for (let i = 0; i < 20; i += 1) {
      await page.waitForTimeout(1_000);
      after = await toggle.getAttribute('data-channel');
      if (after === args.channel) break;
    }
    console.log(`STATE: CHANNEL_AFTER ${after}`);
    if (after !== args.channel) {
      console.log('STATE: CHANNEL_SET_FAILED (the transaction did not take — check the app log for a channel-router error)');
      process.exit(1);
    }
    console.log('STATE: CHANNEL_SET_OK (gateway is bouncing — wait for port 18789 before sending)');
    process.exit(0);
  } finally {
    await browser.close().catch(() => {});
  }
})().catch((e) => {
  console.error(`FATAL: ${e && e.message ? e.message : e}`);
  process.exit(1);
});
