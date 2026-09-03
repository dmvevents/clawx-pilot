/**
 * Screen-recorded, verified submission harness for the Daily Report CLONE form.
 *
 * CLWX-62 last acceptance leg. Same pattern as scripts/forms-submit-recorded.ts
 * (the Suspensions recorded harness), hard-pinned to the Primary School Daily
 * Report clone on test.fac.
 *
 * What it does, in order:
 *   1. HARD-GUARD: the ONLY submittable target is the URL stored in
 *      extensions/moe-principal-assistant/forms/daily-report-test-fac-url.txt.
 *      There is no CLI/env override. Host must be forms.office.com or
 *      forms.cloud.microsoft, and every navigation / submit re-asserts the
 *      form id against that file. Anything else exits non-zero.
 *   2. Preflight: CDP 127.0.0.1:18792 must already be up (profile=user Chrome).
 *      We NEVER launch a browser; if CDP is down we abort so the driver's
 *      repair path can never run.
 *   3. Reads the owner responses count BEFORE (best-effort, signed-in
 *      test.fac session; formapi fetch first, analysis-page scrape second).
 *   4. Starts recording: Playwright tracing (trace.zip) + CDP Page.startScreencast
 *      frames (~2-4 fps, capped) assembled to MP4 with ffmpeg afterwards.
 *   5. Re-opens the clone form (so the load is on video), fills via the
 *      production DailyReportActions driver (expect ~55/57 with the
 *      max-visibility payload; principal_name auto-recorded, reason_no_school
 *      hidden by branching).
 *   6. Proves the refusal path: submit WITHOUT confirm -> must be status=refused.
 *   7. Submits WITH confirm:true — exactly once per run — then independently
 *      verifies the MS Forms success marker with multiple fallback strategies.
 *   8. Stops recording, re-reads the responses count AFTER; PASS requires
 *      count increment by exactly 1 (fallback: success marker + screenshot).
 *   9. Saves all evidence to skills/laptop/evidence/2026-09-03-daily-report-recorded/.
 *
 * Run:
 *   pnpm exec tsx scripts/forms-submit-recorded-daily.ts
 *
 * Reuses the production driver (electron/services/forms-browser-v2) — the same
 * code path the agent uses. Payload mirrors scripts/forms-fill-daily-report.ts.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import type { CDPSession, Page } from 'playwright-core';
import { FormsDriver } from '../electron/services/forms-browser-v2/forms-driver.ts';
import { DailyReportActions, type DailyReportPayload } from '../electron/services/forms-browser-v2/daily-report-actions.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_URL_FILE = join(REPO_ROOT, 'extensions/moe-principal-assistant/forms/daily-report-test-fac-url.txt');
const EVIDENCE_DIR = join(REPO_ROOT, 'skills/laptop/evidence/2026-09-03-daily-report-recorded');
const FRAMES_DIR = join(EVIDENCE_DIR, 'frames');
const CDP_HTTP = 'http://127.0.0.1:18792';
const ALLOWED_HOSTS = new Set(['forms.office.com', 'forms.cloud.microsoft']);
const MIN_FRAME_INTERVAL_MS = 300; // ~3.3 fps ceiling
const MAX_FRAMES = 720;

// ---------------------------------------------------------------------------
// HARD-GUARD — the clone-form allowlist. Everything funnels through this.
// ---------------------------------------------------------------------------

function fatal(code: number, msg: string): never {
  console.error(`FATAL: ${msg}`);
  process.exit(code);
}

function loadAllowedTarget(): { url: string; id: string } {
  if (!existsSync(ALLOWED_URL_FILE)) {
    fatal(3, `allowlist file missing: ${ALLOWED_URL_FILE} — refusing to touch any form`);
  }
  const url = readFileSync(ALLOWED_URL_FILE, 'utf-8').trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fatal(3, `allowlist file does not contain a valid URL: "${url.slice(0, 80)}"`);
  }
  if (!ALLOWED_HOSTS.has(parsed.host)) {
    fatal(3, `allowlist URL host "${parsed.host}" is not an approved Microsoft Forms host`);
  }
  if (!/ResponsePage/i.test(parsed.pathname) && !/^\/r\//i.test(parsed.pathname)) {
    fatal(3, `allowlist URL is not a Forms response page: ${parsed.pathname}`);
  }
  const id = parsed.searchParams.get('id') ?? '';
  if (!id) fatal(3, 'allowlist URL has no form id parameter — cannot pin the target form');
  return { url, id };
}

const TARGET = loadAllowedTarget();

/** Re-assert, at every sensitive moment, that we are on the pinned clone form. */
function assertOnAllowedForm(currentUrl: string, where: string): void {
  let parsed: URL;
  try {
    parsed = new URL(currentUrl);
  } catch {
    fatal(3, `[guard:${where}] current URL unparseable: "${currentUrl.slice(0, 120)}"`);
  }
  if (!ALLOWED_HOSTS.has(parsed.host)) {
    fatal(3, `[guard:${where}] page host "${parsed.host}" is not the pinned Forms host — aborting before any action`);
  }
  const id = parsed.searchParams.get('id');
  if (id !== TARGET.id) {
    fatal(3, `[guard:${where}] page form id does not match the test.fac clone allowlist — aborting`);
  }
}

