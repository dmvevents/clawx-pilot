/**
 * Get the responder URL of the open form so we can write it to disk for the
 * fill driver and also use it ourselves to capture the submit-API shape.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const TENANT = '9590bb09-ce2c-40e2-8181-fad0a7edebfe';
const USER = '0e48d4db-698a-44ca-ba0b-ae905cd07817';
const URL_OUT = 'extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt';

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find(
    (p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()) && /[?&]id=/.test(p.url()),
  );
  if (!page) {
    console.error('no design tab');
    process.exit(1);
  }
  const url = new URL(page.url());
  const formId = url.searchParams.get('id')!;

  // The responder URL pattern is well-known:
  //   https://forms.office.com/r/{shortId}     (short, requires generation)
  //   https://forms.office.com/Pages/ResponsePage.aspx?id={formId}
  const responderUrl = `https://forms.office.com/Pages/ResponsePage.aspx?id=${encodeURIComponent(formId)}`;

  // Also try to fetch the full form metadata via /formapi/api/.../forms('{id}')
  const metaJs = `(async function() {
    var ofi = window.OfficeFormServerInfo || {};
    var headers = { 'accept': 'application/json' };
    if (ofi.antiForgeryToken) headers['__requestverificationtoken'] = ofi.antiForgeryToken;
    const r = await fetch(${JSON.stringify(`https://forms.office.com/formapi/api/${TENANT}/users/${USER}/forms('${formId}')`)}, {
      credentials: 'include',
      headers: headers,
    });
    return await r.json();
  })()`;
  const meta = (await page.evaluate(metaJs)) as any;
  console.log('Form metadata keys:', Object.keys(meta));
  console.log('Title:', meta.title);
  console.log('responderUrl:', meta.responderUrl);
  console.log('responderShortUrl:', meta.responderShortUrl);
  console.log('completedFormUrl:', meta.completedFormUrl);

  const finalUrl = meta.responderUrl || meta.responderShortUrl || responderUrl;
  writeFileSync(URL_OUT, finalUrl + '\n');
  console.log(`\nWrote: ${URL_OUT}`);
  console.log(`URL: ${finalUrl}`);

  await browser.close().catch(() => null);
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
