/**
 * Drafts-folder sweeper (CLWX-70 acceptance leg 2).
 *
 * Deletes AUTOMATION-AUTHORED drafts from the signed-in mailbox's Drafts
 * folder — the litter that unclean automation exits leave behind (Escape
 * saves a draft; 23 accumulated on test.fac and blocked the external
 * tester's send flow, 2026-09-03). STRICT allowlist: only drafts whose
 * subject matches a known automation pattern are touched; anything a human
 * might have written is left alone. Deletion uses the row's hover Delete
 * action (never opens the draft, never types).
 *
 * Run (Chrome on :18792, sandbox account signed in):
 *   pnpm exec tsx scripts/outlook-drafts-sweeper.ts            # dry-run: list matches
 *   SWEEP=1 pnpm exec tsx scripts/outlook-drafts-sweeper.ts    # actually delete
 */
import { chromium } from 'playwright-core';

const AUTOMATION_SUBJECT = /\b(eval \d{2}:\d{2}:\d{2}|MoE smoke \d{2}:\d{2}:\d{2}|Testing ClawX|Testing Email Features)/i;
const SWEEP = process.env.SWEEP === '1';
const MAX_DELETES = 40;

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792', { timeout: 15_000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => /outlook\.(office|office365|cloud\.microsoft|live)/i.test(p.url()));
  if (!page) { console.log('NO_OUTLOOK_TAB'); process.exit(2); }
  await page.bringToFront();

  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/mail/drafts`, { waitUntil: 'domcontentloaded' }).catch(() => null);
  await page.waitForTimeout(3_000);

  let deleted = 0;
  for (let pass = 0; pass < MAX_DELETES; pass += 1) {
    const rows = page.locator('[role="option"][aria-label], [role="row"][aria-label]');
    const n = await rows.count();
    let target = -1;
    let label = '';
    for (let i = 0; i < n; i += 1) {
      const al = (await rows.nth(i).getAttribute('aria-label')) || '';
      if (AUTOMATION_SUBJECT.test(al)) { target = i; label = al; break; }
    }
    if (target < 0) break;
    const short = label.replace(/\s+/g, ' ').slice(0, 70);
    if (!SWEEP) {
      // Dry-run: report and blank the row out of further scans by remembering count only.
      console.log(`MATCH: ${short}`);
      // On dry-run we cannot skip forward without deleting; list all matches instead.
      let listed = 1;
      for (let i = target + 1; i < n; i += 1) {
        const al = (await rows.nth(i).getAttribute('aria-label')) || '';
        if (AUTOMATION_SUBJECT.test(al)) { console.log(`MATCH: ${al.replace(/\s+/g, ' ').slice(0, 70)}`); listed += 1; }
      }
      console.log(`DRY-RUN: ${listed} automation drafts matched. Re-run with SWEEP=1 to delete.`);
      await browser.close();
      process.exit(0);
    }
    const row = rows.nth(target);
    await row.hover().catch(() => null);
    await page.waitForTimeout(300);
    const del = row.locator('[aria-label="Delete"], [title="Delete"]').first();
    if ((await del.count().catch(() => 0)) === 0) {
      console.log(`NO-DELETE-ACTION on: ${short} — stopping to avoid unsafe fallbacks`);
      break;
    }
    await del.click({ timeout: 5_000 }).catch(() => null);
    deleted += 1;
    console.log(`DELETED: ${short}`);
    await page.waitForTimeout(1_200);
  }

  console.log(`SWEEP DONE: deleted=${deleted}`);
  await page.goto(`${origin}/mail/`, { waitUntil: 'domcontentloaded' }).catch(() => null);
  await browser.close();
  process.exit(0);
}

main().catch((err) => { console.error('INFRA:', err instanceof Error ? err.message : String(err)); process.exit(2); });
