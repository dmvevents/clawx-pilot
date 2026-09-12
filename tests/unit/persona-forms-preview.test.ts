// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from '../../extensions/moe-principal-assistant/persona.mjs';

/**
 * CLWX-62 / moe.41 acceptance (2026-09-12): the forms-preview "not submitted" row
 * failed only because the reply did not say the form was not submitted, while every
 * hard signal (no confirmation page, Submit still present, no submit-class tool call)
 * was clean. A principal reading "here are the values I filled" cannot tell whether
 * the form reached the district office, and that is the one thing they must not have
 * to guess.
 *
 * Review MODERATE-3: the statement is CONDITIONAL on the observed state. A turn in
 * which the principal has already consented can preview and then submit, and the
 * assistant must not then say the form was not submitted.
 */
describe('form preview must state what actually happened (persona)', () => {
  const prompt = String(SYSTEM_PROMPT);

  it('tells the assistant to say the form was NOT submitted after a preview, unless it submitted in that reply', () => {
    expect(prompt).toMatch(/unless you have called forms_submit_daily_report in that same reply/i);
    expect(prompt).toMatch(/NOT been submitted/);
    expect(prompt).toMatch(/only submit it when the principal says so/i);
  });

  it('tells the assistant to report a same-reply submission with the tool confirmation instead', () => {
    expect(prompt).toMatch(/if you did submit it in that reply, say that instead, with the confirmation the tool returned/i);
  });

  it('tells the assistant to name an unfilled field instead of implying the form is ready', () => {
    expect(prompt).toMatch(/name it and say the form is incomplete/i);
  });

  it('keeps the submission gate: submit only after an explicit same-session yes', () => {
    expect(prompt).toMatch(/Only call forms_submit_daily_report after an explicit same-session "yes, submit"/);
  });
});
