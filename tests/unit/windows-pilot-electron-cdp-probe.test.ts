// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';
import { isDailyReportFieldVisible } from '@electron/services/forms-browser-v2/daily-report-actions';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the probe is a CommonJS Windows CLI script.
const probeModule = require('../../windows-pilot/scripts/pilot-electron-cdp-probe.js') as {
  buildVisualAcceptance: (
    args: Record<string, unknown>,
    screenshotPath: string,
  ) => {
    allowedStatuses: string[];
    criteria: Array<{ id: string; accept: string; reject: string }>;
    electronScreenshotPath: string;
    modelPrompt: string;
    state: string;
  };
  summarizeChatHistory: (result: unknown, mode: string, verificationToken: string) => {
    scopedToCurrentPrompt: boolean;
    completed: boolean;
    finalAnswerEchoedMarker: boolean;
    expectedToolResultOk: boolean;
    expectedToolOnly: boolean;
    noBannedSideEffects: boolean;
    observedToolCalls: Array<{ name: string; inputTextSample?: string }>;
    observedToolResults: Array<{ name: string; isError: boolean }>;
    bannedToolCalls: Array<{ name: string; id?: string }>;
    bannedToolResults: Array<{ name: string; id?: string; isError: boolean }>;
  };
  isOutlookPageUrl: (url: string) => boolean;
  validateProbeSummary: (summary: unknown, args?: Record<string, unknown>) => {
    ok: boolean;
    reasons: string[];
  };
};

const {
  buildVisualAcceptance,
  isOutlookPageUrl,
  summarizeChatHistory,
  validateProbeSummary,
} = probeModule;

type ProbeSamples = {
  sampleDailyReportPayload: () => Record<string, unknown>;
  sampleSuspensionPayload: (marker?: string) => Record<string, unknown>;
};

type ProbeInternals = {
  summarizeHostApiCall: (
    result: unknown,
    summarizeData: (data: Record<string, unknown> | null) => Record<string, unknown>,
  ) => Record<string, unknown>;
};

type DailySchemaField = {
  id: string;
  required?: boolean;
  showWhen?: Record<string, string>;
};

type SuspensionSchemaField = {
  id: string;
  required?: boolean;
  showWhen?: Record<string, string>;
};

const probeScriptPath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-electron-cdp-probe.js');
const dailyReportSchemaPath = join(process.cwd(), 'extensions', 'moe-principal-assistant', 'forms', 'daily-report-schema.vlm.json');
const suspensionsSchemaPath = join(process.cwd(), 'extensions', 'moe-principal-assistant', 'forms', 'suspensions-schema.json');

function loadProbeSamples(): ProbeSamples {
  const source = readFileSync(probeScriptPath, 'utf8');
  const moduleShim = { exports: {} as Record<string, unknown> };
  runInNewContext(`${source}\nmodule.exports.__samples = { sampleDailyReportPayload, sampleSuspensionPayload };`, {
    Buffer,
    __dirname: dirname(probeScriptPath),
    __filename: probeScriptPath,
    console,
    exports: moduleShim.exports,
    module: moduleShim,
    process,
    require,
  });
  const samples = (moduleShim.exports as { __samples?: ProbeSamples }).__samples;
  if (!samples) {
    throw new Error('failed to load probe sample payload helpers');
  }
  return samples;
}

function loadProbeInternals(): ProbeInternals {
  const source = readFileSync(probeScriptPath, 'utf8');
  const moduleShim = { exports: {} as Record<string, unknown> };
  runInNewContext(`${source}\nmodule.exports.__internals = { summarizeHostApiCall };`, {
    Buffer,
    __dirname: dirname(probeScriptPath),
    __filename: probeScriptPath,
    console,
    exports: moduleShim.exports,
    module: moduleShim,
    process,
    require,
  });
  const internals = (moduleShim.exports as { __internals?: ProbeInternals }).__internals;
  if (!internals) {
    throw new Error('Failed to load probe internals');
  }
  return internals;
}

function visibleForPayload(rule: Record<string, string> | undefined, payload: Record<string, unknown>) {
  if (!rule) return true;
  return Object.entries(rule).every(([key, expected]) => payload[key] === expected);
}

function textMessage(role: string, text: string) {
  return {
    role,
    content: [{ type: 'text', text }],
  };
}

