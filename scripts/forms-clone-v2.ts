/**
 * forms-clone-v2: Clone the MoE Suspensions form using REAL Forms editor selectors
 * (probed live, not guessed).
 *
 * Real selectors discovered via scripts/forms-probe-dom.ts:
 *   - Title editor:   [data-automation-id="formTitleContainer"] → click → fills formMainTitle
 *   - Add-question:   [data-automation-id="questionAdd"] is the visible "+ Add new" container
 *   - Question types: buttons with aria-label="Choice" / "Text" / "Date" / "Section"
 *
 * After clicking a type, Forms inserts a question with:
 *   - A title input (placeholder "Question")
 *   - For Choice: option inputs (placeholders "Option 1", "Option 2")
 *   - "+ Add option" button
 *   - "Multiple answers" toggle for multi_choice
 *   - "Required" toggle (per-question footer)
 *
 * Run:
 *   pnpm exec tsx scripts/forms-clone-v2.ts
 *
 * Result: writes the form URL to extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt
 */
import { chromium, type Page } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SCHEMA = join(process.cwd(), 'extensions/moe-principal-assistant/forms/suspensions-schema.json');
const URL_OUT = join(process.cwd(), 'extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt');
const CDP = process.env.CLAWX_CDP_ENDPOINT ?? 'http://127.0.0.1:18792';

interface Field {
  id: string;
  label: string;
  subtitle?: string;
  type: 'text' | 'number' | 'date' | 'single_choice' | 'multi_choice';
  required?: boolean;
  options?: string[];
  showWhen?: Record<string, string>;
}

interface Schema {
  title: string;
  description: string;
  sections: Array<{ name: string; fields: Field[] }>;
}

async function attach(): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser = await chromium.connectOverCDP(CDP);
  const all = browser.contexts().flatMap((c) => c.pages());
  const designPages = all.filter((p) => /forms\.office\.com\/Pages\/DesignPageV2/i.test(p.url()));
  if (designPages.length === 0) throw new Error('No Forms design tab. Open https://forms.office.com/ + click + New Form first.');
  // Prefer one with id= query (real form, not chooser)
  const page = designPages.find((p) => /[?&]id=/.test(p.url())) ?? designPages[0];
  console.log(`Using: ${page.url().slice(0, 120)}`);
  await page.bringToFront();
  return { page, close: async () => { try { await browser.close(); } catch { /* */ } } };
}

async function setTitle(page: Page, title: string, description: string) {
  console.log(`[title] "${title}"`);
  // Click the title container — opens an editable contenteditable div with
  // aria-label="Form title". Forms uses contenteditable everywhere, NOT
  // <input>, so we type via keyboard rather than .fill().
  await page.locator('[data-automation-id="formTitleContainer"]').click({ timeout: 5_000 });
  await page.waitForTimeout(500);
  // The contenteditable is now focused. Select-all and replace.
  await page.keyboard.press('Meta+A').catch(() => null);
  await page.keyboard.press('Control+A').catch(() => null);
  await page.waitForTimeout(80);
  await page.keyboard.type(title, { delay: 5 });
  await page.waitForTimeout(300);
  // Tab to the next editable region — Forms tends to put description there.
  await page.keyboard.press('Tab').catch(() => null);
  await page.waitForTimeout(300);
  // Type description into whatever is now active
  const activeAria = await page.evaluate(`document.activeElement && document.activeElement.getAttribute('aria-label')`);
  if (typeof activeAria === 'string' && /description/i.test(activeAria)) {
    await page.keyboard.press('Meta+A').catch(() => null);
    await page.keyboard.press('Control+A').catch(() => null);
    await page.keyboard.type(description, { delay: 5 });
    await page.waitForTimeout(200);
  }
  // Click somewhere neutral so the title editor closes
  await page.locator('body').click({ position: { x: 10, y: 10 }, timeout: 2_000 }).catch(() => null);
  await page.waitForTimeout(300);
}

/** Click "+ Add new" then choose the desired question type. */
async function addQuestionOfType(page: Page, formsType: 'Choice' | 'Text' | 'Date' | 'Section') {
  // The questionAdd container shows the type buttons inline. Sometimes we need
  // to click "+ Add new" first to expose them; sometimes they're already visible
  // (after the very first type-picker click).
  const typeBtn = page.locator(`[data-automation-id="questionAdd"]`).getByRole('button', { name: new RegExp(`^${formsType}$`) }).first();
  if ((await typeBtn.count()) > 0) {
    await typeBtn.click({ timeout: 5_000 });
    await page.waitForTimeout(500);
    return;
  }
  // Fallback: any button with that exact aria-label anywhere
  const anyBtn = page.getByRole('button', { name: new RegExp(`^${formsType}$`) }).first();
  if ((await anyBtn.count()) > 0) {
    await anyBtn.click({ timeout: 5_000 });
    await page.waitForTimeout(500);
    return;
  }
  throw new Error(`Could not find "${formsType}" type button`);
}

