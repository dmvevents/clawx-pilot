import { describe, expect, it } from 'vitest';
import { principalErrorDisplay, isTransportDisplayKind } from '@/lib/error-display';

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

  it('preserves an informative raw string as detail', () => {
    const raw = 'getaddrinfo ENOTFOUND generativelanguage.googleapis.com';
    expect(principalErrorDisplay(raw).detail).toBe(raw);
  });

  // moe.18 Finding D2: the packet's trust bar forbids the raw SDK transport
  // wrapper "Connection error." from reaching the UI even behind the
  // collapsed "Technical details" expander. The wrapper carries zero
  // diagnostic value beyond the classified kind, so display blanks it (the
  // expander then does not render); classification is unchanged.
  it('blanks the zero-information transport wrapper from the expander detail (D2)', () => {
    for (const raw of [
      'Connection error.',
      'Connection error',
      'connection error.',
      'Model call failed Connection error.',
      'Model call failed. Connection error.',
      'Model call failed: Connection error.',
    ]) {
      const display = principalErrorDisplay(raw);
      expect(display.kind).toBe('unreachable');
      expect(display.detail).toBe('');
    }
  });

  it('strips a rawError=Connection error fragment but keeps the informative remainder (D2)', () => {
    const display = principalErrorDisplay(
      'LLM request failed: network connection error. rawError=Connection error.',
    );
    expect(display.kind).toBe('unreachable');
    expect(display.detail).toBe('LLM request failed: network connection error.');
  });

  it('never blanks details for classes the degrade notice does not explain', () => {
    expect(principalErrorDisplay('401 Unauthorized').detail).toBe('401 Unauthorized');
    expect(principalErrorDisplay('400 status code (no body)').detail).toBe('400 status code (no body)');
  });
});

describe('isTransportDisplayKind', () => {
  // D0/D1 suppression contract: while the amber degrade notice explains a
  // transport failure, only these kinds may be suppressed as duplicates.
  // Auth/config and generic errors must always surface.
  it('marks exactly the two transport classes', () => {
    expect(isTransportDisplayKind('unreachable')).toBe(true);
    expect(isTransportDisplayKind('rate-limited')).toBe(true);
    expect(isTransportDisplayKind('auth-config')).toBe(false);
    expect(isTransportDisplayKind('generic')).toBe(false);
  });
});
