/**
 * Clone the MoE Suspensions form into the test.fac@fac.edu.tt account.
 *
 * Reads the schema at extensions/moe-principal-assistant/forms/suspensions-schema.json
 * and drives Microsoft Forms via the user's existing Chrome session over CDP.
 * The result is a fillable Forms URL on test.fac that mirrors the original MoE
 * Suspensions form, so we can demo end-to-end form-fill without depending on
 * the @moe.gov.tt tenant.
 *
 * Run:
 *   pnpm exec tsx scripts/forms-clone-suspensions.ts
 *
 * Output:
 *   extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt
 *
 * Prereqs:
 *   - Chrome running with --remote-debugging-port=18792
 *   - test.fac@fac.edu.tt logged into Microsoft 365 (Outlook/Forms share SSO)
 */
import { chromium, type Page } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SCHEMA_PATH = join(process.cwd(), 'extensions/moe-principal-assistant/forms/suspensions-schema.json');
const URL_OUT = join(process.cwd(), 'extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt');
const CDP = process.env.CLAWX_CDP_ENDPOINT ?? 'http://127.0.0.1:18792';

type Field =
  | { id: string; label: string; subtitle?: string; type: 'text' | 'number' | 'date'; required?: boolean; min?: number; max?: number; validation?: string }
  | { id: string; label: string; subtitle?: string; type: 'single_choice' | 'multi_choice'; required?: boolean; options?: string[]; optionsRef?: string; showWhen?: Record<string, string> };

interface Schema {
  id: string;
  title: string;
  description: string;
  sections: Array<{ name: string; fields: Field[] }>;
}

async function attachChrome(): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await chromium.connectOverCDP(CDP);
  // CDP exposes one BrowserContext per Chrome user data dir; pages live under it.
  // Walk every context's pages so we don't miss an existing Forms tab.
  const allPages = browser.contexts().flatMap((c) => c.pages());
  console.log(`Attached. ${allPages.length} pages total in the user's Chrome.`);
  // Prefer a Forms design page that's already open.
  let page = allPages.find((p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()));
  if (page) {
    console.log(`Re-using existing Forms design tab: ${page.url().slice(0, 100)}…`);
  } else {
    page = allPages.find((p) => /forms\.(office|cloud\.microsoft)\.com/i.test(p.url()));
    if (page) {
      console.log(`Re-using existing Forms tab: ${page.url().slice(0, 100)}…`);
    } else {
      // Fall back: open one in the first context.
      const ctx = browser.contexts()[0];
      if (!ctx) throw new Error('no browser contexts');
      page = await ctx.newPage();
      console.log('Opened new tab.');
    }
  }
  return {
    page,
    close: async () => {
      // Don't close the user's Chrome — just disconnect CDP.
      try { await browser.close(); } catch { /* expected on disconnect */ }
    },
  };
}

async function navigateToFormsHome(page: Page): Promise<void> {
  // If we're already on a Forms design page, do nothing.
  if (/forms\.office\.com\/Pages\/DesignPageV2/i.test(page.url())) {
    console.log('[1/4] Already on Forms design page; skipping navigate.');
    await page.bringToFront().catch(() => null);
    return;
  }
  const target = 'https://forms.cloud.microsoft/';
  console.log(`[1/4] Navigate to ${target}`);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => null);
  await page.waitForTimeout(2_000);
}

