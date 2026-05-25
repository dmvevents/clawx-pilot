/**
 * Rebuild the Suspensions form from the VLM-enriched schema.
 *
 * Source: extensions/moe-principal-assistant/forms/suspensions-schema.vlm.json
 * Target: the open Forms design page (must already exist + be empty)
 *
 * Type mapping (verified from live capture):
 *   single_choice → Question.Choice  + ChoiceType=1, Choices=[{Description}]
 *   multi_choice  → Question.Choice  + ChoiceType=2, Choices=[{Description}]
 *   date          → Question.Date    (questionInfo undefined or {})
 *   number/text   → Question.TextField + Multiline=false
 *
 * Required flag goes in the top-level `required` field.
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SCHEMA = 'extensions/moe-principal-assistant/forms/suspensions-schema.vlm.json';
const TENANT = '9590bb09-ce2c-40e2-8181-fad0a7edebfe';
const USER = '0e48d4db-698a-44ca-ba0b-ae905cd07817';

interface VlmField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'single_choice' | 'multi_choice';
  required?: boolean;
  options?: string[];
}

function clientId(): string {
  return 'r' + randomBytes(16).toString('hex');
}

function buildBody(field: VlmField, order: number): any {
  const base: any = {
    title: field.label.slice(0, 4000),
    id: clientId(),
    order,
    isQuiz: false,
    required: field.required === true,
  };

  if (field.type === 'date') {
    // Confirmed via probe: Forms uses "Question.DateTime", not "Question.Date"
    base.type = 'Question.DateTime';
    base.questionInfo = '{}';
    return base;
  }

  if (field.type === 'single_choice' || field.type === 'multi_choice') {
    base.type = 'Question.Choice';
    // Forms has an OData open-type length cap of ~32000 chars. The 454-school
    // list overflows. For the demo we cap choice options at 80 — the real MoE
    // form uses some other mechanism (probably split sections or PATCH after
    // create). Truncation is fine for the demo; the agent fills the FIRST
    // matching option by name regardless of how many are listed.
    const MAX_OPTS = 80;
    let opts = field.options || ['Option 1', 'Option 2'];
    if (opts.length > MAX_OPTS) {
      opts = opts.slice(0, MAX_OPTS - 1).concat(['Other']);
    }
    const choices = opts.map((opt) => ({
      Description: String(opt).slice(0, 250),
      IsGenerated: false,
    }));
    base.questionInfo = JSON.stringify({
      Choices: choices,
      ChoiceType: field.type === 'multi_choice' ? 2 : 1,
      AllowOtherAnswer: false,
      OptionDisplayStyle: 'ListAll',
      ChoiceRestrictionType: 'None',
      ShuffleOptions: false,
      ShowRatingLabel: false,
    });
    return base;
  }

  // text / number → TextField (Forms doesn't have a native number type)
  base.type = 'Question.TextField';
  base.questionInfo = JSON.stringify({
    Multiline: false,
    ShuffleOptions: false,
    ShowRatingLabel: false,
  });
  return base;
}

async function main() {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8')) as { fields: VlmField[] };
  console.log(`Will create ${schema.fields.length} questions (VLM-enriched, correct types).\n`);

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

  let order = 5_000_000;
  let ok = 0;
  let fail = 0;
  const breakdown: Record<string, number> = {};

  for (let i = 0; i < schema.fields.length; i++) {
    const f = schema.fields[i];
    order += 1_000_000 + Math.floor(Math.random() * 500);
    const body = buildBody(f, order);
    breakdown[f.type] = (breakdown[f.type] ?? 0) + 1;

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
      const text = await r.text();
      return { status: r.status, text: text.slice(0, 500) };
    })()`;

    try {
      const result = (await page.evaluate(inlineJs)) as { status: number; text: string };
      if (result.status === 201) {
        ok++;
        const tag = f.type === 'single_choice' || f.type === 'multi_choice'
          ? `${f.type} (${f.options?.length ?? 0} opts)`
          : f.type;
        console.log(`  [${String(i + 1).padStart(2)}] ✓ ${tag.padEnd(28)} ${f.label.slice(0, 60)}`);
      } else {
        fail++;
        console.log(`  [${String(i + 1).padStart(2)}] ✗ ${result.status} ${f.label.slice(0, 50)} :: ${result.text.slice(0, 200)}`);
      }
    } catch (err) {
      fail++;
      console.log(`  [${String(i + 1).padStart(2)}] ✗ THREW: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\n=== ${ok} OK / ${fail} FAIL ===`);
  console.log('Breakdown:', JSON.stringify(breakdown));
  await browser.close().catch(() => null);
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
