#!/usr/bin/env node
/** Read-only: dump full text of all chat-message-* elements + exec graph. */
const fs = require('node:fs');
const path = require('node:path');
function resolvePlaywrightCore() {
  const lad = process.env.LOCALAPPDATA || '';
  const roots = [path.join(lad, 'Programs', 'Ministry of Education', 'resources'), 'C:\\Program Files\\Ministry of Education\\resources'];
  const c = [path.join(process.cwd(), 'node_modules', 'playwright-core'), path.join(__dirname, 'node_modules', 'playwright-core')];
  for (const r of roots) c.push(path.join(r, 'node_modules', 'playwright-core'), path.join(r, 'app.asar.unpacked', 'node_modules', 'playwright-core'), path.join(r, 'openclaw', 'node_modules', 'playwright-core'), path.join(r, 'openclaw', 'dist', 'extensions', 'browser', 'node_modules', 'playwright-core'));
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
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) { try { if (await p.locator('[data-testid="chat-composer-input"]').count() > 0) { page = p; break; } } catch {} }
    if (!page) { console.log('NO_CHAT_PAGE'); return; }
    const dump = await page.evaluate(() => {
      const msgs = Array.from(document.querySelectorAll('[data-testid^="chat-message-"]')).map((el) => ({
        testid: el.getAttribute('data-testid'),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 700),
      }));
      const graph = document.querySelector('[data-testid="chat-execution-graph"]');
      const channel = document.querySelector('[data-testid="chat-composer-channel"]');
      return { count: msgs.length, msgs, graph: graph ? graph.textContent.replace(/\s+/g, ' ').trim() : null, channel: channel ? channel.getAttribute('data-channel') : null };
    });
    console.log('DUMP ' + JSON.stringify(dump, null, 2));
  } finally { await browser.close().catch(() => {}); }
}
main().catch((e) => { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
