/**
 * Watch network on the ResponsePage tab to learn how Forms stages answers.
 *
 * The user clicks ONE radio button while this is running. We capture every
 * non-GET request to forms.office.com — that tells us:
 *   - Does Forms PATCH a response object as you fill (per-field)?
 *   - Or does it hold all answers client-side until Submit?
 *   - What's the staging endpoint URL pattern?
 */
import { chromium } from 'playwright-core';
import { writeFileSync, appendFileSync } from 'node:fs';

async function main() {
  const OUT = '/tmp/forms-response-side.jsonl';
  writeFileSync(OUT, '');

  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find((p) => /forms\.office\.com.*ResponsePage/i.test(p.url()));
  if (!page) {
    console.error('No ResponsePage tab open');
    process.exit(1);
  }
  console.log(`Watching: ${page.url().slice(0, 100)}`);
  await page.bringToFront();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  const seen = new Map<string, any>();
  cdp.on('Network.requestWillBeSent' as any, (params: any) => {
    const u = params.request.url;
    const m = params.request.method;
    if (!/forms\.(office\.com|cloud\.microsoft)/i.test(u)) return;
    if (m === 'GET' || m === 'OPTIONS') return;
    seen.set(params.requestId, { url: u, method: m, postData: params.request.postData });
    console.log(`→ ${m} ${u.slice(-90)}`);
    if (params.request.postData) {
      console.log(`  body: ${params.request.postData.slice(0, 250)}`);
    }
  });
  cdp.on('Network.responseReceived' as any, async (params: any) => {
    const meta = seen.get(params.requestId);
    if (!meta) return;
    appendFileSync(
      OUT,
      JSON.stringify({
        method: meta.method,
        url: meta.url,
        body: meta.postData,
        status: params.response.status,
      }) + '\n',
    );
  });

  console.log('\n→ NOW: click ONE radio button or fill ONE text field on the form. 45s window.\n');
  await new Promise((r) => setTimeout(r, 45_000));
  console.log(`\nCaptured ${seen.size} non-GET requests.`);
  console.log(`Wrote ${OUT}`);
  await browser.close().catch(() => null);
}

main().catch((err) => { console.error(err); process.exit(1); });
