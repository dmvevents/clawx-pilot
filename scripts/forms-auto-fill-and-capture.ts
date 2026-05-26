/**
 * Auto-fill all required fields on the Suspensions ResponsePage AND capture
 * the single Submit POST.
 *
 * KEY DESIGN: every field is filled via page.evaluate() running in-page JS
 * that walks the DOM from the heading downward, NOT via Playwright locators.
 * Reasons:
 *  - Forms is a React app. locator.fill() doesn't trigger React state.
 *    We use the React-native value setter + dispatch 'input' event.
 *  - The role="listitem" container only wraps SOME questions; others
 *    (number-restricted, multi-choice) live in a different wrapper.
 *    Heading-anchored walk is universal.
 *  - Date format must be locale-form (m/d/yyyy on this tenant's en-US).
 *
 * Output:
 *   /tmp/forms-submit-shape.json  — locked-in runtime API shape
 *   /tmp/forms-submit-capture.jsonl — full network log
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

function testValue(field: VlmField): string | string[] {
  switch (field.type) {
    case 'date':
      return '05/25/2026'; // m/d/yyyy locale-format for this tenant
    case 'number':
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
      return field.options?.[0] ?? '';
    case 'multi_choice':
      return field.options ? [field.options[0]] : [];
  }
}

/**
 * Fill a field via in-page DOM manipulation. Heading-anchored walk + React-
 * native setter for inputs + native click() for checkboxes/radios.
 */
