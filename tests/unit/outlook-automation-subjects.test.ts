import { describe, expect, it } from 'vitest';
import { isAutomationSubject } from '../../electron/services/outlook-browser-v2/automation-subjects';

describe('isAutomationSubject (CLWX-58/70 ownership gate)', () => {
  it('matches every automation-authored subject shape the harnesses produce', () => {
    const cases = [
      'eval 02:49:17',
      'Re: eval 02:49:17',
      'MoE smoke 01:51:08',
      'Re: MoE smoke 06:31:23',
      'Testing ClawX Sending Feature',
      'Testing Email Features',
    ];
    for (const s of cases) expect(isAutomationSubject(s), s).toBe(true);
  });

  it('never matches subjects a principal might write', () => {
    const cases = [
      'Re: PTA meeting on Friday',
      'Suspension report for Student A',
      'Daily report follow-up',
      'Testing schedule for Standard 5', // contains "Testing" but not an automation shape
      'eval results for the science fair', // "eval" without the hh:mm:ss shape
      'smoke detectors maintenance', // "smoke" without the MoE prefix shape
      '',
      '   ',
    ];
    for (const s of cases) expect(isAutomationSubject(s), s || '<empty>').toBe(false);
  });

  it('tolerates null and undefined', () => {
    expect(isAutomationSubject(null)).toBe(false);
    expect(isAutomationSubject(undefined)).toBe(false);
  });
});