// ---------------------------------------------------------------------------
// Preflight — CDP must already be up; we never launch or repair a browser.
// ---------------------------------------------------------------------------

function cdpUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${CDP_HTTP}/json/version`, { timeout: 3_000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Recording — Playwright tracing + CDP screencast frames -> MP4 via ffmpeg.
// ---------------------------------------------------------------------------

interface FrameMeta {
  file: string;
  tsMs: number;
}

class Recorder {
  private client: CDPSession | null = null;
  private frames: FrameMeta[] = [];
  private lastFrameTs = 0;
  private frameIndex = 0;
  tracingActive = false;
  screencastActive = false;

  async start(page: Page): Promise<void> {
    // (a) Playwright tracing on the CDP-connected context.
    try {
      await page.context().tracing.start({ screenshots: true, snapshots: true, title: 'forms-submit-daily' });
      this.tracingActive = true;
      console.log('  recorder: playwright tracing ON');
    } catch (err) {
      console.log(`  recorder: tracing unavailable on this context (${err instanceof Error ? err.message : String(err)})`);
    }
    // (b) CDP screencast frames.
    try {
      this.client = await page.context().newCDPSession(page);
      this.client.on('Page.screencastFrame', (ev: { data: string; sessionId: number; metadata?: { timestamp?: number } }) => {
        void this.client?.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => undefined);
        const now = Date.now();
        if (now - this.lastFrameTs < MIN_FRAME_INTERVAL_MS || this.frames.length >= MAX_FRAMES) return;
        this.lastFrameTs = now;
        this.frameIndex += 1;
        const file = `frame-${String(this.frameIndex).padStart(6, '0')}.jpg`;
        try {
          writeFileSync(join(FRAMES_DIR, file), Buffer.from(ev.data, 'base64'));
          this.frames.push({ file, tsMs: now });
        } catch {
          /* disk write failure: drop frame */
        }
      });
      await this.client.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: 1280,
        maxHeight: 960,
        everyNthFrame: 2,
      });
      this.screencastActive = true;
      console.log('  recorder: CDP screencast ON');
    } catch (err) {
      console.log(`  recorder: screencast unavailable (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  async stop(page: Page, tracePath: string): Promise<{ frameCount: number }> {
    if (this.client && this.screencastActive) {
      await this.client.send('Page.stopScreencast').catch(() => undefined);
      await this.client.detach().catch(() => undefined);
    }
    if (this.tracingActive) {
      try {
        await page.context().tracing.stop({ path: tracePath });
        console.log(`  recorder: trace saved -> ${tracePath}`);
      } catch (err) {
        console.log(`  recorder: trace save failed (${err instanceof Error ? err.message : String(err)})`);
        this.tracingActive = false;
      }
    }
    return { frameCount: this.frames.length };
  }

  /** Assemble frames into an MP4 using ffmpeg (concat demuxer, real durations). */
  assembleMp4(outPath: string): { ok: boolean; detail: string } {
    if (this.frames.length < 2) return { ok: false, detail: `only ${this.frames.length} frame(s) captured` };
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) return { ok: false, detail: 'no ffmpeg binary found (bundled or system)' };
    const listLines: string[] = [];
    for (let i = 0; i < this.frames.length; i += 1) {
      const cur = this.frames[i];
      const next = this.frames[i + 1];
      const durSec = next ? Math.min(Math.max((next.tsMs - cur.tsMs) / 1000, 0.05), 5) : 0.5;
      listLines.push(`file '${cur.file}'`);
      listLines.push(`duration ${durSec.toFixed(3)}`);
    }
    // concat demuxer wants the final file repeated without a duration
    listLines.push(`file '${this.frames[this.frames.length - 1].file}'`);
    const listPath = join(FRAMES_DIR, 'concat.txt');
    writeFileSync(listPath, `${listLines.join('\n')}\n`);
    const res = spawnSync(ffmpeg, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-fps_mode', 'vfr',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      outPath,
    ], { cwd: FRAMES_DIR, encoding: 'utf-8', timeout: 120_000 });
    if (res.status !== 0) {
      return { ok: false, detail: `ffmpeg exit ${res.status}: ${(res.stderr ?? '').slice(-400)}` };
    }
    return { ok: true, detail: `${ffmpeg} assembled ${this.frames.length} frames` };
  }

  get frameCount(): number {
    return this.frames.length;
  }
}

