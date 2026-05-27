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

  it('invokes representative OpenClaw tools with execute(toolCallId, params)', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';

    const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      calls.push({
        url: String(url),
        body,
        headers: init.headers as Record<string, string>,
      });
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

      await byName['outlook.open'].execute('call-open', {});
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
        '/api/outlook/send',
        '/api/outlook/download-attachment',
        '/api/forms/submit-daily-report',
        '/api/forms/submit-suspension',
      ]);
      for (const call of calls) {
        expect(call.headers.Authorization).toBe('Bearer test-token');
      }
      expect(calls[1].body).toMatchObject({ confirm: false });
      expect(calls[2].body).toMatchObject({ confirm: false });
      expect(calls[3].body).toMatchObject({ confirm: false });
      expect(calls[4].body).toMatchObject({ confirm: false });
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
  });
});
