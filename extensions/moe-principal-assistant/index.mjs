/**
 * Plugin entry. Registers the openclaw tools that give the agent the role,
 * tone, and templates of an MoE primary-school principal's admin assistant.
 *
 * This plugin is *passive* until the host calls register() with a runtime
 * context that provides:
 *   - config()        → resolved openclaw.json plugin config
 *                       (principalName, schoolName, educationDistrict, ...)
 *   - registerTool()  → host's tool-registration hook
 *
 * The plugin does NOT submit forms. It produces:
 *   - Drafts (prose) from Markdown templates with handlebars-style slots.
 *   - Form payloads (JSON) shaped to match the live MoE Microsoft Forms
 *     fields. Submission is delegated to a browser/Graph plugin under
 *     explicit user confirmation — see README for the composition story.
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

export function register({ config, registerTool, log = console }) {
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

  log.info?.(
    `moe-principal-assistant: registered (school=${cfg.schoolName}, district=${cfg.educationDistrict})`,
  );
  return { registered: true };
}
