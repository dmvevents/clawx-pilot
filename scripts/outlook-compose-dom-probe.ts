/** Diagnostic: open a compose pane on the CURRENT Outlook tab and enumerate
 * every visible editable field with its identifying attributes. Read-only
 * apart from opening/discarding one empty compose. For the outlook.cloud.microsoft
 * DOM-rotation investigation (RAJ-4 class). */
import { chromium } from 'playwright-core';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792', { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().match(/outlook\.(office|office365|cloud\.microsoft)/));
  if (!page) { console.log('no outlook tab'); process.exit(1); }
  await page.bringToFront();

  // Open a fresh compose via the keyboard shortcut — the toolbar button's
  // label/structure rotated on the new domain.
  await page.keyboard.press('n');
  await page.waitForTimeout(3500);

  const fields = await page.evaluate(() => {
    const out: Record<string, string>[] = [];
    const els = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"], input, textarea'));
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        aria: (el.getAttribute('aria-label') || '').slice(0, 60),
        placeholder: (el.getAttribute('placeholder') || '').slice(0, 40),
        automation: (el.getAttribute('data-automation-id') || el.getAttribute('data-automationid') || '').slice(0, 40),
        testid: (el.getAttribute('data-testid') || '').slice(0, 40),
        ce: el.getAttribute('contenteditable') || '',
        rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      });
    }
    return out;
  });
  for (const f of fields) console.log(JSON.stringify(f));

  await page.screenshot({ path: '/tmp/outlook-compose-dom.png' }).catch(() => {});
  // Discard the empty compose to leave clean state.
  const discard = page.locator('button[aria-label*="Discard" i], button:has-text("Discard")');
  if (await discard.count()) await discard.first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const confirm = page.locator('button:has-text("Discard")');
  if (await confirm.count()) await confirm.first().click({ timeout: 3000 }).catch(() => {});
  await browser.close().catch(() => {});
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
