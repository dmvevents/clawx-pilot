/**
 * MoE form-filler manager.
 *
 * Workflow:
 *   1. resolve URL for the form (from ledger config)
 *   2. ensure browser plugin is running on the user's signed-in Chrome
 *   3. open the form in a tab; if Microsoft sign-in appears, surface
 *      'awaiting-signin' to the renderer and wait
 *   4. snapshot the form, attempt heuristic field-matching for our payload
 *   5. emit 'preview' to the renderer with a populated preview + any
 *      unmatched fields, wait for explicit confirm
 *   6. issue act:fill, then click the form's Submit button (final action only
 *      after explicit user confirmation)
 *   7. record into the idempotency ledger and emit 'submitted'
 *
 * NOTE: this is a real, conservative flow. It does NOT auto-submit. The
 * principal must press Confirm in the UI to advance from 'preview' to
 * 'submit'. That's a hard requirement from the persona prompt.
 */
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { browserClient, type BrowserStatus } from './browser-client';
import {
  findRecentSubmission,
  getFormUrls,
  recordSubmission,
} from './store';
import type {
  DailyReportPayload,
  FillRunStatus,
  FillStage,
  FormKind,
  FormPayload,
  SuspensionPayload,
} from './types';

interface ActiveRun {
  runId: string;
  kind: FormKind;
  payload: FormPayload['payload'];
  targetId?: string;
  stage: FillStage;
  fieldPlan?: FieldPlan[];
  unmatched?: string[];
  confirmResolver?: (confirmed: boolean) => void;
}

interface FieldPlan {
  /** Question text from the form snapshot. */
  questionText: string;
  /** Aria/role ref returned by snapshot — feeds act:fill. */
  ref: string;
  /** Value our payload maps to this field. */
  value: string | number | boolean;
  /** Field shape: text/select/radio/checkbox. */
  type: 'text' | 'number' | 'select' | 'radio' | 'checkbox';
  /** The payload key that supplied the value, for the preview UI. */
  payloadKey: string;
}

class MoeFormFillerManager extends EventEmitter {
  private active: ActiveRun | null = null;

  isRunning(): boolean {
    return this.active !== null;
  }

  async start(form: FormPayload): Promise<FillRunStatus> {
    if (this.active) {
      throw new Error('A form fill is already in progress; cancel first.');
    }
    const runId = `run-${Date.now()}`;
    this.active = {
      runId,
      kind: form.kind,
      payload: form.payload,
      stage: 'prepare',
    };
    this.emitStatus();

    try {
      // 1. Idempotency check.
      const idempotencyKey = buildIdempotencyKey(form);
      const recent = await findRecentSubmission(form.kind, idempotencyKey);
      if (recent && Date.now() - recent.submittedAt < 6 * 3600_000) {
        this.fail('DUPLICATE', `Already submitted ${form.kind} ${idempotencyKey} earlier today.`);
        return this.snapshot();
      }

      // 2. Resolve URL.
      const urls = await getFormUrls();
      const url = form.kind === 'daily-report' ? urls.dailyReport : urls.suspension;
      if (!url) {
        this.fail('NO_URL', `No URL configured for ${form.kind}; set in Settings → MoE.`);
        return this.snapshot();
      }

      // 3. Open in user's Chrome (existing-session profile = SSO).
      this.transition('navigate', `Opening ${form.kind} form in your browser…`);
      const status = await this.ensureBrowser('user');
      if (!status.running) {
        this.fail('BROWSER_OFF', 'Chrome is not running with remote debugging enabled.');
        return this.snapshot();
      }
      const { targetId } = await browserClient.open(url, 'user');
      this.active.targetId = targetId;

      // 4. Detect Microsoft sign-in interstitial.
      await sleep(1500);
      const probe = (await browserClient.snapshot(targetId, {
        format: 'aria',
        compact: true,
        depth: 4,
      })) as { url?: string };
      const probeUrl = typeof probe?.url === 'string' ? probe.url : '';
      if (/login\.microsoftonline\.com|login\.microsoft\.com/.test(probeUrl)) {
        this.transition(
          'awaiting-signin',
          'Microsoft sign-in is required. Complete sign-in (and MFA) in the Chrome window that just opened, then say "go" or click Continue.',
        );
        return this.snapshot();
      }

      // 5. Snapshot + plan.
      await this.planFields(targetId);
      this.transition('preview', 'Review the values below and confirm to submit.');
      return this.snapshot();
    } catch (err) {
      this.fail('UNKNOWN', err instanceof Error ? err.message : String(err));
      return this.snapshot();
    }
  }

