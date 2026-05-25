/**
 * Capture the POST shape when a respondent clicks Submit on a Forms response page.
 *
 * Usage:
 *   1. Open the form in a NEW Chrome tab via the responder URL:
 *      https://forms.office.com/Pages/ResponsePage.aspx?id=...
 *   2. Run this script (it'll attach to that tab via CDP)
 *   3. Fill in 4-5 fields (any combination of single_choice + text + date)
 *   4. Click Submit
 *   5. Script captures the POST → writes /tmp/forms-submit-shape.json
 *
 * What we want to extract:
 *   - Endpoint URL (likely /runtime/api/{tenant}/forms('{id}')/responses)
 *   - Full request headers (especially __requestverificationtoken)
 *   - Body shape (JSON-stringified answers array, fields, encoding)
 */
import { chromium } from 'playwright-core';
import { writeFileSync, appendFileSync } from 'node:fs';

const OUT = '/tmp/forms-submit-shape.json';
const LOG = '/tmp/forms-submit-capture.jsonl';

async function main() {
  writeFileSync(LOG, '');

  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const responsePage = all.find((p) => /forms\.office\.com.*ResponsePage/i.test(p.url())) || all.find((p) => /forms\.office\.com\/r\//i.test(p.url()));
  if (!responsePage) {
    console.error('No tab found at /Pages/ResponsePage.aspx?id=... or /r/...');
    console.error('Open the form responder URL in Chrome, then re-run.');
    process.exit(1);
  }
  console.log(`Watching: ${responsePage.url().slice(0, 120)}`);
  await responsePage.bringToFront();

  // Use raw CDP — page.on('request') doesn't fire for attached tabs
  const cdp = await responsePage.context().newCDPSession(responsePage);
  await cdp.send('Network.enable');

  const requests = new Map<string, { url: string; method: string; postData?: string; headers: Record<string, string> }>();
  cdp.on('Network.requestWillBeSent' as any, (params: any) => {
    const url = params.request.url;
    // Watch ALL forms.office.com POST/PATCH that contain answer-like words
    if (!/forms\.(office\.com|cloud\.microsoft)/i.test(url)) return;
    if (params.request.method === 'GET' || params.request.method === 'OPTIONS') return;
    requests.set(params.requestId, {
      url,
      method: params.request.method,
      postData: params.request.postData,
      headers: params.request.headers,
    });
    console.log(`[req] ${params.request.method} ${url.slice(0, 120)}`);
  });

  let captured: any = null;
  cdp.on('Network.responseReceived' as any, async (params: any) => {
    const meta = requests.get(params.requestId);
    if (!meta) return;
    const status = params.response.status;
    const looksLikeSubmit =
      /\/runtime\/api\//i.test(meta.url) ||
      /response/i.test(meta.url) ||
      /answer/i.test(meta.url) ||
      /submit/i.test(meta.url);
    if (!looksLikeSubmit && !meta.postData?.includes('answers')) return;

    appendFileSync(
      LOG,
      JSON.stringify({
        method: meta.method,
        url: meta.url,
        headers: meta.headers,
        body: meta.postData,
        status,
      }) + '\n',
    );
    console.log(`\n[response ${status}] ${meta.url.slice(0, 100)}`);
    if (meta.postData) {
      console.log(`BODY (first 800 chars):\n${meta.postData.slice(0, 800)}`);
    }
    if (status === 200 || status === 201) {
      captured = {
        method: meta.method,
        url: meta.url,
        headers: Object.fromEntries(
          Object.entries(meta.headers).filter(([k]) =>
            /^(__requestverificationtoken|content-type|origin|x-correlationid|authorization|accept)$/i.test(k),
          ),
        ),
        body: meta.postData,
        status,
      };
    }
  });

  console.log('\n→ Now in Chrome: fill 4-5 fields and click Submit. Watching for 120s...\n');
  const start = Date.now();
  while (Date.now() - start < 120_000 && !captured) {
    await new Promise((r) => setTimeout(r, 500));
  }

  if (captured) {
    writeFileSync(OUT, JSON.stringify(captured, null, 2));
    console.log(`\n✓ CAPTURED. Wrote ${OUT}`);
    console.log(`Endpoint: ${captured.url}`);
  } else {
    console.log('\n✗ No submit captured in 120s. Did you click Submit?');
  }

  await browser.close().catch(() => null);
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
