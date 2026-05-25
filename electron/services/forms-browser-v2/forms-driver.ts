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
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { logger } from '../../utils/logger';

const CDP_DEFAULT = 'http://127.0.0.1:18792';

const RESPONSE_HOST_PATTERNS = [
  /^https:\/\/forms\.office\.com\/.*ResponsePage/i,
  /^https:\/\/forms\.cloud\.microsoft\/.*ResponsePage/i,
  // r/<token> is the short-link variant Forms hands out from "Collect responses"
  /^https:\/\/forms\.office\.com\/r\//i,
  /^https:\/\/forms\.cloud\.microsoft\/r\//i,
];

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
    if (this.browser) return;
    logger.info(`[forms-v2] Connecting via CDP at ${this.cdp}`);
    this.browser = await chromium.connectOverCDP(this.cdp);
  }

  /** Find an existing Forms response tab, or open one at the given URL. */
  async ensureFormsTab(formUrl: string): Promise<Page> {
    await this.ensureBrowser();
    if (!this.browser) throw new Error('CDP attach failed');
    const allPages = this.browser.contexts().flatMap((c) => c.pages());
    let page = allPages.find((p) => RESPONSE_HOST_PATTERNS.some((re) => re.test(p.url())));
    if (!page) {
      const ctx: BrowserContext | undefined = this.browser.contexts()[0];
      if (!ctx) throw new Error('no browser contexts available');
      page = await ctx.newPage();
    }
    if (page.url() !== formUrl) {
      await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      // Forms response page lazy-loads questions; wait for one to appear.
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => null);
      await page.waitForTimeout(1_500);
    }
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
    const labelLc = label.toLowerCase().slice(0, 80);
    // Each question is in a list item; find by visible text.
    const item = this.page.locator('[role="listitem"]').filter({ hasText: new RegExp(escapeRegex(labelLc.slice(0, 40)), 'i') }).first();
    const found = await item.count().catch(() => 0);
    if (found === 0) return { ok: false, reason: `field not found by label match: "${label.slice(0, 60)}"` };

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
          // Forms shows a date picker; an ISO YYYY-MM-DD typed into the visible
          // input gets parsed correctly on most locales.
          const input = item.locator('input').first();
          const dateStr =
            value instanceof Date
              ? value.toISOString().slice(0, 10)
              : String(value);
          await input.click({ timeout: this.fieldTimeoutMs });
          await input.fill(dateStr, { timeout: this.fieldTimeoutMs });
          // Press Escape to dismiss the calendar popover.
          await this.page.keyboard.press('Escape').catch(() => null);
          return { ok: true };
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

  /** Hard-confirm submit. Refuses unless confirm:true AND visible title matches expectedTitle. */
  async submit({
    confirm,
    expectedTitle,
  }: {
    confirm: boolean;
    expectedTitle: string;
  }): Promise<SubmitResult> {
    if (!this.page) return { status: 'error', reason: 'no page' };
    if (!confirm) {
      return {
        status: 'refused',
        reason: 'Submit blocked: confirm:true required. Re-call with confirm:true after the principal has reviewed the filled form.',
      };
    }
    const visible = (await this.getVisibleTitle()).toLowerCase();
    const expected = expectedTitle.toLowerCase().slice(0, 60);
    if (!visible.includes(expected.slice(0, 30))) {
      return {
        status: 'refused',
        reason: `Submit blocked: visible form title "${visible.slice(0, 80)}" does not match expected "${expected.slice(0, 60)}". A different form may be open.`,
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
