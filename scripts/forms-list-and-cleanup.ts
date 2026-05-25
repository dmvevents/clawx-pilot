/**
 * List all questions on the open Forms design page, optionally delete by id.
 *
 * Usage:
 *   pnpm exec tsx scripts/forms-list-and-cleanup.ts             # list only
 *   pnpm exec tsx scripts/forms-list-and-cleanup.ts --delete-all
 *   pnpm exec tsx scripts/forms-list-and-cleanup.ts --delete-text-only  # only Question.TextField, keep richer types
 */
import { chromium } from 'playwright-core';

async function main() {
  const args = process.argv.slice(2);
  const deleteAll = args.includes('--delete-all');
  const deleteTextOnly = args.includes('--delete-text-only');

  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find(
    (p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()) && /[?&]id=/.test(p.url()),
  );
  if (!page) {
    console.error('no design tab with ?id=');
    process.exit(1);
  }

  const url = new URL(page.url());
  const formId = url.searchParams.get('id')!;
  const TENANT = '9590bb09-ce2c-40e2-8181-fad0a7edebfe';
  const USER = '0e48d4db-698a-44ca-ba0b-ae905cd07817';
  const base = `https://forms.office.com/formapi/api/${TENANT}/users/${USER}/forms('${formId}')`;

  // List
  const listJs = `(async function() {
    var ofi = window.OfficeFormServerInfo || {};
    var headers = { 'accept': 'application/json' };
    if (ofi.antiForgeryToken) headers['__requestverificationtoken'] = ofi.antiForgeryToken;
    const r = await fetch(${JSON.stringify(base + '/questions')}, { credentials: 'include', headers: headers });
    if (!r.ok) return { error: r.status, text: (await r.text()).slice(0, 400) };
    return await r.json();
  })()`;
  const listed = (await page.evaluate(listJs)) as any;
  if (listed?.error) {
    console.error('List failed:', listed.error, listed.text);
    process.exit(1);
  }
  const questions = (listed?.value || []) as Array<{ id: string; title: string; type: string; order: number }>;
  console.log(`Form has ${questions.length} questions.\n`);
  questions
    .sort((a, b) => a.order - b.order)
    .forEach((q, i) => {
      console.log(`  [${String(i + 1).padStart(2)}] ${q.type.padEnd(22)} ${q.id} ${q.title.slice(0, 70)}`);
    });

  if (!deleteAll && !deleteTextOnly) {
    console.log('\n(Run with --delete-all or --delete-text-only to delete.)');
    await browser.close().catch(() => null);
    return;
  }

  const targets = deleteAll
    ? questions
    : questions.filter((q) => q.type === 'Question.TextField');
  console.log(`\nDeleting ${targets.length} question(s)...`);

  let ok = 0;
  let fail = 0;
  for (const q of targets) {
    const delJs = `(async function() {
      var ofi = window.OfficeFormServerInfo || {};
      var headers = { 'accept': 'application/json' };
      if (ofi.antiForgeryToken) headers['__requestverificationtoken'] = ofi.antiForgeryToken;
      const r = await fetch(${JSON.stringify(`${base}/questions('${q.id}')`)}, {
        method: 'DELETE',
        credentials: 'include',
        headers: headers,
      });
      return { status: r.status, text: r.status >= 400 ? (await r.text()).slice(0, 300) : '' };
    })()`;
    const result = (await page.evaluate(delJs)) as { status: number; text: string };
    if (result.status === 204 || result.status === 200) {
      ok++;
      console.log(`  ✓ delete ${q.id} ${q.title.slice(0, 60)}`);
    } else {
      fail++;
      console.log(`  ✗ ${result.status} ${q.id} :: ${result.text}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`\n=== ${ok} OK, ${fail} FAIL ===`);
  await browser.close().catch(() => null);
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
