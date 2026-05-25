/**
 * Auto-fill all required fields on the Suspensions ResponsePage AND capture
 * the single Submit POST. Uses the VLM-extracted schema to know what each
 * field is and pick valid test values.
 *
 * Output:
 *   /tmp/forms-submit-shape.json  — locked-in runtime API shape
 *   /tmp/forms-submit-capture.jsonl — full network log
 *
 * Approach:
 *   1. Attach via CDP, find the ResponsePage tab
 *   2. Set up Network.requestWillBeSent listener
 *   3. For each field in the schema, pick a deterministic test value and
 *      fill via DOM (click radio, fill input, etc.)
 *   4. Click Submit
 *   5. Wait for the runtime POST to land, save the shape
 */
import { chromium, type Page } from 'playwright-core';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const SCHEMA = 'extensions/moe-principal-assistant/forms/suspensions-schema.vlm.json';
const SHAPE_OUT = '/tmp/forms-submit-shape.json';
const LOG = '/tmp/forms-submit-capture.jsonl';

interface VlmField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'single_choice' | 'multi_choice';
  required?: boolean;
  options?: string[];
}

/** Pick a deterministic test value for each field type. */
function testValue(field: VlmField): string | string[] {
  switch (field.type) {
    case 'date': return '05/25/2026'; // Forms expects locale m/d/yyyy on this tenant
    case 'number':
      // term_suspension_count needs 1-10; phone numbers need >999999.
      if (/phone/i.test(field.label)) return '8681234567';
      return '1';
    case 'text':
      if (/principal|name of the parent|name of the perpetrator|respondent/i.test(field.label)) return 'Demo Test Name';
      if (/pin/i.test(field.label)) return 'TEST-PIN-99999';
      if (/street/i.test(field.label)) return 'Test Street';
      if (/city|town|village/i.test(field.label)) return 'Aranguez';
      if (/house|apartment|light pole|mile/i.test(field.label)) return '12';
      return 'Test value';
    case 'single_choice':
      // Prefer the option named like a safe demo default
      if (!field.options || field.options.length === 0) return '';
      // First option is fine for everything
      return field.options[0];
    case 'multi_choice':
      if (!field.options || field.options.length === 0) return [];
      return [field.options[0]];
  }
}