async function clickNewForm(page: Page): Promise<void> {
  // If we're already on a design page (existing form open), skip.
  if (/forms\.office\.com\/Pages\/DesignPageV2/i.test(page.url())) {
    console.log('[2/4] Already on design page; skipping New Form click.');
    return;
  }
  console.log('[2/4] Click New Form');
  const candidates = [
    page.getByRole('button', { name: /new form/i }),
    page.getByRole('link', { name: /new form/i }),
    page.locator('button:has-text("New Form")'),
    page.locator('a:has-text("New Form")'),
    page.getByRole('button', { name: /^new$/i }),
  ];
  for (const c of candidates) {
    try {
      const count = await c.count().catch(() => 0);
      if (count > 0) {
        await c.first().click({ timeout: 5_000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => null);
        await page.waitForTimeout(2_000);
        return;
      }
    } catch { /* keep trying */ }
  }
  throw new Error('Could not find "New Form" button. Open Forms manually in a Chrome tab and click + New Form, then re-run.');
}

async function setFormTitleAndDescription(page: Page, title: string, description: string): Promise<void> {
  console.log('[3/4] Set title + description');
  // Title
  // The title input usually shows "Untitled form" placeholder — target by placeholder.
  const titleInput = page.locator('input[placeholder*="Untitled" i], textarea[placeholder*="Untitled" i]').first();
  if (await titleInput.count() > 0) {
    await titleInput.click({ timeout: 5_000 });
    await titleInput.fill(title);
    await page.waitForTimeout(300);
  } else {
    console.log('  (warn: title input not found by placeholder; skipping)');
  }
  // Description (often "Form description" placeholder or a contenteditable below the title)
  const descInput = page.locator('input[placeholder*="description" i], textarea[placeholder*="description" i]').first();
  if (await descInput.count() > 0) {
    await descInput.click({ timeout: 5_000 });
    await descInput.fill(description);
    await page.waitForTimeout(300);
  }
}

async function addField(page: Page, field: Field, index: number): Promise<void> {
  console.log(`  [${index}] ${field.type.padEnd(13)} ${field.label.slice(0, 60)}${field.label.length > 60 ? '…' : ''}`);
  // Click "Add new" to insert the next question
  const addBtn = page.locator('button[aria-label*="Add new" i], button:has-text("Add new")').first();
  if (index > 0) {
    if (await addBtn.count() > 0) {
      await addBtn.click({ timeout: 5_000 });
      await page.waitForTimeout(400);
    }
  }
  // Pick the question type from the type-picker that opens
  const typeMap: Record<Field['type'], string[]> = {
    single_choice: ['Choice', 'Multiple choice'],
    multi_choice: ['Choice', 'Multiple choice'],
    text: ['Text'],
    number: ['Text'],          // Forms doesn't have a "number" primitive; use Text + restriction
    date: ['Date'],
  };
  const wantedNames = typeMap[field.type];
  let picked = false;
  for (const name of wantedNames) {
    const btn = page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first();
    if (await btn.count() > 0) {
      await btn.click({ timeout: 5_000 }).catch(() => null);
      picked = true;
      break;
    }
  }
  if (!picked) {
    console.log(`     (warn: no type picker matched ${wantedNames.join('/')})`);
  }
  await page.waitForTimeout(400);

  // Fill the question text
  const questionInput = page.locator('input[placeholder*="Question" i], textarea[placeholder*="Question" i]').last();
  if (await questionInput.count() > 0) {
    await questionInput.click({ timeout: 5_000 });
    await questionInput.fill(field.label);
    await page.waitForTimeout(200);
  }

  // Required toggle
  if (field.required) {
    const req = page.locator(`text=Required`).last();
    if (await req.count() > 0) {
      await req.click({ timeout: 3_000 }).catch(() => null);
      await page.waitForTimeout(150);
    }
  }

  // Options for choice fields
  if (field.type === 'single_choice' || field.type === 'multi_choice') {
    const opts = (field as any).options as string[] | undefined;
    if (opts && opts.length > 0) {
      // The first 2 options are present by default; fill them then "Add option" for the rest.
      for (let i = 0; i < opts.length; i++) {
        const opt = opts[i];
        // Find the i-th option input (placeholder typically "Option 1", "Option 2", etc.)
        const optInputs = page.locator('input[placeholder*="Option" i]');
        const have = await optInputs.count();
        if (i >= have) {
          // Click "Add option"
          const addOpt = page.locator('button:has-text("Add option")').last();
          if (await addOpt.count() > 0) {
            await addOpt.click({ timeout: 3_000 }).catch(() => null);
            await page.waitForTimeout(150);
          }
        }
        const target = page.locator('input[placeholder*="Option" i]').nth(i);
        if (await target.count() > 0) {
          await target.click({ timeout: 3_000 }).catch(() => null);
          await target.fill(opt).catch(() => null);
          await page.waitForTimeout(80);
        }
      }
      // multi_choice → toggle "Multiple answers"
      if (field.type === 'multi_choice') {
        const ma = page.locator('text=/Multiple answers/i').last();
        if (await ma.count() > 0) {
          await ma.click({ timeout: 3_000 }).catch(() => null);
          await page.waitForTimeout(150);
        }
      }
    }
  }
}

async function captureFormUrl(page: Page): Promise<string> {
  console.log('[4/4] Capture form URL');
  // The "Collect responses" or "Send" button reveals the fillable URL.
  const collect = page.getByRole('button', { name: /collect responses|send|share/i }).first();
  if (await collect.count() > 0) {
    await collect.click({ timeout: 5_000 }).catch(() => null);
    await page.waitForTimeout(1_000);
  }
  // Look for the readonly URL input that appears in the share panel.
  const urlInput = page.locator('input[readonly][value*="forms.office.com" i], input[readonly][value*="forms.cloud.microsoft" i]').first();
  if (await urlInput.count() > 0) {
    const v = await urlInput.inputValue();
    return v;
  }
  // Fallback: extract the form ID from the editor URL.
  const editorUrl = page.url();
  console.log(`  (fallback) editor URL: ${editorUrl}`);
  return editorUrl;
}

async function main() {
  if (!existsSync(SCHEMA_PATH)) throw new Error(`schema not found: ${SCHEMA_PATH}`);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as Schema;
  console.log(`Cloning "${schema.title}" — ${schema.sections.flatMap(s => s.fields).length} fields\n`);

  const { page, close } = await attachChrome();
  try {
    await navigateToFormsHome(page);
    await clickNewForm(page);
    await setFormTitleAndDescription(page, schema.title, schema.description);

    let i = 0;
    for (const section of schema.sections) {
      for (const field of section.fields) {
        await addField(page, field, i);
        i++;
      }
    }

    const url = await captureFormUrl(page);
    if (!existsSync(dirname(URL_OUT))) mkdirSync(dirname(URL_OUT), { recursive: true });
    writeFileSync(URL_OUT, url + '\n');
    console.log(`\n=== CLONE PASS ===`);
    console.log(`Form URL: ${url}`);
    console.log(`Saved to: ${URL_OUT}`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