async function fillField(page: Page, field: VlmField, value: string | string[]): Promise<{ ok: boolean; reason?: string }> {
  // Use the FULL label (not a 40-char slice — that caused false matches with
  // sibling questions sharing a prefix). Forms heading is "{N}.{label}" so the
  // full label is a stable suffix match.
  const headingProbe = field.label;
  const valueArg = JSON.stringify(value);
  const fieldType = field.type;

  const inlineJs = `
    (function() {
      // Normalize curly quotes / dashes to ASCII so labels match across renders
      function norm(s) {
        return (s || '').toLowerCase()
          .replace(/[\\u2018\\u2019]/g, "'")
          .replace(/[\\u201C\\u201D]/g, '"')
          .replace(/[\\u2013\\u2014]/g, '-')
          .replace(/\\s+/g, ' ').trim();
      }
      var probe = norm(${JSON.stringify(headingProbe.toLowerCase())});
      var headings = document.querySelectorAll('span[role="heading"], h1, h2, h3');
      var container = null;
      for (var i = 0; i < headings.length; i++) {
        var h = headings[i];
        var t = norm(h.textContent || '');
        if (t.indexOf(probe) >= 0) {
          // Walk up 8 levels to find the question container
          var p = h;
          for (var j = 0; j < 8; j++) {
            if (!p.parentElement) break;
            p = p.parentElement;
            // The question container holds inputs; stop at the lowest one
            // that has at least one input/label/textarea
            if (p.querySelector && p.querySelector('input, textarea, [contenteditable]')) {
              container = p;
              break;
            }
          }
          if (container) break;
        }
      }
      if (!container) return { ok: false, reason: 'no container by heading' };

      var type = ${JSON.stringify(fieldType)};
      var value = ${valueArg};

      // Helper: React-native value set + input event
      function reactFill(el, str) {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set ||
                     Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, str);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }

      if (type === 'single_choice' || type === 'multi_choice') {
        var values = Array.isArray(value) ? value : [value];
        var clicks = 0;
        var inputType = type === 'multi_choice' ? 'checkbox' : 'radio';
        var inputs = container.querySelectorAll('input[type="' + inputType + '"]');
        for (var k = 0; k < values.length; k++) {
          var target = String(values[k]).toLowerCase().trim();
          for (var m = 0; m < inputs.length; m++) {
            var inp = inputs[m];
            // The label is in a sibling/parent text node. Walk up to find a
            // <label> ancestor or look for the next sibling text node.
            var labelText = '';
            var labelEl = inp.closest('label');
            if (labelEl) labelText = (labelEl.textContent || '').toLowerCase().trim();
            if (!labelText) {
              // Forms often has the option text in the parent's text content
              var parentText = (inp.parentElement?.textContent || '').toLowerCase().trim();
              labelText = parentText;
            }
            if (labelText.indexOf(target) >= 0 || target.indexOf(labelText) >= 0) {
              inp.click();
              clicks++;
              break;
            }
          }
        }
        return clicks > 0 ? { ok: true, clicks } : { ok: false, reason: 'no matching ' + inputType + ' option for ' + JSON.stringify(values) };
      }

      // text / number / date — use React-native setter
      var inputs2 = container.querySelectorAll('input, textarea');
      for (var n = 0; n < inputs2.length; n++) {
        var el = inputs2[n];
        // Skip checkboxes / radios in the same container (e.g. in mixed sections)
        var inpType = (el.getAttribute('type') || '').toLowerCase();
        if (inpType === 'checkbox' || inpType === 'radio' || inpType === 'hidden') continue;
        // Skip if the input is a search box for the same dropdown
        if (el.getAttribute('placeholder') && /search/i.test(el.getAttribute('placeholder'))) continue;
        try {
          el.focus();
          reactFill(el, String(value));
          return { ok: true, tag: el.tagName.toLowerCase() };
        } catch (e) {
          return { ok: false, reason: 'reactFill threw: ' + (e?.message || String(e)) };
        }
      }
      return { ok: false, reason: 'no input found in container' };
    })()
  `;

  try {
    const result = (await page.evaluate(inlineJs)) as { ok: boolean; reason?: string };
    return result;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  writeFileSync(LOG, '');

  const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8')) as { fields: VlmField[] };
  const required = schema.fields.filter((f) => f.required);
  console.log(`Will fill ${required.length}/${schema.fields.length} required fields\n`);

  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find((p) => /forms\.office\.com.*ResponsePage/i.test(p.url()));
  if (!page) {
    console.error('No ResponsePage tab. Open the form first.');
    process.exit(1);
  }
  await page.bringToFront();
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
  await page.waitForTimeout(1_500);

  // CDP capture — set up BEFORE filling so we catch every event
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
    if ((status === 200 || status === 201) &&
        (meta.method === 'POST' || meta.method === 'PUT') &&
        /\/(runtime|formapi)\/api\//i.test(meta.url)) {
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
      console.log(`\n[CAPTURED submit] ${meta.method} ${status} ${meta.url}`);
    }
  });

  // Scroll to top before filling so we don't fight scroll-back
  await page.evaluate('window.scrollTo(0, 0)');
  await page.waitForTimeout(300);

  console.log('Filling...');
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < required.length; i++) {
    const f = required[i];
    const v = testValue(f);
    const r = await fillField(page, f, v);
    if (r.ok) {
      ok++;
      console.log(`  [${String(i + 1).padStart(2)}] ✓ ${f.type.padEnd(13)} ${f.label.slice(0, 55)}`);
    } else {
      fail++;
      console.log(`  [${String(i + 1).padStart(2)}] ✗ ${f.type.padEnd(13)} ${f.label.slice(0, 55)} :: ${r.reason}`);
    }
    await page.waitForTimeout(150);
  }
  console.log(`\nFilled ${ok}/${ok + fail}`);

  if (fail > 4) {
    console.log('Too many fill failures. NOT clicking Submit.');
    await browser.close().catch(() => null);
    process.exit(1);
  }

  // Click Submit
  console.log('\nClicking Submit...');
  await page.keyboard.press('End').catch(() => null);
  await page.waitForTimeout(500);
  const submitBtn = page.getByRole('button', { name: /^submit$/i }).first();
  if ((await submitBtn.count().catch(() => 0)) === 0) {
    console.log('Submit button not found.');
    await browser.close().catch(() => null);
    process.exit(1);
  }
  await submitBtn.click({ timeout: 10_000 }).catch((e) => console.log('submit err:', e?.message));

  // Wait for the capture, up to 15s
  const start = Date.now();
  while (Date.now() - start < 15_000 && !captured) {
    await new Promise((r) => setTimeout(r, 250));
  }

  if (captured) {
    writeFileSync(SHAPE_OUT, JSON.stringify(captured, null, 2));
    console.log(`\n✓ CAPTURED. Wrote ${SHAPE_OUT}`);
    console.log(`  endpoint: ${captured.url}`);
  } else {
    console.log('\n✗ No submit POST captured.');
    console.log(`  Network events seen during run: ${seen.size}`);
    console.log(`  Check ${LOG} for what was logged.`);
  }

  await browser.close().catch(() => null);
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
