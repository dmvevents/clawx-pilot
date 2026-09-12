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
import { CHROME_CDP_ENDPOINT, ensureChromeCdpReady, verifyCdpEndpointOwnershipForAttach } from '../chrome-cdp';

const CDP_DEFAULT = CHROME_CDP_ENDPOINT;

const RESPONSE_HOST_PATTERNS = [
  /^https:\/\/forms\.office\.com\/.*ResponsePage/i,
  /^https:\/\/forms\.cloud\.microsoft\/.*ResponsePage/i,
  // r/<token> is the short-link variant Forms hands out from "Collect responses"
  /^https:\/\/forms\.office\.com\/r\//i,
  /^https:\/\/forms\.cloud\.microsoft\/r\//i,
];

const MICROSOFT_AUTHENTICATED_PAGE_PATTERNS = [
  /^https:\/\/forms\.office\.com\//i,
  /^https:\/\/forms\.cloud\.microsoft\//i,
  /^https:\/\/outlook\.office\.com\//i,
  /^https:\/\/outlook\.office365\.com\//i,
  /^https:\/\/outlook\.cloud\.microsoft\//i,
];

const SUBMIT_CONFIRMATION_RE = /thanks|thank you|your response (?:has been|was)(?: successfully)? submitted|response (?:has been|was)(?: successfully)? submitted|submit another response|response has been recorded/i;
const SUBMIT_VALIDATION_RE = /this question is required|please answer|enter a valid|invalid answer|required question/i;

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

function contextHasMicrosoftSession(context: BrowserContext): boolean {
  return context.pages().some((page) => MICROSOFT_AUTHENTICATED_PAGE_PATTERNS.some((re) => re.test(page.url())));
}

function chooseFormsContext(contexts: BrowserContext[], formUrl: string): BrowserContext | undefined {
  return contexts.find((ctx) => ctx.pages().some((page) => responsePageMatchesFormUrl(page.url(), formUrl)))
    ?? contexts.find(contextHasMicrosoftSession)
    ?? contexts[0];
}

