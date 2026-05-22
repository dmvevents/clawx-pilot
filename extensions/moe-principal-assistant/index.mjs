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

/**
 * PRINCIPAL_SKILL_ALLOWLIST is enforced at the host (electron/api/routes/skills.ts
 * + src/stores/skills.ts). Tools registered here whose names are not in the
 * allowlist remain reachable programmatically by the agent but are hidden
 * from the Skills page. Outlook tools are intentionally agent-callable and
 * not exposed as user-facing skills, so they don't need to be added.
 */

export function register({ config, registerTool, log = console, host = {} }) {
  const cfg = config?.() ?? {};
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
    handler: async (args = {}) => {
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
    handler: async (args = {}) => {
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
    handler: async (args = {}) => {
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
    handler: async (args = {}) => {
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
    handler: async (args = {}) => {
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
    handler: async (args = {}) => {
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
  // the principal's existing Chrome (profile=user). The host wires this
  // capability by passing { outlook } on the host handle. Phase-2 (Graph
  // OAuth) is parked in extensions/microsoft-graph/ until IT returns a
  // client_id and stays untouched here.
  //
  // Allowlist gate: outlook.* tools are only registered when the host both
  //   (a) provides a usable outlook facade AND
  //   (b) declares the 'outlook' capability in host.skillAllowlist.
  // ClawX's PRINCIPAL_SKILL_ALLOWLIST in shared/feature-flags.ts is the
  // authoritative list; the host is expected to forward it on the handle.
  // If skillAllowlist is absent we fall back to opt-in: tools register only
  // when host.outlook was explicitly wired by the host (the existing
  // contract), so removing 'outlook' from the allowlist disables the tools
  // without changing this plugin.
  const outlook = host?.outlook;
  const allowlist = host?.skillAllowlist;
  const allowlistGate =
    allowlist == null
      ? true // opt-in via host.outlook presence (legacy contract)
      : (typeof allowlist.has === 'function' ? allowlist.has('outlook') : false) ||
        (Array.isArray(allowlist) && allowlist.includes('outlook'));
  if (outlook && typeof outlook.open === 'function' && allowlistGate) {
    registerTool({
      name: 'outlook.open',
      description:
        'Open Outlook Web (https://outlook.office.com/mail/) in the principal\'s existing Chrome session. Returns { status: "opened" | "needs_signin", url, message? }. If sign-in is required, ask the principal to sign in to Outlook in the Chrome window that just opened, then call outlook.open again.',
      handler: async () => {
        const result = await outlook.open();
        return result;
      },
    });

    registerTool({
      name: 'outlook.read_inbox',
      description:
        'Return the top N unread/recent messages from the principal\'s Outlook inbox by scraping Outlook Web. Args: { top?: number (default 10) }. Returns { status: "ok" | "needs_signin", messages: [{ id, subject, sender, snippet, receivedAt, unread }] }.',
      handler: async (args = {}) => {
        const top = typeof args.top === 'number' && args.top > 0 ? args.top : 10;
        const result = await outlook.readInbox(top);
        return result;
      },
    });

    registerTool({
      name: 'outlook.draft_email',
      description:
        'Compose a new email in Outlook Web and leave the draft open for the principal to review. Does NOT send. Args: { to: string | string[], subject, body, cc?, bcc? }. Returns { status, draftLeftOpen, preview }.',
      handler: async (args = {}) => {
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
      handler: async (args = {}) => {
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

  log.info?.(
    `moe-principal-assistant: registered (school=${cfg.schoolName}, district=${cfg.educationDistrict})`,
  );
  return { registered: true };
}
