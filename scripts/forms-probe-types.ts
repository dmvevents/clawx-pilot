/**
 * Probe what Question types the API accepts. Try a list of candidates,
 * see which 201 Create vs which 500.
 */
import { chromium } from 'playwright-core';
import { randomBytes } from 'node:crypto';

const TENANT = '9590bb09-ce2c-40e2-8181-fad0a7edebfe';
const USER = '0e48d4db-698a-44ca-ba0b-ae905cd07817';

const CANDIDATES = [
  'Question.Date',
  'Question.DateTime',
  'Question.DateField',
  'Question.Calendar',
  'Question.DateTimePicker',
];

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
  const endpoint = `https://forms.office.com/formapi/api/${TENANT}/users/${USER}/forms('${formId}')/questions`;

  let order = 90_000_000;
  for (const type of CANDIDATES) {
    order += 1_000_000;
    const body = {
      type,
      title: `Probe: ${type}`,
      id: 'r' + randomBytes(16).toString('hex'),
      order,
      isQuiz: false,
      required: false,
      questionInfo: '{}',
    };
    const inlineJs = `(async function() {
      var ofi = window.OfficeFormServerInfo || {};
      var headers = { 'content-type': 'application/json', 'accept': 'application/json' };
      if (ofi.antiForgeryToken) headers['__requestverificationtoken'] = ofi.antiForgeryToken;
      const r = await fetch(${JSON.stringify(endpoint)}, {
        method: 'POST',
        credentials: 'include',
        headers: headers,
        body: ${JSON.stringify(JSON.stringify(body))},
      });
      const t = await r.text();
      return { status: r.status, text: t.slice(0, 250) };
    })()`;
    const result = (await page.evaluate(inlineJs)) as { status: number; text: string };
    console.log(`  ${type.padEnd(30)} → ${result.status} ${result.text.slice(0, 100)}`);
  }
  await browser.close().catch(() => null);
}

main().catch((err) => { console.error(err); process.exit(1); });
