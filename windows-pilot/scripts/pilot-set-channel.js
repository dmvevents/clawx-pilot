#!/usr/bin/env node
/**
 * Set the chat channel through the principal's OWN control (the composer pill),
 * then prove the RUNTIME actually moved.
 *
 * Why a script instead of a file edit: the four stores must stay coherent
 * (CLAUDE.md engineering invariants). Clicking the pill runs the real
 * channel transaction (`applyChannelChange`) through the host API, so
 * clawx-providers.json, openclaw.json defaults, every agent's models.json and
 * the persisted preference all move together. A hand-edited JSON file moves
 * exactly one of them and re-creates the drift we are trying to clear.
 *
 * Why the pill's own attribute is NOT the success signal: `data-channel` is the
 * *effective preference* (ChannelToggle.tsx <- ChatInput: session override ||
 * preferredChannel || account availability). It is set optimistically before
 * the backend transaction, and a send-time degrade deliberately leaves
 * `preferredChannel` on "online" while moving the runtime to on-device. So the
 * pill can read "online" while turns run on-device, and a pill-only check exits
 * 0 having certified nothing (found by cross-model adversarial review,
 * 2026-09-06). The authoritative state is the default provider account in
 * clawx-providers.json — exactly what the main process's getActiveChannel reads.
 *
 * The toggle DOES bounce the gateway (by design — it is a deliberate change
 * outside a turn), so callers must still wait for port 18789 to come back
 * before sending. Use pilot-run-chat-turn.ps1's readiness loop, or poll the port.
 *
 * Usage:
 *   node pilot-set-channel.js --channel on-device [--port 9223] [--wait 90]
 * Exit: 0 the RUNTIME is now on the requested channel; 1 it is not (or could not
 * be proven); 2 bad args; 3 no playwright-core.
 */

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = { port: 9223, channel: '', wait: 90 };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--channel') args.channel = String(argv[++i] ?? '');
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--wait') args.wait = Number(argv[++i]);
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

// Mirrors electron/services/providers/channel-router.ts::classifyAccount. Keep
// the two in sync: if the app's classification changes, a stale copy here turns
// a real drift into a silent PASS.
const LOCAL_HOST_PATTERN = /^(?:https?:\/\/)?(?:127(?:\.\d{1,3}){3}|localhost|::1|\[::1\])(?::\d+)?(?:\/|$)/i;
const LOCAL_VENDOR_IDS = new Set(['ollama']);

function classifyAccount(account) {
  const baseUrl = String(account?.baseUrl ?? '').trim();
  if (baseUrl && LOCAL_HOST_PATTERN.test(baseUrl)) return 'on-device';
  const vendorId = String(account?.vendorId ?? account?.type ?? '').trim().toLowerCase();
  if (LOCAL_VENDOR_IDS.has(vendorId)) return 'on-device';
  return 'online';
}

function providersFilePath() {
  if (process.env.CLAWX_PROVIDERS_FILE) return process.env.CLAWX_PROVIDERS_FILE;
  const appData = process.env.APPDATA || '';
  return path.join(appData, 'Ministry of Education', 'clawx-providers.json');
}

/**
 * The channel the runtime will actually use for the next turn: the default
 * provider account, classified. Returns null when it cannot be determined —
 * callers must treat null as "unproven", never as "fine".
 */
function runtimeChannelFromStore(raw) {
  const accounts = raw?.providerAccounts ?? {};
  const accountId = raw?.defaultProviderAccountId;
  if (accountId && accounts[accountId]) return classifyAccount(accounts[accountId]);
  // Older stores only carry defaultProvider (the provider key, not an account).
  const providerKey = raw?.defaultProvider;
  const providers = raw?.providers ?? {};
  if (providerKey && providers[providerKey]) return classifyAccount(providers[providerKey]);
  return null;
}

function readRuntimeChannel() {
  try {
    return runtimeChannelFromStore(JSON.parse(fs.readFileSync(providersFilePath(), 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Which pill clicks to make. The pill computes its next value from its OWN
 * label, so when it already reads the target while the runtime does not, one
 * click moves us further away — round-trip through the other channel instead.
 * Two real transactions, both available to the principal as taps.
 */
function legsFor(pill, runtime, target) {
  if (runtime === target) return [];
  if (pill !== target) return [target];
  return [target === 'online' ? 'on-device' : 'online', target];
}

async function waitForRuntime(target, timeoutMs, page) {
  const deadline = Date.now() + timeoutMs;
  let seen = readRuntimeChannel();
  while (Date.now() < deadline) {
    if (seen === target) return true;
    await page.waitForTimeout(1_000);
    seen = readRuntimeChannel();
  }
  return seen === target;
}

async function main() {
  const args = parseArgs(process.argv);
  const { chromium } = resolvePlaywrightCore();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port}`, { timeout: 15_000 });
  let ok = false;
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
      return;
    }

    const toggle = page.locator(TOGGLE).first();
    const pillBefore = await toggle.getAttribute('data-channel');
    const runtimeBefore = readRuntimeChannel();
    console.log(`STATE: PILL_BEFORE ${pillBefore}`);
    console.log(`STATE: RUNTIME_BEFORE ${runtimeBefore ?? 'UNKNOWN'}`);
    if (runtimeBefore === null) {
      console.log(`STATE: RUNTIME_UNREADABLE ${providersFilePath()} (cannot prove the channel; refusing to report success)`);
      return;
    }
    if (pillBefore !== runtimeBefore) {
      // Expected after an automatic send-time degrade, which leaves the stored
      // preference alone on purpose. Worth printing loudly either way.
      console.log(`STATE: PILL_RUNTIME_DIVERGED pill=${pillBefore} runtime=${runtimeBefore}`);
    }

    if (runtimeBefore === args.channel) {
      console.log(`STATE: CHANNEL_ALREADY ${args.channel} (runtime)`);
      ok = true;
      return;
    }

    const legs = legsFor(pillBefore, runtimeBefore, args.channel);
    if (legs.length > 1) console.log(`STATE: RUNTIME_RESYNC_ROUNDTRIP via ${legs[0]}`);

    for (const leg of legs) {
      await toggle.click();
      const landed = await waitForRuntime(leg, args.wait * 1000, page);
      console.log(`STATE: RUNTIME_AFTER_CLICK ${readRuntimeChannel() ?? 'UNKNOWN'} target=${leg} landed=${landed}`);
      if (!landed) {
        console.log('STATE: CHANNEL_SET_FAILED (the transaction did not reach the runtime — check the app log for a channel-router error)');
        return;
      }
    }

    const pillAfter = await toggle.getAttribute('data-channel');
    const runtimeAfter = readRuntimeChannel();
    console.log(`STATE: PILL_AFTER ${pillAfter}`);
    console.log(`STATE: RUNTIME_AFTER ${runtimeAfter ?? 'UNKNOWN'}`);
    if (runtimeAfter !== args.channel) {
      console.log('STATE: CHANNEL_SET_FAILED (runtime did not settle on the requested channel)');
      return;
    }
    console.log('STATE: CHANNEL_SET_OK (gateway is bouncing — wait for port 18789 before sending)');
    ok = true;
  } finally {
    await browser.close().catch(() => {});
    process.exitCode = ok ? 0 : 1;
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`FATAL: ${e && e.message ? e.message : e}`);
    process.exit(1);
  });
}

module.exports = { classifyAccount, runtimeChannelFromStore, legsFor };
