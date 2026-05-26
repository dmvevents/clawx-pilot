#!/usr/bin/env node
/**
 * Attach to the packaged Electron renderer over Chrome DevTools Protocol and
 * exercise the same IPC bridge the UI uses. This runs on the Windows pilot host.
 *
 * Safe by default:
 * - calls outlook.open only
 * - calls forms.list only
 * - never sends email
 * - never submits Forms
 * - redacts tokens/passwords/URLs/email addresses from console output
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function parseArgs(argv) {
  const out = {
    endpoint: 'http://127.0.0.1:9223',
    artifactDir: path.join(os.homedir(), 'Downloads'),
    safeChat: false,
    outlookSmoke: false,
    waitMs: 5000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--endpoint') out.endpoint = argv[++i] || out.endpoint;
    else if (arg === '--artifact-dir') out.artifactDir = argv[++i] || out.artifactDir;
    else if (arg === '--safe-chat') out.safeChat = true;
    else if (arg === '--outlook-smoke') out.outlookSmoke = true;
    else if (arg === '--wait-ms') out.waitMs = Number(argv[++i] || out.waitMs);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node pilot-electron-cdp-probe.js [--endpoint URL] [--artifact-dir DIR] [--safe-chat] [--outlook-smoke] [--wait-ms N]');
      process.exit(0);
    }
  }
  return out;
}

function appResourceDir() {
  if (process.env.CLAWX_APP_RESOURCES && fs.existsSync(process.env.CLAWX_APP_RESOURCES)) {
    return process.env.CLAWX_APP_RESOURCES;
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Programs', 'Ministry of Education', 'resources');
  }
  return process.cwd();
}

function candidateModuleDirs() {
  const resources = appResourceDir();
  return [
    process.env.PLAYWRIGHT_CORE_PATH,
    path.join(process.cwd(), 'node_modules', 'playwright-core'),
    path.join(__dirname, 'node_modules', 'playwright-core'),
    path.join(resources, 'node_modules', 'playwright-core'),
    path.join(resources, 'app.asar.unpacked', 'node_modules', 'playwright-core'),
    path.join(resources, 'openclaw', 'node_modules', 'playwright-core'),
    path.join(resources, 'openclaw', 'dist', 'extensions', 'browser', 'node_modules', 'playwright-core'),
    path.join(resources, 'openclaw', 'dist', 'extensions', 'diffs', 'node_modules', 'playwright-core'),
  ].filter(Boolean);
}

function requirePlaywright() {
  try {
    return { playwright: require('playwright-core'), source: 'node resolution' };
  } catch {
    // Fall through to explicit installed-app candidates.
  }

  for (const dir of candidateModuleDirs()) {
    const pkg = path.join(dir, 'package.json');
    if (!fs.existsSync(pkg)) continue;
    try {
      return { playwright: require(dir), source: dir };
    } catch {
      // Try the next candidate.
    }
  }

  const resources = appResourceDir();
  const extraNodeModules = [
    path.join(resources, 'node_modules'),
    path.join(resources, 'app.asar.unpacked', 'node_modules'),
    path.join(resources, 'openclaw', 'node_modules'),
  ].filter((dir) => fs.existsSync(dir));
  if (extraNodeModules.length > 0) {
    process.env.NODE_PATH = [process.env.NODE_PATH, ...extraNodeModules].filter(Boolean).join(path.delimiter);
    Module._initPaths();
    try {
      return { playwright: require('playwright-core'), source: `NODE_PATH=${extraNodeModules.join(';')}` };
    } catch {
      // Keep the final diagnostic below.
    }
  }

  throw new Error(`playwright-core not found. Tried: ${candidateModuleDirs().join(' | ')}`);
}

function redact(value, key = '') {
  if (value == null) return value;
  const lowerKey = String(key).toLowerCase();
  if (lowerKey.includes('token') || lowerKey.includes('password') || lowerKey.includes('authorization') || lowerKey.includes('secret')) {
    return '[redacted]';
  }
  if (lowerKey === 'url' || lowerKey.endsWith('url') || lowerKey.includes('websocket')) {
    return '[redacted-url]';
  }
  if (typeof value === 'string') {
    return value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]');
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (typeof value === 'object') {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redact(childValue, childKey);
    }
    return out;
  }
  return value;
}

async function withTimeout(label, fn, ms = 60_000) {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function findRendererPage(browser) {
  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  const inspected = [];

  for (const page of pages) {
    const info = {
      url: page.url(),
      title: await page.title().catch(() => ''),
      hasElectron: false,
      hasInvoke: false,
    };
    try {
      const flags = await page.evaluate(() => ({
        hasElectron: !!window.electron,
        hasInvoke: typeof window.electron?.ipcRenderer?.invoke === 'function',
        electronKeys: window.electron ? Object.keys(window.electron).slice(0, 20) : [],
      }));
      Object.assign(info, flags);
    } catch (error) {
      info.evalError = error instanceof Error ? error.message : String(error);
    }
    inspected.push(info);
    if (info.hasInvoke) return { page, inspected };
  }

  if (pages[0]) return { page: pages[0], inspected };
  throw new Error('No Electron renderer pages were exposed on the CDP endpoint.');
}

async function invokeHostApi(page, pathName, body = {}) {
  return page.evaluate(async ({ pathName: innerPath, body: innerBody }) => {
    const invoke = window.electron?.ipcRenderer?.invoke;
    if (typeof invoke !== 'function') {
      return {
        ok: false,
        error: 'window.electron.ipcRenderer.invoke unavailable',
        electronKeys: window.electron ? Object.keys(window.electron) : [],
      };
    }
    return invoke('hostapi:fetch', {
      path: innerPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(innerBody || {}),
    });
  }, { pathName, body });
}

async function sendSafeChat(page) {
  const prompt = [
    'Verification only.',
    'Use the outlook.open tool exactly once, then report the returned status.',
    'Do not draft email.',
    'Do not send email.',
    'Do not reply or forward.',
    'Do not read inbox contents.',
    'Do not submit forms.',
    'Do not use any other tool.',
  ].join(' ');

  return page.evaluate(async ({ prompt: innerPrompt }) => {
    const invoke = window.electron?.ipcRenderer?.invoke;
    if (typeof invoke !== 'function') {
      return { success: false, error: 'window.electron.ipcRenderer.invoke unavailable' };
    }
    const idempotencyKey = `pilot-electron-cdp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return invoke(
      'gateway:rpc',
      'chat.send',
      {
        sessionKey: 'agent:main:main',
        message: innerPrompt,
        deliver: false,
        idempotencyKey,
      },
      120_000,
    );
  }, { prompt });
}

function summarizeHostApiCall(result, summarizeData) {
  if (!result || result.ok === false) {
    return {
      ok: false,
      error: result?.error ?? 'unknown error',
    };
  }
  const json = result.data?.json;
  const data = json?.data ?? json?.result ?? null;
  return {
    ok: true,
    status: result.data?.status,
    result: summarizeData(data),
  };
}

async function runOutlookSmoke(page) {
  const readInbox = await withTimeout(
    'hostapi outlook.read-inbox',
    () => invokeHostApi(page, '/api/outlook/read-inbox', { top: 3 }),
    90_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  const sendWithoutConfirm = await withTimeout(
    'hostapi outlook.send confirm false',
    () => invokeHostApi(page, '/api/outlook/send', {
      to: 'nobody@example.invalid',
      subject: 'ClawX safety gate smoke',
      body: 'Safety gate check. This must not send.',
      confirm: false,
    }),
    60_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  const downloadWithoutConfirm = await withTimeout(
    'hostapi outlook.download-attachment confirm false',
    () => invokeHostApi(page, '/api/outlook/download-attachment', {
      id: 'safety-gate-smoke',
      filename: 'safety-gate-smoke.pdf',
      confirm: false,
    }),
    60_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return {
    readInbox: summarizeHostApiCall(readInbox, (data) => ({
      status: data?.status,
      messageCount: Array.isArray(data?.messages) ? data.messages.length : 0,
      message: data?.message,
    })),
    sendWithoutConfirm: summarizeHostApiCall(sendWithoutConfirm, (data) => ({
      status: data?.status,
      refused: data?.status === 'refused',
      reason: data?.reason,
    })),
    downloadWithoutConfirm: summarizeHostApiCall(downloadWithoutConfirm, (data) => ({
      status: data?.status,
      refused: data?.status === 'refused',
      reason: data?.reason,
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.artifactDir, { recursive: true });
  const screenshotPath = path.join(args.artifactDir, `clawx-electron-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);

  const { playwright, source } = requirePlaywright();
  const events = [];
  const browser = await withTimeout(
    'connectOverCDP',
    () => playwright.chromium.connectOverCDP(args.endpoint),
    20_000,
  );

  try {
    const { page, inspected } = await findRendererPage(browser);
    page.on('console', (msg) => {
      events.push({ type: 'console', level: msg.type(), text: msg.text().slice(0, 1000) });
    });
    page.on('pageerror', (error) => {
      events.push({ type: 'pageerror', text: error.message.slice(0, 1000) });
    });

    await page.waitForTimeout(500);
    const renderer = {
      url: page.url(),
      title: await page.title().catch(() => ''),
      hasElectronInvoke: await page.evaluate(() => typeof window.electron?.ipcRenderer?.invoke === 'function').catch(() => false),
    };

    await page.screenshot({ path: screenshotPath, fullPage: false }).catch((error) => {
      events.push({ type: 'screenshot-error', text: error instanceof Error ? error.message : String(error) });
    });

    const outlookOpen = await withTimeout('hostapi outlook.open', () => invokeHostApi(page, '/api/outlook/open'), 75_000)
      .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    const formsList = await withTimeout('hostapi forms.list', () => invokeHostApi(page, '/api/forms/list'), 75_000)
      .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

    const safeChat = args.safeChat
      ? await withTimeout('gateway chat.send', () => sendSafeChat(page), 130_000)
        .catch((error) => ({ success: false, error: error instanceof Error ? error.message : String(error) }))
      : { skipped: true };
    const outlookSmoke = args.outlookSmoke
      ? await runOutlookSmoke(page)
      : { skipped: true };

    await page.waitForTimeout(Math.max(0, args.waitMs));

    const summary = {
      state: 'ELECTRON_CDP_PROBE_DONE',
      endpoint: args.endpoint,
      playwrightSource: source,
      renderer,
      inspectedPages: inspected,
      screenshotPath,
      hostApi: {
        outlookOpen,
        formsList,
      },
      outlookSmoke,
      safeChat,
      eventCount: events.length,
      events: events.slice(-50),
    };

    const summaryPath = path.join(args.artifactDir, `clawx-electron-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(redact(summary), null, 2));
    console.log(JSON.stringify(redact({ ...summary, summaryPath }), null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(JSON.stringify(redact({
    state: 'ELECTRON_CDP_PROBE_FAILED',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }), null, 2));
  process.exit(1);
});
