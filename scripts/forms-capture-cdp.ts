/**
 * Capture network traffic via raw CDP — bypasses Playwright's per-page
 * route system which doesn't work on tabs we attach to (only ones we open).
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

  // Raw CDP session
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');

  const requests = new Map<string, { url: string; method: string; postData?: string }>();
  cdp.on('Network.requestWillBeSent' as any, (params: any) => {
    if (!/\/formapi\/api\//i.test(params.request.url)) return;
    requests.set(params.requestId, {
      url: params.request.url,
      method: params.request.method,
      postData: params.request.postData,
    });
  });
  cdp.on('Network.responseReceived' as any, async (params: any) => {
    const meta = requests.get(params.requestId);
    if (!meta) return;
    if (meta.method === 'GET' || meta.method === 'OPTIONS') return;
    appendFileSync(
      OUT,
      JSON.stringify({
        method: meta.method,
        url: meta.url.slice(0, 280),
        body: (meta.postData ?? '').slice(0, 3500),
        status: params.response.status,
      }) + '\n',
    );
    console.log(`${meta.method} ${params.response.status} ${meta.url.slice(-60)}`);
    if (meta.postData) {
      console.log(`  ${meta.postData.slice(0, 350)}`);
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
