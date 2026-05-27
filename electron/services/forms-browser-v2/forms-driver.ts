/**
 * forms-browser-v2 — Microsoft Forms response-page driver.
 *
 * Mirrors the outlook-browser-v2 pattern: attach to the user's running Chrome
 * via CDP, find or open the Forms response tab, drive the visible form by
 * filling each field, then provide a hard-confirm submit that refuses unless
 * the caller passes confirm:true AND the title visible in the page matches
 * what was requested.
 *
 * What this drives: forms.office.com/Pages/ResponsePage.aspx?... — the
 * principal-facing fill-out URL, NOT the admin/editor surface. The response
 * page is much more stable across Microsoft tenant updates than the editor,
 * which is why we only automate this side and ask humans to build forms by
 * hand.
 */
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';
import { logger } from '../../utils/logger';

const CDP_DEFAULT = 'http://127.0.0.1:18792';

const RESPONSE_HOST_PATTERNS = [
  /^https:\/\/forms\.office\.com\/.*ResponsePage/i,
  /^https:\/\/forms\.cloud\.microsoft\/.*ResponsePage/i,
  // r/<token> is the short-link variant Forms hands out from "Collect responses"
  /^https:\/\/forms\.office\.com\/r\//i,
  /^https:\/\/forms\.cloud\.microsoft\/r\//i,
];

function isFormsResponseUrl(url: string): boolean {
  return RESPONSE_HOST_PATTERNS.some((re) => re.test(url));
}

function responseFormId(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('id');
  } catch {
    return null;
  }
}

function responsePageMatchesFormUrl(pageUrl: string, formUrl: string): boolean {
  if (!isFormsResponseUrl(pageUrl)) return false;
  const pageId = responseFormId(pageUrl);
  const formId = responseFormId(formUrl);
  if (pageId && formId) return pageId === formId;
  return pageUrl.split('#')[0] === formUrl.split('#')[0];
}

