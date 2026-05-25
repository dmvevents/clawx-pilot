/**
 * Capture Choice + Date question shapes by watching network for 60s.
 */
import { chromium } from 'playwright-core';
import { writeFileSync, appendFileSync } from 'node:fs';

async function main() {
  const OUT = '/tmp/forms-shapes.jsonl';
  writeFileSync(OUT, '');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find(
    (p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()) && /[?&]id=/.test(p.url()),
  );
  if (!page) {
    console.error('no design tab');
    process.exit(1);
  }
  await page.bringToFront();

  page.on('request', (req) => {
    const u = req.url();
    if (!/\/formapi\/api\//i.test(u)) return;
    const m = req.method();
    if (m === 'GET' || m === 'OPTIONS') return;
    let body = '';
    try {
      body = req.postData() ?? '';
    } catch {
      /* */
    }
    appendFileSync(
      OUT,
      JSON.stringify({ method: m, url: u.slice(0, 280), body: body.slice(0, 3000) }) + '\n',
    );
    console.log(`→ ${m} ${u.slice(-50)} ${body.length}b`);
    if (body && (body.includes('Choice') || body.includes('Date'))) {
      console.log(`  BODY: ${body.slice(0, 400)}`);
    }
  });

  console.log('NOW: Add 1 Choice question with 2-3 options, then 1 Date question. 60s.\n');
  await new Promise((r) => setTimeout(r, 60_000));
  console.log('done');
  await browser.close().catch(() => null);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