  /** User signals "I finished sign-in, continue." */
  async resumeAfterSignin(): Promise<FillRunStatus> {
    if (!this.active || this.active.stage !== 'awaiting-signin') {
      throw new Error('Not currently waiting on Microsoft sign-in.');
    }
    if (!this.active.targetId) {
      this.fail('NO_TARGET', 'Browser tab missing.');
      return this.snapshot();
    }
    this.transition('snapshot', 'Reading the form…');
    await this.planFields(this.active.targetId);
    this.transition('preview', 'Review the values below and confirm to submit.');
    return this.snapshot();
  }

  /** User confirms the preview; we issue act:fill + submit. */
  async confirm(): Promise<FillRunStatus> {
    if (!this.active || this.active.stage !== 'preview' || !this.active.targetId) {
      throw new Error('No preview awaiting confirmation.');
    }
    this.transition('submit', 'Filling fields and submitting…');
    try {
      await this.applyFields(this.active.targetId);
      await this.clickSubmit(this.active.targetId);
      const idem = buildIdempotencyKey({
        kind: this.active.kind,
        payload: this.active.payload,
      } as FormPayload);
      await recordSubmission({
        kind: this.active.kind,
        key: idem,
        submittedAt: Date.now(),
      });
      this.transition('submitted', 'Form submitted.');
      const result = this.snapshot();
      this.active = null;
      return result;
    } catch (err) {
      this.fail('SUBMIT_FAILED', err instanceof Error ? err.message : String(err));
      return this.snapshot();
    }
  }

  async cancel(): Promise<FillRunStatus> {
    if (!this.active) throw new Error('Nothing to cancel.');
    this.transition('aborted', 'Cancelled.');
    const result = this.snapshot();
    this.active = null;
    return result;
  }

