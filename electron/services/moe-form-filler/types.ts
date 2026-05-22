/**
 * Type contracts for the moe-form-filler service.
 *
 * The service drives OpenClaw's browser plugin to fill the Ministry of
 * Education's Microsoft Forms (Daily Report, Student Suspensions) on the
 * principal's behalf. The principal's existing Chrome session provides SSO,
 * so no new auth flow is needed at this layer.
 */

export type FormKind = 'daily-report' | 'suspension';

export interface DailyReportPayload {
  /** ISO date the report is for. Defaults to today (Trinidad & Tobago, UTC-4). */
  date?: string;
  educationDistrict: string;
  schoolType: 'Denominational' | 'Government';
  schoolName: string;
  teachersPresent: number;
  teachersAbsent: number;
  pupilsPresent: number;
  pupilsAbsent: number;
  mealsDistributed: number;
  mealsRating?: 'good' | 'acceptable' | 'unsatisfactory';
  mealsNotes?: string;
  disciplineIncidents?: string;
  transportIssues?: string;
  weeklyAbsenteesNotes?: string;
  otherNotes?: string;
}

export interface SuspensionPayload {
  educationDistrict: string;
  schoolType: 'Denominational' | 'Government';
  schoolName: string;
  /**
   * Pupil identifier — first initial only ("J"), the persona prompt enforces
   * redaction at draft time. We never accept a full name through this layer.
   */
  studentInitial: string;
  gender: 'Male' | 'Female';
  standard: 'Infant 1' | 'Infant 2' | 'Standard 1' | 'Standard 2' | 'Standard 3' | 'Standard 4' | 'Standard 5';
  reason: string;
  lengthDays: number;
  parentContacted: boolean;
  dateOfIncident: string;
  dateOfSuspension: string;
}

export type FormPayload =
  | { kind: 'daily-report'; payload: DailyReportPayload }
  | { kind: 'suspension'; payload: SuspensionPayload };

export type FillStage =
  | 'prepare'
  | 'navigate'
  | 'awaiting-signin'
  | 'snapshot'
  | 'preview'
  | 'awaiting-confirm'
  | 'submit'
  | 'submitted'
  | 'aborted'
  | 'error';

export interface FillRunStatus {
  runId: string;
  kind: FormKind;
  stage: FillStage;
  message?: string;
  /** Set when stage = 'preview' or beyond — the payload as it will be submitted. */
  preview?: Record<string, unknown>;
  /** Set when stage = 'submitted'. */
  submittedAt?: number;
  /** Set when stage = 'error'. */
  error?: { code: string; message: string };
}

export interface IdempotencyLedgerEntry {
  kind: FormKind;
  /** For daily-report, the report date ISO. For suspension, `${date}:${studentInitial}:${standard}`. */
  key: string;
  submittedAt: number;
}
