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

  it('normalizes nested suspension payloads before previewing the browser form', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';

    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      calls.push({ url: String(url), body });
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
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';

    const calls: Array<{ body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      calls.push({ body });
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
      await byName['forms.preview_suspension'].execute('call-preview-suspension', {
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
      });

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
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
    }
  });
});
