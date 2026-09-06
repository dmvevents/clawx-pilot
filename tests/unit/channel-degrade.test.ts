import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  isSessionModelCutoverConfirmed,
  parseModelRef,
  shouldDegradeToOnDevice,
  shouldPromptSwitchToOnline,
  type DegradeContext,
  type OnDeviceOutageContext,
} from '../../src/lib/channel-degrade';

const online: DegradeContext = {
  activeChannel: 'online',
  onDeviceAvailable: true,
  alreadyDegraded: false,
};

// A dead on-device turn with Online configured to switch to: the K13 case.
const onDeviceOutage: OnDeviceOutageContext = {
  activeChannel: 'on-device',
  onlineAvailable: true,
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
      // The exact synthetic string the chat store's stall watchdog feeds into
      // maybeDegradeChannel when a send goes 90s with no stream event at all
      // (CLWX-78 residual, chat.ts checkStuck). It MUST classify as unreachable
      // or the watchdog degrade becomes a no-op — pin the coupling here.
      'provider unreachable: no response from model',
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

describe('shouldPromptSwitchToOnline', () => {
  it('prompts a switch to Online when the on-device model dies', () => {
    // The external tester's real failure (K13): a dead local model surfaced six
    // raw "Connection error." lines with no way forward. Now it offers a switch.
    const d = shouldPromptSwitchToOnline('Connection error.', onDeviceOutage);
    expect(d.promptSwitchToOnline).toBe(true);
    expect(d.reason).toBe('unreachable');
  });

  it('never auto-sends off-box: the switch stays the principal\'s choice', () => {
    // The privacy line. Unlike cloud -> on-device (which keeps data local), this
    // direction would move the turn to the cloud, so it is only ever a prompt —
    // the decision shape carries no "degrade" or "resend", by design.
    const d = shouldPromptSwitchToOnline('Connection error.', onDeviceOutage);
    expect(d).toEqual({ promptSwitchToOnline: true, reason: 'unreachable' });
    expect(d).not.toHaveProperty('degrade');
    expect(d).not.toHaveProperty('resend');
  });

  it('never fires when the failed turn was already on Online', () => {
    const d = shouldPromptSwitchToOnline('fetch failed', {
      ...onDeviceOutage,
      activeChannel: 'online',
    });
    expect(d.promptSwitchToOnline).toBe(false);
  });

  it('surfaces the real error when there is no Online account to reach', () => {
    // Can't promise a switch we cannot make; the now-readable error stays up.
    const d = shouldPromptSwitchToOnline('fetch failed', {
      ...onDeviceOutage,
      onlineAvailable: false,
    });
    expect(d.promptSwitchToOnline).toBe(false);
    expect(d.reason).toBe('unreachable');
  });

  it('prompts on a fleet 429 as well, and reports it as rate-limited', () => {
    const d = shouldPromptSwitchToOnline('HTTP 429 Too Many Requests', onDeviceOutage);
    expect(d.promptSwitchToOnline).toBe(true);
    expect(d.reason).toBe('rate-limited');
  });

  it('never prompts for a real error (auth / content filter): it must surface', () => {
    for (const err of ['HTTP 401 unauthorized', 'content filter triggered', 'MODEL_NOT_ALLOWED']) {
      const d = shouldPromptSwitchToOnline(err, onDeviceOutage);
      expect(d.promptSwitchToOnline, err).toBe(false);
    }
  });

  it('does not prompt twice in one turn', () => {
    const d = shouldPromptSwitchToOnline('fetch failed', { ...onDeviceOutage, alreadyDegraded: true });
    expect(d.promptSwitchToOnline).toBe(false);
  });
});

describe('parseModelRef', () => {
  it('splits a provider/model ref', () => {
    expect(parseModelRef('ollama/qwen2.5:3b-instruct'))
      .toEqual({ provider: 'ollama', model: 'qwen2.5:3b-instruct' });
  });

  it('splits on the FIRST slash so a model id containing one survives', () => {
    // OpenRouter-style refs reach us as provider/vendor/model. Splitting on the
    // last slash would ask the gateway for the model "gemini-2.5-pro" under the
    // provider "openrouter/google", which resolves to nothing.
    expect(parseModelRef('openrouter/google/gemini-2.5-pro'))
      .toEqual({ provider: 'openrouter', model: 'google/gemini-2.5-pro' });
  });

  it('returns null for anything it cannot split into two halves', () => {
    for (const raw of ['', '   ', 'ollama', '/qwen2.5', 'ollama/', null, undefined]) {
      expect(parseModelRef(raw)).toBeNull();
    }
  });
});

describe('isSessionModelCutoverConfirmed', () => {
  const ack = (resolved: unknown) => ({ ok: true, key: 'agent:main:main', resolved });

  it('confirms when the gateway echoes back the requested provider and model', () => {
    expect(isSessionModelCutoverConfirmed(
      ack({ modelProvider: 'ollama', model: 'qwen2.5:3b-instruct' }),
      'ollama/qwen2.5:3b-instruct',
    )).toBe(true);
  });

  it('confirms when the readback carries the full provider/model ref', () => {
    // Tolerated so a gateway that echoes the qualified ref does not read as a
    // failed cutover and suppress every future failover.
    expect(isSessionModelCutoverConfirmed(
      ack({ modelProvider: 'ollama', model: 'ollama/qwen2.5:3b-instruct' }),
      'ollama/qwen2.5:3b-instruct',
    )).toBe(true);
  });

  it('is case-insensitive on both halves', () => {
    expect(isSessionModelCutoverConfirmed(
      ack({ modelProvider: 'Ollama', model: 'Qwen2.5:3B-Instruct' }),
      'ollama/qwen2.5:3b-instruct',
    )).toBe(true);
  });

  it('refuses a patch that landed on a different model', () => {
    // The exact silent failure: the patch succeeded, the turn still runs online.
    expect(isSessionModelCutoverConfirmed(
      ack({ modelProvider: 'google', model: 'gemini-2.5-pro' }),
      'ollama/qwen2.5:3b-instruct',
    )).toBe(false);
  });

  it('refuses a patch that landed on the right model under another provider', () => {
    expect(isSessionModelCutoverConfirmed(
      ack({ modelProvider: 'openrouter', model: 'qwen2.5:3b-instruct' }),
      'ollama/qwen2.5:3b-instruct',
    )).toBe(false);
  });

  it('fails closed on any acknowledgement it cannot read as a match', () => {
    // "The RPC did not throw" is not evidence. Every shape here must count as
    // unproven, because claiming a switch that did not happen sends the resend
    // straight back out on the provider that just failed.
    const modelRef = 'ollama/qwen2.5:3b-instruct';
    expect(isSessionModelCutoverConfirmed(undefined, modelRef)).toBe(false);
    expect(isSessionModelCutoverConfirmed(null, modelRef)).toBe(false);
    expect(isSessionModelCutoverConfirmed('ok', modelRef)).toBe(false);
    expect(isSessionModelCutoverConfirmed({ ok: true }, modelRef)).toBe(false);
    expect(isSessionModelCutoverConfirmed(ack(null), modelRef)).toBe(false);
    expect(isSessionModelCutoverConfirmed(ack({}), modelRef)).toBe(false);
    expect(isSessionModelCutoverConfirmed(ack({ modelProvider: 'ollama' }), modelRef)).toBe(false);
    expect(isSessionModelCutoverConfirmed(ack({ modelProvider: 'ollama', model: '' }), modelRef)).toBe(false);
  });

  it('refuses an unusable requested ref even when the ack looks fine', () => {
    expect(isSessionModelCutoverConfirmed(
      ack({ modelProvider: 'ollama', model: 'qwen2.5:3b-instruct' }),
      'qwen2.5:3b-instruct',
    )).toBe(false);
  });
});