async function fillField(page: Page, field: VlmField, value: string | string[]): Promise<{ ok: boolean; reason?: string }> {
  // Find the question container by visible label substring
  const probe = field.label.toLowerCase().slice(0, 30);
  const container = page
    .locator('div[role="listitem"], div[data-automation-id*="questionItem" i]')
    .filter({ hasText: new RegExp(probe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
    .first();

  const found = await container.count().catch(() => 0);
  if (!found) return { ok: false, reason: 'no question container by label' };

  try {
    if (field.type === 'single_choice') {
      const target = String(Array.isArray(value) ? value[0] : value);
      // radio is usually a <span>{option}</span> inside a clickable label
      const radio = container.locator('label').filter({ hasText: new RegExp(`^\\s*${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') }).first();
      const radioCount = await radio.count().catch(() => 0);
      if (radioCount > 0) {
        await radio.click({ timeout: 5_000 });
        return { ok: true };
      }
      // Fallback: aria-label
      const aria = container.locator(`[role="radio"][aria-label*="${target}" i]`).first();
      if ((await aria.count().catch(() => 0)) > 0) {
        await aria.click({ timeout: 5_000 });
        return { ok: true };
      }
      return { ok: false, reason: `option "${target}" not found` };
    }

    if (field.type === 'multi_choice') {
      const targets = Array.isArray(value) ? value : [String(value)];
      let any = false;
      for (const t of targets) {
        const cb = container.locator('label').filter({ hasText: new RegExp(`^\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') }).first();
        if ((await cb.count().catch(() => 0)) > 0) {
          await cb.click({ timeout: 5_000 });
          any = true;
        }
      }
      return any ? { ok: true } : { ok: false, reason: 'no checkboxes matched' };
    }

    // text / number / date — Forms uses different element types per question
    // category. Try generous set of selectors.
    const inputCandidates = [
      'input[type="text"]',
      'input[type="number"]',
      'input[type="date"]',
      'input[type="tel"]',
      'input:not([type])',
      'textarea',
      'input[role="textbox"]',
      '[contenteditable="true"]',
    ];
    for (const sel of inputCandidates) {
      const el = container.locator(sel).first();
      if ((await el.count().catch(() => 0)) > 0) {
        try {
          await el.click({ timeout: 3_000 });
          await el.fill(String(value));
          return { ok: true };
        } catch {
          // fall through to next selector
        }
      }
    }
    return { ok: false, reason: 'no input/contenteditable found' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  writeFileSync(LOG, '');

  const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8')) as { fields: VlmField[] };
  // Only fill REQUIRED fields — leave optional ones empty so the form still passes validation
  const required = schema.fields.filter((f) => f.required);
  console.log(`Will fill ${required.length}/${schema.fields.length} (required only)`);

  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find((p) => /forms\.office\.com.*ResponsePage/i.test(p.url()));
  if (!page) {
    console.error('No ResponsePage tab open. Open the form responder URL in Chrome.');
    process.exit(1);
  }
  await page.bringToFront();
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
  await page.waitForTimeout(1_500);

  // Set up CDP capture for the submit POST
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const seen = new Map<string, any>();
  cdp.on('Network.requestWillBeSent' as any, (params: any) => {
    const u = params.request.url;
    const m = params.request.method;
    if (!/forms\.(office\.com|cloud\.microsoft)/i.test(u)) return;
    if (m === 'GET' || m === 'OPTIONS') return;
    seen.set(params.requestId, { url: u, method: m, postData: params.request.postData, headers: params.request.headers });
  });
  let captured: any = null;
  cdp.on('Network.responseReceived' as any, (params: any) => {
    const meta = seen.get(params.requestId);
    if (!meta) return;
    const status = params.response.status;
    appendFileSync(LOG, JSON.stringify({ ...meta, status }) + '\n');
    if ((status === 200 || status === 201) && /\/(runtime|formapi)\/api\//i.test(meta.url) && (meta.method === 'POST' || meta.method === 'PUT')) {
      captured = {
        method: meta.method,
        url: meta.url,
        status,
        headers: Object.fromEntries(
          Object.entries(meta.headers as Record<string, string>).filter(([k]) =>
            /^(__requestverificationtoken|content-type|origin|referer|accept|authorization|x-correlationid)$/i.test(k),
          ),
        ),
        body: meta.postData,
      };
    }
  });

  // Fill loop
  console.log('\nFilling...');
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < required.length; i++) {
    const f = required[i];
    const v = testValue(f);
    const r = await fillField(page, f, v);
    if (r.ok) {
      ok++;
      console.log(`  [${String(i + 1).padStart(2)}] ✓ ${f.type.padEnd(13)} ${f.label.slice(0, 55)} → ${String(Array.isArray(v) ? v.join(',') : v).slice(0, 30)}`);
    } else {
      fail++;
      console.log(`  [${String(i + 1).padStart(2)}] ✗ ${f.type.padEnd(13)} ${f.label.slice(0, 55)} :: ${r.reason}`);
    }
    await page.waitForTimeout(180); // give the renderer time
  }
  console.log(`\nFilled ${ok}/${ok + fail}`);

  if (fail > required.length / 4) {
    console.log('Too many fill failures. Aborting before submit.');
    await browser.close().catch(() => null);
    process.exit(1);
  }

  // Click Submit
  console.log('\nClicking Submit...');
  const submitBtn = page.getByRole('button', { name: /^submit$/i }).first();
  if ((await submitBtn.count().catch(() => 0)) === 0) {
    console.log('No Submit button. Scroll to bottom?');
    await page.keyboard.press('End').catch(() => null);
    await page.waitForTimeout(1_000);
  }
  await submitBtn.click({ timeout: 10_000 }).catch((e) => console.log('submit click err:', e?.message));
  await page.waitForTimeout(8_000);

  if (captured) {
    writeFileSync(SHAPE_OUT, JSON.stringify(captured, null, 2));
    console.log(`\n✓ CAPTURED submit POST. Wrote ${SHAPE_OUT}`);
    console.log(`  endpoint: ${captured.url}`);
  } else {
    console.log('\n✗ No submit POST captured. Check /tmp/forms-submit-capture.jsonl for what happened.');
    console.log('Total captured network events:', seen.size);
  }

  await browser.close().catch(() => null);
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
