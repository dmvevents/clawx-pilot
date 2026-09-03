import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  shouldDegradeToOnDevice,
  type DegradeContext,
} from '../../src/lib/channel-degrade';

const online: DegradeContext = {
  activeChannel: 'online',
  onDeviceAvailable: true,
  alreadyDegraded: false,
};

describe('classifyFailure', () => {
  it('classifies real Node/undici transport failures as unreachable', () => {
    // These are the strings that actually reach us, not invented ones.
    const cases = [
      'fetch failed',
      'TypeError: fetch failed',
      'connect ECONNREFUSED 127.0.0.1:443',
      'getaddrinfo ENOTFOUND moe-apim.azure-api.net',
      'connect ETIMEDOUT 20.119.16.4:443',
      'connect ENETUNREACH',
      'read ECONNRESET',
      'EAI_AGAIN moe-apim.azure-api.net',
      'socket hang up',
      'Failed to fetch',
      'provider unreachable',
      // The gateway's stalled-provider surface (IDLE-TIMEOUT-RAW, seen live
      // 2026-05-08): a cloud model that stops answering mid-turn must degrade,
      // not render the raw string.
      'LLM idle timeout (60s): no response from model',
      'llm idle timeout',
      'no response from model',
      // The OpenAI-SDK client's transport wrapper (DEGRADE-PATTERN-GAP, seen
      // live twice 2026-09-03: V-batch W10 hosts-block test + the external
      // tester's ollama-down turns): the bare string must degrade, not
      // render as "Model call failed Connection error."
      'Connection error.',
      'LLM request failed: network connection error. rawError=Connection error.',
      'Model call failed Connection error.',
    ];
    for (const c of cases) {
      expect(classifyFailure(c), c).toBe('unreachable');
    }
  });

  it('classifies APIM budget exhaustion and throttling as rate-limited', () => {
    // The Ministry gateway returns a bare 429 for BOTH per-second throttling and
    // monthly budget exhaustion, with no remaining-budget figure to tell them
    // apart (handoff doc s3.2). Both must degrade.
    const cases = [
      'HTTP 429',
      'Request failed with status code 429',
      '429 Too Many Requests',
      'rate limit exceeded',
      'rate-limited',
      'quota exceeded',
      'token budget exhausted',
      'insufficient quota',
      'request throttled',
    ];
    for (const c of cases) {
      expect(classifyFailure(c), c).toBe('rate-limited');
    }
  });

  it('never degrades auth failures, even though APIM returns them alongside 429', () => {
    // This is the most important negative case. The handoff doc s4.2 says a
    // 401/403 means a missing or wrong subscription key. Degrading would mask a
    // misconfiguration forever: the assistant would just be quietly always
    // on-device, and nobody would learn the key was wrong.
    const cases = [
      'HTTP 401',
      'HTTP 403 Forbidden',
      'Unauthorized',
      'invalid subscription key',
      'missing api key',
      'Authentication failed',
      'permission denied',
    ];
    for (const c of cases) {
      expect(classifyFailure(c), c).toBe('other');
    }
  });

  it('never degrades genuine model/prompt/tool errors', () => {
    const cases = [
      'context length exceeded',
      'maximum context window reached',
      'content filter triggered',
      'safety violation',
      'MODEL_NOT_ALLOWED',
      'tool call failed',
      'aborted by user',
    ];
    for (const c of cases) {
      expect(classifyFailure(c), c).toBe('other');
    }
  });

  it('fails closed: unrecognised errors are not network-class', () => {
    // A wrong "degrade" hides a real defect. A wrong "surface" shows an error we
    // would have shown anyway. So ambiguity must resolve to 'other'.
    for (const c of ['', '   ', 'Something went wrong', 'undefined is not a function']) {
      expect(classifyFailure(c), JSON.stringify(c)).toBe('other');
    }
    expect(classifyFailure(null)).toBe('other');
    expect(classifyFailure(undefined)).toBe('other');
  });

  it('lets a hard never-degrade signal win over a network-looking substring', () => {
    // Precedence test. Both signals are present in one message; auth must win,
    // because masking a bad key is the worse failure.
    expect(classifyFailure('401 Unauthorized after fetch failed')).toBe('other');
    expect(classifyFailure('invalid subscription key (ECONNRESET during retry)')).toBe('other');
    // And rate-limit beats unreachable, since a 429 is a definite server answer
    // whereas the transport words may be incidental retry noise.
    expect(classifyFailure('429 Too Many Requests; connection closed')).toBe('rate-limited');
  });
});

