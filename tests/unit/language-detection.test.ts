import { describe, expect, it } from 'vitest';
import { resolveSupportedLanguage } from '../../shared/language';

describe('resolveSupportedLanguage', () => {
  it('returns English for the supported regional locale', () => {
    expect(resolveSupportedLanguage('en-US')).toBe('en');
    expect(resolveSupportedLanguage('en-GB')).toBe('en');
  });

  it('falls back to English for previously-supported and unsupported locales', () => {
    // Pilot deployment ships English only. Locales that were once supported
    // (zh, ja, ru) and any other unsupported locale all collapse to en.
    expect(resolveSupportedLanguage('zh-CN')).toBe('en');
    expect(resolveSupportedLanguage('ja_JP')).toBe('en');
    expect(resolveSupportedLanguage('ru')).toBe('en');
    expect(resolveSupportedLanguage('fr-FR')).toBe('en');
    expect(resolveSupportedLanguage('ko')).toBe('en');
  });

  it('falls back to English when locale is missing', () => {
    expect(resolveSupportedLanguage('')).toBe('en');
    expect(resolveSupportedLanguage(undefined)).toBe('en');
  });
});
