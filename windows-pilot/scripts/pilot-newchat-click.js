#!/usr/bin/env node
/**
 * Click the "new chat" control over CDP so a leg runs in a FRESH, uncontaminated
 * session (the prior session f576f746 held 23 stale GlobalWorkerOptions refs that
 * made the model short-circuit with a false "same technical error" refusal).
 * Clicks [data-testid="sidebar-new-chat"], waits, reports the message count
 * (expect 0 in a fresh session). No prompt, no send.
 * Usage: node pilot-newchat-click.js [--port 9223]
 */
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
    const before = await page.locator('[data-testid^="chat-message-"]').count();
    const btn = page.locator('[data-testid="sidebar-new-chat"]');
    if (await btn.count() === 0) { console.log('NO_NEW_CHAT_BUTTON before=' + before); return; }
    await btn.first().click();
    await page.waitForTimeout(2500);
    const after = await page.locator('[data-testid^="chat-message-"]').count();
    console.log('NEWCHAT_CLICKED before=' + before + ' after=' + after);
  } finally { await browser.close().catch(() => {}); }
}
main().catch((e) => { console.error('FATAL: ' + (e && e.message ? e.message : e)); process.exit(1); });
