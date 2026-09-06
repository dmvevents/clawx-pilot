#!/usr/bin/env node
/**
 * Read-only CDP probe: find the "new chat / new conversation" control in the
 * packaged renderer so a fresh (uncontaminated) session can be started before
 * driving a turn. Dumps candidate controls (testid, aria-label, title, text).
 * No clicks. Usage: node pilot-newchat-probe.js [--port 9223]
 */
const fs = require('node:fs');
const path = require('node:path');

function resolvePlaywrightCore() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const roots = [
    path.join(localAppData, 'Programs', 'Ministry of Education', 'resources'),
    'C:\\Program Files\\Ministry of Education\\resources',
  ];
  const c = [path.join(process.cwd(), 'node_modules', 'playwright-core'), path.join(__dirname, 'node_modules', 'playwright-core')];
  for (const r of roots) c.push(
    path.join(r, 'node_modules', 'playwright-core'),
    path.join(r, 'app.asar.unpacked', 'node_modules', 'playwright-core'),
    path.join(r, 'openclaw', 'node_modules', 'playwright-core'),
    path.join(r, 'openclaw', 'dist', 'extensions', 'browser', 'node_modules', 'playwright-core'),
  );
  for (const x of c) { try { if (fs.existsSync(path.join(x, 'package.json'))) return require(x); } catch {} }
  console.error('FATAL: playwright-core not found'); process.exit(3);
}

async function main() {
  let port = 9223;
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--port') port = Number(process.argv[++i]);
  const { chromium } = resolvePlaywrightCore();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15000 });
  try {
    let page = null;
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) {
      try { if (await p.locator('[data-testid="chat-composer-input"]').count() > 0) { page = p; break; } } catch {}
    }
    if (!page) { console.log('NO_CHAT_PAGE'); return; }
    const candidates = await page.evaluate(() => {
      const out = [];
      const els = Array.from(document.querySelectorAll('button,[role="button"],a,[data-testid]'));
      for (const el of els) {
        const testid = el.getAttribute('data-testid') || '';
        const aria = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        const hay = (testid + ' ' + aria + ' ' + title + ' ' + text).toLowerCase();
        if (/new|compose|conversation|\bchat\b|thread|\+/.test(hay)) {
          out.push({ tag: el.tagName, testid, aria, title, text });
        }
      }
      return out.slice(0, 40);
    });
    console.log('CANDIDATES ' + JSON.stringify(candidates, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}
main().catch((e) => { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
