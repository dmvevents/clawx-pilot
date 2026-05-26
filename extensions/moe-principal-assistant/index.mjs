/**
 * Plugin entry. Registers the openclaw tools that give the agent the role,
 * tone, and templates of an MoE primary-school principal's admin assistant.
 *
 * This plugin is *passive* until the host calls register() with a runtime
 * context that provides:
 *   - config()        → resolved openclaw.json plugin config
 *                       (principalName, schoolName, educationDistrict, ...)
 *   - registerTool()  → host's tool-registration hook
 *   - host.outlook?   → optional handle bound by the Electron main process
 *                       to the OutlookBrowserManager. When present, this
 *                       plugin exposes outlook.* tools that drive Outlook
 *                       Web in the principal's existing Chrome session.
 *                       Phase-1 path; the Phase-2 Graph OAuth path lives in
 *                       extensions/microsoft-graph/ and stays parked until
 *                       IT returns a client_id.
 *
 * The plugin does NOT submit forms. It produces:
 *   - Drafts (prose) from Markdown templates with handlebars-style slots.
 *   - Form payloads (JSON) shaped to match the live MoE Microsoft Forms
 *     fields. Submission is delegated to a browser/Graph plugin under
 *     explicit user confirmation — see README for the composition story.
 *   - Outlook drafts (when the host wires outlook). Drafts are NEVER auto-
 *     sent; outlook.send_email refuses unless the agent shows the draft to
 *     the principal and re-calls with confirm=true.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = __dirname;

const VALID_DISTRICTS = [
  'Caroni',
  'North Eastern',
  'Port of Spain & Environs',
  'South Eastern',
  'St. George East',
  'St. Patrick',
  'Victoria',
];

const VALID_SCHOOL_TYPES = ['Denominational', 'Government'];
const VALID_GENDERS = ['Male', 'Female'];
const VALID_STANDARDS = ['Infant 1', 'Infant 2', 'Standard 1', 'Standard 2', 'Standard 3', 'Standard 4', 'Standard 5'];

async function readTemplate(name) {
  return readFile(path.join(PKG_ROOT, 'templates', name), 'utf8');
}

// Minimal handlebars-style fill. We deliberately avoid pulling in a templating
// dep — the slots are flat and the templates are ours.
function fillTemplate(tpl, vars) {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function requireString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required (non-empty string).`);
  }
}

function requireNumber(name, value) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new Error(`${name} is required (non-negative number).`);
  }
}

const stringSchema = { type: 'string' };
const booleanSchema = { type: 'boolean' };
const nonNegativeNumberSchema = { type: 'number', minimum: 0 };
const stringArraySchema = { type: 'array', items: stringSchema };
const stringOrStringArraySchema = {
  anyOf: [stringSchema, stringArraySchema],
};
const looseObjectSchema = { type: 'object', additionalProperties: true };

function toolParameters(properties = {}, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

const emptyParameters = toolParameters();

/**
 * PRINCIPAL_SKILL_ALLOWLIST is enforced at the host (electron/api/routes/skills.ts
 * + src/stores/skills.ts). Tools registered here whose names are not in the
 * allowlist remain reachable programmatically by the agent but are hidden
 * from the Skills page. Outlook tools are intentionally agent-callable and
 * not exposed as user-facing skills, so they don't need to be added.
 */

