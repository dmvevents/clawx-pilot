/**
 * Capture FULL headers (not redacted) for a successful POST. We need the
 * AntiForgery / CSRF token name and value so we can replay programmatically.
 */
import { chromium } from 'playwright-core';
import { writeFileSync, appendFileSync } from 'node:fs';

const OUT = '/tmp/forms-headers.jsonl';

async function main() {
  writeFileSync(OUT, '');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find(
    (p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()) && /[?&]id=/.test(p.url()),
  );
  if (!page) {
    console.error('no design tab with ?id=');
    process.exit(1);
  }
  await page.bringToFront();

  page.on('request', (req) => {
    const u = req.url();
    if (!/\/formapi\/api\//i.test(u)) return;
    const m = req.method();
    if (m !== 'POST' && m !== 'PATCH') return;
    const headers = req.headers();
    appendFileSync(
      OUT,
      JSON.stringify({
        kind: 'req',
        method: m,
        url: u,
        headers, // FULL headers — we need to see csrf names
        body: req.postData() ?? '',
      }) + '\n',
    );
    console.log(`→ ${m} ${u.slice(-70)}`);
    console.log('  HEADERS:', Object.keys(headers).filter((k) => k.match(/token|csrf|forms|origin|x-/i)).join(', '));
  });

  console.log('Now: add ONE more question of any type. 30 seconds.\n');
  await new Promise((r) => setTimeout(r, 30_000));
  await browser.close().catch(() => null);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
