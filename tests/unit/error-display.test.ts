import { describe, expect, it } from 'vitest';
import { principalErrorDisplay, isTransportDisplayKind, errorBannerVisibility } from '@/lib/error-display';

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

  it('keeps the renderer no-response watchdog copy out of the busy/quota bucket', () => {
    const display = principalErrorDisplay(
      'No response received from the model. Your message was kept here, but the assistant did not finish in time. Try again when ready.',
    );

    expect(display.kind).toBe('unreachable');
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

describe('errorBannerVisibility', () => {
  const kinds = (runErrorKind: 'unreachable' | 'rate-limited' | 'auth-config' | 'generic', errorKind: typeof runErrorKind = 'generic') => ({ runErrorKind, errorKind });

  it('suppresses transport-class banners only while a notice is explaining a failure', () => {
    const v = errorBannerVisibility({
      runError: 'Connection error.', error: null,
      ...kinds('unreachable'),
      degradeNotice: { resent: false },
    });
    expect(v.showRunError).toBe(false);
  });

  it('a success-claiming notice (resent) never suppresses a failure (failed resend stays visible)', () => {
    const v = errorBannerVisibility({
      runError: 'Connection error.', error: null,
      ...kinds('unreachable'),
      degradeNotice: { resent: true },
    });
    expect(v.showRunError).toBe(true);
  });

  it('an in-progress switch suppresses the duplicate transport banner (one surface, not two)', () => {
    // The progress notice added for the silent-cutover-wait fix carries the root
    // cause itself ("no internet — switching to the model on this device"), so a
    // red "could not be reached" banner beneath it is the same failure told
    // twice. It reads as two problems to a principal, which was the trust-lens
    // MEDIUM alongside the silent wait (principal-proxy, 2026-09-06).
    const v = errorBannerVisibility({
      runError: 'Connection error.', error: 'fetch failed',
      runErrorKind: 'unreachable', errorKind: 'unreachable',
      degradeNotice: { resent: false, inProgress: true } as never,
    });
    expect(v.showRunError).toBe(false);
    expect(v.showErrorBar).toBe(false);
  });

  it('auth/config and generic banners always show, notice or not', () => {
    for (const kind of ['auth-config', 'generic'] as const) {
      const v = errorBannerVisibility({
        runError: '401 Unauthorized', error: null,
        ...kinds(kind),
        degradeNotice: { resent: false },
      });
      expect(v.showRunError).toBe(true);
    }
  });

  it('shows banners normally with no notice', () => {
    const v = errorBannerVisibility({
      runError: 'Connection error.', error: 'other failure',
      runErrorKind: 'unreachable', errorKind: 'generic',
      degradeNotice: null,
    });
    expect(v.showRunError).toBe(true);
    expect(v.showErrorBar).toBe(true);
  });

  it('the error bar never duplicates the callout verbatim but shows a distinct failure', () => {
    const dup = errorBannerVisibility({
      runError: 'Connection error.', error: 'Connection error.',
      runErrorKind: 'unreachable', errorKind: 'unreachable',
      degradeNotice: null,
    });
    expect(dup.showRunError).toBe(true);
    expect(dup.showErrorBar).toBe(false);

    const distinct = errorBannerVisibility({
      runError: 'Connection error.', error: '401 Unauthorized',
      runErrorKind: 'unreachable', errorKind: 'auth-config',
      degradeNotice: { resent: false },
    });
    expect(distinct.showErrorBar).toBe(true);
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