export function register(api) {
  // Gateway register-API contract (build/openclaw/dist/api-builder-d3jBS7ML.js):
  //   api.pluginConfig — THIS plugin's `plugins.entries[<id>].config` (validated)
  //   api.config       — the WHOLE resolved openclaw.json
  //   api.registerTool, api.runtime, api.logger, api.host, ...
  //
  // Earlier code destructured `{ config }` and treated it as the plugin's own
  // config — but that's the entire openclaw.json, so cfg.principalName was
  // always undefined and the missing-keys check fired, and tools never
  // registered. The fix: read api.pluginConfig.
  //
  // Fallbacks: tolerate config-as-function (very old gateway API) and
  // config-as-direct-object (a custom host that bypasses the gateway loader).
  const { pluginConfig, config, registerTool, log = console, host = {} } = api;
  const cfg =
    (pluginConfig && typeof pluginConfig === 'object' ? pluginConfig : null) ??
    (typeof config === 'function' ? config() : config) ??
    {};
  const required = ['principalName', 'schoolName', 'educationDistrict', 'schoolType'];
  const missing = required.filter((k) => !cfg[k]);
  if (missing.length) {
    log.warn?.(
      `moe-principal-assistant: missing config (${missing.join(', ')}) — tools will not be registered.`,
    );
    return { registered: false };
  }
  if (!VALID_DISTRICTS.includes(cfg.educationDistrict)) {
    log.warn?.(`moe-principal-assistant: educationDistrict "${cfg.educationDistrict}" is not one of the seven MoE districts.`);
  }
  if (!VALID_SCHOOL_TYPES.includes(cfg.schoolType)) {
    log.warn?.(`moe-principal-assistant: schoolType "${cfg.schoolType}" is not Denominational or Government.`);
  }

  registerTool({
    name: 'principal.draft_letter',
    description:
      'Draft a formal letter on behalf of the principal. Args: { recipient, subject, intent, key_points: string[] }. Returns { text } — prose only.',
    parameters: toolParameters(
      {
        recipient: stringSchema,
        subject: stringSchema,
        intent: stringSchema,
        key_points: stringArraySchema,
      },
      ['recipient', 'subject', 'intent'],
    ),
    execute: async (_toolCallId, args = {}) => {
      const { recipient, subject, intent, key_points } = args;
      requireString('recipient', recipient);
      requireString('subject', subject);
      requireString('intent', intent);
      const points = Array.isArray(key_points) ? key_points : [];

      const tpl = await readTemplate('letter.md');
      const body = [
        intent.trim(),
        ...(points.length
          ? ['', ...points.map((p) => `- ${String(p).trim()}`)]
          : []),
      ].join('\n');

      const text = fillTemplate(tpl, {
        recipient,
        subject,
        body,
        principal_name: cfg.principalName,
        school_name: cfg.schoolName,
        date: todayISO(),
        closing: 'Yours sincerely,',
      });
      return { text };
    },
  });

  registerTool({
    name: 'principal.draft_memo',
    description:
      'Draft an internal memo. Args: { to, from?, subject, body_points: string[] }. Returns { text } — prose only.',
    parameters: toolParameters(
      {
        to: stringSchema,
        from: stringSchema,
        subject: stringSchema,
        body_points: stringArraySchema,
      },
      ['to', 'subject'],
    ),
    execute: async (_toolCallId, args = {}) => {
      const { to, subject, body_points } = args;
      const from = args.from ?? cfg.principalName;
      requireString('to', to);
      requireString('subject', subject);
      const points = Array.isArray(body_points) ? body_points : [];

      const tpl = await readTemplate('memo.md');
      const body = points.map((p) => `- ${String(p).trim()}`).join('\n');
      const text = fillTemplate(tpl, {
        to,
        from,
        subject,
        date: todayISO(),
        school_name: cfg.schoolName,
        body,
      });
      return { text };
    },
  });

  registerTool({
    name: 'principal.summarise_circular',
    description:
      'Summarise an MoE circular, email, or meeting note. Args: { circular_text }. Returns { summary, action_items: string[], deadline | null }. Stub — handler returns a structurally correct placeholder; the model is expected to fill it in.',
    parameters: toolParameters(
      {
        circular_text: stringSchema,
      },
      ['circular_text'],
    ),
    execute: async (_toolCallId, args = {}) => {
      const { circular_text } = args;
      requireString('circular_text', circular_text);
      // Intentionally stubbed: the agent layer is responsible for the
      // actual summarisation. We return the shape it must conform to so
      // downstream consumers (UI, follow-up tools) can rely on it.
      return {
        summary: '',
        action_items: [],
        deadline: null,
      };
    },
  });

  registerTool({
    name: 'principal.daily_report_payload',
    description:
      'Build the structured payload for the Primary School Daily Report (Term 3 2025/26). Args: { date, teachers_present, teachers_absent, students_present, students_absent_total, meals_distributed, meals_rated, discipline_incidents?, transport_issues?, notes? }. Returns JSON only.',
    parameters: toolParameters(
      {
        date: stringSchema,
        teachers_present: nonNegativeNumberSchema,
        teachers_absent: nonNegativeNumberSchema,
        students_present: nonNegativeNumberSchema,
        students_absent_total: nonNegativeNumberSchema,
        meals_distributed: nonNegativeNumberSchema,
        meals_rated: nonNegativeNumberSchema,
        discipline_incidents: stringArraySchema,
        transport_issues: stringArraySchema,
        notes: stringSchema,
      },
      [
        'date',
        'teachers_present',
        'teachers_absent',
        'students_present',
        'students_absent_total',
        'meals_distributed',
      ],
    ),
    execute: async (_toolCallId, args = {}) => {
      const {
        date,
        teachers_present,
        teachers_absent,
        students_present,
        students_absent_total,
        meals_distributed,
        meals_rated,
        discipline_incidents = [],
        transport_issues = [],
        notes = '',
      } = args;

      requireString('date', date);
      requireNumber('teachers_present', teachers_present);
      requireNumber('teachers_absent', teachers_absent);
      requireNumber('students_present', students_present);
      requireNumber('students_absent_total', students_absent_total);
      requireNumber('meals_distributed', meals_distributed);

      return {
        form: 'primary_school_daily_report',
        term: 'Term 3 2025/26',
        school: {
          name: cfg.schoolName,
          educationDistrict: cfg.educationDistrict,
          schoolType: cfg.schoolType,
        },
        principal: cfg.principalName,
        date,
        attendance: {
          teachers: { present: teachers_present, absent: teachers_absent },
          students: { present: students_present, absentTotal: students_absent_total },
        },
        nsdsl: {
          mealsDistributed: meals_distributed,
          mealsRated: meals_rated ?? null,
        },
        discipline: { incidents: Array.isArray(discipline_incidents) ? discipline_incidents : [] },
        transport: { issues: Array.isArray(transport_issues) ? transport_issues : [] },
        notes: String(notes ?? ''),
      };
    },
  });

  registerTool({
    name: 'principal.suspension_payload',
    description:
      'Build the structured payload for the Primary School Student Suspensions form (one per pupil). Args: { student_first_name_initial, gender, standard, reason, length_days, parent_contacted, date_of_incident, date_of_suspension }. Returns JSON only. Pupil names are not stored — only the first-name initial.',
    parameters: toolParameters(
      {
        student_first_name_initial: stringSchema,
        gender: { type: 'string', enum: VALID_GENDERS },
        standard: { type: 'string', enum: VALID_STANDARDS },
        reason: stringSchema,
        length_days: nonNegativeNumberSchema,
        parent_contacted: booleanSchema,
        date_of_incident: stringSchema,
        date_of_suspension: stringSchema,
      },
      [
        'student_first_name_initial',
        'gender',
        'standard',
        'reason',
        'length_days',
        'parent_contacted',
        'date_of_incident',
        'date_of_suspension',
      ],
    ),
    execute: async (_toolCallId, args = {}) => {
      const {
        student_first_name_initial,
        gender,
        standard,
        reason,
        length_days,
        parent_contacted,
        date_of_incident,
        date_of_suspension,
      } = args;

      requireString('student_first_name_initial', student_first_name_initial);
      requireString('gender', gender);
      requireString('standard', standard);
      requireString('reason', reason);
      requireNumber('length_days', length_days);
      requireString('date_of_incident', date_of_incident);
      requireString('date_of_suspension', date_of_suspension);

      if (!VALID_GENDERS.includes(gender)) {
        throw new Error(`gender must be one of ${VALID_GENDERS.join(', ')}.`);
      }
      if (!VALID_STANDARDS.includes(standard)) {
        throw new Error(`standard must be one of ${VALID_STANDARDS.join(', ')}.`);
      }

      return {
        form: 'primary_school_student_suspensions',
        term: 'Term 3 2025/26',
        school: {
          name: cfg.schoolName,
          educationDistrict: cfg.educationDistrict,
          schoolType: cfg.schoolType,
        },
        principal: cfg.principalName,
        student: {
          firstNameInitial: student_first_name_initial.trim().slice(0, 1).toUpperCase(),
          gender,
          standard,
        },
        incident: {
          dateOfIncident: date_of_incident,
          reason,
        },
        suspension: {
          dateOfSuspension: date_of_suspension,
          lengthDays: length_days,
          parentContacted: Boolean(parent_contacted),
        },
      };
    },
  });

  registerTool({
    name: 'principal.find_school',
    description:
      'Fuzzy-match against the MoE school roster. Args: { query }. Returns up to 10 matches: { name, educationDistrict, schoolType }. Stub roster (~30 schools); production should load the full ~1300-school list.',
    parameters: toolParameters(
      {
        query: stringSchema,
      },
      ['query'],
    ),
    execute: async (_toolCallId, args = {}) => {
      const { query } = args;
      requireString('query', query);
      const raw = await readFile(path.join(PKG_ROOT, 'data', 'schools.json'), 'utf8');
      const parsed = JSON.parse(raw);
      const all = Array.isArray(parsed.schools) ? parsed.schools : [];
      const q = query.trim().toLowerCase();
      const matches = all
        .filter((s) => typeof s?.name === 'string' && s.name.toLowerCase().includes(q))
        .slice(0, 10);
      return { matches, total: matches.length, queriedAgainst: all.length };
    },
  });

  // ── Outlook (browser-session) tools ─────────────────────────────────────
  // Phase-1 path: drives Outlook Web through the bundled browser plugin in
  // the principal's existing Chrome (profile=user). Phase-2 (Graph OAuth)
  // is parked in extensions/microsoft-graph/ until IT returns a client_id.
  //
  // Implementation: the plugin runs in the OpenClaw gateway process, NOT
  // in ClawX's main process — the gateway register API doesn't expose a
  // `host` handle for IPC. Instead we talk to ClawX's host-API at
  // 127.0.0.1:$CLAWX_HOST_API_PORT/api/outlook/* using a bearer token.
  // ClawX threads CLAWX_HOST_API_PORT and CLAWX_HOST_API_TOKEN into the
  // gateway's spawn env (electron/gateway/config-sync.ts:612).
  //
  // The host-API routes already gate by PRINCIPAL_SKILL_ALLOWLIST (see
  // electron/api/routes/outlook.ts), so removing 'outlook' from the
  // allowlist disables the tools without changing this plugin — the
  // routes return 404 and the tool handlers surface that error.
  const hostApiPort = process.env.CLAWX_HOST_API_PORT;
  const hostApiToken = process.env.CLAWX_HOST_API_TOKEN;
  const outlook =
    hostApiPort && hostApiToken
      ? createHostApiOutlookFacade(hostApiPort, hostApiToken)
      : null;
  // Honour explicit host.skillAllowlist override (legacy contract). When the
  // gateway exposes neither host.outlook nor host.skillAllowlist (current
  // state), gate purely on whether we have host-API creds in env.
  const allowlist = host?.skillAllowlist;
  const allowlistGate =
    allowlist == null
      ? true
      : (typeof allowlist.has === 'function' ? allowlist.has('outlook') : false) ||
        (Array.isArray(allowlist) && allowlist.includes('outlook'));
  if (outlook && typeof outlook.open === 'function' && allowlistGate) {
    registerTool({
      name: 'outlook.open',
      description:
        'Open Outlook Web (https://outlook.office.com/mail/) in the principal\'s existing Chrome session. Returns { status: "opened" | "needs_signin", url, message? }. If sign-in is required, ask the principal to sign in to Outlook in the Chrome window that just opened, then call outlook.open again.',
      parameters: emptyParameters,
      execute: async (_toolCallId, _params = {}) => {
        const result = await outlook.open();
        return result;
      },
    });

    registerTool({
      name: 'outlook.read_inbox',
      description:
        'Return the top N unread/recent messages from the principal\'s Outlook inbox by scraping Outlook Web. Args: { top?: number (default 10) }. Returns { status: "ok" | "needs_signin", messages: [{ id, subject, sender, snippet, receivedAt, unread }] }.',
      parameters: toolParameters({
        top: nonNegativeNumberSchema,
      }),
      execute: async (_toolCallId, args = {}) => {
        const top = typeof args.top === 'number' && args.top > 0 ? args.top : 10;
        const result = await outlook.readInbox(top);
        return result;
      },
    });

    registerTool({
      name: 'outlook.draft_email',
      description:
        'Compose a new email in Outlook Web and leave the draft open for the principal to review. Does NOT send. Args: { to: string | string[], subject, body, cc?, bcc? }. Returns { status, draftLeftOpen, preview }.',
      parameters: toolParameters(
        {
          to: stringOrStringArraySchema,
          subject: stringSchema,
          body: stringSchema,
          cc: stringOrStringArraySchema,
          bcc: stringOrStringArraySchema,
        },
        ['to', 'subject', 'body'],
      ),
      execute: async (_toolCallId, args = {}) => {
        const { to, subject, body, cc, bcc } = args;
        requireString('subject', subject);
        if (typeof body !== 'string') {
          throw new Error('body is required (string).');
        }
        if (!to || (Array.isArray(to) && to.length === 0)) {
          throw new Error('to is required (string or non-empty array).');
        }
        return outlook.draftEmail({ to, subject, body, cc, bcc });
      },
    });

    registerTool({
      name: 'outlook.send_email',
      description:
        'Send an email via Outlook Web. HARD GATE: refuses unless { confirm: true } is set. The agent MUST show the draft to the principal and obtain explicit confirmation ("yes, send") before passing confirm=true. Default behaviour is to draft and stop. Args: { to, subject, body, cc?, bcc?, confirm: boolean }.',
      parameters: toolParameters(
        {
          to: stringOrStringArraySchema,
          subject: stringSchema,
          body: stringSchema,
          cc: stringOrStringArraySchema,
          bcc: stringOrStringArraySchema,
          confirm: booleanSchema,
        },
        ['to', 'subject', 'body', 'confirm'],
      ),
      execute: async (_toolCallId, args = {}) => {
        const { to, subject, body, cc, bcc, confirm } = args;
        requireString('subject', subject);
        if (typeof body !== 'string') {
          throw new Error('body is required (string).');
        }
        return outlook.sendEmail({
          to,
          subject,
          body,
          cc,
          bcc,
          confirm: confirm === true,
        });
      },
    });

    // ── Phase 3 tools: search, read full email, reply, forward, mark read,
    //                  list attachments. Each is a thin shell over the
    //                  host-API outlook facade.

    registerTool({
      name: 'outlook.search_inbox',
      description:
        'Filter the principal\'s inbox by sender, subject, date, unread, or attachment presence. Args: { from?, subjectContains?, dateGte?, dateLt?, unread?, hasAttachment?, top? (default 25) }. Returns { status, messages, capped }. dateGte/dateLt are ISO 8601 strings. Prefer this over read_inbox when the user mentions a sender or date or topic.',
      parameters: toolParameters({
        from: stringSchema,
        subjectContains: stringSchema,
        dateGte: stringSchema,
        dateLt: stringSchema,
        unread: booleanSchema,
        hasAttachment: booleanSchema,
        top: nonNegativeNumberSchema,
      }),
      execute: async (_toolCallId, args = {}) => {
        return outlook.searchInbox(args);
      },
    });

    registerTool({
      name: 'outlook.read_email',
      description:
        'Open a specific message and return its full body, sender, recipients, and attachment list. Args: { id }. id is the InboxMessage.id from read_inbox or search_inbox (sender|subject|received fingerprint). Returns { status, id, subject, sender, receivedAt, body, recipients, attachments: [{ filename, sizeBytes?, mimeType? }] }. Use this when the user asks "what does it say" or "summarise that email".',
      parameters: toolParameters(
        {
          id: stringSchema,
        },
        ['id'],
      ),
      execute: async (_toolCallId, args = {}) => {
        const { id } = args;
        requireString('id', id);
        return outlook.readEmail({ id });
      },
    });

    registerTool({
      name: 'outlook.reply',
      description:
        'Reply (or reply-all) to a specific message. Opens the reply pane in Outlook with To/Subject pre-filled by Outlook; we fill the body. Leaves the draft open for the principal to review — does NOT send. Args: { id, body, replyAll? (default false) }.',
      parameters: toolParameters(
        {
          id: stringSchema,
          body: stringSchema,
          replyAll: booleanSchema,
        },
        ['id', 'body'],
      ),
      execute: async (_toolCallId, args = {}) => {
        const { id, body, replyAll } = args;
        requireString('id', id);
        if (typeof body !== 'string') throw new Error('body is required (string).');
        return outlook.reply({ id, body, replyAll: replyAll === true });
      },
    });

    registerTool({
      name: 'outlook.forward',
      description:
        'Forward a specific message to a new recipient. Opens the forward pane in Outlook with the original message quoted; we fill To and an optional commentary body. Leaves the draft open. Args: { id, to: string | string[], body? }.',
      parameters: toolParameters(
        {
          id: stringSchema,
          to: stringOrStringArraySchema,
          body: stringSchema,
        },
        ['id', 'to'],
      ),
      execute: async (_toolCallId, args = {}) => {
        const { id, to, body } = args;
        requireString('id', id);
        if (!to || (Array.isArray(to) && to.length === 0)) {
          throw new Error('to is required (string or non-empty array).');
        }
        return outlook.forward({ id, to, body });
      },
    });

    registerTool({
      name: 'outlook.mark_read',
      description:
        'Mark a specific message as read or unread. Args: { id, read: boolean }. Returns { status }.',
      parameters: toolParameters(
        {
          id: stringSchema,
          read: booleanSchema,
        },
        ['id', 'read'],
      ),
      execute: async (_toolCallId, args = {}) => {
        const { id, read } = args;
        requireString('id', id);
        if (typeof read !== 'boolean') {
          throw new Error('read is required (boolean).');
        }
        return outlook.markRead({ id, read });
      },
    });

    registerTool({
      name: 'outlook.list_attachments',
      description:
        'List metadata for the attachments on a specific message without downloading them. Args: { id }. Returns { status, id, attachments: [{ filename, sizeBytes?, mimeType? }] }. Use this before suggesting any download.',
      parameters: toolParameters(
        {
          id: stringSchema,
        },
        ['id'],
      ),
      execute: async (_toolCallId, args = {}) => {
        const { id } = args;
        requireString('id', id);
        return outlook.listAttachments({ id });
      },
    });

    registerTool({
      name: 'outlook.download_attachment',
      description:
        'Download a specific attachment from a message to disk. HARD GATE: refuses unless { confirm: true } is set. The agent MUST show the principal which file will be downloaded (filename + sender + subject) and obtain explicit confirmation before passing confirm=true. Args: { id, filename, confirm: boolean }. Returns { status, filename, savedPath?, reason? }.',
      parameters: toolParameters(
        {
          id: stringSchema,
          filename: stringSchema,
          confirm: booleanSchema,
        },
        ['id', 'filename', 'confirm'],
      ),
      execute: async (_toolCallId, args = {}) => {
        const { id, filename, confirm } = args;
        requireString('id', id);
        requireString('filename', filename);
        return outlook.downloadAttachment({
          id,
          filename,
          confirm: confirm === true,
        });
      },
    });

    log.info?.('moe-principal-assistant: outlook (browser-session) tools registered');
  } else if (outlook && typeof outlook.open === 'function' && !allowlistGate) {
    log.info?.(
      'moe-principal-assistant: outlook capability present but disabled by allowlist — outlook.* tools skipped',
    );
  } else {
    log.info?.(
      'moe-principal-assistant: outlook host handle not provided — outlook.* tools skipped',
    );
  }

  // ── Forms (Microsoft Forms via browser-session, MoE suspension form) ──────
  // Same pattern as outlook above: build a host-API HTTP facade so the plugin
  // running inside the gateway can call back to the Electron main process,
  // which owns the FormsBrowserManager singleton + the Playwright driver.
  const forms =
    hostApiPort && hostApiToken
      ? createHostApiFormsFacade(hostApiPort, hostApiToken)
      : null;
  if (forms) {
    registerTool({
      name: 'forms.list',
      description:
        'List the MoE forms ClawX can fill. Returns { status, forms: [{ id, title, status: "available" | "not_configured" }] }. Call this first if the user mentions filling a form, so you know which forms are available.',
      parameters: emptyParameters,
      execute: async (_toolCallId, _params = {}) => forms.list(),
    });

    registerTool({
      name: 'forms.preview_suspension',
      description:
        'Open the Suspensions form in the principal\'s browser and fill every field from a typed payload. Does NOT submit. Returns { status: "previewed", url, filledCount, skippedCount, errors[] }. Use this AFTER the user has reviewed the extracted fields and asked you to fill the form. Always call this before forms.submit_suspension.',
      parameters: toolParameters(
        {
          payload: looseObjectSchema,
        },
        ['payload'],
      ),
      execute: async (_toolCallId, args = {}) => {
        if (!args.payload || typeof args.payload !== 'object') {
          throw new Error('payload object required (32 fields, see suspensions-schema.json).');
        }
        return forms.previewSuspension({ payload: args.payload });
      },
    });

    registerTool({
      name: 'forms.submit_suspension',
      description:
        'Submit the Suspensions form. HARD GATE: refuses unless { confirm: true }. The agent MUST show the principal the filled form (forms.preview_suspension first) and obtain explicit confirmation ("yes, submit") before passing confirm=true. Returns { status: "submitted" | "refused" | "error", message?, reason? }.',
      parameters: toolParameters(
        {
          confirm: booleanSchema,
        },
        ['confirm'],
      ),
      execute: async (_toolCallId, args = {}) => forms.submitSuspension({ confirm: args.confirm === true }),
    });

    log.info?.('moe-principal-assistant: forms (browser-session) tools registered');
  } else {
    log.info?.('moe-principal-assistant: forms host handle not provided — forms.* tools skipped');
  }

  log.info?.(
    `moe-principal-assistant: registered (school=${cfg.schoolName}, district=${cfg.educationDistrict})`,
  );
  return { registered: true };
}

