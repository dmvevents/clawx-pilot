/**
 * forms-bulk-add: Programmatically POST 33 questions into the open Suspensions
 * form via the internal /formapi/ endpoint we reverse-engineered.
 *
 * For tomorrow's demo we ship Text fields only. Choice/Date can be converted
 * by hand in the editor after, OR by another script after we capture their
 * shapes cleanly.
 *
 * Endpoint:
 *   POST forms.office.com/formapi/api/{tenant}/users/{user}/forms('{form}')/questions
 *   Body: { type, title, id, order, isQuiz: false, required, questionInfo }
 *
 * We use page.request which inherits the page's session cookies — no token
 * dance, no header forging. This works because the page itself is authed.
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const SCHEMA = join(process.cwd(), 'extensions/moe-principal-assistant/forms/suspensions-schema.json');
const CDP = 'http://127.0.0.1:18792';

interface Field {
  id: string;
  label: string;
  subtitle?: string;
  type: 'text' | 'number' | 'date' | 'single_choice' | 'multi_choice';
  required?: boolean;
  options?: string[];
  showWhen?: Record<string, string>;
}

function clientQuestionId(): string {
  // Forms uses "r" + 32 hex char string. Match that shape.
  return 'r' + randomBytes(16).toString('hex');
}

async function main() {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8')) as { sections: Array<{ fields: Field[] }> };
  const allFields = schema.sections.flatMap((s) => s.fields);
  console.log(`Will add ${allFields.length} questions.\n`);

  const browser = await chromium.connectOverCDP(CDP);
  const all = browser.contexts().flatMap((c) => c.pages());
  const page = all.find(
    (p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()) && /[?&]id=/.test(p.url()),
  );
  if (!page) {
    console.error('No design tab with ?id=. Open the form in Chrome first.');
    process.exit(1);
  }

  // Extract tenantId, userId, formId from a previously-known POST URL or the page URL.
  // We saw: /formapi/api/{tenantId}/users/{userId}/forms('{formId}')/questions
  // The page URL has only the formId (in the ?id= query).
  // tenantId + userId we got from the capture. Hardcode here (one-shot demo helper).
  const TENANT_ID = '9590bb09-ce2c-40e2-8181-fad0a7edebfe';
  const USER_ID = '0e48d4db-698a-44ca-ba0b-ae905cd07817';
  // formId is in the URL after ?id=
  const url = new URL(page.url());
  const formId = url.searchParams.get('id');
  if (!formId) {
    console.error('No ?id= in page URL.');
    process.exit(1);
  }

  const base = `https://forms.office.com/formapi/api/${TENANT_ID}/users/${USER_ID}/forms('${formId}')`;
  const endpoint = `${base}/questions`;
  console.log(`Endpoint: ${endpoint.slice(0, 110)}...\n`);

  const ctx = page.context();

  // Forms requires double-submit CSRF: cookie __RequestVerificationToken
  // must match header __requestverificationtoken. The Bearer token is also
  // checked. Pull both from the page so we replay them on each POST.
  const cookies = await ctx.cookies('https://forms.office.com');
  const csrfCookie = cookies.find((c) => c.name === '__RequestVerificationToken');
  if (!csrfCookie) {
    console.error('No __RequestVerificationToken cookie. Reload the Forms tab in Chrome and re-run.');
    process.exit(1);
  }
  console.log(`CSRF cookie length: ${csrfCookie.value.length}`);

  // The page's own fetch wrapper (PageContext.bind) attaches the
  // __requestverificationtoken header AND the Bearer token automatically.
  // We invoke fetch() directly via an inline IIFE in each evaluate call
  // (page.evaluate uses fresh contexts so we can't define helpers once).

  let order = 5_000_000;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < allFields.length; i++) {
    const f = allFields[i];
    order += 1_000_000 + Math.floor(Math.random() * 500);
    const body = {
      type: 'Question.TextField',
      title: f.label.slice(0, 4000),
      id: clientQuestionId(),
      order,
      isQuiz: false,
      required: f.required === true,
      questionInfo: JSON.stringify({
        Multiline: false,
        ShuffleOptions: false,
        ShowRatingLabel: false,
      }),
    };

    try {
      // Run fetch INSIDE the page so all auth/csrf headers ride along.
      // Forms requires:
      //   __requestverificationtoken header = OfficeFormServerInfo.antiForgeryToken
      //   authorization: Bearer <jwt> — sniffed from a cached recent request OR
      //     from the page's OfficeFormServerInfo.bearerToken if exposed
      const inlineJs = `(async function() {
        var ofi = window.OfficeFormServerInfo || {};
        var headers = { 'content-type': 'application/json', 'accept': 'application/json' };
        if (ofi.antiForgeryToken) headers['__requestverificationtoken'] = ofi.antiForgeryToken;
        // Try to find a Bearer token. The page caches it after the first auth.
        var bearer = null;
        try {
          // Look in MSAL cache (msal.cache.encryption cookie hints there's localStorage)
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && /accesstoken|bearer/i.test(k)) {
              var v = localStorage.getItem(k);
              if (v && v.length > 200) {
                try { var parsed = JSON.parse(v); if (parsed.secret && parsed.secret.length > 200) { bearer = parsed.secret; break; } } catch(e) {}
                if (v.startsWith('eyJ')) { bearer = v; break; }
              }
            }
          }
        } catch(e) {}
        if (bearer) headers['authorization'] = 'Bearer ' + bearer;
        const r = await fetch(${JSON.stringify(endpoint)}, {
          method: 'POST',
          credentials: 'include',
          headers: headers,
          body: ${JSON.stringify(JSON.stringify(body))},
        });
        const text = await r.text();
        return { status: r.status, text: text.slice(0, 400), hasAFT: !!headers['__requestverificationtoken'], hasAuth: !!headers['authorization'] };
      })()`;
      const result = (await page.evaluate(inlineJs)) as { status: number; text: string; hasAFT: boolean; hasAuth: boolean };
      if (i === 0) console.log(`  (request #1 sent with AFT=${result.hasAFT} Auth=${result.hasAuth})`);
      const resp = { status: () => result.status, text: async () => result.text };
      const status = resp.status();
      if (status === 201) {
        ok++;
        console.log(`  [${String(i + 1).padStart(2)}] ✓ ${f.label.slice(0, 70)}`);
      } else {
        fail++;
        const text = await resp.text().catch(() => '');
        console.log(`  [${String(i + 1).padStart(2)}] ✗ ${status} - ${f.label.slice(0, 50)} :: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      fail++;
      console.log(`  [${String(i + 1).padStart(2)}] ✗ THREW: ${err instanceof Error ? err.message : String(err)}`);
    }
    // small spacing so we don't overrun the form's queue
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\n=== ${ok} OK, ${fail} FAIL ===`);
  console.log(`Refresh the design tab in Chrome to see the questions.`);
  await browser.close().catch(() => null);
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