  status(): FillRunStatus | null {
    return this.active ? this.snapshot() : null;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async ensureBrowser(profile: 'user' | 'openclaw'): Promise<BrowserStatus> {
    let s = await browserClient.status(profile);
    if (!s.running) {
      await browserClient.start(profile);
      await sleep(1500);
      s = await browserClient.status(profile);
    }
    return s;
  }

  private async planFields(targetId: string): Promise<void> {
    if (!this.active) return;
    const snap = (await browserClient.snapshot(targetId, {
      format: 'aria',
      refs: 'aria',
      interactive: true,
      compact: false,
      labels: true,
    })) as { tree?: unknown };
    const fields = extractFormFields(snap?.tree);
    const { plan, unmatched } = mapPayloadToFields(
      this.active.kind,
      // Field hints index the typed payload by dynamic key (double cast:
      // the payload types have no index signature).
      this.active.payload as unknown as Record<string, unknown>,
      fields,
    );
    this.active.fieldPlan = plan;
    this.active.unmatched = unmatched;
  }

  private async applyFields(targetId: string): Promise<void> {
    if (!this.active?.fieldPlan?.length) return;
    const fillBatch = this.active.fieldPlan
      .filter((f) => f.type === 'text' || f.type === 'number' || f.type === 'select')
      .map((f) => ({
        ref: f.ref,
        value: String(f.value),
        type: f.type === 'number' ? 'text' : f.type,
      }));
    if (fillBatch.length > 0) {
      await browserClient.act(targetId, { kind: 'fill', fields: fillBatch });
    }
    for (const f of this.active.fieldPlan) {
      if (f.type === 'radio' || f.type === 'checkbox') {
        await browserClient.act(targetId, { kind: 'click', ref: f.ref });
      }
    }
  }

  private async clickSubmit(targetId: string): Promise<void> {
    // Try common Microsoft Forms submit-button labels.
    const tryLabels = ['Submit', 'Send', 'Finish'];
    for (const label of tryLabels) {
      try {
        await browserClient.act(targetId, {
          kind: 'click',
          selector: `button:has-text("${label}")`,
        });
        return;
      } catch {
        // try next label
      }
    }
    throw new Error('Could not find Submit button.');
  }

  private transition(stage: FillStage, message?: string): void {
    if (!this.active) return;
    this.active.stage = stage;
    this.emitStatus(message);
  }

  private fail(code: string, message: string): void {
    if (!this.active) return;
    this.active.stage = 'error';
    logger.error(`[moe-form-filler] ${code}: ${message}`);
    this.emit('status', {
      runId: this.active.runId,
      kind: this.active.kind,
      stage: 'error',
      error: { code, message },
    } satisfies FillRunStatus);
  }

  private snapshot(): FillRunStatus {
    if (!this.active) {
      return { runId: '', kind: 'daily-report', stage: 'aborted' };
    }
    const preview = buildPreview(this.active);
    return {
      runId: this.active.runId,
      kind: this.active.kind,
      stage: this.active.stage,
      preview,
    };
  }

  private emitStatus(message?: string): void {
    if (!this.active) return;
    const s = this.snapshot();
    if (message) s.message = message;
    this.emit('status', s);
  }
}

function buildIdempotencyKey(form: FormPayload): string {
  if (form.kind === 'daily-report') {
    return form.payload.date ?? new Date().toISOString().slice(0, 10);
  }
  const p = form.payload;
  return `${p.dateOfSuspension}:${p.studentInitial}:${p.standard}`;
}

function buildPreview(active: ActiveRun): Record<string, unknown> {
  return {
    payload: active.payload,
    fieldPlan: active.fieldPlan?.map((f) => ({
      question: f.questionText,
      value: f.value,
      from: f.payloadKey,
    })),
    unmatched: active.unmatched ?? [],
  };
}

interface FormFieldNode {
  ref: string;
  role: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'radio' | 'checkbox';
}

function extractFormFields(tree: unknown): FormFieldNode[] {
  const out: FormFieldNode[] = [];
  function visit(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    const role = typeof n.role === 'string' ? n.role : '';
    const label = typeof n.name === 'string' ? n.name : (typeof n.label === 'string' ? n.label : '');
    const ref = typeof n.ref === 'string' ? n.ref : '';
    if (ref) {
      if (role === 'textbox' || role === 'spinbutton') {
        out.push({ ref, role, label, type: role === 'spinbutton' ? 'number' : 'text' });
      } else if (role === 'combobox' || role === 'listbox') {
        out.push({ ref, role, label, type: 'select' });
      } else if (role === 'radio') {
        out.push({ ref, role, label, type: 'radio' });
      } else if (role === 'checkbox') {
        out.push({ ref, role, label, type: 'checkbox' });
      }
    }
    if (Array.isArray(n.children)) for (const c of n.children) visit(c);
  }
  visit(tree);
  return out;
}

const DAILY_REPORT_FIELD_HINTS: Record<keyof DailyReportPayload, string[]> = {
  date: ['date being reported', 'date'],
  educationDistrict: ['education district', 'district'],
  schoolType: ['school type'],
  schoolName: ['name of school', 'name of primary school', 'school'],
  teachersPresent: ['teachers present'],
  teachersAbsent: ['teachers absent'],
  pupilsPresent: ['pupils present', 'students present'],
  pupilsAbsent: ['pupils absent', 'students absent'],
  mealsDistributed: ['meals distributed', 'nsdsl meals'],
  mealsRating: ['rate', 'meals rating', 'meal rating'],
  mealsNotes: ['meals comment', 'meals note'],
  disciplineIncidents: ['discipline'],
  transportIssues: ['transport'],
  weeklyAbsenteesNotes: ['weekly absentee', 'absentee summary'],
  otherNotes: ['anything else', 'other'],
};

const SUSPENSION_FIELD_HINTS: Record<keyof SuspensionPayload, string[]> = {
  educationDistrict: ['education district', 'district'],
  schoolType: ['school type'],
  schoolName: ['name of school', 'school'],
  studentInitial: ["student's first initial", 'first initial', 'student initial'],
  gender: ['gender', 'sex'],
  standard: ['standard', 'class'],
  reason: ['reason', 'nature of incident'],
  lengthDays: ['length of suspension', 'days', 'duration'],
  parentContacted: ['parent contacted', 'guardian contacted'],
  dateOfIncident: ['date of incident'],
  dateOfSuspension: ['date of suspension', 'date suspended'],
};

function mapPayloadToFields(
  kind: FormKind,
  payload: Record<string, unknown>,
  fields: FormFieldNode[],
): { plan: FieldPlan[]; unmatched: string[] } {
  const hints = kind === 'daily-report' ? DAILY_REPORT_FIELD_HINTS : SUSPENSION_FIELD_HINTS;
  const plan: FieldPlan[] = [];
  const unmatched: string[] = [];

  for (const [key, hintList] of Object.entries(hints) as Array<[string, string[]]>) {
    const value = payload[key];
    if (value === undefined || value === null || value === '') continue;
    const match = fields.find((f) =>
      hintList.some((h) => f.label.toLowerCase().includes(h)),
    );
    if (!match) {
      unmatched.push(key);
      continue;
    }
    plan.push({
      questionText: match.label,
      ref: match.ref,
      value: value as string | number | boolean,
      type: match.type,
      payloadKey: key,
    });
  }
  return { plan, unmatched };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const moeFormFillerManager = new MoeFormFillerManager();