/**
 * Build a forms facade that proxies the three agent-callable methods over
 * HTTP to ClawX's host-API. Same shape as createHostApiOutlookFacade.
 */
function createHostApiFormsFacade(port, token) {
  const base = `http://127.0.0.1:${port}/api/forms`;
  const REQUEST_TIMEOUT_MS = 90_000; // generous: filling 32 fields can take a moment.

  async function call(path, body) {
    const url = `${base}${path}`;
    const init = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body == null ? '{}' : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    let resp;
    try {
      resp = await fetch(url, init);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`forms host-API ${path} unreachable: ${msg}`);
    }
    if (resp.status === 404) {
      throw new Error(
        `forms capability disabled: ${path} returned 404 — check that 'forms' is in PRINCIPAL_SKILL_ALLOWLIST.`,
      );
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`forms host-API ${path} failed ${resp.status}: ${text.slice(0, 200)}`);
    }
    const json = await resp.json();
    if (!json || json.success !== true) {
      throw new Error(`forms host-API ${path}: ${json?.error ?? 'unknown error'}`);
    }
    return json.data;
  }

  return {
    list: () => call('/list'),
    previewSuspension: (args) => call('/preview-suspension', args),
    submitSuspension: (args) => call('/submit-suspension', args),
  };
}

/**
 * Build an outlook facade that proxies the four agent-callable methods
 * (open, readInbox, draftEmail, sendEmail) over HTTP to ClawX's host-API.
 *
 * The host-API auth token lives in process.env.CLAWX_HOST_API_TOKEN; the
 * port in CLAWX_HOST_API_PORT. ClawX populates both on gateway spawn
 * (electron/gateway/config-sync.ts forkEnv block).
 *
 * Each method maps to a host-API route:
 *   open()                       → POST /api/outlook/open       (no body)
 *   readInbox(top)               → POST /api/outlook/read-inbox { top }
 *   draftEmail({to,subject,...}) → POST /api/outlook/draft      { ...args }
 *   sendEmail({to,...,confirm})  → POST /api/outlook/send       { ...args }
 *
 * Errors:
 *   - 404 from the host-API → 'outlook' was removed from the allowlist;
 *     surface a clear error so the agent can tell the user.
 *   - Network / timeout       → wrap as { status: 'error', message }
 *     so the agent can retry or fall back gracefully.
 */
