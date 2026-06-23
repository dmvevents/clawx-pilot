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
const YES_NO = ['Yes', 'No'];
const DAILY_REPORT_YEAR_GROUPS = [
  ['first_year', 'students_enrolled_first_year', 'first_year_students_present'],
  ['second_year', 'students_enrolled_second_year', 'second_year_students_present'],
  ['standard_1', 'students_enrolled_standard_1', 'standard_1_students_present'],
  ['standard_2', 'students_enrolled_standard_2', 'standard_2_students_present'],
  ['standard_3', 'students_enrolled_standard_3', 'standard_3_students_present'],
  ['standard_4', 'students_enrolled_standard_4', 'standard_4_students_present'],
  ['standard_5', 'students_enrolled_standard_5', 'standard_5_students_present'],
];

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

function numberValue(name, value) {
  requireNumber(name, value);
  return value;
}

function optionalNumber(name, value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  requireNumber(name, value);
  return value;
}

function choice(name, value, allowed, fallback) {
  const v = value === undefined || value === null || value === '' ? fallback : value;
  if (!allowed.includes(v)) {
    throw new Error(`${name} must be one of ${allowed.join(', ')}.`);
  }
  return v;
}

function requireChoice(name, value, allowed) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name} is required (${allowed.join(', ')}).`);
  }
  return choice(name, value, allowed);
}

function getGroupCounts(args, groupKey) {
  const groups = args.year_groups;
  const value = groups && typeof groups === 'object' ? groups[groupKey] : null;
  if (!value || typeof value !== 'object') {
    throw new Error(`year_groups.${groupKey} is required.`);
  }
  const { enrolled, present } = value;
  requireNumber(`year_groups.${groupKey}.enrolled`, enrolled);
  requireNumber(`year_groups.${groupKey}.present`, present);
  return { enrolled, present };
}

const stringSchema = { type: 'string' };
const booleanSchema = { type: 'boolean' };
const nonNegativeNumberSchema = { type: 'number', minimum: 0 };
const stringArraySchema = { type: 'array', items: stringSchema };
const stringOrStringArraySchema = {
  anyOf: [stringSchema, stringArraySchema],
};
const looseObjectSchema = { type: 'object', additionalProperties: true };
const yesNoSchema = { type: 'string', enum: YES_NO };
const dailyReportYearGroupSchema = {
  type: 'object',
  properties: {
    enrolled: nonNegativeNumberSchema,
    present: nonNegativeNumberSchema,
  },
  required: ['enrolled', 'present'],
  additionalProperties: false,
};
const dailyReportYearGroupsSchema = {
  type: 'object',
  properties: Object.fromEntries(
    DAILY_REPORT_YEAR_GROUPS.map(([groupKey]) => [groupKey, dailyReportYearGroupSchema]),
  ),
  required: DAILY_REPORT_YEAR_GROUPS.map(([groupKey]) => groupKey),
  additionalProperties: false,
};
const dailyReportAbsentTermSchema = {
  type: 'object',
  properties: Object.fromEntries(
    DAILY_REPORT_YEAR_GROUPS.map(([groupKey]) => [groupKey, nonNegativeNumberSchema]),
  ),
  additionalProperties: false,
};

function toolParameters(properties = {}, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

const emptyParameters = toolParameters();

const SUSPENSION_CLASS_ALIASES = {
  'Infant 1': 'First Year',
  'Infant 2': 'Second Year',
};

const SUSPENSION_INFRACTION_WHEN_ALIASES = [
  [/during\s+class/i, 'During class time (member of staff present)'],
  [/assembly/i, 'During assembly'],
  [/before\s+school/i, 'Before school'],
  [/after\s+school/i, 'After school'],
  [/break/i, 'Break time'],
  [/lunch/i, 'Lunch time'],
  [/change.*class|class.*period/i, 'During the change in class periods'],
  [/external|off\s*site|outside/i, 'External to school'],
];

const SUSPENSION_PRIMARY_INFRACTION_ALIASES = [
  [/fight.*weapon/i, 'Fight with Weapon'],
  [/fight|fighting/i, 'Fight without Weapon'],
  [/disrespect|defian|authority|staff/i, 'Disrespect/Defiance of Authority'],
  [/disrupt|disorder/i, 'Disorderly/Disruptive Conduct'],
  [/bully|intimid/i, 'Bullying/Intimidation'],
  [/assault.*weapon/i, 'Assault with Weapon'],
  [/assault/i, 'Assault without Weapon'],
  [/threat.*weapon/i, 'Threat with Weapon'],
  [/threat/i, 'Threat without Weapon'],
  [/theft|robbery/i, 'Robbery/Theft'],
  [/vandal/i, 'Vandalism'],
  [/obscene|language|profan/i, 'Use of Obscene Language'],
  [/technology|phone|device/i, 'Misuse of Technology'],
];

const SUSPENSION_LEVEL_ALIASES = [
  [/level\s*1|minor/i, 'Minor'],
  [/level\s*2|major/i, 'Major'],
  [/level\s*3|severe/i, 'Severe'],
];

const SUSPENSION_DEMO_SCHOOL_ALIASES = new Map([
  ['aranguez government primary school', 'Aranguez GPS'],
  ['demo primary', 'Aranguez GPS'],
  ['unconfigured school', 'Aranguez GPS'],
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function coalesce(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function stringOr(value, fallback) {
  const v = coalesce(value);
  return v === undefined ? fallback : String(v);
}

function yesNo(value, fallback = 'No') {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  const v = String(coalesce(value, fallback)).trim();
  return /^y(es)?$/i.test(v) || /^true$/i.test(v) ? 'Yes' : 'No';
}

function digitsOrDefault(value, fallback) {
  const digits = String(coalesce(value, '')).replace(/\D/g, '');
  return digits ? Number(digits) : fallback;
}

function optionalDigits(value) {
  const digits = String(coalesce(value, '')).replace(/\D/g, '');
  return digits ? Number(digits) : undefined;
}

function optionalArray(value) {
  if (Array.isArray(value)) return value.filter((v) => v !== undefined && v !== null && String(v).trim() !== '').map(String);
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).split(/[;,]/).map((v) => v.trim()).filter(Boolean);
}

function normalizeSuspensionClass(value) {
  const v = stringOr(value, 'Standard 4').trim();
  return SUSPENSION_CLASS_ALIASES[v] ?? v;
}

function normalizeSuspensionLength(value) {
  const n = Number(String(coalesce(value, 2)).match(/\d+/)?.[0] ?? 2);
  if (!Number.isFinite(n)) return '2';
  return String(Math.min(7, Math.max(1, Math.round(n))));
}

function normalizeSuspensionSchoolName(value) {
  const raw = stringOr(value, 'Aranguez GPS').trim();
  return SUSPENSION_DEMO_SCHOOL_ALIASES.get(raw.toLowerCase()) ?? raw;
}

function normalizeSuspensionWhen(value) {
  const raw = stringOr(value, '').trim();
  for (const [pattern, canonical] of SUSPENSION_INFRACTION_WHEN_ALIASES) {
    if (pattern.test(raw)) return canonical;
  }
  return raw || 'During class time (member of staff present)';
}

function normalizeSuspensionPrimaryInfraction(value) {
  const raw = stringOr(value, '').trim();
  for (const [pattern, canonical] of SUSPENSION_PRIMARY_INFRACTION_ALIASES) {
    if (pattern.test(raw)) return canonical;
  }
  return raw || 'Other';
}

function normalizeSuspensionLevel(value, lengthDays) {
  const raw = stringOr(value, '').trim();
  for (const [pattern, canonical] of SUSPENSION_LEVEL_ALIASES) {
    if (pattern.test(raw)) return canonical;
  }
  const n = Number(lengthDays);
  return Number.isFinite(n) && n >= 5 ? 'Major' : 'Minor';
}

function normalizeSuspensionPreviewPayload(rawPayload, cfg) {
  const root = isObject(rawPayload?.payload) ? rawPayload.payload : rawPayload;
  if (!isObject(root)) return rawPayload;

  // The legacy principal.suspension_payload helper captures only the details a
  // principal commonly gives verbally. Fill remaining required fields with
  // deterministic test.fac demo defaults so preview works; submit remains gated.
  const school = isObject(root.school) ? root.school : {};
  const student = isObject(root.student) ? root.student : {};
  const incident = isObject(root.incident) ? root.incident : {};
  const suspension = isObject(root.suspension) ? root.suspension : {};
  const parent = isObject(root.parent) ? root.parent : {};
  const victim = isObject(root.victim) ? root.victim : {};
  const address = isObject(parent.address) ? parent.address : {};
  const {
    school: _school,
    student: _student,
    incident: _incident,
    suspension: _suspension,
    parent: _parent,
    payload: _payload,
    ...flatBase
  } = root;
  const studentInitial = stringOr(
    coalesce(root.student_first_name_initial, student.firstNameInitial, student.first_name_initial),
    'T',
  ).trim().slice(0, 1).toUpperCase();
  const lengthDays = coalesce(root.length_of_suspension, root.length_days, suspension.lengthDays);
  const reason = coalesce(root.primary_infraction, root.reason, incident.reason);
  const additionalInfractions = optionalArray(coalesce(root.additional_infractions, incident.additionalInfractions));
  const parentPhone2 = optionalDigits(coalesce(root.parent_phone_2, parent.phone2, parent.secondaryPhone));

  const normalized = {
    ...flatBase,
    education_district: stringOr(
      coalesce(root.education_district, school.educationDistrict, cfg.educationDistrict),
      'North Eastern',
    ),
    school_type: stringOr(coalesce(root.school_type, school.schoolType, cfg.schoolType), 'Government'),
    school_name: normalizeSuspensionSchoolName(coalesce(root.school_name, school.name, cfg.schoolName)),
    perpetrator_name: stringOr(
      coalesce(root.perpetrator_name, student.name, student.fullName, root.student_name),
      `${studentInitial}. Test`,
    ),
    perpetrator_sex: stringOr(coalesce(root.perpetrator_sex, root.gender, student.gender), 'Male'),
    perpetrator_dob: stringOr(coalesce(root.perpetrator_dob, root.date_of_birth, student.dateOfBirth, student.dob), '2016-01-15'),
    perpetrator_age: String(coalesce(root.perpetrator_age, root.age, student.age, '10')),
    student_birth_certificate_pin: stringOr(
      coalesce(root.student_birth_certificate_pin, student.birthCertificatePin, student.pin),
      'TEST-PIN-0001',
    ),
    class: normalizeSuspensionClass(coalesce(root.class, root.standard, student.standard)),
    date_of_infraction: stringOr(coalesce(root.date_of_infraction, root.date_of_incident, incident.dateOfIncident), todayISO()),
    date_of_issue_of_suspension: stringOr(
      coalesce(root.date_of_issue_of_suspension, root.date_of_suspension, suspension.dateOfSuspension),
      todayISO(),
    ),
    term_suspension_count: Number(coalesce(root.term_suspension_count, suspension.termSuspensionCount, 1)),
    infraction_when: normalizeSuspensionWhen(coalesce(root.infraction_when, incident.when)),
    primary_infraction: normalizeSuspensionPrimaryInfraction(reason),
    additional_infractions_present: yesNo(root.additional_infractions_present, 'No'),
    victim_present: yesNo(root.victim_present, 'No'),
    victim_type: stringOr(coalesce(root.victim_type, victim.type), ''),
    written_reports_collected: yesNo(root.written_reports_collected, 'Yes'),
    length_of_suspension: normalizeSuspensionLength(lengthDays),
    extended_suspension_application: yesNo(root.extended_suspension_application, 'No'),
    sssd_referral: yesNo(root.sssd_referral, 'No'),
    parent_present_at_issue: yesNo(coalesce(root.parent_present_at_issue, suspension.parentContacted), 'Yes'),
    parent_signed_notice: yesNo(root.parent_signed_notice, 'Yes'),
    discipline_matrix_followed: yesNo(root.discipline_matrix_followed, 'Yes'),
    level_of_offence: normalizeSuspensionLevel(root.level_of_offence, lengthDays),
    parent_name: stringOr(coalesce(root.parent_name, parent.name, parent.guardianName), 'Test Parent'),
    parent_phone_1: digitsOrDefault(coalesce(root.parent_phone_1, parent.phone1, parent.phone), 8681234567),
    address_house: stringOr(coalesce(root.address_house, address.house), '12'),
    address_street: stringOr(coalesce(root.address_street, address.street), 'Test Street'),
    address_city: stringOr(coalesce(root.address_city, address.city), 'Aranguez'),
  };
  if (additionalInfractions && additionalInfractions.length > 0) {
    normalized.additional_infractions = additionalInfractions;
  }
  if (parentPhone2 !== undefined) {
    normalized.parent_phone_2 = parentPhone2;
  }
  return normalized;
}

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
    name: 'principal.daily_report_form_payload',
    description:
      'Build the exact Microsoft Forms field payload for the Primary School Daily Report. Use this before forms.preview_daily_report. "Nothing to report" means no discipline, transport, meal illness, or whole-term absentee issues; do not invent attendance, teacher, meal, PTSC, or branch-specific counts. Required: date, teacher counts including MOH quarantine/other leave, and year_groups enrolled/present counts. Returns { form, payload }.',
    parameters: toolParameters(
      {
        date: stringSchema,
        did_you_have_school_today: yesNoSchema,
        reason_no_school: stringSchema,
        principal_status: {
          type: 'string',
          enum: [
            'Physically present at school',
            'Conducting official school business off the compound',
            'Absent',
            'On MOH issued quarantine',
          ],
        },
        vice_principal_status: {
          type: 'string',
          enum: [
            'Physically present at school',
            'Conducting official school business off the compound',
            'Absent',
            'On MOH issued quarantine',
            'School does not have a VP/Senior Teacher',
          ],
        },
        number_of_teachers_on_staff: nonNegativeNumberSchema,
        number_of_teachers_present: nonNegativeNumberSchema,
        number_of_teachers_absent: nonNegativeNumberSchema,
        number_of_teachers_on_moh_quarantine: nonNegativeNumberSchema,
        number_of_teachers_other_leave: nonNegativeNumberSchema,
        year_groups: dailyReportYearGroupsSchema,
        school_receives_nsdsl_meals: yesNoSchema,
        received_nsdsl_breakfasts: yesNoSchema,
        breakfasts_delivered: nonNegativeNumberSchema,
        breakfasts_left_after_distribution: nonNegativeNumberSchema,
        breakfast_portion_size_rating: {
          type: 'string',
          enum: ['Too much', 'Enough', 'Too little'],
        },
        children_satisfied_with_breakfast: yesNoSchema,
        students_fell_ill_after_nsdsl_breakfast: nonNegativeNumberSchema,
        received_nsdsl_lunches: yesNoSchema,
        lunches_delivered: nonNegativeNumberSchema,
        lunches_left_after_distribution: nonNegativeNumberSchema,
        lunch_portion_size_rating: {
          type: 'string',
          enum: ['Too much', 'Enough', 'Too little'],
        },
        children_satisfied_with_lunch: yesNoSchema,
        students_fell_ill_after_nsdsl_lunch: nonNegativeNumberSchema,
        students_suspended_today: yesNoSchema,
        number_of_students_suspended: nonNegativeNumberSchema,
        suspension_recorded_on_form: yesNoSchema,
        school_serviced_by_ptsc_maxi_taxi: yesNoSchema,
        ptsc_approved_routes_count: nonNegativeNumberSchema,
        ptsc_morning_trips_count: nonNegativeNumberSchema,
        last_day_of_week: yesNoSchema,
        students_absent_entire_term: yesNoSchema,
        absent_entire_term_counts: dailyReportAbsentTermSchema,
      },
      [
        'date',
        'number_of_teachers_on_staff',
        'number_of_teachers_present',
        'number_of_teachers_absent',
        'number_of_teachers_on_moh_quarantine',
        'number_of_teachers_other_leave',
        'year_groups',
      ],
    ),
    execute: async (_toolCallId, args = {}) => {
      const { date } = args;
      requireString('date', date);
      requireNumber('number_of_teachers_on_staff', args.number_of_teachers_on_staff);
      requireNumber('number_of_teachers_present', args.number_of_teachers_present);
      requireNumber('number_of_teachers_absent', args.number_of_teachers_absent);

      const payload = {
        date_being_reported_on: date,
        education_district: cfg.educationDistrict,
        school_type: cfg.schoolType,
        name_of_school: cfg.schoolName,
        did_you_have_school_today: choice('did_you_have_school_today', args.did_you_have_school_today, YES_NO, 'Yes'),
        principal_status: choice(
          'principal_status',
          args.principal_status,
          [
            'Physically present at school',
            'Conducting official school business off the compound',
            'Absent',
            'On MOH issued quarantine',
          ],
          'Physically present at school',
        ),
        vice_principal_status: choice(
          'vice_principal_status',
          args.vice_principal_status,
          [
            'Physically present at school',
            'Conducting official school business off the compound',
            'Absent',
            'On MOH issued quarantine',
            'School does not have a VP/Senior Teacher',
          ],
          'Physically present at school',
        ),
        number_of_teachers_on_staff: args.number_of_teachers_on_staff,
        number_of_teachers_present: args.number_of_teachers_present,
        number_of_teachers_absent: args.number_of_teachers_absent,
        number_of_teachers_on_moh_quarantine: numberValue(
          'number_of_teachers_on_moh_quarantine',
          args.number_of_teachers_on_moh_quarantine,
        ),
        number_of_teachers_other_leave: numberValue(
          'number_of_teachers_other_leave',
          args.number_of_teachers_other_leave,
        ),
        school_receives_nsdsl_meals: choice('school_receives_nsdsl_meals', args.school_receives_nsdsl_meals, YES_NO, 'No'),
        students_suspended_today: choice('students_suspended_today', args.students_suspended_today, YES_NO, 'No'),
        school_serviced_by_ptsc_maxi_taxi: choice(
          'school_serviced_by_ptsc_maxi_taxi',
          args.school_serviced_by_ptsc_maxi_taxi,
          YES_NO,
          'No',
        ),
        last_day_of_week: choice('last_day_of_week', args.last_day_of_week, YES_NO, 'No'),
      };

      if (payload.did_you_have_school_today === 'No') {
        requireString('reason_no_school', args.reason_no_school);
        payload.reason_no_school = args.reason_no_school;
      }

      for (const [groupKey, enrolledField, presentField] of DAILY_REPORT_YEAR_GROUPS) {
        const group = getGroupCounts(args, groupKey);
        payload[enrolledField] = group.enrolled;
        payload[presentField] = group.present;
      }

      if (payload.school_receives_nsdsl_meals === 'Yes') {
        payload.received_nsdsl_breakfasts = requireChoice(
          'received_nsdsl_breakfasts',
          args.received_nsdsl_breakfasts,
          YES_NO,
        );
        if (payload.received_nsdsl_breakfasts === 'Yes') {
          payload.breakfasts_delivered = numberValue('breakfasts_delivered', args.breakfasts_delivered);
          payload.breakfasts_left_after_distribution = numberValue(
            'breakfasts_left_after_distribution',
            args.breakfasts_left_after_distribution,
          );
          payload.breakfast_portion_size_rating = requireChoice(
            'breakfast_portion_size_rating',
            args.breakfast_portion_size_rating,
            ['Too much', 'Enough', 'Too little'],
          );
          payload.children_satisfied_with_breakfast = requireChoice(
            'children_satisfied_with_breakfast',
            args.children_satisfied_with_breakfast,
            YES_NO,
          );
          payload.students_fell_ill_after_nsdsl_breakfast = numberValue(
            'students_fell_ill_after_nsdsl_breakfast',
            args.students_fell_ill_after_nsdsl_breakfast,
          );
        }

        payload.received_nsdsl_lunches = requireChoice(
          'received_nsdsl_lunches',
          args.received_nsdsl_lunches,
          YES_NO,
        );
        if (payload.received_nsdsl_lunches === 'Yes') {
          payload.lunches_delivered = numberValue('lunches_delivered', args.lunches_delivered);
          payload.lunches_left_after_distribution = numberValue(
            'lunches_left_after_distribution',
            args.lunches_left_after_distribution,
          );
          payload.lunch_portion_size_rating = requireChoice(
            'lunch_portion_size_rating',
            args.lunch_portion_size_rating,
            ['Too much', 'Enough', 'Too little'],
          );
          payload.children_satisfied_with_lunch = requireChoice(
            'children_satisfied_with_lunch',
            args.children_satisfied_with_lunch,
            YES_NO,
          );
          payload.students_fell_ill_after_nsdsl_lunch = numberValue(
            'students_fell_ill_after_nsdsl_lunch',
            args.students_fell_ill_after_nsdsl_lunch,
          );
        }
      }

      if (payload.students_suspended_today === 'Yes') {
        payload.number_of_students_suspended = numberValue(
          'number_of_students_suspended',
          args.number_of_students_suspended,
        );
        payload.suspension_recorded_on_form = requireChoice(
          'suspension_recorded_on_form',
          args.suspension_recorded_on_form,
          YES_NO,
        );
      }

      if (payload.school_serviced_by_ptsc_maxi_taxi === 'Yes') {
        payload.ptsc_approved_routes_count = numberValue(
          'ptsc_approved_routes_count',
          args.ptsc_approved_routes_count,
        );
        payload.ptsc_morning_trips_count = numberValue(
          'ptsc_morning_trips_count',
          args.ptsc_morning_trips_count,
        );
      }

      if (payload.last_day_of_week === 'Yes') {
        payload.students_absent_entire_term = requireChoice(
          'students_absent_entire_term',
          args.students_absent_entire_term,
          YES_NO,
        );
        if (payload.students_absent_entire_term === 'Yes') {
          const counts = args.absent_entire_term_counts ?? {};
          payload.total_students_absent_entire_term = DAILY_REPORT_YEAR_GROUPS.reduce((sum, [groupKey]) => {
            return sum + numberValue(`absent_entire_term_counts.${groupKey}`, counts[groupKey]);
          }, 0);
          for (const [groupKey] of DAILY_REPORT_YEAR_GROUPS) {
            payload[`${groupKey}_students_absent_entire_term`] = numberValue(
              `absent_entire_term_counts.${groupKey}`,
              counts[groupKey],
            );
          }
        }
      }

      return {
        form: 'primary_school_daily_report',
        term: 'Term 3 2025/26',
        payload,
      };
    },
  });

  registerTool({
    name: 'principal.suspension_payload',
    description:
      'Build the structured payload for the Primary School Student Suspensions form (one per pupil). Include every field found in the source document, not only the short verbal summary. Common args: { student_first_name_initial, perpetrator_name, gender, standard, reason, length_days, parent_contacted, date_of_incident, date_of_suspension, date_of_birth, age, student_birth_certificate_pin, parent_name, parent_phone_1, parent_phone_2, address_house, address_street, address_city, additional_infractions_present, additional_infractions, victim_present, victim_type }. Returns JSON only. Pass this result as-is to forms.preview_suspension; the preview tool maps it to the live form fields. Pupil names are not stored in long-term memory — only this form payload.',
    parameters: toolParameters(
      {
        student_first_name_initial: stringSchema,
        perpetrator_name: stringSchema,
        gender: { type: 'string', enum: VALID_GENDERS },
        standard: { type: 'string', enum: VALID_STANDARDS },
        reason: stringSchema,
        length_days: nonNegativeNumberSchema,
        parent_contacted: booleanSchema,
        date_of_incident: stringSchema,
        date_of_suspension: stringSchema,
        date_of_birth: stringSchema,
        age: stringSchema,
        student_birth_certificate_pin: stringSchema,
        school_name: stringSchema,
        education_district: stringSchema,
        school_type: stringSchema,
        suspensions_this_term: nonNegativeNumberSchema,
        infraction_when: stringSchema,
        additional_infractions_present: yesNoSchema,
        additional_infractions: stringOrStringArraySchema,
        victim_present: yesNoSchema,
        victim_type: stringSchema,
        written_reports_collected: yesNoSchema,
        extended_suspension_application: yesNoSchema,
        sssd_referral: yesNoSchema,
        parent_present_at_issue: yesNoSchema,
        parent_signed_notice: yesNoSchema,
        discipline_matrix_followed: yesNoSchema,
        level_of_offence: stringSchema,
        parent_name: stringSchema,
        parent_phone_1: stringSchema,
        parent_phone_2: stringSchema,
        address_house: stringSchema,
        address_street: stringSchema,
        address_city: stringSchema,
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
        perpetrator_name,
        gender,
        standard,
        reason,
        length_days,
        parent_contacted,
        date_of_incident,
        date_of_suspension,
        date_of_birth,
        age,
        student_birth_certificate_pin,
        school_name,
        education_district,
        school_type,
        suspensions_this_term,
        infraction_when,
        additional_infractions_present,
        additional_infractions,
        victim_present,
        victim_type,
        written_reports_collected,
        extended_suspension_application,
        sssd_referral,
        parent_present_at_issue,
        parent_signed_notice,
        discipline_matrix_followed,
        level_of_offence,
        parent_name,
        parent_phone_1,
        parent_phone_2,
        address_house,
        address_street,
        address_city,
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
          name: stringOr(school_name, cfg.schoolName),
          educationDistrict: stringOr(education_district, cfg.educationDistrict),
          schoolType: stringOr(school_type, cfg.schoolType),
        },
        principal: cfg.principalName,
        student: {
          firstNameInitial: student_first_name_initial.trim().slice(0, 1).toUpperCase(),
          fullName: perpetrator_name,
          gender,
          standard,
          dateOfBirth: date_of_birth,
          age,
          birthCertificatePin: student_birth_certificate_pin,
        },
        incident: {
          dateOfIncident: date_of_incident,
          reason,
          when: infraction_when,
          additionalInfractions: optionalArray(additional_infractions),
        },
        suspension: {
          dateOfSuspension: date_of_suspension,
          lengthDays: length_days,
          parentContacted: Boolean(parent_contacted),
          termSuspensionCount: suspensions_this_term,
        },
        school_name,
        education_district,
        school_type,
        perpetrator_name,
        perpetrator_dob: date_of_birth,
        perpetrator_age: age,
        student_birth_certificate_pin,
        term_suspension_count: suspensions_this_term,
        infraction_when,
        additional_infractions_present,
        additional_infractions,
        victim_present,
        victim_type,
        written_reports_collected,
        extended_suspension_application,
        sssd_referral,
        parent_present_at_issue,
        parent_signed_notice,
        discipline_matrix_followed,
        level_of_offence,
        parent_name,
        parent_phone_1,
        parent_phone_2,
        address_house,
        address_street,
        address_city,
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
  const browser =
    hostApiPort && hostApiToken
      ? createHostApiBrowserFacade(hostApiPort, hostApiToken)
      : null;
  if (browser) {
    registerTool({
      name: 'browser.diagnose',
      description:
        'Diagnose browser automation readiness for Outlook and Microsoft Forms. Returns Chrome/CDP state such as cdp_ready, chrome_not_found, profile_locked_close_chrome, or cdp_down_chrome_closed, plus the next safe action. Call this after any Outlook/Forms Chrome attach failure. Never give a principal manual Chrome setup, flags-page, online troubleshooting, or command-line instructions.',
      parameters: emptyParameters,
      execute: async (_toolCallId, _params = {}) => browser.diagnose(),
    });

    registerTool({
      name: 'browser.repair_chrome_cdp',
      description:
        'Repair Chrome browser automation by launching the system Chrome profile with the ClawX-required automation port when safe. Never force-closes Chrome. If Chrome is already open without CDP, returns profile_locked_close_chrome; ask the principal to close all Chrome windows and retry from ClawX. Do not ask the principal to run manual Chrome commands or configure Chrome automation manually.',
      parameters: emptyParameters,
      execute: async (_toolCallId, _params = {}) => browser.repairChromeCdp(),
    });
  }

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
        'Open Outlook Web (https://outlook.office.com/mail/) in the principal\'s existing Chrome session. Use outlook.open first for Outlook email tasks, then use the explicit Outlook tools for read/search/read-email/reply/forward/send instead of generic browser/Chrome MCP tools. Returns { status: "opened" | "needs_signin", url, message?, transport?, source?, implementation?, version? }. If transport/source/implementation/version is present, report it as Outlook Browser v2/browser, Microsoft Graph, or legacy; do not infer it when absent. If a Chrome/CDP attach error occurs, call browser.diagnose then browser.repair_chrome_cdp before asking the principal to do anything manually. Never give the principal manual Chrome debugging, manual Chrome setup, flags-page, online troubleshooting, or command-line instructions. If sign-in is required, ask the principal to sign in to Outlook in the Chrome window that just opened, then call outlook.open again.',
      parameters: emptyParameters,
      execute: async (_toolCallId, _params = {}) => {
        const result = await outlook.open();
        return result;
      },
    });

    registerTool({
      name: 'outlook.read_inbox',
      description:
        'Read the top N recent messages from the principal\'s Outlook Inbox through the ClawX Outlook tool path. Canonical action: read. Args: { top?: number (default 10) }. This is a bounded recent Inbox window, not an exhaustive mailbox export. For "all emails", "this month", or audit-style summaries, use outlook.search_inbox with top 100-200, report scan.scannedCount/scan.scope, and do not claim all mail unless scan.exhaustive is true. If transport/source/implementation/version is present in the result, report it as Outlook Browser v2/browser, Microsoft Graph, or legacy; do not infer it when absent. If Chrome attach fails, use browser.diagnose and browser.repair_chrome_cdp; do not give manual Chrome setup instructions. Returns { status: "ok" | "needs_signin", messages: [{ id, subject, sender, snippet, receivedAt, unread }], scan, transport?, source?, implementation?, version? }.',
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
        'Compose a new email in Outlook Web and leave the draft open for the principal to review. Does NOT send. Use this only for a new draft, not to recover from a draft-related send refusal. Args: { to: string | string[], subject, body, cc?, bcc? }. The body is email content and belongs only in the Outlook message body editor, never in To/Cc/Bcc. If transport/source/implementation/version is present, report it as Outlook Browser v2/browser, Microsoft Graph, or legacy. Returns { status, draftLeftOpen, preview, transport?, source?, implementation?, version? }.',
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
        'Send the single visible reviewed draft in Outlook Web. Canonical action: send. HARD GATE: refuses unless { confirm: true } is set. The agent MUST show or leave the draft open for the principal and obtain explicit confirmation ("yes, send") before passing confirm=true. After the principal reviews an open draft, call outlook.send_email with { confirm: true } only; do not regenerate, redraft, or resend to/subject/body from memory. If the result refuses or fails because of drafts (no open draft, multiple drafts, stale saved draft, mismatched draft, or unverified Send button), do not call outlook.draft_email again. Run browser.diagnose when the result indicates browser/CDP state; otherwise ask one concrete diagnostic question about whether exactly one reviewed Outlook compose pane is visible, then retry outlook.send_email with { confirm: true } only after that visible draft state is clear. If transport/source/implementation/version is present, report it as Outlook Browser v2/browser, Microsoft Graph, or legacy. Optional to/cc/bcc/subject/body are safety assertions for advanced flows, not required for the normal reviewed-draft send.',
      parameters: toolParameters(
        {
          to: stringOrStringArraySchema,
          subject: stringSchema,
          body: stringSchema,
          cc: stringOrStringArraySchema,
          bcc: stringOrStringArraySchema,
          confirm: booleanSchema,
        },
        ['confirm'],
      ),
      execute: async (_toolCallId, args = {}) => {
        const { to, subject, body, cc, bcc, confirm } = args;
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
        'Search the principal\'s Inbox by sender, subject, date, unread, or attachment presence. Canonical action: search. Args: { from?, subjectContains?, dateGte?, dateLt?, unread?, hasAttachment?, top? (default 25) }. Returns { status, messages, capped, scan, transport?, source?, implementation?, version? }. dateGte/dateLt are ISO 8601 strings. Prefer this over read_inbox when the user mentions a sender, date, month, or topic. For broad month/all-inbox searches use top 100-200, report the bounded scan, and say capped/incomplete/not exhaustive when capped is true or scan.exhaustive is false. Do not say "these are all emails" unless scan.exhaustive is true. If transport/source/implementation/version is present, report it as Outlook Browser v2/browser, Microsoft Graph, or legacy; do not infer it when absent.',
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
        'Open a specific message and return its full body, sender, recipients, and attachment list. Canonical action: read-email. Args: { id }. id is the InboxMessage.id from read_inbox or search_inbox (sender|subject|received fingerprint). Returns { status, id, subject, sender, receivedAt, body, recipients, attachments: [{ filename, sizeBytes?, mimeType? }], transport?, source?, implementation?, version? }. Use this before summarising a specific message or drafting a reply/forward. If transport/source/implementation/version is present, report it as Outlook Browser v2/browser, Microsoft Graph, or legacy; do not infer it when absent.',
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
        'Reply (or reply-all) to a specific message. Canonical action: reply. Use this explicit Outlook tool for replies; do not use generic browser clicks or toolbar guessing to find Reply. Opens the reply pane in Outlook with To/Subject pre-filled by Outlook; we fill only the message body editor. Do not ask for a recipient after Outlook pre-fills the reply draft, and never place body text in To/Cc/Bcc. Leaves the draft open for the principal to review — does NOT send. Args: { id, body, replyAll? (default false) }. If transport/source/implementation/version is present, report it as Outlook Browser v2/browser, Microsoft Graph, or legacy.',
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
        'Forward a specific message to a new recipient. Canonical action: forward. Use this explicit Outlook tool for forwards; do not use generic browser clicks or toolbar guessing to find Forward. Opens the forward pane in Outlook with the original message quoted; To/Cc/Bcc are recipients only, and optional body is commentary that belongs only in the message body editor. Leaves the draft open. Args: { id, to: string | string[], body? }. If transport/source/implementation/version is present, report it as Outlook Browser v2/browser, Microsoft Graph, or legacy.',
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

  // ── Forms (Microsoft Forms via browser-session, MoE daily + suspension forms)
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
        'Open the Suspensions form in the principal\'s browser and fill every field from a typed payload. Accepts either the exact flat Forms field schema or the nested principal.suspension_payload result and normalizes it before filling. Does NOT submit. Returns { status: "previewed", url, filledCount, skippedCount, errors[] }. If a Chrome/CDP attach error occurs, call browser.diagnose then browser.repair_chrome_cdp before asking the principal to do anything manually. Use this AFTER the user has reviewed the extracted fields and asked you to fill the form. Always call this before forms.submit_suspension.',
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
        return forms.previewSuspension({ payload: normalizeSuspensionPreviewPayload(args.payload, cfg) });
      },
    });

    registerTool({
      name: 'forms.preview_daily_report',
      description:
        'Open the Primary School Daily Report form in the principal\'s browser and fill every visible field from a typed payload. Does NOT submit. Returns { status: "previewed", filledCount, skippedCount, errors[] }. If a Chrome/CDP attach error occurs, call browser.diagnose then browser.repair_chrome_cdp before asking the principal to do anything manually. Use principal.daily_report_form_payload first, show the result to the principal, then call this for browser preview.',
      parameters: toolParameters(
        {
          payload: looseObjectSchema,
        },
        ['payload'],
      ),
      execute: async (_toolCallId, args = {}) => {
        if (!args.payload || typeof args.payload !== 'object') {
          throw new Error('payload object required (field ids from daily-report-schema.vlm.json).');
        }
        return forms.previewDailyReport({ payload: args.payload });
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

    registerTool({
      name: 'forms.submit_daily_report',
      description:
        'Submit the Primary School Daily Report form. HARD GATE: refuses unless { confirm: true }. The agent MUST show the filled form (forms.preview_daily_report first) and obtain explicit confirmation ("yes, submit") before passing confirm=true. Returns { status: "submitted" | "refused" | "error", message?, reason? }.',
      parameters: toolParameters(
        {
          confirm: booleanSchema,
        },
        ['confirm'],
      ),
      execute: async (_toolCallId, args = {}) => forms.submitDailyReport({ confirm: args.confirm === true }),
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
 * Build a browser automation facade for shared Outlook/Forms diagnostics.
 */
function createHostApiBrowserFacade(port, token) {
  const base = `http://127.0.0.1:${port}/api/browser`;
  const REQUEST_TIMEOUT_MS = 30_000;

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
      throw new Error(`browser host-API ${path} unreachable: ${msg}`);
    }
    const text = await resp.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* fall through */ }
    if (!resp.ok) {
      const errMsg = (data && (data.error || data.message)) || text.slice(0, 200) || `HTTP ${resp.status}`;
      throw new Error(`browser host-API ${path}: ${errMsg}`);
    }
    if (data && typeof data === 'object' && 'success' in data) {
      if ('data' in data) return data.data;
      if ('result' in data) return data.result;
    }
    return data;
  }

  return {
    diagnose: () => call('/diagnose'),
    repairChromeCdp: () => call('/repair-chrome-cdp'),
  };
}