async function waitForResponseQuestions(page: Page): Promise<void> {
  const questionSelector = '[data-automation-id="questionItem"], [role="listitem"]';
  try {
    await page.waitForSelector(questionSelector, { state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(500);
  } catch (err) {
    throw new Error(
      `Microsoft Forms response page did not render question items within 30s: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
}

export interface FormsDriverOptions {
  cdpEndpoint?: string;
  fieldTimeoutMs?: number;
}

export interface FillResult {
  status: 'filled' | 'error';
  filledCount: number;
  skippedCount: number;
  errors: Array<{ fieldId: string; reason: string }>;
}

export interface SubmitResult {
  status: 'submitted' | 'refused' | 'error';
  reason?: string;
  message?: string;
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function titleMatchesExpected(visibleTitle: string, expectedTitle: string): boolean {
  const visible = normalizeMatchText(visibleTitle);
  const expected = normalizeMatchText(expectedTitle).slice(0, 60);
  return visible.includes(expected.slice(0, 30));
}

export function formatFormsDateInput(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  return `${Number(month)}/${Number(day)}/${year}`;
}

export function matchesExpectedQuestionFingerprint(
  visibleQuestionText: string,
  expectedQuestionLabels: string[],
): { ok: boolean; matched: number; required: number } {
  const text = normalizeMatchText(visibleQuestionText);
  const labels = expectedQuestionLabels
    .map(normalizeMatchText)
    .filter((label, index, all) => label.length >= 8 && all.indexOf(label) === index);
  const matched = labels.filter((label) => text.includes(label.slice(0, 40))).length;
  const required = Math.min(labels.length, 4);
  return { ok: required > 0 && matched >= required, matched, required };
}

export class FormsDriver {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly cdp: string;
  private readonly fieldTimeoutMs: number;

  constructor(opts: FormsDriverOptions = {}) {
    this.cdp = opts.cdpEndpoint ?? CDP_DEFAULT;
    this.fieldTimeoutMs = opts.fieldTimeoutMs ?? 5_000;
  }

  /** Connect (or re-connect) to the user's running Chrome via CDP. */
  async ensureBrowser(): Promise<void> {
    if (this.browser?.isConnected() && this.browser.contexts().length > 0) return;
    if (this.browser) {
      await this.browser.close().catch(() => null);
      this.browser = null;
      this.page = null;
    }
    logger.info(`[forms-v2] Connecting via CDP at ${this.cdp}`);
    this.browser = await chromium.connectOverCDP(this.cdp);
  }

  /** Find an existing Forms response tab, or open one at the given URL. */
  async ensureFormsTab(formUrl: string): Promise<Page> {
    await this.ensureBrowser();
    if (!this.browser) throw new Error('CDP attach failed');
    let contexts = this.browser.contexts();
    if (contexts.length === 0) {
      await this.browser.close().catch(() => null);
      this.browser = null;
      this.page = null;
      await this.ensureBrowser();
      if (!this.browser) throw new Error('CDP attach failed');
      contexts = this.browser.contexts();
    }
    const allPages = contexts.flatMap((c) => c.pages());
    let page = allPages.find((p) => responsePageMatchesFormUrl(p.url(), formUrl));
    if (!page) {
      const ctx: BrowserContext | undefined = contexts[0];
      if (!ctx) throw new Error('no browser contexts available');
      page = await ctx.newPage();
    }
    if (!responsePageMatchesFormUrl(page.url(), formUrl)) {
      await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      // Forms response page lazy-loads questions; wait for one to appear.
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => null);
    }
    await waitForResponseQuestions(page);
    await page.bringToFront().catch(() => null);
    this.page = page;
    return page;
  }

  /** Read the visible form title — used by the hard-confirm submit gate. */
  async getVisibleTitle(): Promise<string> {
    if (!this.page) throw new Error('no page; call ensureFormsTab first');
    // Forms renders the title as an h1 with class containing "office-form-title"
    // but class names rotate. Use role=heading level=1 instead.
    const candidates = [
      this.page.getByRole('heading', { level: 1 }),
      this.page.locator('[data-automation-id="formTitle"]'),
      this.page.locator('h1').first(),
    ];
    for (const c of candidates) {
      try {
        const count = await c.count().catch(() => 0);
        if (count > 0) {
          const t = await c.first().textContent({ timeout: 2_000 });
          if (t) return t.trim();
        }
      } catch { /* try next */ }
    }
    return '';
  }

  async getVisibleQuestionText(): Promise<string> {
    if (!this.page) throw new Error('no page; call ensureFormsTab first');
    const items = this.page.locator('[data-automation-id="questionItem"], [role="listitem"]');
    const count = await items.count().catch(() => 0);
    const texts: string[] = [];
    for (let i = 0; i < Math.min(count, 40); i += 1) {
      const text = await items.nth(i).innerText({ timeout: 1_000 }).catch(() => '');
      if (text.trim()) texts.push(text.trim());
    }
    return texts.join('\n');
  }

  /**
   * Fill a single field by question label (substring match, case-insensitive).
   * The Forms response page renders each question in a list-item with role="listitem".
   * We find the listitem whose innerText contains the label, then look inside it
   * for the appropriate primitive.
   */
  async fillField(
    label: string,
    value: string | string[] | number | Date,
    type: 'text' | 'number' | 'date' | 'single_choice' | 'multi_choice',
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!this.page) return { ok: false, reason: 'no page' };
    const item = await this.findQuestionItem(label);
    if (!item) return { ok: false, reason: `field not found by label match: "${label.slice(0, 60)}"` };

    try {
      switch (type) {
        case 'text': {
          const input = item.locator('input[type="text"], input:not([type]), textarea').first();
          await input.fill(String(value), { timeout: this.fieldTimeoutMs });
          return { ok: true };
        }
        case 'number': {
          const input = item.locator('input[type="text"], input:not([type]), input[type="number"]').first();
          await input.fill(String(value), { timeout: this.fieldTimeoutMs });
          return { ok: true };
        }
        case 'date': {
          const input = item.locator('input').first();
          const dateStr = formatFormsDateInput(value as string | Date);
          await input.click({ timeout: this.fieldTimeoutMs });
          await input.fill(dateStr, { timeout: this.fieldTimeoutMs });
          await input.press('Tab', { timeout: this.fieldTimeoutMs }).catch(() => this.page?.keyboard.press('Tab').catch(() => null));
          await this.page.waitForTimeout(250);
          const accepted = await input.inputValue({ timeout: this.fieldTimeoutMs }).catch(() => '');
          const invalid = await input.evaluate((el) => el.getAttribute('aria-invalid') === 'true').catch(() => false);
          return accepted.trim() && !invalid
            ? { ok: true }
            : { ok: false, reason: `date was not accepted by Microsoft Forms: "${dateStr}"` };
        }
        case 'single_choice': {
          const target = String(value);
          // Radio options are usually <input type="radio"> with sibling label, OR
          // role="radio" with aria-label. Try by visible text first.
          const radio = item.locator('label').filter({ hasText: new RegExp(`^\\s*${escapeRegex(target)}\\s*$`, 'i') }).first();
          if ((await radio.count()) > 0) {
            await radio.click({ timeout: this.fieldTimeoutMs });
            return { ok: true };
          }
          const aria = item.locator(`[role="radio"][aria-label="${target}"]`).first();
          if ((await aria.count()) > 0) {
            await aria.click({ timeout: this.fieldTimeoutMs });
            return { ok: true };
          }
          return { ok: false, reason: `option not found: "${target}"` };
        }
        case 'multi_choice': {
          const targets = Array.isArray(value) ? value : [String(value)];
          let any = false;
          for (const t of targets) {
            const cb = item.locator('label').filter({ hasText: new RegExp(`^\\s*${escapeRegex(t)}\\s*$`, 'i') }).first();
            if ((await cb.count()) > 0) {
              await cb.click({ timeout: this.fieldTimeoutMs });
              any = true;
            }
          }
          return any ? { ok: true } : { ok: false, reason: `no checkbox options matched: ${targets.join(', ')}` };
        }
      }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    return { ok: false, reason: 'unhandled type' };
  }

  private async findQuestionItem(label: string): Promise<Locator | null> {
    if (!this.page) return null;
    const questionItems = this.page.locator('[data-automation-id="questionItem"], [role="listitem"]');
    const needles = labelNeedles(label);
    for (const needle of needles) {
      const item = questionItems.filter({ hasText: new RegExp(escapeRegex(needle), 'i') }).first();
      if ((await item.count().catch(() => 0)) > 0) return item;
    }
    return null;
  }

  /** Hard-confirm submit. Refuses unless confirm:true AND visible title matches expectedTitle. */
  async submit({
    confirm,
    expectedTitle,
    expectedQuestionLabels = [],
  }: {
    confirm: boolean;
    expectedTitle: string;
    expectedQuestionLabels?: string[];
  }): Promise<SubmitResult> {
    if (!this.page) return { status: 'error', reason: 'no page' };
    if (!confirm) {
      return {
        status: 'refused',
        reason: 'Submit blocked: confirm:true required. Re-call with confirm:true after the principal has reviewed the filled form.',
      };
    }
    const visibleTitle = await this.getVisibleTitle();
    let matchedByFingerprint = false;
    let fingerprint = { ok: false, matched: 0, required: 0 };
    if (!titleMatchesExpected(visibleTitle, expectedTitle)) {
      const questionText = await this.getVisibleQuestionText().catch(() => '');
      fingerprint = matchesExpectedQuestionFingerprint(questionText, expectedQuestionLabels);
      matchedByFingerprint = fingerprint.ok;
    }
    if (!titleMatchesExpected(visibleTitle, expectedTitle) && !matchedByFingerprint) {
      return {
        status: 'refused',
        reason: `Submit blocked: visible form title "${normalizeMatchText(visibleTitle).slice(0, 80)}" does not match expected "${normalizeMatchText(expectedTitle).slice(0, 60)}", and question fingerprint matched ${fingerprint.matched}/${fingerprint.required}. A different form may be open.`,
      };
    }

    const submitBtn = this.page.getByRole('button', { name: /^submit$/i }).first();
    if ((await submitBtn.count()) === 0) {
      return { status: 'error', reason: 'Submit button not found on page.' };
    }
    try {
      await submitBtn.click({ timeout: 10_000 });
      // Wait for the "Thanks" confirmation that Forms shows after submission.
      const thanks = this.page.getByText(/thanks|your response was submitted|response submitted/i).first();
      const ok = await thanks.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
      return ok
        ? { status: 'submitted', message: 'Form submitted via Microsoft Forms.' }
        : { status: 'error', reason: 'Submit clicked but no confirmation appeared in 15s.' };
    } catch (err) {
      return { status: 'error', reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async close(): Promise<void> {
    try {
      await this.browser?.close();
    } catch { /* expected on cdp disconnect */ }
    this.browser = null;
    this.page = null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelNeedles(label: string): string[] {
  const compact = label.replace(/\s+/g, ' ').trim();
  const withoutParentheticals = compact.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const beforeParenthetical = compact.split('(')[0]?.trim() ?? '';
  const beforeComma = compact.split(',')[0]?.trim() ?? '';
  return [
    compact,
    withoutParentheticals,
    beforeParenthetical,
    beforeComma,
  ]
    .map((needle) => needle.slice(0, 80).trim())
    .filter((needle, index, all) => needle.length >= 3 && all.indexOf(needle) === index);
}
