import { describe, expect, it } from 'vitest';
import { principalErrorDisplay } from '@/lib/error-display';

describe('principalErrorDisplay', () => {
  it('classifies the tester-reported raw HTTP strings away from the headline', () => {
    // CLWX-53: "Model call failed / 400 status code (no body)" must not be the
    // primary text. 400 is neither auth nor network → generic wording, raw
    // string preserved as detail.
    const display = principalErrorDisplay('400 status code (no body)');
    expect(display.kind).toBe('generic');
    expect(display.detail).toBe('400 status code (no body)');
  });

  it('classifies transport failures as unreachable', () => {
    for (const raw of [
      'Connection error.',
      'fetch failed',
      'ECONNREFUSED 127.0.0.1:443',
      'getaddrinfo ENOTFOUND generativelanguage.googleapis.com',
      'LLM idle timeout (60s): no response from model',
    ]) {
      expect(principalErrorDisplay(raw).kind).toBe('unreachable');
    }
  });

  it('classifies throttling and quota exhaustion as rate-limited', () => {
    for (const raw of ['429 Too Many Requests', 'quota exceeded for this project', 'rate limit reached']) {
      expect(principalErrorDisplay(raw).kind).toBe('rate-limited');
    }
  });

  it('classifies auth/config failures distinctly so they surface, never degrade', () => {
    for (const raw of [
      '401 Unauthorized',
      '403 Forbidden',
      'invalid api key provided',
      'missing subscription key',
      'authentication failed for tenant',
    ]) {
      expect(principalErrorDisplay(raw).kind).toBe('auth-config');
    }
  });

  it('lets an auth signal win over a network-looking substring in the same message', () => {
    expect(principalErrorDisplay('fetch failed: 401 Unauthorized from upstream').kind).toBe('auth-config');
  });

  it('handles empty and null input as generic with empty detail', () => {
    expect(principalErrorDisplay(null)).toEqual({ kind: 'generic', detail: '' });
    expect(principalErrorDisplay('   ')).toEqual({ kind: 'generic', detail: '' });
    expect(principalErrorDisplay(undefined)).toEqual({ kind: 'generic', detail: '' });
  });

  it('always preserves the raw string as detail', () => {
    const raw = 'Model call failed Connection error.';
    expect(principalErrorDisplay(raw).detail).toBe(raw);
  });
});