describe('shouldDegradeToOnDevice', () => {
  it('degrades a cloud turn that could not reach the provider', () => {
    const d = shouldDegradeToOnDevice('fetch failed', online);
    expect(d).toEqual({ degrade: true, resend: true, reason: 'unreachable' });
  });

  it('degrades a cloud turn refused by the fleet token budget', () => {
    // The fleet-wide 429 scenario: without this, one principal exhausting the
    // shared APIM bucket makes EVERY principal's assistant error at once.
    const d = shouldDegradeToOnDevice('HTTP 429 Too Many Requests', online);
    expect(d).toEqual({ degrade: true, resend: true, reason: 'rate-limited' });
  });

  it('degrades the channel but will not replay a turn that already ran tools', () => {
    // A turn that got as far as opening a compose pane or reading a mailbox
    // must not be resent unattended. The principal's own resend then lands
    // on-device, because the channel moved.
    const d = shouldDegradeToOnDevice('fetch failed', { ...online, toolsRan: true });
    expect(d.degrade).toBe(true);
    expect(d.resend).toBe(false);
  });

  it('does not resend when the message text is gone', () => {
    const d = shouldDegradeToOnDevice('fetch failed', { ...online, haveMessageText: false });
    expect(d.degrade).toBe(true);
    expect(d.resend).toBe(false);
  });

  it('never resends a turn it is not degrading', () => {
    // resend must be a subset of degrade — a resend on the same failing
    // channel would just fail again, and on a non-degraded error it would
    // replay a turn the user has not seen the error for.
    for (const err of ['HTTP 401', 'content filter triggered', 'Something went wrong']) {
      const d = shouldDegradeToOnDevice(err, online);
      expect(d.resend, err).toBe(false);
    }
    expect(shouldDegradeToOnDevice('fetch failed', { ...online, alreadyDegraded: true }).resend).toBe(false);
    expect(shouldDegradeToOnDevice('fetch failed', { ...online, onDeviceAvailable: false }).resend).toBe(false);
  });

  it('surfaces a real error instead of hiding it behind a model swap', () => {
    expect(shouldDegradeToOnDevice('content filter triggered', online).degrade).toBe(false);
    expect(shouldDegradeToOnDevice('HTTP 401', online).degrade).toBe(false);
  });

  it('does not degrade an on-device turn — there is nowhere to go', () => {
    const d = shouldDegradeToOnDevice('fetch failed', {
      ...online,
      activeChannel: 'on-device',
    });
    expect(d.degrade).toBe(false);
  });

  it('does not degrade when no on-device account exists', () => {
    const d = shouldDegradeToOnDevice('fetch failed', {
      ...online,
      onDeviceAvailable: false,
    });
    expect(d.degrade).toBe(false);
  });

  it('degrades at most once per turn, so a dead local runtime cannot ping-pong', () => {
    const d = shouldDegradeToOnDevice('fetch failed', {
      ...online,
      alreadyDegraded: true,
    });
    expect(d.degrade).toBe(false);
  });

  it('reports the reason even when it declines to degrade', () => {
    // The caller logs this; losing the classification would make an on-device
    // outage indistinguishable from a cloud one in the logs.
    const d = shouldDegradeToOnDevice('fetch failed', {
      ...online,
      activeChannel: 'on-device',
    });
    expect(d.reason).toBe('unreachable');
  });
});