function toolCallMessage(name: string, id = `${name}-1`, input?: Record<string, unknown>) {
  return {
    role: 'assistant',
    stopReason: 'toolUse',
    content: [{ type: 'toolCall', name, id, input }],
  };
}

function toolResultMessage(name: string, isError = false, id = `${name}-1`) {
  return {
    role: 'toolResult',
    toolName: name,
    toolCallId: id,
    isError,
    content: [{ type: 'text', text: '{"status":"ok"}' }],
  };
}

function finalMessage(token: string) {
  return {
    role: 'assistant',
    stopReason: 'stop',
    content: [{ type: 'text', text: `Done. Verification token: ${token}` }],
  };
}

function history(messages: unknown[]) {
  return {
    success: true,
    result: { messages },
  };
}

describe('Windows Electron CDP probe transcript evaluator', () => {
  it('keeps the explicit confirmed-send probe on the reviewed-draft confirm-only path', () => {
    const source = readFileSync(probeScriptPath, 'utf8');

    expect(source).toContain("invokeHostApi(page, '/api/outlook/send', { confirm: true })");
    expect(source).not.toContain("invokeHostApi(page, '/api/outlook/send', { to, subject, body, confirm: true })");
  });

  it('recognizes all supported Outlook web hosts, including cloud.microsoft without .com', () => {
    expect(isOutlookPageUrl('https://outlook.office.com/mail/inbox')).toBe(true);
    expect(isOutlookPageUrl('https://outlook.office365.com/mail/inbox')).toBe(true);
    expect(isOutlookPageUrl('https://outlook.cloud.microsoft/mail/inbox')).toBe(true);
    expect(isOutlookPageUrl('https://outlook.live.com/mail/inbox')).toBe(true);
    expect(isOutlookPageUrl('https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=form')).toBe(false);
  });

  it('keeps the daily report smoke payload aligned with visible required schema fields', () => {
    const payload = loadProbeSamples().sampleDailyReportPayload();
    const schema = JSON.parse(readFileSync(dailyReportSchemaPath, 'utf8')) as { fields: DailySchemaField[] };
    const expectedFieldIds = schema.fields
      .filter((field) => field.required)
      .filter((field) => isDailyReportFieldVisible(field, payload))
      .map((field) => field.id);

    expect(expectedFieldIds).toHaveLength(30);
    expect(Object.keys(payload)).toEqual(expect.arrayContaining(expectedFieldIds));
    expect(expectedFieldIds.filter((fieldId) => payload[fieldId] === undefined || payload[fieldId] === null || payload[fieldId] === '')).toEqual([]);
  });

  it('keeps the suspension smoke payload aligned with visible required schema fields', () => {
    const payload = loadProbeSamples().sampleSuspensionPayload('TESTMARKER');
    const schema = JSON.parse(readFileSync(suspensionsSchemaPath, 'utf8')) as { sections: Array<{ fields: SuspensionSchemaField[] }> };
    const expectedFieldIds = schema.sections
      .flatMap((section) => section.fields)
      .filter((field) => field.required)
      .filter((field) => visibleForPayload(field.showWhen, payload))
      .map((field) => field.id);
    const browserFilledFieldIds = expectedFieldIds.filter((fieldId) => fieldId !== 'respondent_name');

    expect(expectedFieldIds).toHaveLength(32);
    expect(browserFilledFieldIds).toHaveLength(31);
    expect(Object.keys(payload)).toEqual(expect.arrayContaining(expectedFieldIds));
    expect(expectedFieldIds.filter((fieldId) => payload[fieldId] === undefined || payload[fieldId] === null || payload[fieldId] === '')).toEqual([]);
  });

  it('scopes to the current verification token after a long history', () => {
    const token = 'pilot-safe-chat-token';
    const olderMessages = Array.from({ length: 75 }, (_item, index) => textMessage('assistant', `older ${index}`));
    const summary = summarizeChatHistory(history([
      ...olderMessages,
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage('forms.list'),
      toolResultMessage('forms.list'),
      finalMessage(token),
    ]), 'forms-list', token);

    expect(summary.scopedToCurrentPrompt).toBe(true);
    expect(summary.completed).toBe(true);
    expect(summary.finalAnswerEchoedMarker).toBe(true);
    expect(summary.expectedToolResultOk).toBe(true);
    expect(summary.expectedToolOnly).toBe(true);
  });

  it('flags extra tool calls in exact-tool safe chat modes', () => {
    const token = 'pilot-safe-chat-token';
    const summary = summarizeChatHistory(history([
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage('outlook.open'),
      toolResultMessage('outlook.open'),
      toolCallMessage('outlook.read_inbox'),
      toolResultMessage('outlook.read_inbox'),
      finalMessage(token),
    ]), 'outlook-open', token);

    expect(summary.expectedToolResultOk).toBe(true);
    expect(summary.expectedToolOnly).toBe(false);
    expect(summary.observedToolCalls.map((tool) => tool.name)).toContain('outlook.read_inbox');
  });

  it('flags banned side-effect tools even when the final token is echoed', () => {
    const token = 'pilot-safe-chat-token';
    const summary = summarizeChatHistory(history([
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage('outlook.send_email'),
      toolResultMessage('outlook.send_email'),
      finalMessage(token),
    ]), 'custom', token);

    expect(summary.completed).toBe(true);
    expect(summary.finalAnswerEchoedMarker).toBe(true);
    expect(summary.noBannedSideEffects).toBe(false);
  });

  it.each([
    'outlook.download_attachment',
    'forms.submit_daily_report',
    'forms.submit_suspension',
  ])('flags %s as a banned safe-chat side effect', (toolName) => {
    const token = 'pilot-safe-chat-token';
    const summary = summarizeChatHistory(history([
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage(toolName),
      toolResultMessage(toolName),
      finalMessage(token),
    ]), 'custom', token);

    expect(summary.completed).toBe(true);
    expect(summary.finalAnswerEchoedMarker).toBe(true);
    expect(summary.noBannedSideEffects).toBe(false);
    expect(summary.bannedToolCalls).toEqual([expect.objectContaining({ name: toolName })]);
    expect(summary.bannedToolResults).toEqual([expect.objectContaining({ name: toolName })]);
  });

  it('captures reply-draft visual acceptance text without requiring a send', () => {
    const token = 'pilot-safe-chat-token';
    const summary = summarizeChatHistory(history([
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage('outlook.search_inbox', 'search-1', { fromContains: 'Karunesh', top: 10 }),
      toolResultMessage('outlook.search_inbox', false, 'search-1'),
      toolCallMessage('outlook.reply', 'reply-1', { id: 'message-1', body: 'Testing the reply feature' }),
      toolResultMessage('outlook.reply', false, 'reply-1'),
      {
        role: 'assistant',
        stopReason: 'stop',
        content: [{
          type: 'text',
          text: [
            'The reply draft is open in Outlook and ready for review.',
            'It has not been sent; sending requires your explicit confirmation.',
            `Verification token: ${token}`,
          ].join(' '),
        }],
      },
    ]), 'custom', token);

    expect(summary.observedToolCalls.map((tool) => tool.name)).toEqual([
      'outlook.search_inbox',
      'outlook.reply',
    ]);
    expect(summary.finalAnswerTextSample).toMatch(/draft .*open|open .*draft/i);
    expect(summary.finalAnswerTextSample).toMatch(/review/i);
    expect(summary.finalAnswerTextSample).toMatch(/not been sent|not sent/i);
    expect(summary.finalAnswerTextSample).toMatch(/confirmation/i);
    expect(summary.noBannedSideEffects).toBe(true);
    expect(summary.observedToolCalls.map((tool) => tool.name)).not.toContain('outlook.send_email');
  });

  it('captures bounded inbox-scan acceptance text from the final answer', () => {
    const token = 'pilot-safe-chat-token';
    const summary = summarizeChatHistory(history([
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage('outlook.search_inbox', 'search-1', {
        dateGte: '2026-06-01T00:00:00.000Z',
        dateLt: '2026-07-01T00:00:00.000Z',
        top: 200,
      }),
      toolResultMessage('outlook.search_inbox', false, 'search-1'),
      {
        role: 'assistant',
        stopReason: 'stop',
        content: [{
          type: 'text',
          text: [
            'I found June inbox messages from a recent bounded window.',
            'The scan checked 200 recent inbox rows, so this is not exhaustive and there may be more older June messages.',
            `Verification token: ${token}`,
          ].join(' '),
        }],
      },
    ]), 'custom', token);

    expect(summary.observedToolCalls).toEqual([
      expect.objectContaining({ name: 'outlook.search_inbox' }),
    ]);
    expect(summary.noBannedSideEffects).toBe(true);
    expect(summary.finalAnswerTextSample).toMatch(/June/i);
    expect(summary.finalAnswerTextSample).toMatch(/inbox|message/i);
    expect(summary.finalAnswerTextSample).toMatch(/bounded|recent|window|scanned/i);
    expect(summary.finalAnswerTextSample).toMatch(/not exhaustive|may be more/i);
    expect(summary.observedToolCalls.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      'outlook.reply',
      'outlook.send_email',
    ]));
  });

  it('records redacted tool input samples for document write audits', () => {
    const token = 'pilot-safe-chat-token';
    const summary = summarizeChatHistory(history([
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage('exec', 'exec-1', {
        command: 'Set-Content -Path summarize_excel.py -Value "print(1)"',
        token: 'secret-token',
      }),
      toolResultMessage('exec', false, 'exec-1'),
      finalMessage(token),
    ]), 'custom', token);

    expect(summary.observedToolCalls).toEqual([
      expect.objectContaining({
        name: 'exec',
        inputTextSample: expect.stringContaining('Set-Content'),
      }),
    ]);
    expect(summary.observedToolCalls[0]?.inputTextSample).toContain('[redacted]');
    expect(summary.observedToolCalls[0]?.inputTextSample).not.toContain('secret-token');
  });

  it('requires the expected tool result to be non-error', () => {
    const token = 'pilot-safe-chat-token';
    const summary = summarizeChatHistory(history([
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage('forms.list'),
      toolResultMessage('forms.list', true),
      finalMessage(token),
    ]), 'forms-list', token);

    expect(summary.expectedToolResultOk).toBe(false);
    expect(summary.observedToolResults).toEqual([
      expect.objectContaining({ name: 'forms.list', isError: true }),
    ]);
  });

  it('fails default validation when safe Host API checks fail', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      hostApi: {
        outlookOpen: { ok: false, error: 'timeout' },
        formsList: { ok: true },
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('hostapi outlook.open was not ok');
  });

  it('builds visual acceptance criteria for Outlook, Forms, and safe-chat evidence', () => {
    const visual = buildVisualAcceptance({
      safeChat: true,
      outlookSmoke: true,
      formsSmoke: true,
    }, 'C:\\Users\\clawxtest\\Downloads\\clawx-electron.png');
    const ids = visual.criteria.map((item) => item.id);

    expect(visual.state).toBe('PENDING_VISUAL_OR_VLM_REVIEW');
    expect(visual.allowedStatuses).toEqual(['PASS', 'YELLOW', 'RED']);
    expect(visual.electronScreenshotPath).toContain('clawx-electron.png');
    expect(visual.modelPrompt).toContain('redacted VM/browser evidence');
    expect(ids).toEqual(expect.arrayContaining([
      'electron-app-shell',
      'chat-not-stuck-thinking',
      'no-sensitive-visual-leak',
      'outlook-uses-app-tool-path',
      'outlook-start-state-matrix',
      'outlook-reply-draft-state',
      'outlook-inbox-scope-visible',
      'outlook-side-effect-refusal',
      'forms-preview-field-coverage',
      'safe-chat-current-turn',
    ]));
  });

  it('builds Outlook state-matrix visual acceptance criteria when requested', () => {
    const visual = buildVisualAcceptance({
      outlookStateMatrix: true,
    }, 'C:\\Users\\clawxtest\\Downloads\\clawx-electron.png');
    const ids = visual.criteria.map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining([
      'outlook-uses-app-tool-path',
      'outlook-start-state-matrix',
      'outlook-reply-draft-state',
      'outlook-inbox-scope-visible',
      'outlook-state-matrix-screenshots',
    ]));
    expect(visual.modelPrompt).toMatch(/redacted VM\/browser evidence/i);
  });

  it('validates the Outlook state matrix across risky starting folders', () => {
    const states = ['inbox', 'sent', 'drafts', 'archive', 'search', 'opened-message'].map((id) => ({
      id,
      status: 'ok',
      screenshotPath: `C:\\evidence\\${id}.png`,
      readInbox: { ok: true, result: { status: 'ok' } },
      readEmail: id === 'opened-message' ? { ok: true, result: { status: 'ok' } } : undefined,
    }));

    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      outlookStateMatrix: {
        skipped: false,
        ok: true,
        states,
      },
    }, { outlookStateMatrix: true });

    expect(validation).toEqual({ ok: true, reasons: [] });
  });

  it('preserves Host API call durations in probe summaries', () => {
    const { summarizeHostApiCall } = loadProbeInternals();

    expect(summarizeHostApiCall({
      ok: true,
      durationMs: 1234,
      data: {
        status: 200,
        json: {
          success: true,
          data: { status: 'ok', messages: [1, 2, 3] },
        },
      },
    }, (data) => ({
      status: data?.status,
      messageCount: Array.isArray(data?.messages) ? data.messages.length : 0,
    }))).toMatchObject({
      ok: true,
      status: 200,
      durationMs: 1234,
      result: { status: 'ok', messageCount: 3 },
    });

    expect(summarizeHostApiCall({
      ok: false,
      error: 'hostapi failed',
      durationMs: 4321,
    }, () => ({}))).toMatchObject({
      ok: false,
      error: 'hostapi failed',
      durationMs: 4321,
    });
  });

  it('fails the Outlook state matrix when a risky folder is missing or not normalized', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      outlookStateMatrix: {
        skipped: false,
        ok: false,
        states: [
          {
            id: 'sent',
            status: 'failed',
            screenshotPath: '',
            readInbox: { ok: true, result: { status: 'needs_signin' } },
          },
        ],
      },
    }, { outlookStateMatrix: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('outlook state matrix was not ok');
    expect(validation.reasons).toContain('outlook state matrix missing inbox');
    expect(validation.reasons).toContain('outlook state matrix sent status was failed');
    expect(validation.reasons).toContain('outlook state matrix sent screenshot path missing');
    expect(validation.reasons).toContain('outlook state matrix sent readInbox status was needs_signin');
  });

  it('requires visual acceptance evidence when the probe asks for it', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      outlookSmoke: {
        readInbox: { ok: true },
        sendWithoutConfirm: { ok: true, result: { status: 'refused', refused: true } },
        downloadWithoutConfirm: { ok: true, result: { status: 'refused', refused: true } },
      },
      visualAcceptance: { skipped: true },
      events: [],
    }, { outlookSmoke: true, visualAcceptance: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('visual acceptance criteria missing or skipped');
  });

  it('passes visual acceptance validation when required criteria and screenshot path are present', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      outlookSmoke: {
        readInbox: { ok: true },
        sendWithoutConfirm: { ok: true, result: { status: 'refused', refused: true } },
        downloadWithoutConfirm: { ok: true, result: { status: 'refused', refused: true } },
      },
      visualAcceptance: buildVisualAcceptance(
        { outlookSmoke: true },
        'C:\\Users\\clawxtest\\Downloads\\clawx-electron.png',
      ),
      events: [],
    }, { outlookSmoke: true, visualAcceptance: true });

    expect(validation).toEqual({ ok: true, reasons: [] });
  });

  it('fails visual acceptance validation when screenshot capture failed', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      visualAcceptance: buildVisualAcceptance(
        {},
        'C:\\Users\\clawxtest\\Downloads\\clawx-electron.png',
      ),
      events: [{ type: 'screenshot-error', text: 'capture failed' }],
    }, { visualAcceptance: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('visual acceptance screenshot capture failed');
  });

  it('fails safe chat validation when the model never completes the requested tool call', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      safeChat: {
        send: { success: true },
        history: {
          ok: true,
          scopedToCurrentPrompt: true,
          completed: false,
          finalAnswerEchoedMarker: false,
          expectedToolResultOk: false,
          expectedToolOnly: true,
          noBannedSideEffects: true,
        },
      },
    }, { safeChat: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('safe chat did not complete');
    expect(validation.reasons).toContain('expected tool result was not ok');
  });

  it('fails smoke validation when refusal gates do not refuse', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      outlookSmoke: {
        readInbox: { ok: true },
        sendWithoutConfirm: { ok: true, result: { status: 'sent', refused: false } },
        downloadWithoutConfirm: { ok: true, result: { status: 'refused', refused: true } },
      },
    }, { outlookSmoke: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('outlook send without confirm status was sent');
    expect(validation.reasons).toContain('outlook send without confirm was not refused');
  });

  it('fails forms smoke validation when previews do not fill the full smoke payload', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      formsSmoke: {
        dailyPreview: { ok: true, result: { status: 'previewed', filledCount: 29, errorCount: 0 } },
        dailySubmitWithoutConfirm: { ok: true, result: { status: 'refused', refused: true } },
        preview: { ok: true, result: { status: 'previewed', filledCount: 30, errorCount: 0 } },
        submitWithoutConfirm: { ok: true, result: { status: 'refused', refused: true } },
      },
    }, { formsSmoke: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('daily report preview filledCount was 29, expected at least 30');
    expect(validation.reasons).toContain('suspension preview filledCount was 30, expected at least 31');
  });

  it('fails forms smoke validation when previews report field errors', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      formsSmoke: {
        dailyPreview: { ok: true, result: { status: 'previewed', filledCount: 30, errorCount: 1 } },
        dailySubmitWithoutConfirm: { ok: true, result: { status: 'refused', refused: true } },
        preview: { ok: true, result: { status: 'previewed', filledCount: 31, errorCount: 2 } },
        submitWithoutConfirm: { ok: true, result: { status: 'refused', refused: true } },
      },
    }, { formsSmoke: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('daily report preview errorCount was 1');
    expect(validation.reasons).toContain('suspension preview errorCount was 2');
  });

  it('fails forms smoke validation when submit without confirm is accepted', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      formsSmoke: {
        dailyPreview: { ok: true, result: { status: 'previewed', filledCount: 30, errorCount: 0 } },
        dailySubmitWithoutConfirm: { ok: true, result: { status: 'submitted', refused: false } },
        preview: { ok: true, result: { status: 'previewed', filledCount: 31, errorCount: 0 } },
        submitWithoutConfirm: { ok: true, result: { status: 'submitted', refused: false } },
      },
    }, { formsSmoke: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('daily report submit without confirm status was submitted');
    expect(validation.reasons).toContain('daily report submit without confirm was not refused');
    expect(validation.reasons).toContain('suspension submit without confirm status was submitted');
    expect(validation.reasons).toContain('suspension submit without confirm was not refused');
  });

  it('fails draft validation when Outlook draft is not left open', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      emailDraft: {
        subject: 'Demo draft',
        toCount: 1,
        draft: { ok: true, result: { status: 'drafted', draftLeftOpen: false } },
        bodyInComposeBody: true,
        bodyInRecipientField: false,
        screenshotPath: 'compose.png',
      },
    }, { draftEmail: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('outlook draft was not left open');
  });

  it('passes draft validation when Outlook leaves the draft open with body in the compose editor', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      emailDraft: {
        subject: 'Demo draft',
        toCount: 1,
        draft: { ok: true, result: { status: 'drafted', draftLeftOpen: true } },
        bodyInComposeBody: true,
        bodyInRecipientField: false,
        screenshotPath: 'compose.png',
      },
    }, { draftEmail: true });

    expect(validation).toEqual({ ok: true, reasons: [] });
  });

  it('fails draft validation when the compose body text lands in a recipient field', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      emailDraft: {
        subject: 'Demo draft',
        toCount: 1,
        draft: { ok: true, result: { status: 'drafted', draftLeftOpen: true } },
        bodyInComposeBody: false,
        bodyInRecipientField: true,
        screenshotPath: 'compose.png',
      },
    }, { draftEmail: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('outlook draft body text was detected in a recipient field');
    expect(validation.reasons).toContain('outlook draft body text was not verified in the compose body');
  });

  it('fails confirmed send validation when draft or send results are incomplete', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      emailSend: {
        subject: 'Demo send',
        toCount: 1,
        draft: { ok: true, result: { status: 'drafted', draftLeftOpen: true } },
        send: { ok: true, result: { status: 'refused' } },
      },
    }, { sendEmail: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('outlook confirmed send status was refused');
  });

  it('passes confirmed send validation when draft and send both complete', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      emailSend: {
        subject: 'Demo send',
        toCount: 1,
        draft: { ok: true, result: { status: 'drafted', draftLeftOpen: true } },
        send: { ok: true, result: { status: 'sent' } },
      },
    }, { sendEmail: true });

    expect(validation).toEqual({ ok: true, reasons: [] });
  });

  it('passes reply matrix validation when reply, reply-all, and forward draft correctly', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      outlookReplyMatrix: {
        ok: true,
        noSend: true,
        observedHostApiPaths: [
          '/api/outlook/read-inbox',
          '/api/outlook/reply',
          '/api/outlook/reply',
          '/api/outlook/forward',
        ],
        steps: [
          {
            action: 'reply',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: true,
            bodyInRecipientField: false,
            screenshotPath: 'reply.png',
          },
          {
            action: 'replyAll',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: true,
            bodyInRecipientField: false,
            screenshotPath: 'reply-all.png',
          },
          {
            action: 'forward',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: true,
            bodyInRecipientField: false,
            screenshotPath: 'forward.png',
          },
        ],
      },
    }, { outlookReplyMatrix: true });

    expect(validation).toEqual({ ok: true, reasons: [] });
  });

  it('fails reply matrix validation when the no-send matrix observes a send call', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      outlookReplyMatrix: {
        ok: false,
        noSend: false,
        observedHostApiPaths: [
          '/api/outlook/read-inbox',
          '/api/outlook/reply',
          '/api/outlook/send',
          '/api/outlook/forward',
        ],
        steps: [
          {
            action: 'reply',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: true,
            bodyInRecipientField: false,
            screenshotPath: 'reply.png',
          },
          {
            action: 'replyAll',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: true,
            bodyInRecipientField: false,
            screenshotPath: 'reply-all.png',
          },
          {
            action: 'forward',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: true,
            bodyInRecipientField: false,
            screenshotPath: 'forward.png',
          },
        ],
      },
    }, { outlookReplyMatrix: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('outlook reply matrix sent an email or did not prove no-send mode');
    expect(validation.reasons).toContain('outlook reply matrix observed /api/outlook/send during no-send validation');
  });

  it('fails reply matrix validation when observed Host API paths are missing', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      outlookReplyMatrix: {
        ok: true,
        noSend: true,
        steps: [
          {
            action: 'reply',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: true,
            bodyInRecipientField: false,
            screenshotPath: 'reply.png',
          },
          {
            action: 'replyAll',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: true,
            bodyInRecipientField: false,
            screenshotPath: 'reply-all.png',
          },
          {
            action: 'forward',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: true,
            bodyInRecipientField: false,
            screenshotPath: 'forward.png',
          },
        ],
      },
    }, { outlookReplyMatrix: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('outlook reply matrix did not record observed Host API paths');
    expect(validation.reasons).toContain('outlook reply matrix did not observe the expected read/reply/reply-all/forward Host API calls');
  });

  it('fails reply matrix validation when body text lands in a recipient field', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      outlookReplyMatrix: {
        ok: false,
        noSend: true,
        steps: [
          {
            action: 'reply',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: false,
            bodyInRecipientField: true,
            screenshotPath: 'reply.png',
          },
          {
            action: 'replyAll',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: true,
            bodyInRecipientField: false,
            screenshotPath: 'reply-all.png',
          },
          {
            action: 'forward',
            status: 'drafted',
            draftLeftOpen: true,
            bodyInComposeBody: true,
            bodyInRecipientField: false,
            screenshotPath: 'forward.png',
          },
        ],
      },
    }, { outlookReplyMatrix: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('outlook reply matrix was not ok');
    expect(validation.reasons).toContain('outlook reply matrix reply body text was detected in a recipient field');
    expect(validation.reasons).toContain('outlook reply matrix reply body text was not verified in the compose body');
  });

  it('fails confirmed form submit validation when preview is incomplete', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      formsSubmit: {
        preview: { ok: true, result: { status: 'previewed', filledCount: 30, errorCount: 0 } },
        submit: { ok: true, result: { status: 'submitted' } },
      },
    }, { submitForms: true });

    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('suspension submit preview filledCount was 30, expected at least 31');
  });

  it('passes confirmed form submit validation when preview and submit both complete', () => {
    const validation = validateProbeSummary({
      state: 'ELECTRON_CDP_PROBE_DONE',
      renderer: { hasElectronInvoke: true },
      formsSubmit: {
        preview: { ok: true, result: { status: 'previewed', filledCount: 31, errorCount: 0 } },
        submit: { ok: true, result: { status: 'submitted' } },
      },
    }, { submitForms: true });

    expect(validation).toEqual({ ok: true, reasons: [] });
  });
});
