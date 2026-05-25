/**
 * Fix the truncated school list (80+Other → full 454).
 * Strategy: minified Choices JSON (drop IsGenerated:false) saves ~9.5K
 * which fits 454 schools under the 32K open-type cap.
 *
 * Steps:
 *   1. Find the existing "Name of primary school" question
 *   2. Delete it
 *   3. POST a new one with all 454 options, minified
 *   4. Reorder so it lands at position 3 (after Education District, School Type)
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SCHEMA = 'extensions/moe-principal-assistant/forms/suspensions-schema.vlm.json';
const TENANT = '9590bb09-ce2c-40e2-8181-fad0a7edebfe';
const USER = '0e48d4db-698a-44ca-ba0b-ae905cd07817';

async function main() {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8')) as {
    fields: Array<{ label: string; options?: string[] }>;
  };
  const schoolField = schema.fields.find(
    (f) => f.label.toLowerCase() === 'name of primary school',
  );
  if (!schoolField || !schoolField.options) {
    console.error('school field not found in schema');
    process.exit(1);
  }
  console.log(`Schema has ${schoolField.options.length} schools.`);

  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find(
    (p) =>
      /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()) && /[?&]id=/.test(p.url()),
  );
  if (!page) {
    console.error('no design tab');
    process.exit(1);
  }
  const url = new URL(page.url());
  const formId = url.searchParams.get('id')!;
  const base = `https://forms.office.com/formapi/api/${TENANT}/users/${USER}/forms('${formId}')`;

  // 1. List + find existing school question
  const listJs = `(async function() {
    var ofi = window.OfficeFormServerInfo || {};
    var headers = { 'accept': 'application/json' };
    if (ofi.antiForgeryToken) headers['__requestverificationtoken'] = ofi.antiForgeryToken;
    const r = await fetch(${JSON.stringify(base + '/questions')}, { credentials: 'include', headers: headers });
    return await r.json();
  })()`;
  const listed = (await page.evaluate(listJs)) as { value: Array<{ id: string; title: string; order: number }> };
  const existing = listed.value.find((q) => q.title === 'Name of primary school');
  if (!existing) {
    console.error('existing "Name of primary school" question not found on form');
    process.exit(1);
  }
  console.log(`Found existing question id=${existing.id} order=${existing.order}`);

  // 2. Delete it
  console.log('Deleting truncated version...');
  const delJs = `(async function() {
    var ofi = window.OfficeFormServerInfo || {};
    var headers = { 'accept': 'application/json' };
    if (ofi.antiForgeryToken) headers['__requestverificationtoken'] = ofi.antiForgeryToken;
    const r = await fetch(${JSON.stringify(base + `/questions('${existing.id}')`)}, {
      method: 'DELETE',
      credentials: 'include',
      headers: headers,
    });
    return r.status;
  })()`;
  const delStatus = await page.evaluate(delJs);
  console.log(`  delete status: ${delStatus}`);

  // 3. POST with all 454, MINIFIED (no IsGenerated)
  const choicesMinified = schoolField.options.map((opt) => ({ Description: String(opt) }));
  const questionInfo = JSON.stringify({
    Choices: choicesMinified,
    ChoiceType: 1,
    AllowOtherAnswer: false,
    OptionDisplayStyle: 'ListAll',
    ChoiceRestrictionType: 'None',
    ShuffleOptions: false,
    ShowRatingLabel: false,
  });
  console.log(`questionInfo size: ${questionInfo.length} chars (limit 32000)`);
  if (questionInfo.length > 32000) {
    console.error('STILL too large. Need a different strategy.');
    process.exit(1);
  }

  const body = {
    type: 'Question.Choice',
    title: 'Name of primary school',
    id: 'r' + randomBytes(16).toString('hex'),
    order: existing.order, // keep original position
    isQuiz: false,
    required: true,
    questionInfo,
  };

  const postJs = `(async function() {
    var ofi = window.OfficeFormServerInfo || {};
    var headers = { 'content-type': 'application/json', 'accept': 'application/json' };
    if (ofi.antiForgeryToken) headers['__requestverificationtoken'] = ofi.antiForgeryToken;
    const r = await fetch(${JSON.stringify(base + '/questions')}, {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: ${JSON.stringify(JSON.stringify(body))},
    });
    return { status: r.status, text: (await r.text()).slice(0, 600) };
  })()`;
  const result = (await page.evaluate(postJs)) as { status: number; text: string };
  console.log(`POST result: ${result.status}`);
  if (result.status !== 201) {
    console.log(`  body: ${result.text}`);
  } else {
    console.log(`✓ Recreated "Name of primary school" with all ${schoolField.options.length} options.`);
  }

  await browser.close().catch(() => null);
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
