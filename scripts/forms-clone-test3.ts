/**
 * Test the clone-v2 logic against just title + first 3 fields.
 * Validates the editor automation before we burn 33 fields.
 */
import { chromium, type Page } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = join(process.cwd(), 'extensions/moe-principal-assistant/forms/suspensions-schema.json');
const CDP = process.env.CLAWX_CDP_ENDPOINT ?? 'http://127.0.0.1:18792';

interface Field { id: string; label: string; type: string; required?: boolean; options?: string[] }
interface Schema { title: string; description: string; sections: Array<{ fields: Field[] }> }

async function main() {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8')) as Schema;
  const fields = schema.sections.flatMap(s => s.fields).slice(0, 3);
  const browser = await chromium.connectOverCDP(CDP);
  const all = browser.contexts().flatMap(c => c.pages());
  const designPages = all.filter(p => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()));
  console.log(`Found ${designPages.length} design tabs:`);
  designPages.forEach((p, i) => console.log(`  [${i}] ${p.url().slice(0, 130)}`));
  // Strict: only a tab with ?id= in the URL (templates chooser doesn't have it)
  const page = designPages.find(p => /[?&]id=/.test(p.url()));
  if (!page) throw new Error('No DesignPageV2 tab with ?id= query — open https://forms.office.com/, click + New Form so a real form gets an id, then re-run.');
  await page.bringToFront();

  console.log(`Test target: ${page.url().slice(0, 100)}`);

  // 1. TITLE
  console.log('\n[1] Click title container');
  await page.locator('[data-automation-id="formTitleContainer"]').click({ timeout: 5_000 });
  await page.waitForTimeout(700);
  await page.keyboard.press('Meta+A').catch(() => null);
  await page.waitForTimeout(80);
  await page.keyboard.type('Test: Suspensions clone', { delay: 4 });
  await page.waitForTimeout(400);
  // Tab to description
  await page.keyboard.press('Tab').catch(() => null);
  await page.waitForTimeout(300);
  const aria = await page.evaluate(`document.activeElement && document.activeElement.getAttribute('aria-label')`);
  console.log(`  → after Tab, active aria-label = ${JSON.stringify(aria)}`);
  if (typeof aria === 'string' && /description/i.test(aria)) {
    await page.keyboard.type('test description', { delay: 4 });
    await page.waitForTimeout(200);
  }
  // Click neutral so editor commits
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => null);
  await page.waitForTimeout(500);

  // Read back the title
  const titleAfter = await page.evaluate(`document.querySelector('[data-automation-id="formMainTitle"]') && document.querySelector('[data-automation-id="formMainTitle"]').textContent`);
  console.log(`  → title now reads: "${titleAfter}"`);

  // 2-4. ADD 3 FIELDS
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const formsType = field.type === 'date' ? 'Date'
      : field.type === 'single_choice' || field.type === 'multi_choice' ? 'Choice'
      : 'Text';
    console.log(`\n[${i + 2}] Add ${formsType}: ${field.label}`);

    // Click + Add new (the questionAdd container shows the type buttons inline)
    let clicked = false;
    const inAddContainer = page.locator('[data-automation-id="questionAdd"]').getByRole('button', { name: new RegExp(`^${formsType}$`) }).first();
    if (await inAddContainer.count() > 0) {
      await inAddContainer.click({ timeout: 5_000 }).catch(() => null);
      clicked = true;
    } else {
      const anywhere = page.getByRole('button', { name: new RegExp(`^${formsType}$`) }).first();
      if (await anywhere.count() > 0) {
        await anywhere.click({ timeout: 5_000 }).catch(() => null);
        clicked = true;
      }
    }
    if (!clicked) { console.log(`  ✗ no ${formsType} button found`); continue; }
    await page.waitForTimeout(700);

    // Active should now be the question's title editor (contenteditable, aria-label "Question…")
    const qaria = await page.evaluate(`document.activeElement && document.activeElement.getAttribute('aria-label')`);
    console.log(`  → after type click, active aria = ${JSON.stringify(qaria)}`);
    await page.keyboard.press('Meta+A').catch(() => null);
    await page.waitForTimeout(60);
    await page.keyboard.type(field.label, { delay: 3 });
    await page.waitForTimeout(300);

    // For Choice: tab into first option, type, Enter for next
    if (formsType === 'Choice' && field.options) {
      for (let j = 0; j < field.options.length; j++) {
        if (j === 0) {
          await page.keyboard.press('Tab').catch(() => null);
        } else {
          await page.keyboard.press('Enter').catch(() => null);
        }
        await page.waitForTimeout(120);
        const oaria = await page.evaluate(`document.activeElement && document.activeElement.getAttribute('aria-label')`);
        if (j === 0) console.log(`  → first option active aria = ${JSON.stringify(oaria)}`);
        await page.keyboard.press('Meta+A').catch(() => null);
        await page.keyboard.type(field.options[j], { delay: 2 });
      }
    }

    if (field.required) {
      // Find Required toggle for this question — last role=switch with "Required" name
      const req = page.locator('[role="switch"]').filter({ hasText: /required/i }).last();
      if (await req.count() > 0) {
        await req.click({ timeout: 2_000 }).catch(() => null);
      } else {
        // Try the icon button form
        const reqBtn = page.getByRole('button', { name: /required/i }).last();
        if (await reqBtn.count() > 0) await reqBtn.click({ timeout: 2_000 }).catch(() => null);
      }
    }
    await page.waitForTimeout(400);
  }

  console.log('\nDONE — eyeball the form in Chrome to verify.');
  await browser.close().catch(() => null);
}

main().catch(err => { console.error('CRASH:', err); process.exit(1); });
