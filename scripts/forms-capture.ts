/**
 * Capture Microsoft Forms internal API calls.
 *
 * Strategy: attach to the design tab via CDP, hook page.on('request') and
 * page.on('response'), then DO NOTHING for 30 seconds while the user
 * manually adds ONE question. We log every POST/PUT/PATCH/DELETE to
 * forms.office.com or substrate.office.com.
 *
 * Output: /tmp/forms-capture.jsonl — one line per request with method, url,
 * post body, status, response body (clipped). Then we read it to find the
 * "create question" call and write a programmatic clone.
 */
import { chromium } from 'playwright-core';
import { writeFileSync, appendFileSync } from 'node:fs';

const CDP = 'http://127.0.0.1:18792';
const OUT = '/tmp/forms-capture.jsonl';

async function main() {
  writeFileSync(OUT, ''); // truncate
  const browser = await chromium.connectOverCDP(CDP);
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find((p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()) && /[?&]id=/.test(p.url()));
  if (!page) throw new Error('no design tab with ?id=');
  await page.bringToFront();
  console.log(`Watching: ${page.url().slice(0, 120)}\n`);

  const interesting = (url: string) =>
    /forms\.office\.com\/(api|formapi|runtime)/i.test(url) ||
    /substrate\.office\.com/i.test(url) ||
    /forms\.cloud\.microsoft\/(api|formapi|runtime)/i.test(url);

  page.on('request', async (req) => {
    const method = req.method();
    const url = req.url();
    if (!interesting(url)) return;
    if (method === 'GET' || method === 'OPTIONS') return;
    let body = '';
    try { body = req.postData() ?? ''; } catch { /* */ }
    const headers = req.headers();
    const rec = {
      ts: new Date().toISOString(),
      kind: 'request',
      method,
      url: url.slice(0, 300),
      headers: {
        'content-type': headers['content-type'] || '',
        'x-anchormailbox': headers['x-anchormailbox'] || '',
        'x-correlationid': headers['x-correlationid'] || '',
        'x-formstoken': headers['x-formstoken'] ? '<present>' : '',
        authorization: headers['authorization'] ? '<present>' : '',
      },
      bodyPreview: body.slice(0, 600),
      bodyLength: body.length,
    };
    appendFileSync(OUT, JSON.stringify(rec) + '\n');
    console.log(`→ ${method} ${url.slice(0, 120)}  body=${body.length}b`);
  });

  page.on('response', async (resp) => {
    const url = resp.url();
    if (!interesting(url)) return;
    const method = resp.request().method();
    if (method === 'GET' || method === 'OPTIONS') return;
    let body = '';
    try {
      const buf = await resp.body();
      body = buf.toString('utf-8').slice(0, 600);
    } catch { /* binary or cross-origin */ }
    const rec = {
      ts: new Date().toISOString(),
      kind: 'response',
      method,
      status: resp.status(),
      url: url.slice(0, 300),
      bodyPreview: body,
    };
    appendFileSync(OUT, JSON.stringify(rec) + '\n');
    console.log(`← ${resp.status()} ${url.slice(0, 100)}`);
  });

  console.log(`Now manually add ONE question in Forms (click "Text" or "Choice", type a label, press Tab).`);
  console.log(`Watching for 45 seconds...\n`);

  await new Promise((r) => setTimeout(r, 45_000));
  console.log(`\nDone. Wrote ${OUT}.`);
  await browser.close().catch(() => null);
}

main().catch((err) => { console.error(err); process.exit(1); });