function createHostApiOutlookFacade(port, token) {
  const base = `http://127.0.0.1:${port}/api/outlook`;
  const REQUEST_TIMEOUT_MS = 60_000; // generous: drafts can include slow DOM waits.

  async function call(path, body) {
    const url = `${base}${path}`;
    const init = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body == null ? '{}' : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    let resp;
    try {
      resp = await fetch(url, init);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`outlook host-API ${path} unreachable: ${msg}`);
    }
    if (resp.status === 404) {
      throw new Error(
        `outlook capability disabled: ${path} returned 404 — check that 'outlook' is in PRINCIPAL_SKILL_ALLOWLIST.`,
      );
    }
    const text = await resp.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* fall through */ }
    if (!resp.ok) {
      const errMsg = (data && (data.error || data.message)) || text.slice(0, 200) || `HTTP ${resp.status}`;
      throw new Error(`outlook host-API ${path}: ${errMsg}`);
    }
    // The host-API wraps results as { success: true, data } (current shape)
    // or { success: true, result } (older). Tolerate both, plus a bare
    // result body for forward-compat.
    if (data && typeof data === 'object' && 'success' in data) {
      if ('data' in data) return data.data;
      if ('result' in data) return data.result;
    }
    return data;
  }

  return {
    open: () => call('/open'),
    readInbox: (top) => call('/read-inbox', typeof top === 'number' ? { top } : {}),
    draftEmail: (args) => call('/draft', args),
    sendEmail: (args) => call('/send', args),
    searchInbox: (args) => call('/search-inbox', args ?? {}),
    readEmail: (args) => call('/read-email', args),
    reply: (args) => call('/reply', args),
    forward: (args) => call('/forward', args),
    markRead: (args) => call('/mark-read', args),
    listAttachments: (args) => call('/list-attachments', args),
    downloadAttachment: (args) => call('/download-attachment', args),
  };
}