/** Fill the most-recently-added question's title (contenteditable). */
async function fillQuestionTitle(page: Page, label: string) {
  await page.waitForTimeout(400);
  // The newly-inserted question's title editor is auto-focused by Forms.
  // It's a contenteditable div with aria-label like "Question title" or "Question text".
  const activeAria = await page.evaluate(`document.activeElement && document.activeElement.getAttribute('aria-label')`);
  if (typeof activeAria === 'string' && /question/i.test(activeAria)) {
    await page.keyboard.press('Meta+A').catch(() => null);
    await page.keyboard.press('Control+A').catch(() => null);
    await page.keyboard.type(label, { delay: 3 });
    return;
  }
  // Fallback: click the last "Question" contenteditable
  const last = page.locator('[contenteditable="true"][aria-label*="Question" i]').last();
  if ((await last.count()) > 0) {
    await last.click({ timeout: 3_000 });
    await page.keyboard.press('Meta+A').catch(() => null);
    await page.keyboard.press('Control+A').catch(() => null);
    await page.keyboard.type(label, { delay: 3 });
  }
}

async function fillChoiceOptions(page: Page, options: string[], multiAnswer: boolean) {
  // Options are also contenteditables. After a Choice question is created,
  // Forms gives you 2 default options and an "Add option" affordance.
  // Strategy: tab from the question title to the first option, type, then
  // Enter to create the next one (Forms supports Enter-to-add for options).
  for (let i = 0; i < options.length; i++) {
    if (i === 0) {
      // Tab from question title into the first option editor
      await page.keyboard.press('Tab').catch(() => null);
      await page.waitForTimeout(100);
    } else {
      // Enter key on a focused option creates a new option below
      await page.keyboard.press('Enter').catch(() => null);
      await page.waitForTimeout(80);
    }
    await page.keyboard.press('Meta+A').catch(() => null);
    await page.keyboard.press('Control+A').catch(() => null);
    await page.keyboard.type(options[i], { delay: 2 });
  }
  if (multiAnswer) {
    // After all options are typed, find the "Multiple answers" toggle for this question.
    const ma = page.locator('[role="switch"]').filter({ hasText: /multiple/i }).last();
    if ((await ma.count()) > 0) {
      await ma.click({ timeout: 2_000 }).catch(() => null);
    } else {
      const lbl = page.getByText(/Multiple answers/i).last();
      if ((await lbl.count()) > 0) await lbl.click({ timeout: 2_000 }).catch(() => null);
    }
  }
}

async function setRequired(page: Page) {
  // Per-question footer has a "Required" toggle. Find the most recent one.
  const req = page.locator('button[role="switch"]').filter({ hasText: /required/i }).last();
  if ((await req.count()) > 0) {
    await req.click({ timeout: 2_000 }).catch(() => null);
    return;
  }
  const lbl = page.getByText(/^Required$/).last();
  if ((await lbl.count()) > 0) {
    await lbl.click({ timeout: 2_000 }).catch(() => null);
  }
}

async function addField(page: Page, field: Field, indexInForm: number) {
  console.log(`  [${indexInForm}] ${field.type.padEnd(13)} ${field.label.slice(0, 60)}${field.label.length > 60 ? '…' : ''}`);
  // Map our schema types → Forms editor types
  const formsType: 'Choice' | 'Text' | 'Date' =
    field.type === 'date' ? 'Date'
    : field.type === 'single_choice' || field.type === 'multi_choice' ? 'Choice'
    : 'Text';
  await addQuestionOfType(page, formsType);
  await fillQuestionTitle(page, field.label);
  if (field.type === 'single_choice' || field.type === 'multi_choice') {
    if (field.options && field.options.length > 0) {
      await fillChoiceOptions(page, field.options, field.type === 'multi_choice');
    }
  }
  if (field.required) {
    await setRequired(page);
  }
  await page.waitForTimeout(200);
}

async function captureUrl(page: Page): Promise<string> {
  // Click "Collect responses" → modal opens with a readonly URL input
  const collect = page.getByRole('button', { name: /collect responses/i }).first();
  if ((await collect.count()) > 0) {
    await collect.click({ timeout: 5_000 }).catch(() => null);
    await page.waitForTimeout(1_500);
  }
  // Look for an input/textarea that contains a forms URL
  const urlInput = page
    .locator('input[readonly], textarea[readonly], input[value*="forms.office.com" i], input[value*="forms.cloud.microsoft" i]')
    .first();
  if ((await urlInput.count()) > 0) {
    const v = await urlInput.inputValue().catch(() => '');
    if (v && /forms\./i.test(v)) return v;
  }
  // Fallback: read clipboard if a Copy button was clicked, else editor URL
  return page.url();
}

async function main() {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8')) as Schema;
  const allFields = schema.sections.flatMap((s) => s.fields);
  console.log(`Cloning "${schema.title}" — ${allFields.length} fields\n`);

  const { page, close } = await attach();
  try {
    await setTitle(page, schema.title, schema.description);

    let i = 0;
    for (const field of allFields) {
      try {
        await addField(page, field, i);
      } catch (err) {
        console.log(`     ✗ ${err instanceof Error ? err.message : String(err)}`);
      }
      i++;
    }

    const url = await captureUrl(page);
    if (!existsSync(dirname(URL_OUT))) mkdirSync(dirname(URL_OUT), { recursive: true });
    writeFileSync(URL_OUT, url + '\n');
    console.log(`\n=== CLONE DONE ===\nForm URL written to ${URL_OUT}:\n  ${url}`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
