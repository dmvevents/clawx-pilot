/**
 * Automation-owned Outlook subject allowlist (CLWX-58/70).
 *
 * The compose auto-recovery path and the drafts sweeper may ONLY discard
 * drafts the automation itself authored. Ownership is decided by subject
 * shape; anything a principal might have written must never match. The
 * patterns mirror scripts/outlook-drafts-sweeper.ts — extend both together.
 */
export const AUTOMATION_SUBJECT_RE =
  /\b(eval \d{2}:\d{2}:\d{2}|MoE smoke \d{2}:\d{2}:\d{2}|Testing ClawX|Testing Email Features)/i;

export function isAutomationSubject(subject: string | null | undefined): boolean {
  return AUTOMATION_SUBJECT_RE.test((subject ?? '').trim());
}
