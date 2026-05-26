#!/usr/bin/env node
/**
 * Attach to the packaged Electron renderer over Chrome DevTools Protocol and
 * exercise the same IPC bridge the UI uses. This runs on the Windows pilot host.
 *
 * Safe by default:
 * - calls outlook.open only
 * - calls forms.list only
 * - never sends email
 * - never submits Forms
 *
 * Explicit side-effect flags:
 * - --send-email drafts and sends only with confirm:true
 * - --submit-forms previews and submits only with confirm:true
 *
 * - redacts tokens/passwords/URLs/email addresses from console output
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function parseArgs(argv) {
  const out = {
    endpoint: 'http://127.0.0.1:9223',
    artifactDir: path.join(os.homedir(), 'Downloads'),
    safeChat: false,
    safeChatMode: 'outlook-open',
    outlookSmoke: false,
    formsSmoke: false,
    sendEmail: false,
    emailTo: '',
    emailSubject: '',
    emailBody: '',
    submitForms: false,
    waitMs: 5000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--endpoint') out.endpoint = argv[++i] || out.endpoint;
    else if (arg === '--artifact-dir') out.artifactDir = argv[++i] || out.artifactDir;
    else if (arg === '--safe-chat') out.safeChat = true;
    else if (arg === '--safe-chat-mode') out.safeChatMode = argv[++i] || out.safeChatMode;
    else if (arg === '--outlook-smoke') out.outlookSmoke = true;
    else if (arg === '--forms-smoke') out.formsSmoke = true;
    else if (arg === '--send-email') out.sendEmail = true;
    else if (arg === '--email-to') out.emailTo = argv[++i] || out.emailTo;
    else if (arg === '--email-subject') out.emailSubject = argv[++i] || out.emailSubject;
    else if (arg === '--email-body') out.emailBody = argv[++i] || out.emailBody;
    else if (arg === '--submit-forms') out.submitForms = true;
    else if (arg === '--wait-ms') out.waitMs = Number(argv[++i] || out.waitMs);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node pilot-electron-cdp-probe.js [--endpoint URL] [--artifact-dir DIR] [--safe-chat] [--safe-chat-mode outlook-open|forms-list] [--outlook-smoke] [--forms-smoke] [--send-email --email-to ADDR [--email-subject TEXT] [--email-body TEXT]] [--submit-forms] [--wait-ms N]');
      process.exit(0);
    }
  }
  return out;
}

function appResourceDir() {
  if (process.env.CLAWX_APP_RESOURCES && fs.existsSync(process.env.CLAWX_APP_RESOURCES)) {
    return process.env.CLAWX_APP_RESOURCES;
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Programs', 'Ministry of Education', 'resources');
  }
  return process.cwd();
}

function candidateModuleDirs() {
  const resources = appResourceDir();
  return [
    process.env.PLAYWRIGHT_CORE_PATH,
    path.join(process.cwd(), 'node_modules', 'playwright-core'),
    path.join(__dirname, 'node_modules', 'playwright-core'),
    path.join(resources, 'node_modules', 'playwright-core'),
    path.join(resources, 'app.asar.unpacked', 'node_modules', 'playwright-core'),
    path.join(resources, 'openclaw', 'node_modules', 'playwright-core'),
    path.join(resources, 'openclaw', 'dist', 'extensions', 'browser', 'node_modules', 'playwright-core'),
    path.join(resources, 'openclaw', 'dist', 'extensions', 'diffs', 'node_modules', 'playwright-core'),
  ].filter(Boolean);
}

function requirePlaywright() {
  try {
    return { playwright: require('playwright-core'), source: 'node resolution' };
  } catch {
    // Fall through to explicit installed-app candidates.
  }

  for (const dir of candidateModuleDirs()) {
    const pkg = path.join(dir, 'package.json');
    if (!fs.existsSync(pkg)) continue;
    try {
      return { playwright: require(dir), source: dir };
    } catch {
      // Try the next candidate.
    }
  }

  const resources = appResourceDir();
  const extraNodeModules = [
    path.join(resources, 'node_modules'),
    path.join(resources, 'app.asar.unpacked', 'node_modules'),
    path.join(resources, 'openclaw', 'node_modules'),
  ].filter((dir) => fs.existsSync(dir));
  if (extraNodeModules.length > 0) {
    process.env.NODE_PATH = [process.env.NODE_PATH, ...extraNodeModules].filter(Boolean).join(path.delimiter);
    Module._initPaths();
    try {
      return { playwright: require('playwright-core'), source: `NODE_PATH=${extraNodeModules.join(';')}` };
    } catch {
      // Keep the final diagnostic below.
    }
  }

  throw new Error(`playwright-core not found. Tried: ${candidateModuleDirs().join(' | ')}`);
}

function redact(value, key = '') {
  if (value == null) return value;
  const lowerKey = String(key).toLowerCase();
  if (lowerKey.includes('token') || lowerKey.includes('password') || lowerKey.includes('authorization') || lowerKey.includes('secret')) {
    return '[redacted]';
  }
  if (lowerKey === 'url' || lowerKey.endsWith('url') || lowerKey.includes('websocket')) {
    return '[redacted-url]';
  }
  if (typeof value === 'string') {
    return value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]');
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (typeof value === 'object') {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = redact(childValue, childKey);
    }
    return out;
  }
  return value;
}

async function withTimeout(label, fn, ms = 60_000) {
  let timer;
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function findRendererPage(browser) {
  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  const inspected = [];

  for (const page of pages) {
    const info = {
      url: page.url(),
      title: await page.title().catch(() => ''),
      hasElectron: false,
      hasInvoke: false,
    };
    try {
      const flags = await page.evaluate(() => ({
        hasElectron: !!window.electron,
        hasInvoke: typeof window.electron?.ipcRenderer?.invoke === 'function',
        electronKeys: window.electron ? Object.keys(window.electron).slice(0, 20) : [],
      }));
      Object.assign(info, flags);
    } catch (error) {
      info.evalError = error instanceof Error ? error.message : String(error);
    }
    inspected.push(info);
    if (info.hasInvoke) return { page, inspected };
  }

  if (pages[0]) return { page: pages[0], inspected };
  throw new Error('No Electron renderer pages were exposed on the CDP endpoint.');
}

async function invokeHostApi(page, pathName, body = {}) {
  return page.evaluate(async ({ pathName: innerPath, body: innerBody }) => {
    const invoke = window.electron?.ipcRenderer?.invoke;
    if (typeof invoke !== 'function') {
      return {
        ok: false,
        error: 'window.electron.ipcRenderer.invoke unavailable',
        electronKeys: window.electron ? Object.keys(window.electron) : [],
      };
    }
    return invoke('hostapi:fetch', {
      path: innerPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(innerBody || {}),
    });
  }, { pathName, body });
}

function safeChatPrompt(mode, verificationToken) {
  if (mode === 'forms-list') {
    return [
      'Verification only.',
      `Verification token: ${verificationToken}.`,
      'Use the forms.list tool exactly once, then report the returned status and available form ids.',
      'Include the verification token in the final answer.',
      'Do not preview a form.',
      'Do not submit forms.',
      'Do not draft email.',
      'Do not send email.',
      'Do not read inbox contents.',
      'Do not use any other tool.',
    ].join(' ');
  }
  return [
    'Verification only.',
    `Verification token: ${verificationToken}.`,
    'Use the outlook.open tool exactly once, then report the returned status.',
    'Include the verification token in the final answer.',
    'Do not draft email.',
    'Do not send email.',
    'Do not reply or forward.',
    'Do not read inbox contents.',
    'Do not submit forms.',
    'Do not use any other tool.',
  ].join(' ');
}

function safeChatExpectedTool(mode) {
  return mode === 'forms-list' ? 'forms.list' : 'outlook.open';
}

async function sendSafeChat(page, mode, verificationToken) {
  const prompt = safeChatPrompt(mode, verificationToken);

  return page.evaluate(async ({ prompt: innerPrompt }) => {
    const invoke = window.electron?.ipcRenderer?.invoke;
    if (typeof invoke !== 'function') {
      return { success: false, error: 'window.electron.ipcRenderer.invoke unavailable' };
    }
    const idempotencyKey = `pilot-electron-cdp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return invoke(
      'gateway:rpc',
      'chat.send',
      {
        sessionKey: 'agent:main:main',
        message: innerPrompt,
        deliver: false,
        idempotencyKey,
      },
      120_000,
    );
  }, { prompt });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadChatHistory(page) {
  return page.evaluate(async () => {
    const invoke = window.electron?.ipcRenderer?.invoke;
    if (typeof invoke !== 'function') {
      return { success: false, error: 'window.electron.ipcRenderer.invoke unavailable' };
    }
    return invoke(
      'gateway:rpc',
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 40 },
      35_000,
    );
  });
}

function messageText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text || ''))
    .join(' ');
}

function summarizeMessage(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  const toolCalls = content
    .filter((part) => part?.type === 'toolCall')
    .map((part) => ({ name: part.name, id: part.id }));
  const text = content
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text || '').replace(/\s+/g, ' ').slice(0, 220));
  return {
    role: message?.role,
    toolName: message?.toolName,
    toolCallId: message?.toolCallId,
    isError: message?.isError,
    stopReason: message?.stopReason,
    toolCalls,
    text,
  };
}

function summarizeChatHistory(result, mode, verificationToken) {
  if (!result?.success) {
    return {
      ok: false,
      error: result?.error ?? 'chat.history failed',
    };
  }
  const messages = Array.isArray(result.result?.messages) ? result.result.messages : [];
  const expectedTool = safeChatExpectedTool(mode);
  const marker = verificationToken;
  let startIndex = -1;
  messages.forEach((message, index) => {
    if (message?.role === 'user' && messageText(message).includes(marker)) startIndex = index;
  });
  const scoped = startIndex >= 0 ? messages.slice(startIndex) : messages.slice(-12);
  const expectedToolResult = scoped.find((message) => message?.role === 'toolResult' && message.toolName === expectedTool);
  const finalAssistant = scoped.find((message) => message?.role === 'assistant' && message.stopReason === 'stop');
  return {
    ok: true,
    messageCount: messages.length,
    mode,
    verificationToken,
    expectedTool,
    scopedToCurrentPrompt: startIndex >= 0,
    completed: Boolean(finalAssistant),
    expectedToolResultOk: Boolean(expectedToolResult && expectedToolResult.isError !== true),
    recent: scoped.slice(-12).map(summarizeMessage),
  };
}

async function waitForSafeChatHistory(page, mode, verificationToken, timeoutMs = 60_000) {
  const started = Date.now();
  let lastSummary = { ok: false, error: 'chat.history not polled yet' };
  while (Date.now() - started < timeoutMs) {
    const result = await loadChatHistory(page);
    lastSummary = summarizeChatHistory(result, mode, verificationToken);
    if (
      lastSummary.ok
      && lastSummary.scopedToCurrentPrompt
      && lastSummary.completed
      && lastSummary.expectedToolResultOk
    ) {
      return lastSummary;
    }
    await sleep(1500);
  }
  return lastSummary;
}

function summarizeHostApiCall(result, summarizeData) {
  if (!result || result.ok === false) {
    return {
      ok: false,
      error: result?.error ?? 'unknown error',
    };
  }
  const json = result.data?.json;
  const data = json?.data ?? json?.result ?? null;
  return {
    ok: true,
    status: result.data?.status,
    result: summarizeData(data),
  };
}

async function runOutlookSmoke(page) {
  const readInbox = await withTimeout(
    'hostapi outlook.read-inbox',
    () => invokeHostApi(page, '/api/outlook/read-inbox', { top: 3 }),
    90_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  const sendWithoutConfirm = await withTimeout(
    'hostapi outlook.send confirm false',
    () => invokeHostApi(page, '/api/outlook/send', {
      to: 'nobody@example.invalid',
      subject: 'ClawX safety gate smoke',
      body: 'Safety gate check. This must not send.',
      confirm: false,
    }),
    60_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  const downloadWithoutConfirm = await withTimeout(
    'hostapi outlook.download-attachment confirm false',
    () => invokeHostApi(page, '/api/outlook/download-attachment', {
      id: 'safety-gate-smoke',
      filename: 'safety-gate-smoke.pdf',
      confirm: false,
    }),
    60_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return {
    readInbox: summarizeHostApiCall(readInbox, (data) => ({
      status: data?.status,
      messageCount: Array.isArray(data?.messages) ? data.messages.length : 0,
      message: data?.message,
    })),
    sendWithoutConfirm: summarizeHostApiCall(sendWithoutConfirm, (data) => ({
      status: data?.status,
      refused: data?.status === 'refused',
      reason: data?.reason,
    })),
    downloadWithoutConfirm: summarizeHostApiCall(downloadWithoutConfirm, (data) => ({
      status: data?.status,
      refused: data?.status === 'refused',
      reason: data?.reason,
    })),
  };
}

function runMarker() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function sampleSuspensionPayload(marker = runMarker()) {
  return {
    respondent_name: 'Demo Principal',
    education_district: 'Victoria',
    school_type: 'Government',
    school_name: 'Arouca Government Primary',
    perpetrator_name: `ClawX Test Student ${marker}`,
    perpetrator_sex: 'Male',
    perpetrator_dob: '2016-05-12',
    perpetrator_age: '10',
    student_birth_certificate_pin: 'TEST123456',
    class: 'Standard 4',
    date_of_infraction: '2026-05-25',
    date_of_issue_of_suspension: '2026-05-26',
    term_suspension_count: 1,
    infraction_when: 'During class time (member of staff present)',
    primary_infraction: 'Disorderly/Disruptive Conduct',
    additional_infractions_present: 'Yes',
    additional_infractions: ['Disrespect/Defiance of Authority'],
    victim_present: 'Yes',
    victim_type: 'Student of the same school',
    written_reports_collected: 'Yes',
    length_of_suspension: '2',
    extended_suspension_application: 'No',
    sssd_referral: 'No',
    parent_present_at_issue: 'Yes',
    parent_signed_notice: 'Yes',
    discipline_matrix_followed: 'Yes',
    level_of_offence: 'Minor',
    parent_name: 'Demo Guardian',
    parent_phone_1: 8685550100,
    address_house: '12',
    address_street: 'Demo Street',
    address_city: 'Arima',
  };
}

async function runOutlookSend(page, args) {
  const to = args.emailTo;
  if (!to) {
    return { ok: false, error: '--email-to is required with --send-email' };
  }
  const subject = args.emailSubject || `ClawX Windows service test ${new Date().toISOString()}`;
  const body = args.emailBody || [
    'This is a real end-to-end test email from the ClawX Windows pilot app.',
    `Timestamp: ${new Date().toISOString()}`,
    'Purpose: verify Outlook send through the installed app service path.',
  ].join('\n');

  const draft = await withTimeout(
    'hostapi outlook.draft',
    () => invokeHostApi(page, '/api/outlook/draft', { to, subject, body }),
    180_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  const draftData = draft?.data?.json?.data;
  if (!draft?.ok || draftData?.status !== 'drafted') {
    return {
      draft: summarizeHostApiCall(draft, (data) => ({
        status: data?.status,
        draftLeftOpen: data?.draftLeftOpen,
        message: data?.message,
      })),
      send: { skipped: true, reason: 'draft did not reach status=drafted' },
    };
  }

  const send = await withTimeout(
    'hostapi outlook.send confirm true',
    () => invokeHostApi(page, '/api/outlook/send', { to, subject, body, confirm: true }),
    180_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return {
    subject,
    bodyLength: body.length,
    draft: summarizeHostApiCall(draft, (data) => ({
      status: data?.status,
      draftLeftOpen: data?.draftLeftOpen,
      message: data?.message,
    })),
    send: summarizeHostApiCall(send, (data) => ({
      status: data?.status,
      message: data?.message,
      reason: data?.reason,
    })),
  };
}

async function runFormsSmoke(page) {
  const preview = await withTimeout(
    'hostapi forms.preview-suspension',
    () => invokeHostApi(page, '/api/forms/preview-suspension', { payload: sampleSuspensionPayload() }),
    120_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  const submitWithoutConfirm = await withTimeout(
    'hostapi forms.submit-suspension confirm false',
    () => invokeHostApi(page, '/api/forms/submit-suspension', { confirm: false }),
    60_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return {
    preview: summarizeHostApiCall(preview, (data) => ({
      status: data?.status,
      filledCount: data?.filledCount,
      skippedCount: data?.skippedCount,
      errorCount: Array.isArray(data?.errors) ? data.errors.length : undefined,
      errors: Array.isArray(data?.errors) ? data.errors.slice(0, 8) : undefined,
      reason: data?.reason,
    })),
    submitWithoutConfirm: summarizeHostApiCall(submitWithoutConfirm, (data) => ({
      status: data?.status,
      refused: data?.status === 'refused',
      reason: data?.reason,
    })),
  };
}

async function runFormsSubmit(page) {
  const marker = runMarker();
  const payload = sampleSuspensionPayload(marker);
  const preview = await withTimeout(
    'hostapi forms.preview-suspension',
    () => invokeHostApi(page, '/api/forms/preview-suspension', { payload }),
    180_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  const previewData = preview?.data?.json?.data;
  if (!preview?.ok || previewData?.status !== 'previewed' || (Array.isArray(previewData?.errors) && previewData.errors.length > 0)) {
    return {
      marker,
      preview: summarizeHostApiCall(preview, (data) => ({
        status: data?.status,
        filledCount: data?.filledCount,
        skippedCount: data?.skippedCount,
        errorCount: Array.isArray(data?.errors) ? data.errors.length : undefined,
        errors: Array.isArray(data?.errors) ? data.errors.slice(0, 8) : undefined,
        reason: data?.reason,
      })),
      submit: { skipped: true, reason: 'preview did not complete cleanly' },
    };
  }

  const submit = await withTimeout(
    'hostapi forms.submit-suspension confirm true',
    () => invokeHostApi(page, '/api/forms/submit-suspension', { confirm: true }),
    120_000,
  ).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return {
    marker,
    preview: summarizeHostApiCall(preview, (data) => ({
      status: data?.status,
      filledCount: data?.filledCount,
      skippedCount: data?.skippedCount,
      errorCount: Array.isArray(data?.errors) ? data.errors.length : undefined,
      errors: Array.isArray(data?.errors) ? data.errors.slice(0, 8) : undefined,
      reason: data?.reason,
    })),
    submit: summarizeHostApiCall(submit, (data) => ({
      status: data?.status,
      message: data?.message,
      reason: data?.reason,
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.artifactDir, { recursive: true });
  const screenshotPath = path.join(args.artifactDir, `clawx-electron-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);

  const { playwright, source } = requirePlaywright();
  const events = [];
  const browser = await withTimeout(
    'connectOverCDP',
    () => playwright.chromium.connectOverCDP(args.endpoint),
    20_000,
  );

  try {
    const { page, inspected } = await findRendererPage(browser);
    page.on('console', (msg) => {
      events.push({ type: 'console', level: msg.type(), text: msg.text().slice(0, 1000) });
    });
    page.on('pageerror', (error) => {
      events.push({ type: 'pageerror', text: error.message.slice(0, 1000) });
    });

    await page.waitForTimeout(500);
    const renderer = {
      url: page.url(),
      title: await page.title().catch(() => ''),
      hasElectronInvoke: await page.evaluate(() => typeof window.electron?.ipcRenderer?.invoke === 'function').catch(() => false),
    };

    await page.screenshot({ path: screenshotPath, fullPage: false }).catch((error) => {
      events.push({ type: 'screenshot-error', text: error instanceof Error ? error.message : String(error) });
    });

    const outlookOpen = await withTimeout('hostapi outlook.open', () => invokeHostApi(page, '/api/outlook/open'), 75_000)
      .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    const formsList = await withTimeout('hostapi forms.list', () => invokeHostApi(page, '/api/forms/list'), 75_000)
      .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

    const safeChatVerificationToken = args.safeChat
      ? `pilot-safe-chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
      : null;
    const safeChat = args.safeChat
      ? await withTimeout('gateway chat.send', () => sendSafeChat(page, args.safeChatMode, safeChatVerificationToken), 130_000)
        .catch((error) => ({ success: false, error: error instanceof Error ? error.message : String(error) }))
      : { skipped: true };
    const outlookSmoke = args.outlookSmoke
      ? await runOutlookSmoke(page)
      : { skipped: true };
    const formsSmoke = args.formsSmoke
      ? await runFormsSmoke(page)
      : { skipped: true };
    const emailSend = args.sendEmail
      ? await runOutlookSend(page, args)
      : { skipped: true };
    const formsSubmit = args.submitForms
      ? await runFormsSubmit(page)
      : { skipped: true };

    await page.waitForTimeout(Math.max(0, args.waitMs));
    const safeChatHistory = args.safeChat
      ? await withTimeout('gateway chat.history', () => waitForSafeChatHistory(page, args.safeChatMode, safeChatVerificationToken), 75_000)
        .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      : { skipped: true };

    const summary = {
      state: 'ELECTRON_CDP_PROBE_DONE',
      endpoint: args.endpoint,
      playwrightSource: source,
      renderer,
      inspectedPages: inspected,
      screenshotPath,
      hostApi: {
        outlookOpen,
        formsList,
      },
      outlookSmoke,
      formsSmoke,
      emailSend,
      formsSubmit,
      safeChat: {
        mode: args.safeChatMode,
        verificationToken: safeChatVerificationToken,
        send: safeChat,
        history: safeChatHistory,
      },
      eventCount: events.length,
      events: events.slice(-50),
    };

    const summaryPath = path.join(args.artifactDir, `clawx-electron-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(redact(summary), null, 2));
    console.log(JSON.stringify(redact({ ...summary, summaryPath }), null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(JSON.stringify(redact({
    state: 'ELECTRON_CDP_PROBE_FAILED',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }), null, 2));
  process.exit(1);
});
