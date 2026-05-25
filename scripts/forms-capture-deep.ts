/**
 * Deep capture: catches Choice/Date/PATCH and runtime submissions too.
 * Wrapped in main() to dodge tsx top-level-await CJS error.
 */
import { chromium } from 'playwright-core';
import { writeFileSync, appendFileSync } from 'node:fs';

const OUT = '/tmp/forms-capture-deep.jsonl';

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

  const interesting = (u: string) =>
    /forms\.office\.com\/(formapi|api|runtime|ResponsePage)/i.test(u) ||
    /substrate\.office\.com/i.test(u) ||
    /forms\.cloud\.microsoft\/(formapi|api|runtime)/i.test(u);

  page.on('request', (req) => {
    const m = req.method();
    const u = req.url();
    if (!interesting(u) || m === 'GET' || m === 'OPTIONS') return;
    let body = '';
    try {
      body = req.postData() ?? '';
    } catch {
      /* */
    }
    appendFileSync(
      OUT,
      JSON.stringify({
        kind: 'req',
        method: m,
        url: u.slice(0, 280),
        body: body.slice(0, 2500),
        bodyLen: body.length,
      }) + '\n',
    );
    console.log(`→ ${m} ...${u.slice(-90)}  body=${body.length}b`);
  });

  page.on('response', async (resp) => {
    const u = resp.url();
    const m = resp.request().method();
    if (!interesting(u) || m === 'GET' || m === 'OPTIONS') return;
    let body = '';
    try {
      body = (await resp.body()).toString('utf-8').slice(0, 2500);
    } catch {
      /* */
    }
    appendFileSync(
      OUT,
      JSON.stringify({ kind: 'res', status: resp.status(), method: m, url: u.slice(0, 280), body }) + '\n',
    );
  });

  console.log('Now: add 1 Choice with 3 options, 1 Date, mark one Required, EDIT the title of any.');
  console.log('Capturing for 75 seconds...\n');
  await new Promise((r) => setTimeout(r, 75_000));
  console.log('\nDone.');
  await browser.close().catch(() => null);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
