// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const pluginConfig = {
  principalName: 'Mrs. Test',
  schoolName: 'Demo Primary',
  educationDistrict: 'Victoria',
  schoolType: 'Government',
};

interface RegisteredTool {
  name: string;
  execute?: (toolCallId: string, params?: Record<string, unknown>) => Promise<unknown>;
  handler?: unknown;
  parameters?: unknown;
}

async function loadPlugin() {
  return import('../../extensions/moe-principal-assistant/index.mjs');
}

async function loadPersona() {
  return import('../../extensions/moe-principal-assistant/persona.mjs');
}

function jsonResponse(data: unknown) {
  return {
    status: 200,
    ok: true,
    text: async () => JSON.stringify(data),
    json: async () => data,
  };
}

describe('moe-principal-assistant plugin registration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers OpenClaw execute-based tools with JSON schemas', async () => {
    const { register } = await loadPlugin();
    const tools: RegisteredTool[] = [];

    const result = register({
      pluginConfig,
      registerTool: (tool: RegisteredTool) => tools.push(tool),
      log: { info() {}, warn() {} },
    });

    expect(result).toEqual({ registered: true });
    expect(tools.length).toBeGreaterThanOrEqual(6);
    expect(tools.some((tool) => typeof tool.handler === 'function')).toBe(false);

    for (const tool of tools) {
      expect(tool.name).toEqual(expect.any(String));
      expect(typeof tool.execute).toBe('function');
      expect(tool.parameters).toMatchObject({
        type: 'object',
        properties: expect.any(Object),
      });
    }
  });

  it('registers Outlook and Forms tools when Host API credentials are present', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

      for (const name of [
        'outlook.open',
        'outlook.read_inbox',
        'outlook.search_inbox',
        'outlook.read_email',
        'outlook.draft_email',
        'outlook.send_email',
        'outlook.reply',
        'outlook.forward',
        'outlook.mark_read',
        'outlook.list_attachments',
        'outlook.download_attachment',
        'forms.list',
        'forms.preview_daily_report',
        'forms.submit_daily_report',
        'forms.preview_suspension',
        'forms.submit_suspension',
      ]) {
        expect(byName[name], name).toBeDefined();
        expect(typeof byName[name].execute).toBe('function');
        expect(byName[name].parameters).toMatchObject({ type: 'object' });
      }
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
    }
  });

  it('steers document reads away from the generic read tool and is honest about pptx (CLWX-80)', async () => {
    const { SYSTEM_PROMPT } = await loadPersona();
    const prompt = String(SYSTEM_PROMPT);

    // The generic core read tool returns raw PK/ZIP bytes for OOXML files;
    // the persona must forbid it for binary documents outright.
    expect(prompt).toMatch(/generic file read tool/i);
    expect(prompt).toMatch(/raw bytes/i);
    expect(prompt).toMatch(/document\.\* tools are the only reading path/i);
    // .pptx has no document.* reader: the persona must give the model an
    // honest escape instead of cornering it into the raw-bytes path.
    expect(prompt).toMatch(/PowerPoint files are not supported yet/i);
    expect(prompt).toMatch(/PDF export or pasted text/i);
    // The filename-only search promise (Downloads/Documents/Desktop/OneDrive)
    // is the fork-side answer to the "allowlist rejects ~/Downloads" class.
    expect(prompt).toMatch(/searches Downloads, Documents, Desktop, and the OneDrive-redirected/i);
  });

  it('keeps Outlook/Forms model-facing guidance on the ClawX repair path', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';

    try {
      const { register } = await loadPlugin();
      const { SYSTEM_PROMPT } = await loadPersona();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const modelFacingText = [
        SYSTEM_PROMPT,
        ...tools.map((tool) => `${tool.name}\n${String((tool as { description?: unknown }).description ?? '')}`),
      ].join('\n');

      expect(modelFacingText).toMatch(/outlook\.\*/);
      expect(modelFacingText).toMatch(/outlook\.open first/i);
      expect(modelFacingText).toMatch(/outlook\.read_inbox/i);
      expect(modelFacingText).toMatch(/outlook\.search_inbox/i);
      expect(modelFacingText).toMatch(/outlook\.read_email/i);
      expect(modelFacingText).toMatch(/outlook\.reply/i);
      expect(modelFacingText).toMatch(/outlook\.forward/i);
      expect(modelFacingText).toMatch(/outlook\.send_email/i);
      expect(modelFacingText).toMatch(/Canonical action: read-email/i);
      expect(modelFacingText).toMatch(/transport\/source\/implementation\/version/i);
      expect(modelFacingText).toMatch(/Outlook Browser v2\/browser, Microsoft Graph, or legacy/i);
      expect(modelFacingText).toMatch(/browser\.diagnose/);
      expect(modelFacingText).toMatch(/browser\.repair_chrome_cdp/);
      expect(modelFacingText).toMatch(/call outlook\.send_email with \{ confirm: true \} only/i);
      expect(modelFacingText).toMatch(/do not regenerate, redraft, or resend/i);
      expect(modelFacingText).toMatch(/do not call outlook\.draft_email again/i);
      expect(modelFacingText).toMatch(/one concrete diagnostic question/i);
      expect(modelFacingText).toMatch(/exactly one reviewed Outlook compose pane/i);
      expect(modelFacingText).toMatch(/bounded recent Inbox window/i);
      expect(modelFacingText).toMatch(/not an exhaustive mailbox export/i);
      expect(modelFacingText).toMatch(/do not claim all mail unless scan\.exhaustive is true/i);
      expect(modelFacingText).toMatch(/say capped\/incomplete\/not exhaustive/i);
      expect(modelFacingText).toMatch(/message body editor/i);
      expect(modelFacingText).toMatch(/never (?:place|in) .*body text in To\/Cc\/Bcc/i);
      expect(modelFacingText).toMatch(/do not ask for a recipient after Outlook pre-fills/i);
      expect(modelFacingText).toMatch(/do not use generic browser clicks or toolbar guessing/i);
      expect(modelFacingText).toMatch(/close all Chrome windows and retry from ClawX/i);
      expect(modelFacingText).not.toMatch(/enable Chrome remote debugging/i);
      expect(modelFacingText).not.toMatch(/configure remote debugging/i);
      expect(modelFacingText).not.toMatch(/remote debugging enabled/i);
      expect(modelFacingText).toMatch(/Never give .*manual Chrome debugging/i);
      expect(modelFacingText).not.toMatch(/advise .*manual Chrome debugging/i);
      expect(modelFacingText).not.toMatch(/chrome:\/\/flags/i);
      expect(modelFacingText).not.toMatch(/chrome\.exe/i);
      expect(modelFacingText).not.toMatch(/web-?search/i);
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
    }
  });

  it('invokes representative OpenClaw tools with execute(toolCallId, params)', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';

    const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      // The CLWX-86 capability handshake issues side-effect-free GET probes
      // at registration; this test asserts the POST tool-call sequence only.
      if ((init.method ?? 'GET') !== 'GET') {
        calls.push({
          url: String(url),
          body,
          headers: init.headers as Record<string, string>,
        });
      }
      return jsonResponse({ success: true, data: { status: 'ok' } });
    }));

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      expect(byName['outlook.send_email'].parameters).toMatchObject({
        required: ['confirm'],
      });

      await byName['outlook.open'].execute('call-open', {});
      await byName['outlook.draft_email'].execute('call-draft', {
        to: 'recipient@example.invalid',
        subject: 'Safety gate smoke',
        body: 'Body is not logged by this test.',
      });
      await byName['outlook.send_email'].execute('call-send', {
        to: 'recipient@example.invalid',
        subject: 'Safety gate smoke',
        body: 'Body is not logged by this test.',
      });
      await byName['outlook.download_attachment'].execute('call-download', {
        id: 'message-1',
        filename: 'report.pdf',
      });
      await byName['forms.submit_daily_report'].execute('call-submit-daily', {});
      await byName['forms.submit_suspension'].execute('call-submit', {});

      expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
        '/api/outlook/open',
        '/api/outlook/draft',
        '/api/outlook/send',
        '/api/outlook/download-attachment',
        '/api/forms/submit-daily-report',
        '/api/forms/submit-suspension',
      ]);
      for (const call of calls) {
        expect(call.headers.Authorization).toBe('Bearer test-token');
      }
      expect(calls[1].body).not.toMatchObject({ confirm: expect.any(Boolean) });
      expect(calls[2].body).toMatchObject({ confirm: false });
      expect(calls[3].body).toMatchObject({ confirm: false });
      expect(calls[4].body).toMatchObject({ confirm: false });
      expect(calls[5].body).toMatchObject({ confirm: false });
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
    }
  });

  it('lets the reviewed Outlook draft send tool pass confirm only', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      // Skip the CLWX-86 registration handshake GETs — POST sequence only.
      if (((init as RequestInit).method ?? 'GET') !== 'GET') {
        calls.push({ url: String(url), body });
      }
      return jsonResponse({ success: true, data: { status: 'sent' } });
    }));

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      await byName['outlook.send_email'].execute('call-send', { confirm: true });

      expect(calls).toHaveLength(1);
      expect(new URL(calls[0].url).pathname).toBe('/api/outlook/send');
      expect(calls[0].body).toEqual({ confirm: true });
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
    }
  });

  it('returns a structured Outlook error when a read-only Host API call times out', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout');
    }));

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const result = await byName['outlook.reply'].execute('call-reply', {
        id: 'message-1',
        body: 'Body is not logged by this test.',
      });

      expect(result).toMatchObject({ status: 'error' });
      expect((result as { message?: string }).message).toMatch(/outlook host-API \/reply unreachable/i);
      expect((result as { message?: string }).message).toMatch(/timeout/i);
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
    }
  });

  it('does not encourage automatic send retries when the Outlook send result is unknown', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout');
    }));

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const result = await byName['outlook.send_email'].execute('call-send', { confirm: true });

      expect(result).toMatchObject({ status: 'unknown' });
      expect((result as { message?: string }).message).toMatch(/could not be confirmed/i);
      expect((result as { message?: string }).message).toMatch(/Do not retry automatically/i);
      expect((result as { message?: string }).message).toMatch(/open draft or Sent Items/i);
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
    }
  });

  it('builds a daily-report form payload without inventing incident fields', async () => {
    const { register } = await loadPlugin();
    const tools: RegisteredTool[] = [];

    register({
      pluginConfig,
      registerTool: (tool: RegisteredTool) => tools.push(tool),
      log: { info() {}, warn() {} },
    });

    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    const result = await byName['principal.daily_report_form_payload'].execute('call-daily-payload', {
      date: '2026-05-26',
      did_you_have_school_today: 'Yes',
      principal_status: 'Physically present at school',
      vice_principal_status: 'Physically present at school',
      school_receives_nsdsl_meals: 'No',
      students_suspended_today: 'No',
      school_serviced_by_ptsc_maxi_taxi: 'No',
      last_day_of_week: 'No',
      number_of_teachers_on_staff: 12,
      number_of_teachers_present: 11,
      number_of_teachers_absent: 1,
      number_of_teachers_on_moh_quarantine: 0,
      number_of_teachers_other_leave: 0,
      year_groups: {
        first_year: { enrolled: 20, present: 19 },
        second_year: { enrolled: 18, present: 18 },
        standard_1: { enrolled: 22, present: 20 },
        standard_2: { enrolled: 21, present: 21 },
        standard_3: { enrolled: 20, present: 20 },
        standard_4: { enrolled: 19, present: 19 },
        standard_5: { enrolled: 17, present: 16 },
      },
    });

    expect(result).toMatchObject({
      form: 'primary_school_daily_report',
      payload: {
        date_being_reported_on: '2026-05-26',
        education_district: 'Victoria',
        school_type: 'Government',
        name_of_school: 'Demo Primary',
        did_you_have_school_today: 'Yes',
        students_suspended_today: 'No',
        school_serviced_by_ptsc_maxi_taxi: 'No',
        standard_5_students_present: 16,
      },
    });
    expect(result.payload.number_of_students_suspended).toBeUndefined();
    expect(result.payload.ptsc_morning_trips_count).toBeUndefined();
    expect(result.demoDefaultsApplied).toBeUndefined();
  });

  it('refuses the daily-report payload when statutory choice fields are missing (CLWX-79)', async () => {
    const { register } = await loadPlugin();
    const tools: RegisteredTool[] = [];

    register({
      pluginConfig,
      registerTool: (tool: RegisteredTool) => tools.push(tool),
      log: { info() {}, warn() {} },
    });

    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    const result = (await byName['principal.daily_report_form_payload'].execute('call-daily-refusal', {
      date: '2026-05-26',
      number_of_teachers_on_staff: 12,
      number_of_teachers_present: 11,
      number_of_teachers_absent: 1,
      number_of_teachers_on_moh_quarantine: 0,
      number_of_teachers_other_leave: 0,
      year_groups: {
        first_year: { enrolled: 20, present: 19 },
        second_year: { enrolled: 18, present: 18 },
        standard_1: { enrolled: 22, present: 20 },
        standard_2: { enrolled: 21, present: 21 },
        standard_3: { enrolled: 20, present: 20 },
        standard_4: { enrolled: 19, present: 19 },
        standard_5: { enrolled: 17, present: 16 },
      },
    })) as { status?: string; missingFields?: string[]; message?: string; payload?: unknown };

    expect(result.status).toBe('refused');
    expect(result.missingFields).toEqual([
      'did_you_have_school_today',
      'principal_status',
      'vice_principal_status',
      'school_receives_nsdsl_meals',
      'students_suspended_today',
      'school_serviced_by_ptsc_maxi_taxi',
      'last_day_of_week',
    ]);
    for (const fieldId of result.missingFields!) {
      expect(result.message).toContain(fieldId);
    }
    expect(result.payload).toBeUndefined();
  });

  it('applies daily-report demo defaults only under MOE_DEMO_DEFAULTS=1 and marks them (CLWX-79)', async () => {
    const previousDemo = process.env.MOE_DEMO_DEFAULTS;
    process.env.MOE_DEMO_DEFAULTS = '1';
    const logged: string[] = [];

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info: (message: string) => logged.push(message), warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const result = (await byName['principal.daily_report_form_payload'].execute('call-daily-demo', {
        date: '2026-05-26',
        number_of_teachers_on_staff: 12,
        number_of_teachers_present: 11,
        number_of_teachers_absent: 1,
        number_of_teachers_on_moh_quarantine: 0,
        number_of_teachers_other_leave: 0,
        year_groups: {
          first_year: { enrolled: 20, present: 19 },
          second_year: { enrolled: 18, present: 18 },
          standard_1: { enrolled: 22, present: 20 },
          standard_2: { enrolled: 21, present: 21 },
          standard_3: { enrolled: 20, present: 20 },
          standard_4: { enrolled: 19, present: 19 },
          standard_5: { enrolled: 17, present: 16 },
        },
      })) as {
        status?: string;
        payload: Record<string, unknown>;
        demoDefaultsApplied?: string[];
      };

      expect(result.status).toBeUndefined();
      expect(result.payload).toMatchObject({
        did_you_have_school_today: 'Yes',
        principal_status: 'Physically present at school',
        students_suspended_today: 'No',
        last_day_of_week: 'No',
      });
      expect(result.demoDefaultsApplied).toEqual([
        'did_you_have_school_today',
        'principal_status',
        'vice_principal_status',
        'school_receives_nsdsl_meals',
        'students_suspended_today',
        'school_serviced_by_ptsc_maxi_taxi',
        'last_day_of_week',
      ]);
      const demoLogs = logged.filter((line) => line.includes('DEMO defaults applied'));
      expect(demoLogs).toHaveLength(1);
      expect(demoLogs[0]).toContain('7 field(s)');
      // Count only — no field values in the log line.
      expect(demoLogs[0]).not.toContain('Physically present');
    } finally {
      if (previousDemo === undefined) delete process.env.MOE_DEMO_DEFAULTS;
      else process.env.MOE_DEMO_DEFAULTS = previousDemo;
    }
  });

  it('ignores a model-supplied demo arg and a generic DEMO=1 on the daily report (CLWX-79)', async () => {
    const previousDemo = process.env.DEMO;
    const previousMoeDemo = process.env.MOE_DEMO_DEFAULTS;
    // The fill-scripts overload DEMO=1 with "actually submit". It must NEVER
    // re-enable statutory fabrication, and neither may a model-set demo arg.
    process.env.DEMO = '1';
    delete process.env.MOE_DEMO_DEFAULTS;

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const result = (await byName['principal.daily_report_form_payload'].execute('call-daily-no-demo', {
        // demo:true is not a real parameter any more; passing it must not fabricate.
        demo: true,
        date: '2026-05-26',
        number_of_teachers_on_staff: 12,
        number_of_teachers_present: 11,
        number_of_teachers_absent: 1,
        number_of_teachers_on_moh_quarantine: 0,
        number_of_teachers_other_leave: 0,
        year_groups: {
          first_year: { enrolled: 20, present: 19 },
          second_year: { enrolled: 18, present: 18 },
          standard_1: { enrolled: 22, present: 20 },
          standard_2: { enrolled: 21, present: 21 },
          standard_3: { enrolled: 20, present: 20 },
          standard_4: { enrolled: 19, present: 19 },
          standard_5: { enrolled: 17, present: 16 },
        },
      })) as { status?: string; missingFields?: string[] };

      expect(result.status).toBe('refused');
      expect(result.missingFields).toContain('did_you_have_school_today');
      expect(result.missingFields).toContain('principal_status');
    } finally {
      if (previousDemo === undefined) delete process.env.DEMO;
      else process.env.DEMO = previousDemo;
      if (previousMoeDemo === undefined) delete process.env.MOE_DEMO_DEFAULTS;
      else process.env.MOE_DEMO_DEFAULTS = previousMoeDemo;
    }
  });

  it('normalizes nested suspension payloads before previewing the browser form', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';

    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      // Skip the CLWX-86 registration handshake GETs — POST sequence only.
      if ((init.method ?? 'GET') !== 'GET') {
        calls.push({ url: String(url), body });
      }
      return jsonResponse({ success: true, data: { status: 'previewed', filledCount: 29, skippedCount: 1, errors: [] } });
    }));

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const nested = await byName['principal.suspension_payload'].execute('call-suspension-payload', {
        student_first_name_initial: 'a',
        perpetrator_name: 'A. Test Student',
        gender: 'Male',
        standard: 'Standard 5',
        reason: 'Disrespect to a member of staff',
        length_days: 5,
        parent_contacted: true,
        date_of_incident: '2026-05-26',
        date_of_suspension: '2026-05-27',
        date_of_birth: '2015-09-14',
        age: '10',
        student_birth_certificate_pin: 'TEST-PIN-0001',
        suspensions_this_term: 1,
        infraction_when: 'During class time (member of staff present)',
        additional_infractions_present: 'No',
        victim_present: 'No',
        written_reports_collected: 'Yes',
        extended_suspension_application: 'No',
        sssd_referral: 'No',
        parent_present_at_issue: 'Yes',
        parent_signed_notice: 'Yes',
        discipline_matrix_followed: 'Yes',
        level_of_offence: 'Major',
        parent_name: 'Pat Test',
        parent_phone_1: '8681234567',
        parent_phone_2: '8687654321',
        address_house: '12',
        address_street: 'Test Street',
        address_city: 'Aranguez',
      });

      const result = await byName['forms.preview_suspension'].execute('call-preview-suspension', {
        payload: nested as Record<string, unknown>,
      });

      expect(result).toMatchObject({ status: 'previewed' });
      expect(new URL(calls[0].url).pathname).toBe('/api/forms/preview-suspension');
      const previewPayload = (calls[0].body as { payload: Record<string, unknown> }).payload;
      expect(previewPayload).toMatchObject({
        education_district: 'Victoria',
        school_type: 'Government',
        school_name: 'Aranguez GPS',
        perpetrator_name: 'A. Test Student',
        perpetrator_sex: 'Male',
        perpetrator_dob: '2015-09-14',
        perpetrator_age: '10',
        student_birth_certificate_pin: 'TEST-PIN-0001',
        class: 'Standard 5',
        date_of_infraction: '2026-05-26',
        date_of_issue_of_suspension: '2026-05-27',
        term_suspension_count: 1,
        infraction_when: 'During class time (member of staff present)',
        primary_infraction: 'Disrespect/Defiance of Authority',
        length_of_suspension: '5',
        level_of_offence: 'Major',
        parent_phone_1: 8681234567,
        parent_phone_2: 8687654321,
        parent_name: 'Pat Test',
        address_city: 'Aranguez',
      });
      expect(previewPayload.school).toBeUndefined();
      expect(previewPayload.student).toBeUndefined();
      expect(previewPayload.incident).toBeUndefined();
      expect(previewPayload.suspension).toBeUndefined();
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
    }
  });

  it('canonicalizes common suspension dropdown aliases before previewing', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    const previousDemo = process.env.MOE_DEMO_DEFAULTS;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';
    process.env.MOE_DEMO_DEFAULTS = '1';

    const calls: Array<{ body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      // Skip the CLWX-86 registration handshake GETs — POST sequence only.
      if ((init.method ?? 'GET') !== 'GET') {
        calls.push({ body });
      }
      return jsonResponse({ success: true, data: { status: 'previewed', filledCount: 29, skippedCount: 1, errors: [] } });
    }));

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const result = (await byName['forms.preview_suspension'].execute('call-preview-suspension', {
        // Partial payload: demo defaults are only allowed under the operator's
        // MOE_DEMO_DEFAULTS env var (set above), never a tool argument.
        payload: {
          education_district: 'Victoria',
          school_type: 'Government',
          school_name: 'Demo Primary',
          perpetrator_name: 'T. Test',
          perpetrator_sex: 'Male',
          perpetrator_dob: '2016-01-15',
          perpetrator_age: 10,
          student_birth_certificate_pin: 'TEST-PIN-123',
          class: 'Infant 1',
          date_of_infraction: '2026-05-26',
          date_of_issue_of_suspension: '2026-05-27',
          term_suspension_count: 1,
          infraction_when: 'During class',
          primary_infraction: 'Disruptive Behaviour',
          length_of_suspension: '1 Day',
          level_of_offence: 'Level 1',
          parent_phone_1: '555-0123',
        },
      })) as { status?: string; demoDefaultsApplied?: string[] };

      const previewPayload = (calls[0].body as { payload: Record<string, unknown> }).payload;
      expect(previewPayload).toMatchObject({
        school_name: 'Aranguez GPS',
        class: 'First Year',
        infraction_when: 'During class time (member of staff present)',
        primary_infraction: 'Disorderly/Disruptive Conduct',
        length_of_suspension: '1',
        level_of_offence: 'Minor',
        parent_phone_1: 5550123,
      });
      // The demo marker rides on the tool result, never inside the form payload.
      expect(previewPayload.demoDefaultsApplied).toBeUndefined();
      expect(result.status).toBe('previewed');
      expect(result.demoDefaultsApplied).toEqual([
        'additional_infractions_present',
        'victim_present',
        'written_reports_collected',
        'extended_suspension_application',
        'sssd_referral',
        'parent_present_at_issue',
        'parent_signed_notice',
        'discipline_matrix_followed',
        'parent_name',
        'address_house',
        'address_street',
        'address_city',
      ]);
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
      if (previousDemo === undefined) delete process.env.MOE_DEMO_DEFAULTS;
      else process.env.MOE_DEMO_DEFAULTS = previousDemo;
    }
  });

  it('refuses to preview a suspension payload with missing statutory fields outside demo mode (CLWX-79)', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    const previousDemo = process.env.MOE_DEMO_DEFAULTS;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';
    delete process.env.MOE_DEMO_DEFAULTS;

    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { status: 'previewed', filledCount: 29, skippedCount: 1, errors: [] } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const result = (await byName['forms.preview_suspension'].execute('call-preview-suspension', {
        payload: {
          education_district: 'Victoria',
          school_type: 'Government',
          school_name: 'Demo Primary',
          perpetrator_name: 'T. Test',
          perpetrator_sex: 'Male',
          perpetrator_dob: '2016-01-15',
          perpetrator_age: 10,
          student_birth_certificate_pin: 'TEST-PIN-123',
          class: 'Infant 1',
          date_of_infraction: '2026-05-26',
          date_of_issue_of_suspension: '2026-05-27',
          term_suspension_count: 1,
          infraction_when: 'During class',
          primary_infraction: 'Disruptive Behaviour',
          length_of_suspension: '1 Day',
          level_of_offence: 'Level 1',
          parent_phone_1: '555-0123',
        },
      })) as { status?: string; missingFields?: string[]; message?: string };

      expect(result.status).toBe('refused');
      expect(result.missingFields).toEqual([
        'additional_infractions_present',
        'victim_present',
        'written_reports_collected',
        'extended_suspension_application',
        'sssd_referral',
        'parent_present_at_issue',
        'parent_signed_notice',
        'discipline_matrix_followed',
        'parent_name',
        'address_house',
        'address_street',
        'address_city',
      ]);
      for (const fieldId of result.missingFields!) {
        expect(result.message).toContain(fieldId);
      }
      // No browser preview is attempted for a refused payload.
      // (the CLWX-86 registration handshake GET probe is allowed; a browser
      // preview would be a POST)
      expect(
        fetchMock.mock.calls.filter(
          ([, init]) => (((init ?? {}) as RequestInit).method ?? 'GET') !== 'GET',
        ),
      ).toHaveLength(0);
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
      if (previousDemo === undefined) delete process.env.MOE_DEMO_DEFAULTS;
      else process.env.MOE_DEMO_DEFAULTS = previousDemo;
    }
  });

  it('refuses conditional incident details even in demo mode (CLWX-79)', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    const previousDemo = process.env.MOE_DEMO_DEFAULTS;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';
    // Demo defaults ARE enabled here — the point is that conditional incident
    // details refuse even so; the env is the only way to turn defaults on.
    process.env.MOE_DEMO_DEFAULTS = '1';

    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { status: 'previewed', filledCount: 29, skippedCount: 1, errors: [] } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const result = (await byName['forms.preview_suspension'].execute('call-preview-suspension', {
        payload: {
          perpetrator_name: 'T. Test',
          // Asserts a victim exists but never says who — demo defaults must
          // not invent the answer.
          victim_present: 'Yes',
          additional_infractions_present: 'Yes',
        },
      })) as { status?: string; missingFields?: string[] };

      expect(result.status).toBe('refused');
      expect(result.missingFields).toContain('victim_type');
      expect(result.missingFields).toContain('additional_infractions');
      // (the CLWX-86 registration handshake GET probe is allowed; a browser
      // preview would be a POST)
      expect(
        fetchMock.mock.calls.filter(
          ([, init]) => (((init ?? {}) as RequestInit).method ?? 'GET') !== 'GET',
        ),
      ).toHaveLength(0);
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
      if (previousDemo === undefined) delete process.env.MOE_DEMO_DEFAULTS;
      else process.env.MOE_DEMO_DEFAULTS = previousDemo;
    }
  });

  it('ignores a model-supplied demo arg and refuses to invent statutory fields (CLWX-79)', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    const previousDemo = process.env.MOE_DEMO_DEFAULTS;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';
    // MOE_DEMO_DEFAULTS is OFF: a model passing demo:true must not re-enable
    // fabrication now that the arg is no longer read.
    delete process.env.MOE_DEMO_DEFAULTS;

    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { status: 'previewed', filledCount: 29, skippedCount: 1, errors: [] } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const result = (await byName['forms.preview_suspension'].execute('call-preview-suspension', {
        demo: true,
        payload: {
          perpetrator_name: 'T. Test',
        },
      })) as { status?: string; missingFields?: string[] };

      expect(result.status).toBe('refused');
      // written_reports_collected is exactly the kind of attestation demo
      // fabrication used to invent; it must be listed as missing instead.
      expect(result.missingFields).toContain('written_reports_collected');
      // (the CLWX-86 registration handshake GET probe is allowed; a browser
      // preview would be a POST)
      expect(
        fetchMock.mock.calls.filter(
          ([, init]) => (((init ?? {}) as RequestInit).method ?? 'GET') !== 'GET',
        ),
      ).toHaveLength(0);
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
      if (previousDemo === undefined) delete process.env.MOE_DEMO_DEFAULTS;
      else process.env.MOE_DEMO_DEFAULTS = previousDemo;
    }
  });

  it('coerces a NaN numeric field to a refusal instead of emitting NaN (CLWX-79)', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    const previousDemo = process.env.MOE_DEMO_DEFAULTS;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';
    delete process.env.MOE_DEMO_DEFAULTS;

    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { status: 'previewed', filledCount: 29, skippedCount: 1, errors: [] } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const result = (await byName['forms.preview_suspension'].execute('call-preview-suspension', {
        payload: {
          // A non-numeric term count would become NaN under raw Number();
          // it must be treated as unusable, not emitted into the payload.
          term_suspension_count: 'many',
        },
      })) as { status?: string; missingFields?: string[] };

      expect(result.status).toBe('refused');
      expect(result.missingFields).toContain('term_suspension_count');
      // (the CLWX-86 registration handshake GET probe is allowed; a browser
      // preview would be a POST)
      expect(
        fetchMock.mock.calls.filter(
          ([, init]) => (((init ?? {}) as RequestInit).method ?? 'GET') !== 'GET',
        ),
      ).toHaveLength(0);
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
      if (previousDemo === undefined) delete process.env.MOE_DEMO_DEFAULTS;
      else process.env.MOE_DEMO_DEFAULTS = previousDemo;
    }
  });

  it('refuses an array or non-object suspension payload (CLWX-79)', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    const previousDemo = process.env.MOE_DEMO_DEFAULTS;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';
    // Even with defaults on, an unstructured shape is never filled.
    process.env.MOE_DEMO_DEFAULTS = '1';

    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { status: 'previewed', filledCount: 29, skippedCount: 1, errors: [] } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];

      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });

      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const result = (await byName['forms.preview_suspension'].execute('call-preview-suspension', {
        // typeof [] === 'object', so this slips past the caller's guard and
        // reaches the normalizer, which must reject it.
        payload: [{ perpetrator_name: 'T. Test' }],
      })) as { status?: string; reason?: string };

      expect(result.status).toBe('refused');
      expect(result.reason).toBe('invalid_payload');
      // (the CLWX-86 registration handshake GET probe is allowed; a browser
      // preview would be a POST)
      expect(
        fetchMock.mock.calls.filter(
          ([, init]) => (((init ?? {}) as RequestInit).method ?? 'GET') !== 'GET',
        ),
      ).toHaveLength(0);
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
      if (previousDemo === undefined) delete process.env.MOE_DEMO_DEFAULTS;
      else process.env.MOE_DEMO_DEFAULTS = previousDemo;
    }
  });
});