async function waitForResponseQuestions(page: Page): Promise<void> {
  const questionSelector = '[data-automation-id="questionItem"], [role="listitem"]';
  try {
    await page.waitForSelector(questionSelector, { state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(500);
  } catch (err) {
    const pageDiagnosis = await diagnoseFormsLoadPage(page);
    if (pageDiagnosis) {
      throw new Error(pageDiagnosis, { cause: err });
    }
    throw new Error(
      `Microsoft Forms response page did not render question items within 30s: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
}

function summarizePageLocation(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'unknown page';
  }
}

async function diagnoseFormsLoadPage(page: Page): Promise<string | null> {
  const url = page.url();
  const location = summarizePageLocation(url);
  const title = (await page.title().catch(() => '')).trim();
  const body = (await page.locator('body').innerText({ timeout: 1_500 }).catch(() => '')).replace(/\s+/g, ' ').trim();
  const visibleText = `${title}\n${body}`;

  if (/login\.microsoftonline\.com/i.test(url) || /sign in to your account|can't access your account|sign-in options/i.test(visibleText)) {
    return `Microsoft Forms sign-in required before questions can render. Chrome landed on ${location} with title "${title || 'unknown'}". Sign in to Microsoft in the Chrome profile that Ministry of Education opened, then retry the form preview.`;
  }

  if (/you don't have permission|access denied|request access|account doesn't have access|not authorized/i.test(visibleText)) {
    return `Microsoft Forms access blocked before questions could render. Chrome landed on ${location} with title "${title || 'unknown'}". Confirm the signed-in Microsoft account has permission to respond to this form.`;
  }

  return null;
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

export interface FieldInspection {
  visible: boolean;
  hasValue: boolean;
  required: boolean;
  text: string;
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

/** Comparable option text: NBSP/whitespace collapsed, case-insensitive. */
export function normalizeChoiceText(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Escape a value for use inside a CSS attribute selector's double quotes.
 * Review lane B (2026-09-11): `[role="radio"][aria-label="${target}"]` built a
 * selector by concatenation, so option text taken from a principal's document
 * could close the quote and append another selector — a value shaped like
 * `x"], [role="button"][aria-label="Submit` turned a fill into a Submit click,
 * bypassing the confirmation gate. Every attribute value interpolated into a
 * selector in this file goes through here.
 */
export function cssAttrValue(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    // A CSS string cannot contain a raw line break: escape rather than let the
    // selector fail to parse (review lane B nit).
    .replace(/\r/g, '\\00000d')
    .replace(/\n/g, '\\00000a');
}

/** True when the control's visible value is exactly the wanted option (per line/segment, never a substring). */
export function valueEchoesTarget(shown: string, want: string): boolean {
  if (!want) return false;
  const segments = String(shown ?? '')
    .split(/\n|•|\|/)
    .map((part) => normalizeChoiceText(part))
    .filter(Boolean);
  return segments.includes(want);
}

async function readComboboxValue(item: Locator): Promise<string> {
  for (const sel of ['[role="combobox"]', 'input[role="combobox"]', '[aria-selected="true"]', '[data-automation-id*="dropdown" i]']) {
    const el = item.locator(sel).first();
    if ((await el.count().catch(() => 0)) === 0) continue;
    const text = await el.innerText({ timeout: 500 }).catch(() => '');
    if (text.trim()) return text;
    const value = await el.inputValue({ timeout: 500 }).catch(() => '');
    if (value.trim()) return value;
  }
  return '';
}

export type DropdownChoiceResult = { ok: boolean; reason?: string; via?: 'select' | 'combobox' | 'virtualized-radio' };

/**
 * CLWX-62 — select an option from a LARGE single-choice question whose radio
 * list is virtualized.
 *
 * Observed live on the production Daily Report (2026-09-11, installed moe.36):
 * "Name of school" has 454 options in the schema but renders as ~80
 * `input[type=radio]` elements at a time, each wrapped in a `<label>` whose
 * text is exactly the school name, with an EMPTY aria-label and
 * `aria-labelledby="QuestionChoiceOptionNN"`. There is no combobox, no
 * `<select>`, no listbox, and no scroll container inside the question item
 * (its scrollHeight equals its clientHeight); the window of rendered options
 * changes as the PAGE scrolls across the question's 4000px extent. So the
 * pre-existing aria-label tier could never match, and the target option is
 * usually not in the DOM at all when filling starts.
 *
 * Strategy: try the rendered window first; then walk the page through the
 * question's vertical extent in viewport-sized steps, re-querying for a label
 * whose full text equals the target after each step. On a match, click the
 * label and verify the associated radio reports checked. Bounded passes, and
 * the original scroll position is restored on every exit.
 */
export async function selectVirtualizedRadioChoice(
  page: Page,
  item: Locator,
  target: string,
  timeoutMs: number,
): Promise<DropdownChoiceResult> {
  const want = normalizeChoiceText(target);
  if (!want) return { ok: false, reason: 'empty option value' };
  const anchored = new RegExp(`^\\s*${escapeRegex(target)}\\s*$`, 'i');
  const originalScroll = await page.evaluate(() => window.scrollY).catch(() => 0);
  const restore = async () => {
    await page.evaluate((y) => window.scrollTo(0, y), originalScroll).catch(() => null);
  };

  // Review lane B (MINOR-2): scope the option search to the ONE radiogroup this
  // question owns when it exposes one. `findQuestionItem` can resolve a
  // container spanning several questions (the getByRole('listitem') tier
  // matches implicit roles), and that container is the only route by which
  // another question's option could be clicked. More than one radiogroup means
  // the item is over-scoped: refuse rather than guess.
  const radiogroups = item.locator('[role="radiogroup"]');
  const groupCount = await radiogroups.count().catch(() => 0);
  let scope = item;
  if (groupCount === 1) {
    scope = radiogroups.first();
  } else if (groupCount > 1) {
    // Review lane B (NIT-A): refusing outright conflated two different things —
    // an over-scoped item spanning several questions, and one question that
    // legitimately renders more than one radiogroup. Resolve it by the target:
    // exactly one group offering this option is unambiguous, so use it. Zero or
    // several is genuinely ambiguous and still refuses.
    const owning: number[] = [];
    for (let i = 0; i < groupCount; i += 1) {
      const n = await radiogroups.nth(i).locator('label').filter({ hasText: anchored }).count().catch(() => 0);
      if (n > 0) owning.push(i);
    }
    if (owning.length === 1) {
      scope = radiogroups.nth(owning[0]);
    } else {
      return {
        ok: false,
        reason: `question scope is ambiguous (${groupCount} radiogroups resolved, `
          + `${owning.length} offer this option) for "${target}"`,
      };
    }
  }
  const optionCount = async () => scope.locator('input[type="radio"], [role="radio"]').count().catch(() => 0);

  const verifySelection = async (): Promise<DropdownChoiceResult> => {
    // Verify by RE-RESOLVING inside the question scope, never through the handle
    // that was clicked (review lane B, MINOR-A and MINOR-D):
    //  - the virtualizer detaches the clicked element when it re-renders the
    //    window to show the selection, so probing that handle threw and produced
    //    a false negative on a selection that had actually worked;
    //  - a descendant-only lookup misses a radio associated by `for=` or
    //    aria-labelledby rather than wrapped by its label, which now matters for
    //    EVERY choice question because this walk is the first tier.
    // Asking the scope "which option is selected, and is it the one I wanted"
    // answers both, independently of how label and input are associated.
    const selected = await scope
      .evaluate((root) => {
        const checked = Array.from(root.querySelectorAll('input[type="radio"], [role="radio"]')).filter(
          (r) => (r as HTMLInputElement).checked === true || r.getAttribute('aria-checked') === 'true',
        );
        if (checked.length === 0) return { count: 0, text: null };
        // The document-scoped fallbacks are guarded so this same function is
        // exercisable outside a browser (the review found the test fake never ran
        // it at all).
        const doc: Document | null = typeof document === 'undefined' ? null : document;
        const esc = (v: string) => v.replace(/["\\]/g, '\\$&');
        const labelTextFor = (radio: Element): string => {
          const wrapping = radio.closest('label');
          if (wrapping && (wrapping.textContent || '').trim()) return (wrapping.textContent || '').trim();
          const id = radio.getAttribute('id');
          if (id) {
            const byFor = root.querySelector(`label[for="${esc(id)}"]`)
              ?? (doc ? doc.querySelector(`label[for="${esc(id)}"]`) : null);
            if (byFor && (byFor.textContent || '').trim()) return (byFor.textContent || '').trim();
          }
          const labelledBy = radio.getAttribute('aria-labelledby');
          if (labelledBy) {
            const parts = labelledBy
              .split(/\s+/)
              .map((ref) => root.querySelector(`[id="${esc(ref)}"]`) ?? (doc ? doc.getElementById(ref) : null))
              .filter(Boolean);
            const text = parts.map((el) => (el as Element).textContent || '').join(' ').trim();
            if (text) return text;
          }
          const aria = radio.getAttribute('aria-label');
          if (aria && aria.trim()) return aria.trim();
          const parent = radio.parentElement;
          return parent ? (parent.textContent || '').trim() : '';
        };
        return { count: checked.length, text: labelTextFor(checked[0]) };
      })
      .catch(() => null);
    // Review lane B (MAJOR-2): an UNVERIFIABLE selection is a failure, never a pass.
    if (!selected) {
      return { ok: false, reason: `option "${target}" was clicked but the selection could not be read back` };
    }
    if (selected.count === 0) {
      return { ok: false, reason: `option "${target}" was clicked but no option in this question reports selected` };
    }
    if (selected.count > 1) {
      return { ok: false, reason: `option "${target}" was clicked but ${selected.count} options report selected` };
    }
    if (normalizeChoiceText(selected.text) !== want) {
      return {
        ok: false,
        reason: `option "${target}" was clicked but the question now reports a different selection`,
      };
    }
    return { ok: true, via: 'virtualized-radio' };
  };

  const tryClickRendered = async (): Promise<DropdownChoiceResult | null> => {
    // Match on NORMALIZED text, not on the anchored regex alone (review lane A):
    // Playwright tests a RegExp against the element's raw text, so one non-breaking
    // space or one doubled inner space in a school name produces "option not found"
    // for an option that is right there — a message indistinguishable from a genuine
    // absence, which is exactly the message the live run returned. The regex stays as
    // a cheap prefilter; the decision is normalized equality.
    const label = scope.locator('label').filter({ hasText: anchored });
    const count = await label.count().catch(() => 0);
    if (count === 0) {
      const normalizedIndexes = await scope
        .evaluate(
          (root, wanted) => {
            const norm = (v: string) => v.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            const out: number[] = [];
            const labels = Array.from(root.querySelectorAll('label'));
            labels.forEach((el, i) => {
              if (norm(el.textContent || '') === wanted) out.push(i);
            });
            return out;
          },
          want,
        )
        .catch(() => null);
      if (!normalizedIndexes || normalizedIndexes.length === 0) return null;
      if (normalizedIndexes.length > 1) {
        return { ok: false, reason: `ambiguous option (${normalizedIndexes.length} labels match exactly): "${target}"` };
      }
      await scope.locator('label').nth(normalizedIndexes[0]).click({ timeout: timeoutMs });
      return await verifySelection();
    }
    if (count > 1) {
      return { ok: false, reason: `ambiguous option (${count} labels match exactly): "${target}"` };
    }
    await label.first().click({ timeout: timeoutMs });
    await page.waitForTimeout(150);
    return await verifySelection();
  };

  // Review lane B (MINOR-1): the click inside tryClickRendered can throw past a
  // bare restore() call, leaving the principal's page scrolled. Every exit —
  // including a throw — restores the original position.
  let passes = 0;
  let rendered = await optionCount();
  // Whether the rendered window ever changed while walking. If it never did, the
  // question is not virtualized and the rendered count IS the total; if it did, the
  // count is only what one window shows (review MODERATE-2).
  let windowEverChanged = false;
  // Review lane B (MINOR-B): the option COUNT is not a render signal on this
  // form — the virtualizer keeps a constant ~80-option window, so the count
  // never changes and polling it degenerated into a flat 480 ms per scroll pass.
  // The window's size plus its first and last option text do change on every
  // re-render, so that is the signal; and the target label itself is what the
  // walk is actually waiting for.
  const targetLabelCount = async () => scope.locator('label').filter({ hasText: anchored }).count().catch(() => 0);
  const windowFingerprint = async () =>
    scope
      .evaluate((root) => {
        const labels = root.querySelectorAll('label');
        if (labels.length === 0) return '0';
        const text = (el: Element) => (el.textContent || '').trim().slice(0, 80);
        return `${labels.length}|${text(labels[0])}|${text(labels[labels.length - 1])}`;
      })
      .catch(() => null);
  try {
    const first = await tryClickRendered();
    if (first) return first;

    // Walk the page across the question's extent so the virtualizer renders each
    // window of options in turn.
    //
    // The bound CANNOT be a pixel measurement of the question. Measured live on the
    // installed moe.39 candidate (2026-09-11 19:06Z): the 454-option school question
    // reports a height of ~4013 px because the virtualizer renders only ~80 options
    // at a time, so an item-height bound stopped the walk after 6 passes — roughly
    // 77 options — and the target near option 400 was never rendered. The item's
    // height does not grow as options render, so nothing derived from it can bound
    // the walk correctly.
    //
    // Drive by OBSERVABLE PROGRESS instead: keep scrolling while the page still
    // moves or the rendered window still changes, and stop when neither happens.
    // That reaches the end of a virtualized list of any length and stops promptly on
    // a short one, without assuming anything about the list's pixel extent.
    const viewport = await page.evaluate(() => window.innerHeight).catch(() => 800);
    const step = Math.max(200, Math.floor(viewport * 0.8));
    const box = await item.boundingBox().catch(() => null);
    const scrollNow = async (): Promise<number> => {
      const y = await page.evaluate(() => window.scrollY).catch(() => null);
      return typeof y === 'number' ? y : 0;
    };
    let y = box ? Math.max(0, originalScroll + box.y - viewport * 0.2) : originalScroll;
    let lastY = originalScroll;
    let stalled = 0;
    while (passes < 60) {
      passes += 1;
      const moved = Math.round(y) !== Math.round(lastY);
      const beforeScroll = moved ? await windowFingerprint() : null;
      await page.evaluate((top) => window.scrollTo(0, top), y).catch(() => null);
      const actual = await scrollNow();
      lastY = y;
      // Review lane B (MINOR-3, MINOR-B): poll for the virtualizer instead of
      // sleeping a flat 120 ms, which is unreliable on a loaded VM — but poll for
      // what this pass actually needs. Stop the moment the target renders; stop as
      // soon as the window re-rendered without it; otherwise give up on this window
      // after a short deadline.
      let changed = false;
      for (let settle = 0; moved && settle < 8; settle += 1) {
        if ((await targetLabelCount()) > 0) { changed = true; break; }
        const now = await windowFingerprint();
        if (now !== null && now !== beforeScroll) { changed = true; break; }
        await page.waitForTimeout(60);
      }
      if (changed) windowEverChanged = true;
      const hit = await tryClickRendered();
      if (hit) return hit;
      rendered = Math.max(rendered, await optionCount());
      // The page clamps at its bottom, so `actual` also tells us whether there is
      // any room left. Nothing new rendered AND no room left is the end of the list;
      // a stall with room left is given two more chances, because a loaded VM can
      // render late.
      const roomLeft = actual >= y - 2;
      if (!changed && !roomLeft) break;
      stalled = changed ? 0 : stalled + 1;
      if (stalled >= 3) break;
      y = actual + step;
    }
  } finally {
    await restore();
  }
  // Measured live on the pilot Daily Report (2026-09-12): the school question is NOT
  // virtualized. It offers a fixed set of radio options, and the configured school was
  // simply absent from it. The old message described scroll passes and a "rendered
  // window", which sent the reader looking for a scrolling defect that does not exist.
  // Say what a principal can act on: this form does not offer that value, how many it
  // does offer, and the closest things it has.
  const offered = await scope
    .evaluate((root) => Array.from(root.querySelectorAll('label'))
      .map((l) => (l.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 0))
    .catch(() => null);
  // Review MAJOR-1: on the live vocabulary almost every option ends in "Government
  // Primary", so counting shared tokens ranked three wrong schools above the right
  // one ("Aranguez GPS" for "Aranguez Government Primary School"). Tokens are weighted
  // by rarity within the offered set: a token carried by more than a quarter of the
  // options (or by 3+ options in a short list) is generic and cannot rank a candidate
  // on its own. A candidate must share at least one DISTINCTIVE token, and the hint is
  // suppressed entirely when nothing does, rather than naming unrelated schools.
  const nearest = (() => {
    if (!offered || offered.length === 0) return [];
    const tokens = (v: string) => new Set(normalizeChoiceText(v).split(' ').filter((w) => w.length > 2));
    const wantTokens = tokens(target);
    if (wantTokens.size === 0) return [];
    const offeredTokens = offered.map((label) => tokens(label));
    const frequency = new Map<string, number>();
    for (const t of offeredTokens) t.forEach((w) => frequency.set(w, (frequency.get(w) ?? 0) + 1));
    const genericAt = Math.max(3, Math.ceil(offered.length * 0.25));
    const generic = (w: string) => (frequency.get(w) ?? 0) >= genericAt;
    return offered
      .map((label, i) => {
        const t = offeredTokens[i];
        let distinctive = 0;
        let shared = 0;
        wantTokens.forEach((w) => {
          if (!t.has(w)) return;
          shared += 1;
          if (!generic(w)) distinctive += 1;
        });
        return { label, distinctive, shared };
      })
      .filter((c) => c.distinctive > 0)
      .sort((a, b) => b.distinctive - a.distinctive || b.shared - a.shared)
      .slice(0, 3)
      .map((c) => c.label);
  })();
  // Review MODERATE-2: count radios, which is what the live probe measured (80), not
  // labels; and claim a total only when the rendered window never changed.
  const radios = Math.max(rendered, await optionCount());
  const scanned = radios > 0
    ? (windowEverChanged
      ? `at least ${radios} option(s) were seen (the list renders in windows)`
      : `the question offers ${radios} option(s)`)
    : `no option labels could be read (looked across ${passes} scroll pass(es), ~${rendered} radios seen)`;
  const hint = nearest.length > 0 ? `; closest offered: ${nearest.map((n) => `"${n}"`).join(', ')}` : '';
  return {
    ok: false,
    reason: `this question does not offer "${target}" — ${scanned}${hint}`,
  };
}

/**
 * CLWX-62: select one option of a DROPDOWN single-choice question.
 *
 * Microsoft Forms renders long single-choice lists (the Daily Report's
 * 454-school "Name of school") as a dropdown, not radios, so the radio tiers
 * of `fillField` cannot fill them. Tiers, per the CLWX-64 selector rules:
 *   1. native `<select>` by exact label;
 *   2. ARIA combobox / haspopup trigger inside the question item. The popup is
 *      resolved to THIS trigger — `aria-controls`/`aria-owns` first, then a
 *      listbox inside the question item, then a page-level visible listbox only
 *      when exactly one exists. Review lane A/B: the previous
 *      `page.locator('[role="listbox"]:visible').last()` was a DOM-position
 *      heuristic with no relation to the trigger, so a stale or unrelated open
 *      listbox could have its option clicked — an answer written to a
 *      different question.
 *
 * Fail-safe rules, all verified by unit controls:
 *   - the option is clicked through a locator filtered by exact text with a
 *     count assertion taken immediately before the click, never a stale index
 *     (the 454-option list is virtualized and re-renders);
 *   - no exact match, more than one exact match, an ambiguous popup or a
 *     re-render between read and click => typed failure;
 *   - every non-ok exit closes the popup (Escape) and clears any filter text
 *     this function typed, so nothing it wrote survives a failure;
 *   - a selection the control does not echo back per line/segment is reported,
 *     never assumed.
 * It never presses Enter and never clicks outside the resolved option list.
 * Escape is pressed at page level: safe on a Forms response page (the only page
 * this driver navigates to); do not copy this helper into an Outlook path,
 * where Escape can discard a compose.
 */
export async function selectDropdownChoice(
  page: Page,
  item: Locator,
  target: string,
  timeoutMs: number,
): Promise<DropdownChoiceResult> {
  const want = normalizeChoiceText(target);
  if (!want) return { ok: false, reason: 'empty option value' };

  const select = item.locator('select').first();
  if ((await select.count().catch(() => 0)) > 0) {
    const picked = await select.selectOption({ label: target }, { timeout: timeoutMs }).catch(() => null);
    return picked && picked.length > 0
      ? { ok: true, via: 'select' }
      : { ok: false, reason: `option not found in dropdown: "${target}"` };
  }

  const trigger = item.locator('[role="combobox"], [aria-haspopup="listbox"]').first();
  if ((await trigger.count().catch(() => 0)) === 0) {
    return { ok: false, reason: `option not found: "${target}"` };
  }

  // Filter input: the combobox itself or an input inside it — never a bare
  // text input, which on a single-choice question with an "Other" option is a
  // free-text answer field (review lane B).
  const filterInput = item.locator('input[role="combobox"], [role="combobox"] input').first();
  let typedFilter = false;
  const abandon = async (reason: string): Promise<DropdownChoiceResult> => {
    if (typedFilter) await filterInput.fill('', { timeout: timeoutMs }).catch(() => null);
    await page.keyboard.press('Escape').catch(() => null);
    return { ok: false, reason };
  };

  await trigger.click({ timeout: timeoutMs });

  // Resolve the popup that belongs to THIS trigger.
  const popupId = (await trigger.getAttribute('aria-controls').catch(() => null))
    ?? (await trigger.getAttribute('aria-owns').catch(() => null));
  let listbox: Locator | null = null;
  if (popupId && popupId.trim()) {
    const byId = page.locator(`[id="${cssAttrValue(popupId.trim())}"]`);
    if ((await byId.count().catch(() => 0)) === 1) listbox = byId;
  }
  if (!listbox) {
    const inItem = item.locator('[role="listbox"]:visible');
    const inItemCount = await inItem.count().catch(() => 0);
    if (inItemCount === 1) listbox = inItem;
    else if (inItemCount > 1) return abandon(`ambiguous dropdown popup (${inItemCount} listboxes in the question) for "${target}"`);
  }
  if (!listbox) {
    const onPage = page.locator('[role="listbox"]:visible');
    const onPageCount = await onPage.count().catch(() => 0);
    if (onPageCount === 1) listbox = onPage;
    else if (onPageCount > 1) {
      return abandon(`ambiguous dropdown popup (${onPageCount} visible listboxes; cannot bind one to this question) for "${target}"`);
    }
  }
  if (!listbox) return abandon(`dropdown did not open for "${target}"`);
  try {
    await listbox.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    return abandon(`dropdown did not open for "${target}"`);
  }

  const anchored = new RegExp(`^\\s*${escapeRegex(target)}\\s*$`, 'i');
  const readState = async () => {
    const options = listbox.locator('[role="option"]');
    const texts = await options.allInnerTexts().catch(() => [] as string[]);
    const matches = texts.map((t, i) => ({ i, t })).filter((x) => normalizeChoiceText(x.t) === want);
    return { options, texts, matches };
  };
  let { options, texts, matches } = await readState();
  if (matches.length === 0 && (await filterInput.count().catch(() => 0)) > 0) {
    // Virtualized list: only a window of options is rendered. Forms filters as you type.
    typedFilter = true;
    await filterInput.fill(target, { timeout: timeoutMs }).catch(() => null);
    await page.waitForTimeout(300);
    ({ options, texts, matches } = await readState());
  }
  if (matches.length !== 1) {
    return abandon(
      matches.length === 0
        ? `option not found in dropdown (${texts.length} options rendered): "${target}"`
        : `ambiguous dropdown option (${matches.length} exact matches): "${target}"`,
    );
  }

  // Click through an exact-text locator asserted immediately before the click,
  // so a re-render between the read above and the click cannot select a
  // different school. Fall back to the index only after re-reading its text.
  const exact = listbox.locator('[role="option"]').filter({ hasText: anchored });
  const exactCount = await exact.count().catch(() => 0);
  if (exactCount === 1) {
    await exact.first().click({ timeout: timeoutMs });
  } else if (exactCount > 1) {
    return abandon(`ambiguous dropdown option (${exactCount} exact matches at click time): "${target}"`);
  } else {
    const candidate = options.nth(matches[0].i);
    const nowText = normalizeChoiceText(await candidate.innerText({ timeout: timeoutMs }).catch(() => ''));
    if (nowText !== want) {
      return abandon(`dropdown re-rendered before the option could be clicked: "${target}"`);
    }
    await candidate.click({ timeout: timeoutMs });
  }

  await page.waitForTimeout(200);
  const shown = await readComboboxValue(item);
  if (!valueEchoesTarget(shown, want)) {
    // Clear our filter text and close the popup. Review lane B: the option was
    // already clicked at this point and a Forms single choice offers no "clear",
    // so say plainly that the field may now hold a value — the caller surfaces
    // this and the principal reviews the field before any submit.
    return abandon(
      `dropdown selection not confirmed for "${target}" (control shows "${normalizeChoiceText(shown).slice(0, 80)}"); `
      + 'an option was clicked, so review this field before submitting',
    );
  }
  return { ok: true, via: 'combobox' };
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
    // Attach boundary (CLWX-130): verify the loopback endpoint's Windows
    // session/profile ownership BEFORE connectOverCDP — a reachable endpoint
    // owned by another user's session must be refused, not driven. The port
    // identity is derived from the endpoint itself, so ownership and attach
    // describe the same listener.
    const attachGate = await verifyCdpEndpointOwnershipForAttach({ cdpEndpoint: this.cdp });
    if (!attachGate.allowed) {
      throw new Error(`[${attachGate.status.state}] ${attachGate.status.message}`);
    }
    logger.info(`[forms-v2] Connecting via CDP at ${this.cdp}`);
    try {
      this.browser = await chromium.connectOverCDP(this.cdp);
    } catch (err) {
      logger.warn(
        `[forms-v2] CDP attach failed (${err instanceof Error ? err.message : String(err)}) — attempting Chrome CDP repair`,
      );
      const status = await ensureChromeCdpReady({
        cdpEndpoint: this.cdp,
        allowManagedProfileFallback: true,
      });
      if (status.state !== 'cdp_ready') {
        throw new Error(`[${status.state}] ${status.message}`, { cause: err });
      }
      this.browser = await chromium.connectOverCDP(this.cdp);
    }
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
      // ensureBrowser() reassigns this.browser as a side effect, which the
      // compiler's narrowing (null after the assignment above) cannot see.
      const reattached = this.browser as Browser | null;
      if (!reattached) throw new Error('CDP attach failed');
      contexts = reattached.contexts();
    }
    const allPages = contexts.flatMap((c) => c.pages());
    let page = allPages.find((p) => responsePageMatchesFormUrl(p.url(), formUrl));
    if (!page) {
      const ctx: BrowserContext | undefined = chooseFormsContext(contexts, formUrl);
      if (!ctx) throw new Error('no browser contexts available');
      page = await ctx.newPage();
    }
    await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Forms response page lazy-loads questions; wait for one to appear.
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => null);
    await waitForResponseQuestions(page);
    await page.bringToFront().catch(() => null);
    this.page = page;
    return page;
  }

  async inspectField(label: string): Promise<FieldInspection> {
    if (!this.page) return { visible: false, hasValue: false, required: false, text: '' };
    const item = await this.findQuestionItem(label);
    if (!item) return { visible: false, hasValue: false, required: false, text: '' };
    const visible = await item.isVisible({ timeout: 1_000 }).catch(() => false);
    const text = await item.innerText({ timeout: 1_000 }).catch(() => '');
    if (!visible) return { visible: false, hasValue: false, required: false, text };
    const inputValue = await item.locator('input, textarea').evaluateAll((elements) => elements.some((element) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      if (input instanceof HTMLInputElement && (input.type === 'radio' || input.type === 'checkbox')) {
        return input.checked;
      }
      return Boolean(input.value?.trim());
    })).catch(() => false);
    const ariaChecked = await item
      .locator('[role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"]')
      .count()
      .then((count) => count > 0)
      .catch(() => false);
    const required = /this question is required|required/i.test(text)
      || await item
        .locator('[aria-required="true"], input[required], textarea[required]')
        .count()
        .then((count) => count > 0)
        .catch(() => false);
    return { visible, hasValue: inputValue || ariaChecked, required, text };
  }

  private async visibleValidationMessages(): Promise<string[]> {
    if (!this.page) return [];
    return this.page
      .locator('text=/This question is required|Please answer|Enter a valid|Invalid answer|Required question/i')
      .evaluateAll((nodes) => nodes
        .filter((node) => {
          if (!(node instanceof HTMLElement)) return false;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '')
        .filter(Boolean)
        .slice(0, 8))
      .catch(() => []);
  }

  private async waitForSubmitOutcome(timeoutMs: number, networkPromise?: Promise<boolean>): Promise<SubmitResult | null> {
    if (!this.page) return { status: 'error', reason: 'no page' };
    let networkDone = false;
    let networkSubmitted = false;
    networkPromise
      ?.then((ok) => {
        networkDone = true;
        networkSubmitted = ok;
      })
      .catch(() => {
        networkDone = true;
      });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (networkSubmitted) {
        return { status: 'submitted', message: 'Form submitted via Microsoft Forms.' };
      }

      const bodyText = await this.page.locator('body').innerText({ timeout: 1_000 }).catch(() => '');
      if (SUBMIT_CONFIRMATION_RE.test(bodyText)) {
        return { status: 'submitted', message: 'Form submitted via Microsoft Forms.' };
      }

      const validationMessages = await this.visibleValidationMessages();
      if (validationMessages.length > 0 || SUBMIT_VALIDATION_RE.test(bodyText)) {
        return {
          status: 'error',
          reason: `Microsoft Forms kept the response open with validation errors: ${
            validationMessages.length > 0 ? validationMessages.join(' | ') : 'validation text detected'
          }`,
        };
      }

      const submitStillVisible = await this.page
        .getByRole('button', { name: /^submit$/i })
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (!submitStillVisible && /microsoft forms/i.test(bodyText)) {
        return { status: 'submitted', message: 'Form submitted via Microsoft Forms.' };
      }

      if (networkDone && networkSubmitted) {
        return { status: 'submitted', message: 'Form submitted via Microsoft Forms.' };
      }
      await this.page.waitForTimeout(500);
    }
    if (networkSubmitted || await networkPromise?.catch(() => false)) {
      return { status: 'submitted', message: 'Form submitted via Microsoft Forms.' };
    }
    return null;
  }

  private async waitForFormsSubmitResponse(timeoutMs: number): Promise<boolean> {
    if (!this.page) return false;
    return this.page
      .waitForResponse((response) => {
        const method = response.request().method().toUpperCase();
        if (method !== 'POST' && method !== 'PUT') return false;
        const status = response.status();
        if (status < 200 || status >= 300) return false;
        return /\/(?:runtime|formapi)\/api\/.*\/responses\b/i.test(response.url());
      }, { timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
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
   * Question-item locator, tiered (CLWX-64, dom-selector-regression-tester).
   *
   * Selector classification, verified against the recorded live traces
   * (skills/laptop/evidence/2026-09-03-*-recorded): the response page renders
   * `[data-automation-id="questionItem"]` (vendor-ROTATED — this family
   * rotated once already, moe.5 editor pivot) and NO explicit role attribute,
   * so the CSS `[role="listitem"]` alternative matches nothing there today —
   * it is an explicit-attribute fallback only. The real fallback tiers:
   *   1. CSS union: rotated data-automation-id + explicit role attribute.
   *   2. Playwright role engine `getByRole('listitem')` — resolves IMPLICIT
   *      ARIA roles (li elements, aria mappings) that CSS cannot see.
   *   3. Prefix variant `[data-automation-id^="question"]` — survives suffix
   *      renames of the automation id.
   */
  private async questionItemsLocator(): Promise<Locator> {
    if (!this.page) throw new Error('no page; call ensureFormsTab first');
    const tiers: Locator[] = [
      this.page.locator('[data-automation-id="questionItem"], [role="listitem"]'),
      this.page.getByRole('listitem'),
      this.page.locator('[data-automation-id^="question"]'),
    ];
    for (const tier of tiers) {
      if ((await tier.count().catch(() => 0)) > 0) return tier;
    }
    return tiers[0];
  }

  /**
   * List the rendered question items' innerText in DOM order — the live
   * side of the CLWX-64 schema-drift check (schema-fingerprint.ts).
   */
  async listQuestionItemTexts(maxItems = 80): Promise<string[]> {
    const items = await this.questionItemsLocator();
    const count = await items.count().catch(() => 0);
    const texts: string[] = [];
    for (let i = 0; i < Math.min(count, maxItems); i += 1) {
      const text = await items.nth(i).innerText({ timeout: 1_000 }).catch(() => '');
      if (text.trim()) texts.push(text.trim());
    }
    return texts;
  }

  async getVisibleQuestionText(): Promise<string> {
    const texts = await this.listQuestionItemTexts(40);
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
          // CLWX-62 (2026-09-11), measured live on the production Daily Report:
          // "Name of school" renders ~80 of 454 options as radios wrapped in a
          // <label> whose text is the option, with an EMPTY aria-label, no
          // combobox/select/listbox, and the target option absent from the DOM
          // until the PAGE scrolls across the question.
          //
          // Tier 1 is the virtualized walk, which also covers an ordinary
          // already-rendered radio list: it refuses exact duplicates and it
          // verifies the radio reports checked. Review lane B: the previous
          // label tier used the SAME anchored locator but applied .first()
          // before .count(), so the duplicate refusal could never fire, and it
          // returned ok purely because a click was dispatched — it shadowed
          // every guarantee this path adds. It is gone rather than reordered.
          const virtualized = await selectVirtualizedRadioChoice(this.page, item, target, this.fieldTimeoutMs);
          if (virtualized.ok) return virtualized;
          // Tier 2: role="radio" carrying the option in aria-label (some renderings).
          const aria = item.locator(`[role="radio"][aria-label="${cssAttrValue(target)}"]`);
          const ariaCount = await aria.count().catch(() => 0);
          if (ariaCount === 1) {
            await aria.first().click({ timeout: this.fieldTimeoutMs });
            const ariaChecked = await aria.first().getAttribute('aria-checked').catch(() => null);
            if (ariaChecked === 'true') return { ok: true };
            return { ok: false, reason: `option "${target}" was clicked but the control does not report it selected` };
          }
          if (ariaCount > 1) {
            return { ok: false, reason: `ambiguous option (${ariaCount} aria-label matches): "${target}"` };
          }
          // Tier 3: a real dropdown (native select or ARIA combobox).
          const dropdown = await selectDropdownChoice(this.page, item, target, this.fieldTimeoutMs);
          if (dropdown.ok) return dropdown;
          // Report the more informative failure: the virtualized walk knows how
          // many options it saw, the dropdown tier only that no popup existed.
          return /option not found: /.test(dropdown.reason ?? '') ? virtualized : dropdown;
        }
        case 'multi_choice': {
          const targets = Array.isArray(value) ? value : [String(value)];
          let any = false;
          for (const t of targets) {
            const cb = item.locator('label').filter({ hasText: new RegExp(`^\\s*${escapeRegex(t)}\\s*$`, 'i') }).first();
            if ((await cb.count()) > 0) {
              await cb.click({ timeout: this.fieldTimeoutMs });
              any = true;
              continue;
            }
            // CLWX-64: aria fallback mirroring the single_choice path — some
            // Forms renders expose choices as role="checkbox" without a
            // clickable <label> wrapper.
            const aria = item.locator(`[role="checkbox"][aria-label="${cssAttrValue(t)}"]`).first();
            if ((await aria.count()) > 0) {
              await aria.click({ timeout: this.fieldTimeoutMs });
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
    const questionItems = await this.questionItemsLocator();
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
    if (!confirm) {
      return {
        status: 'refused',
        reason: 'Submit blocked: confirm:true required. Re-call with confirm:true after the principal has reviewed the filled form.',
      };
    }
    if (!this.page) return { status: 'error', reason: 'no page' };
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
      const networkOutcome = this.waitForFormsSubmitResponse(30_000);
      await submitBtn.click({ timeout: 10_000 });
      const outcome = await this.waitForSubmitOutcome(30_000, networkOutcome);
      return outcome ?? { status: 'error', reason: 'Submit clicked but no confirmation or validation result appeared in 30s.' };
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