/**
 * Build a forms facade that proxies the agent-callable methods over
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
    previewDailyReport: (args) => call('/preview-daily-report', args),
    submitDailyReport: (args) => call('/submit-daily-report', args),
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
 *   - Network / timeout       → wrap as a structured tool result instead
 *     of throwing. Send/download use { status: 'unknown' } and tell the
 *     agent not to retry automatically because side effects may have happened.
 */
function createHostApiOutlookFacade(port, token) {
  const base = `http://127.0.0.1:${port}/api/outlook`;
  const REQUEST_TIMEOUT_MS = 60_000; // generous: drafts can include slow DOM waits.

  function structuredError(path, message) {
    if (path === '/send') {
      return {
        status: 'unknown',
        message:
          `${message}. Outlook send result could not be confirmed. Do not retry automatically; ask the principal to check the open draft or Sent Items in Outlook before trying again.`,
      };
    }
    if (path === '/download-attachment') {
      return {
        status: 'unknown',
        message:
          `${message}. Outlook attachment download result could not be confirmed. Do not retry automatically; ask the principal to check the Downloads folder before trying again.`,
      };
    }
    return { status: 'error', message };
  }

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
      return structuredError(path, `outlook host-API ${path} unreachable: ${msg}`);
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
      return structuredError(path, `outlook host-API ${path}: ${errMsg}`);
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
