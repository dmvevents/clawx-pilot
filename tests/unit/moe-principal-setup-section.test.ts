import { describe, expect, it } from 'vitest';
import {
  isAllowedMoEFormsUrl,
  validateMoEFormUrls,
} from '../../src/lib/moe-forms';

describe('MoE principal setup form URL validation', () => {
  it('accepts empty links so principals can configure one form at a time', () => {
    expect(validateMoEFormUrls({})).toEqual([]);
    expect(isAllowedMoEFormsUrl('')).toBe(true);
  });

  it('accepts Microsoft Forms response links', () => {
    expect(isAllowedMoEFormsUrl('https://forms.office.com/Pages/ResponsePage.aspx?id=abc')).toBe(true);
    expect(isAllowedMoEFormsUrl('https://forms.office.com/r/abcDEF_123')).toBe(true);
    expect(isAllowedMoEFormsUrl('https://forms.cloud.microsoft/r/abcDEF-123')).toBe(true);
  });

  it('rejects non-Microsoft Forms links', () => {
    expect(isAllowedMoEFormsUrl('http://forms.office.com/r/abcDEF_123')).toBe(false);
    expect(isAllowedMoEFormsUrl('https://example.com/r/abcDEF_123')).toBe(false);
    expect(isAllowedMoEFormsUrl('https://forms.office.com/designpage.aspx')).toBe(false);
  });

  it('returns field-specific validation messages', () => {
    expect(
      validateMoEFormUrls({
        dailyReport: 'https://example.com/report',
        suspension: 'https://forms.office.com/r/suspension123',
      }),
    ).toEqual(['Daily Report link must be a Microsoft Forms response link.']);

    expect(
      validateMoEFormUrls({
        dailyReport: 'https://forms.office.com/r/report123',
        suspension: 'https://example.com/suspension',
      }),
    ).toEqual(['Suspension link must be a Microsoft Forms response link.']);
  });
});
