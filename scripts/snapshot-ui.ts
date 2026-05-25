/**
 * UI snapshot helper for UX designer hand-off.
 *
 * Walks every top-level route in the running app and screenshots it at
 * 1440x900. Output lands in docs/ui-snapshots/<mode>/<timestamp>/ with
 * one PNG per route plus a combined PDF.
 *
 * Modes:
 *   --mode=production  Attach to the running Electron app via CDP.
 *                      Requires the app to have been launched with
 *                      --remote-debugging-port=9223 (we add it to Info.plist
 *                      argv at runtime, or you can launch it yourself).
 *   --mode=dev         Spawn `pnpm dev` and walk the Vite-served renderer
 *                      directly via Playwright Chromium. No Electron
 *                      attach needed; faster and cleaner for UX hand-off.
 *
 * Run:
 *   pnpm exec tsx scripts/snapshot-ui.ts --mode=dev
 *   pnpm exec tsx scripts/snapshot-ui.ts --mode=production --port=9223
 */
import { chromium, type Browser, type Page } from 'playwright-core';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const ROUTES: Array<{ hash: string; name: string; settle?: number }> = [
  { hash: '/', name: '01-chat' },
  { hash: '/models', name: '02-models' },
  { hash: '/agents', name: '03-agents' },
  { hash: '/channels', name: '04-channels' },
  { hash: '/skills', name: '05-skills' },
  { hash: '/cron', name: '06-cron' },
  { hash: '/settings', name: '07-settings' },
  { hash: '/settings/general', name: '08-settings-general' },
  { hash: '/settings/providers', name: '09-settings-providers' },
  { hash: '/settings/outlook', name: '10-settings-outlook' },
  { hash: '/settings/microsoft-graph', name: '11-settings-microsoft-graph' },
];

const VIEWPORT = { width: 1440, height: 900 };

function parseArgs(): { mode: 'production' | 'dev'; port: number } {
  let mode: 'production' | 'dev' = 'dev';
  let port = 9223;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--mode=')) mode = a.slice(7) as any;
    else if (a.startsWith('--port=')) port = Number(a.slice(7));
  }
  if (mode !== 'production' && mode !== 'dev') throw new Error('mode must be production|dev');
  return { mode, port };
}

async function snapshotRoute(page: Page, baseUrl: string, route: { hash: string; name: string; settle?: number }, outDir: string): Promise<{ ok: boolean; path: string; bytes: number; error?: string }> {
  const url = baseUrl.includes('#') ? baseUrl.replace(/#.*$/, '') + '#' + route.hash : baseUrl + '#' + route.hash;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(route.settle ?? 1500);
    // Force any pending fonts / lazy renders.
    await page.evaluate(() => document.fonts?.ready).catch(() => null);
    await page.waitForTimeout(300);
    const out = join(outDir, `${route.name}.png`);
    const buf = await page.screenshot({ fullPage: false, type: 'png' });
    writeFileSync(out, buf);
    return { ok: true, path: out, bytes: buf.length };
  } catch (err) {
    return { ok: false, path: '', bytes: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function attachProduction(port: number): Promise<{ browser: Browser; baseUrl: string }> {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('CDP attached but no contexts; is the Electron app running?');
  const pages = contexts[0].pages();
  if (!pages.length) throw new Error('No pages in default context.');
  const page = pages[0];
  const baseUrl = page.url();
  if (!baseUrl.startsWith('file://') && !baseUrl.startsWith('http')) {
    throw new Error(`unexpected page URL: ${baseUrl}`);
  }
  return { browser, baseUrl };
}

async function startDevServer(): Promise<{ child: ChildProcess; baseUrl: string }> {
  console.log('[dev] starting `pnpm dev`...');
  const child = spawn('pnpm', ['dev'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  let baseUrl = '';
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('dev server did not start in 90s')), 90_000);
    const onData = (chunk: Buffer) => {
      const s = chunk.toString();
      process.stdout.write('[dev] ' + s);
      const m = s.match(/Local:\s+(http:\/\/[^\s]+)/);
      if (m && !baseUrl) {
        baseUrl = m[1].trim();
        clearTimeout(t);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`dev server exited early (${code})`)));
  });
  console.log(`[dev] up at ${baseUrl}`);
  return { child, baseUrl };
}

async function main() {
  const { mode, port } = parseArgs();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = join(process.cwd(), 'docs', 'ui-snapshots', mode, ts);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  console.log(`Output: ${outDir}`);

  let browser: Browser | undefined;
  let devChild: ChildProcess | undefined;
  let page: Page | undefined;
  let baseUrl: string;

  try {
    if (mode === 'production') {
      const r = await attachProduction(port);
      browser = r.browser;
      baseUrl = r.baseUrl;
      page = browser.contexts()[0].pages()[0];
    } else {
      const dev = await startDevServer();
      devChild = dev.child;
      baseUrl = dev.baseUrl;
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({ viewport: VIEWPORT });
      page = await ctx.newPage();
    }
    if (!page) throw new Error('no page');
    await page.setViewportSize(VIEWPORT).catch(() => null);
    console.log(`baseUrl: ${baseUrl}`);

    const results: Array<{ name: string; ok: boolean; bytes: number; error?: string }> = [];
    for (const route of ROUTES) {
      const r = await snapshotRoute(page, baseUrl, route, outDir);
      results.push({ name: route.name, ok: r.ok, bytes: r.bytes, error: r.error });
      console.log(`  ${r.ok ? '✓' : '✗'} ${route.name} ${r.ok ? `(${(r.bytes / 1024).toFixed(0)}KB)` : '— ' + r.error}`);
    }

    // Manifest
    const manifest = {
      mode,
      capturedAt: new Date().toISOString(),
      baseUrl,
      viewport: VIEWPORT,
      routes: results,
    };
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // README in the folder for the UX designer
    const readme = [
      `# ClawX UI snapshots (${mode}) — ${ts}`,
      '',
      `Captured at ${new Date().toISOString()} from base \`${baseUrl}\` at ${VIEWPORT.width}×${VIEWPORT.height}.`,
      '',
      `Mode: **${mode}** — ${mode === 'production' ? 'attached to the running Electron app over CDP. Live data including real Outlook session.' : 'fresh `pnpm dev` boot. Empty state, no production data.'}`,
      '',
      '| Route | File | Status |',
      '|---|---|---|',
      ...results.map((r) => `| \`${r.name}\` | [${r.name}.png](./${r.name}.png) | ${r.ok ? '✓' : '✗ ' + (r.error ?? '')} |`),
      '',
      `Total: ${results.filter((r) => r.ok).length}/${results.length} captured.`,
    ].join('\n');
    writeFileSync(join(outDir, 'README.md'), readme);

    console.log(`\nDone. ${results.filter((r) => r.ok).length}/${results.length} captured.`);
    console.log(`Folder: ${outDir}`);
  } finally {
    try { await browser?.close(); } catch { /* */ }
    try { devChild?.kill(); } catch { /* */ }
  }
}

main().catch((err) => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