describe('retry breaker (CLWX-38)', () => {
  async function registerAndFind(name: string) {
    const { register } = await loadPlugin();
    const tools: RegisteredTool[] = [];
    register({
      pluginConfig,
      registerTool: (tool: RegisteredTool) => tools.push(tool),
      log: { info() {}, warn() {} },
    });
    const tool = tools.find((t) => t.name === name);
    expect(tool, `${name} must be registered`).toBeDefined();
    return tool!;
  }

  it('breaks the loop after 3 identical failing calls with a success-shaped instruction', async () => {
    const tool = await registerAndFind('principal.summarise_circular');

    // The live moe.14 failure: empty circular_text, retried identically.
    await expect(tool.execute!('t1', { circular_text: '' })).rejects.toThrow();
    await expect(tool.execute!('t2', { circular_text: '' })).rejects.toThrow();

    const broken = (await tool.execute!('t3', { circular_text: '' })) as { text: string };
    expect(broken.text).toContain('STOP');
    expect(broken.text).toContain('principal.summarise_circular');
    expect(broken.text).toContain('Answer the user directly');
  });

  it('different arguments or a success reset the counter', async () => {
    const tool = await registerAndFind('principal.summarise_circular');

    await expect(tool.execute!('t1', { circular_text: '' })).rejects.toThrow();
    await expect(tool.execute!('t2', { circular_text: '' })).rejects.toThrow();

    // A successful call resets the breaker...
    const ok = (await tool.execute!('t3', { circular_text: 'Circular 42: school closes early Friday.' })) as Record<string, unknown>;
    expect(ok).toHaveProperty('summary');

    // ...so the next two identical failures still throw (no premature break).
    await expect(tool.execute!('t4', { circular_text: '' })).rejects.toThrow();
    await expect(tool.execute!('t5', { circular_text: '' })).rejects.toThrow();

    // Distinct failing args also do not trip the identical-args breaker.
    const distinct = tool.execute!('t6', {} as Record<string, unknown>);
    await expect(distinct).rejects.toThrow();
  });
});