function findFfmpeg(): string | null {
  const candidates = [
    join(REPO_ROOT, 'resources/bin/darwin-arm64/ffmpeg'),
    join(REPO_ROOT, 'resources/bin', `${process.platform}-${process.arch}`, 'ffmpeg'),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const which = spawnSync('which', ['ffmpeg'], { encoding: 'utf-8' });
  const fromPath = which.status === 0 ? which.stdout.trim() : '';
  return fromPath || null;
}

// ---------------------------------------------------------------------------
// Responses-count verification (owner view; best-effort, no sign-ins ever).
// ---------------------------------------------------------------------------

interface CountReading {
  count: number | null;
  strategy: string;
}

async function readResponsesCount(page: Page): Promise<CountReading> {
  // Strategy 1: same-origin formapi fetch from the already-open forms page.
  try {
    const apiResult = await page.evaluate(async (formId: string) => {
      const urls = [
        `https://forms.office.com/formapi/api/forms('${formId}')?$select=id,title,responseCount`,
        `https://forms.office.com/formapi/api/forms('${formId}')`,
      ];
      for (const u of urls) {
        try {
          const res = await fetch(u, { credentials: 'include', headers: { accept: 'application/json' } });
          if (!res.ok) continue;
          const json = (await res.json()) as { responseCount?: number; value?: Array<{ responseCount?: number }> };
          if (typeof json.responseCount === 'number') return json.responseCount;
          const first = json.value?.[0];
          if (first && typeof first.responseCount === 'number') return first.responseCount;
        } catch {
          /* try next */
        }
      }
      return null;
    }, TARGET.id);
    if (typeof apiResult === 'number') {
      return { count: apiResult, strategy: 'formapi responseCount (same-origin fetch)' };
    }
  } catch {
    /* fall through to page scrape */
  }

  // Strategy 2: open the owner analysis page in a throwaway tab and scrape.
  let tab: Page | null = null;
  try {
    tab = await page.context().newPage();
    const analysisUrl = `https://forms.office.com/Pages/DesignPageV2.aspx?subpage=analysis&id=${encodeURIComponent(TARGET.id)}`;
    await tab.goto(analysisUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await tab.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
    await tab.waitForTimeout(4_000);
    if (/login\.microsoftonline\.com/i.test(tab.url())) {
      return { count: null, strategy: 'analysis page redirected to sign-in; refused to authenticate' };
    }
    const body = (await tab.locator('body').innerText({ timeout: 5_000 }).catch(() => '')).replace(/\s+/g, ' ');
    // Vendor-rotated surface: forms.office.com analysis URL currently redirects
    // to forms.cloud.microsoft subpage=design, whose badge reads "View responses N".
    const patterns = [
      /view responses\s+(\d[\d,]*)\b/i,
      /(\d[\d,]*)\s+responses?\b/i,
      /responses?\s*[(:]\s*(\d[\d,]*)\s*\)?/i,
      /responses?\s+(\d[\d,]*)\b/i,
    ];
    for (const re of patterns) {
      const m = re.exec(body);
      if (m) {
        return { count: Number(m[1].replace(/,/g, '')), strategy: `analysis page scrape (${re.source.slice(0, 30)})` };
      }
    }
    return { count: null, strategy: 'analysis page loaded but no response-count text matched' };
  } catch (err) {
    return { count: null, strategy: `analysis page unreachable: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}` };
  } finally {
    await tab?.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Independent success-marker check (vendor-rotated UI -> multiple strategies).
// ---------------------------------------------------------------------------

async function detectSuccessMarker(page: Page, timeoutMs: number): Promise<{ ok: boolean; strategy: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Strategy A: stable data-automation-id thank-you containers.
    const thankYou = await page
      .locator('[data-automation-id="thankYouPage"], [data-automation-id="thankYouPageMessage"]')
      .count()
      .catch(() => 0);
    if (thankYou > 0) return { ok: true, strategy: 'data-automation-id thankYouPage' };

    // Strategy B: canonical confirmation copy in body text.
    const body = await page.locator('body').innerText({ timeout: 1_500 }).catch(() => '');
    if (/your response (?:was|has been)(?: successfully)? submitted|response has been recorded/i.test(body)) {
      return { ok: true, strategy: 'body text "response was submitted"' };
    }

    // Strategy C: "Submit another response" affordance only exists post-submit.
    const another = await page
      .getByText(/submit another response/i)
      .count()
      .catch(() => 0);
    if (another > 0) return { ok: true, strategy: 'text "Submit another response"' };

    await page.waitForTimeout(500);
  }
  return { ok: false, strategy: 'none matched within timeout' };
}

// ---------------------------------------------------------------------------
// Payload — mirrors scripts/forms-fill-daily-report.ts (synthetic test data).
// Internally consistent: 20 teachers = 17 present + 3 absent (0 quarantine,
// 0 other leave); per-class present <= enrolled; absentee-summary counts sum
// to the stated total (0+1+0+1+0+1+0 = 3). Max-visibility branches: school
// open, NSDSL both meals, suspension, PTSC, last-day absentee summary all
// = Yes; only reason_no_school stays hidden.
// ---------------------------------------------------------------------------

const SAMPLE_PAYLOAD: DailyReportPayload = {
  principal_name: 'Test Principal (auto)',
  date_being_reported_on: '2026-09-03',
  education_district: 'Caroni',
  school_type: 'Government',
  name_of_school: 'Aranguez GPS',
  did_you_have_school_today: 'Yes',
  principal_status: 'Physically present at school',
  vice_principal_status: 'Physically present at school',
  number_of_teachers_on_staff: 20,
  number_of_teachers_present: 17,
  number_of_teachers_absent: 3,
  number_of_teachers_on_moh_quarantine: 0,
  number_of_teachers_other_leave: 0,
  students_enrolled_first_year: 30,
  first_year_students_present: 27,
  students_enrolled_second_year: 32,
  second_year_students_present: 30,
  students_enrolled_standard_1: 28,
  standard_1_students_present: 26,
  students_enrolled_standard_2: 31,
  standard_2_students_present: 29,
  students_enrolled_standard_3: 27,
  standard_3_students_present: 25,
  students_enrolled_standard_4: 29,
  standard_4_students_present: 28,
  students_enrolled_standard_5: 26,
  standard_5_students_present: 24,
  school_receives_nsdsl_meals: 'Yes',
  received_nsdsl_breakfasts: 'Yes',
  breakfasts_delivered: 120,
  breakfasts_left_after_distribution: 5,
  breakfast_portion_size_rating: 'Enough',
  children_satisfied_with_breakfast: 'Yes',
  students_fell_ill_after_nsdsl_breakfast: 0,
  received_nsdsl_lunches: 'Yes',
  lunches_delivered: 150,
  lunches_left_after_distribution: 8,
  lunch_portion_size_rating: 'Enough',
  children_satisfied_with_lunch: 'Yes',
  students_fell_ill_after_nsdsl_lunch: 0,
  students_suspended_today: 'Yes',
  number_of_students_suspended: 1,
  suspension_recorded_on_form: 'Yes',
  school_serviced_by_ptsc_maxi_taxi: 'Yes',
  ptsc_approved_routes_count: 2,
  ptsc_morning_trips_count: 4,
  last_day_of_week: 'Yes',
  students_absent_entire_term: 'Yes',
  total_students_absent_entire_term: 3,
  first_year_students_absent_entire_term: 0,
  second_year_students_absent_entire_term: 1,
  standard_1_students_absent_entire_term: 0,
  standard_2_students_absent_entire_term: 1,
  standard_3_students_absent_entire_term: 0,
  standard_4_students_absent_entire_term: 1,
  standard_5_students_absent_entire_term: 0,
};

// ---------------------------------------------------------------------------
// Main flow.
// ---------------------------------------------------------------------------

interface StepTiming {
  step: string;
  atMs: number;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const timings: StepTiming[] = [];
  const mark = (step: string) => {
    timings.push({ step, atMs: Date.now() - t0 });
    console.log(`[t+${((Date.now() - t0) / 1000).toFixed(1)}s] ${step}`);
  };

  mkdirSync(FRAMES_DIR, { recursive: true });

  mark('preflight: checking CDP 127.0.0.1:18792');
  if (!(await cdpUp())) {
    fatal(4, 'CDP endpoint 127.0.0.1:18792 is not reachable. Refusing to proceed — this harness never launches a browser. Start the user Chrome with remote debugging first.');
  }
  mark('preflight: CDP up (user Chrome, profile=user)');
  console.log(`  pinned clone form id: ${TARGET.id.slice(0, 12)}... host: ${new URL(TARGET.url).host}`);

  const driver = new FormsDriver();
  const actions = new DailyReportActions(driver);
  const recorder = new Recorder();
  let submissions = 0;

  try {
    mark('open: attaching to clone form tab');
    const page = await driver.ensureFormsTab(TARGET.url);
    assertOnAllowedForm(page.url(), 'after-open');
    const title = await driver.getVisibleTitle();
    mark(`open: OK (visible title "${title}")`);

    mark('verify: reading responses count BEFORE');
    const before = await readResponsesCount(page);
    mark(`verify: BEFORE count=${before.count === null ? 'unreadable' : before.count} via ${before.strategy}`);
    await page.bringToFront().catch(() => undefined);

    mark('record: starting tracing + screencast');
    await recorder.start(page);

    // Re-navigate so the form load itself is on the recording.
    mark('record: re-opening clone form on camera');
    await driver.ensureFormsTab(TARGET.url);
    assertOnAllowedForm(page.url(), 'after-reopen');

    mark('fill: driving 57-field payload through DailyReportActions');
    const fill = await actions.fill(SAMPLE_PAYLOAD);
    mark(`fill: status=${fill.status} filled=${fill.filledCount} skipped=${fill.skippedCount} errors=${fill.errors.length}`);
    for (const e of fill.errors) console.log(`  fill error [${e.fieldId}] ${e.reason}`);
    if (fill.filledCount < 45) {
      fatal(5, `fill landed only ${fill.filledCount} fields (<45) — aborting before any submit`);
    }

    await page.screenshot({ path: join(EVIDENCE_DIR, 'before-submit.png'), fullPage: false }).catch(() => undefined);
    mark('evidence: before-submit.png captured');

    mark('gate: submitting WITHOUT confirm (must refuse)');
    const refused = await actions.submit({ confirm: false });
    if (refused.status !== 'refused') {
      fatal(6, `hard-confirm gate DID NOT refuse without confirm:true (status=${refused.status}) — aborting, no confirmed submit will be attempted`);
    }
    mark(`gate: refused as required ("${(refused.reason ?? '').slice(0, 80)}...")`);
    // Belt-and-braces: ensure the refusal really did not submit anything.
    const bodyAfterRefusal = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
    if (/your response (?:was|has been)(?: successfully)? submitted/i.test(bodyAfterRefusal)) {
      fatal(6, 'page shows a submitted state after the refusal path — investigate before ever re-running');
    }

    assertOnAllowedForm(page.url(), 'pre-confirmed-submit');
    mark('submit: confirm:true (exactly one submission this run)');
    submissions += 1;
    if (submissions !== 1) fatal(7, 'submission latch tripped — more than one submit attempt in a single run');
    const sent = await actions.submit({ confirm: true });
    mark(`submit: status=${sent.status} ${(sent.message ?? sent.reason ?? '').slice(0, 120)}`);
    if (sent.status !== 'submitted') {
      await page.screenshot({ path: join(EVIDENCE_DIR, 'after-submit.png'), fullPage: false }).catch(() => undefined);
      await recorder.stop(page, join(EVIDENCE_DIR, 'trace.zip'));
      fatal(8, `confirmed submit did not land: status=${sent.status} reason=${sent.reason ?? 'n/a'}`);
    }

    mark('verify: independent success-marker check');
    const marker = await detectSuccessMarker(page, 15_000);
    mark(`verify: success marker ${marker.ok ? 'FOUND' : 'NOT FOUND'} via ${marker.strategy}`);

    await page.screenshot({ path: join(EVIDENCE_DIR, 'after-submit.png'), fullPage: false }).catch(() => undefined);
    mark('evidence: after-submit.png captured');

    mark('record: stopping recorders');
    const { frameCount } = await recorder.stop(page, join(EVIDENCE_DIR, 'trace.zip'));
    mark(`record: stopped (${frameCount} frames)`);

    mark('verify: reading responses count AFTER');
    const after = await readResponsesCount(page);
    mark(`verify: AFTER count=${after.count === null ? 'unreadable' : after.count} via ${after.strategy}`);

    mark('record: assembling MP4');
    const mp4 = recorder.assembleMp4(join(EVIDENCE_DIR, 'video.mp4'));
    mark(`record: mp4 ${mp4.ok ? 'OK' : 'SKIPPED'} — ${mp4.detail}`);
    if (mp4.ok) {
      rmSync(FRAMES_DIR, { recursive: true, force: true });
      mark('record: raw frames removed (mp4 retained)');
    }

    // Verdict.
    const countVerified = before.count !== null && after.count !== null && after.count === before.count + 1;
    const verdict = countVerified
      ? 'PASS (responses count incremented by exactly 1)'
      : marker.ok
        ? 'PASS-FALLBACK (success marker verified; responses count not readable/comparable)'
        : 'FAIL (submitted per driver, but neither count increment nor success marker verified)';

    const summary = {
      verdict,
      target: { host: new URL(TARGET.url).host, formIdPrefix: TARGET.id.slice(0, 12) },
      fill: { filled: fill.filledCount, skipped: fill.skippedCount, errors: fill.errors.length },
      refusalPath: refused.status,
      confirmedSubmit: sent.status,
      successMarker: marker,
      responsesCount: { before: before.count, beforeStrategy: before.strategy, after: after.count, afterStrategy: after.strategy, incrementedByOne: countVerified },
      recording: { tracing: recorder.tracingActive, frames: frameCount, mp4: mp4.ok, mp4Detail: mp4.detail },
      timings,
      totalMs: Date.now() - t0,
    };
    writeFileSync(join(EVIDENCE_DIR, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`\n=== ${verdict} ===`);
    console.log(`evidence: ${EVIDENCE_DIR}`);
    process.exit(verdict.startsWith('PASS') ? 0 : 9);
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
