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
import {
  readPdf as docReadPdf,
  readDocx as docReadDocx,
  writeDocx as docWriteDocx,
  readXlsx as docReadXlsx,
  writeXlsx as docWriteXlsx,
  readImage as docReadImage,
  findDocuments as docFindDocuments,
} from './doc-tools.mjs';
import {
  createHostApiCapabilityGate,
  gateHostApiFacade,
  hostApiSkewMessage,
} from './capability-gate.mjs';
import { loadNsccText, searchNscc } from './nscc-lookup.mjs';

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

// CLWX-98: patterns are tried in order and `.*` happily spans words like
// " without " or " unsupervised ", so every exact form option text must win
// before any broader pattern that would rewrite it. More-specific rows sit
// first, and the "with Weapon" rows carve out "without" via lookahead. The
// identity round-trip over every option text is enforced by
// tests/unit/moe-suspensions-option-roundtrip.test.ts.
const SUSPENSION_INFRACTION_WHEN_ALIASES = [
  [/unsupervised/i, 'During class time (unsupervised)'],
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
  [/fight(?!.*without).*weapon/i, 'Fight with Weapon'],
  [/fight|fighting/i, 'Fight without Weapon'],
  [/disrespect|defian|authority|staff/i, 'Disrespect/Defiance of Authority'],
  [/disrupt|disorder/i, 'Disorderly/Disruptive Conduct'],
  [/cyber.*bully/i, 'Cyber Bullying'],
  [/bully|intimid/i, 'Bullying/Intimidation'],
  [/assault(?!.*without).*weapon/i, 'Assault with Weapon'],
  [/assault/i, 'Assault without Weapon'],
  [/threat(?!.*without).*weapon/i, 'Threat with Weapon'],
  [/threat/i, 'Threat without Weapon'],
  [/theft|robbery/i, 'Robbery/Theft'],
  [/vandal/i, 'Vandalism'],
  [/incendiary|explosive/i, 'Possession of an Incendiary/Explosive Device'],
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
  const v = String(value).trim();
  return SUSPENSION_CLASS_ALIASES[v] ?? v;
}

function normalizeSuspensionLength(value) {
  const digits = String(value).match(/\d+/)?.[0];
  if (digits === undefined) return undefined; // unparseable == missing; never invent a length
  return String(Math.min(7, Math.max(1, Math.round(Number(digits)))));
}

function normalizeSuspensionSchoolName(value) {
  const raw = String(value).trim();
  return SUSPENSION_DEMO_SCHOOL_ALIASES.get(raw.toLowerCase()) ?? raw;
}

function normalizeSuspensionWhen(value) {
  const raw = String(value).trim();
  for (const [pattern, canonical] of SUSPENSION_INFRACTION_WHEN_ALIASES) {
    if (pattern.test(raw)) return canonical;
  }
  return raw;
}

function normalizeSuspensionPrimaryInfraction(value) {
  const raw = String(value).trim();
  for (const [pattern, canonical] of SUSPENSION_PRIMARY_INFRACTION_ALIASES) {
    if (pattern.test(raw)) return canonical;
  }
  return raw;
}

function normalizeSuspensionLevel(value, lengthDays) {
  const raw = String(value).trim();
  for (const [pattern, canonical] of SUSPENSION_LEVEL_ALIASES) {
    if (pattern.test(raw)) return canonical;
  }
  const n = Number(lengthDays);
  return Number.isFinite(n) && n >= 5 ? 'Major' : 'Minor';
}

/**
 * CLWX-79: this normalizer used to silently backfill every missing statutory
 * field with a test.fac demo default, so a near-empty payload always produced
 * a fully "valid" Suspensions form. That is a trust violation on a statutory
 * document — a written_reports_collected: "Yes" the principal never asserted.
 *
 * Contract now:
 *   - Provided values are canonicalized exactly as before (aliases, clamps).
 *   - Missing REQUIRED fields => { ok: false, missingFields } and the caller
 *     must refuse; no value is ever invented.
 *   - A non-object payload (including an array) => { ok: false, invalidPayload }
 *     and the caller must refuse; the raw value is never passed to the browser.
 *   - Demo defaults survive ONLY when the operator sets the explicitly-named
 *     env var MOE_DEMO_DEFAULTS === '1'. There is deliberately NO tool argument
 *     for this: a model can never flip it, and it is decoupled from the
 *     fill-scripts' generic DEMO=1. Every defaulted field id is reported in
 *     demoDefaultsApplied so the result is marked.
 *   - Conditionally-required fields (additional_infractions when
 *     additional_infractions_present is "Yes", victim_type when
 *     victim_present is "Yes") refuse even in demo mode — demo defaults never
 *     assert an incident detail the principal did not state.
 */
function normalizeSuspensionPreviewPayload(rawPayload, cfg, { demo = false } = {}) {
  const root = isObject(rawPayload?.payload) ? rawPayload.payload : rawPayload;
  // Reject arrays and any non-plain-object payload up front: `typeof [] ===
  // 'object'` so an array would otherwise slip past the caller's guard and be
  // forwarded verbatim to the browser fill. A statutory form is never filled
  // from a shape we cannot validate field-by-field.
  if (!isObject(root)) return { ok: false, invalidPayload: true };

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

  const missingFields = [];
  const demoDefaultsApplied = [];
  // Resolve one required form field. `provided` has already been coalesced
  // across the flat + nested aliases; `normalizeProvided` may return undefined
  // to signal "present but unusable" (e.g. a length with no digits), which is
  // treated the same as missing.
  const resolve = (fieldId, provided, normalizeProvided, demoDefault) => {
    if (provided !== undefined) {
      const normalized = normalizeProvided ? normalizeProvided(provided) : provided;
      // NaN (e.g. Number('many') for term_suspension_count) is "present but
      // unusable" — coerce it away so a NaN never reaches the form payload.
      const unusable = typeof normalized === 'number' && Number.isNaN(normalized);
      if (normalized !== undefined && !unusable) return normalized;
    }
    if (demo) {
      demoDefaultsApplied.push(fieldId);
      return typeof demoDefault === 'function' ? demoDefault() : demoDefault;
    }
    missingFields.push(fieldId);
    return undefined;
  };

  const normalized = {
    ...flatBase,
    education_district: resolve(
      'education_district',
      coalesce(root.education_district, school.educationDistrict, cfg.educationDistrict),
      String,
      'North Eastern',
    ),
    school_type: resolve('school_type', coalesce(root.school_type, school.schoolType, cfg.schoolType), String, 'Government'),
    school_name: resolve(
      'school_name',
      coalesce(root.school_name, school.name, cfg.schoolName),
      normalizeSuspensionSchoolName,
      'Aranguez GPS',
    ),
    perpetrator_name: resolve(
      'perpetrator_name',
      coalesce(root.perpetrator_name, student.name, student.fullName, root.student_name),
      String,
      `${studentInitial}. Test`,
    ),
    perpetrator_sex: resolve('perpetrator_sex', coalesce(root.perpetrator_sex, root.gender, student.gender), String, 'Male'),
    perpetrator_dob: resolve(
      'perpetrator_dob',
      coalesce(root.perpetrator_dob, root.date_of_birth, student.dateOfBirth, student.dob),
      String,
      '2016-01-15',
    ),
    perpetrator_age: resolve('perpetrator_age', coalesce(root.perpetrator_age, root.age, student.age), String, '10'),
    student_birth_certificate_pin: resolve(
      'student_birth_certificate_pin',
      coalesce(root.student_birth_certificate_pin, student.birthCertificatePin, student.pin),
      String,
      'TEST-PIN-0001',
    ),
    class: resolve('class', coalesce(root.class, root.standard, student.standard), normalizeSuspensionClass, 'Standard 4'),
    date_of_infraction: resolve(
      'date_of_infraction',
      coalesce(root.date_of_infraction, root.date_of_incident, incident.dateOfIncident),
      String,
      todayISO,
    ),
    date_of_issue_of_suspension: resolve(
      'date_of_issue_of_suspension',
      coalesce(root.date_of_issue_of_suspension, root.date_of_suspension, suspension.dateOfSuspension),
      String,
      todayISO,
    ),
    term_suspension_count: resolve(
      'term_suspension_count',
      coalesce(root.term_suspension_count, suspension.termSuspensionCount),
      Number,
      1,
    ),
    infraction_when: resolve(
      'infraction_when',
      coalesce(root.infraction_when, incident.when),
      normalizeSuspensionWhen,
      'During class time (member of staff present)',
    ),
    primary_infraction: resolve('primary_infraction', reason, normalizeSuspensionPrimaryInfraction, 'Other'),
    additional_infractions_present: resolve(
      'additional_infractions_present',
      coalesce(root.additional_infractions_present),
      yesNo,
      'No',
    ),
    victim_present: resolve('victim_present', coalesce(root.victim_present), yesNo, 'No'),
    victim_type: stringOr(coalesce(root.victim_type, victim.type), ''),
    written_reports_collected: resolve(
      'written_reports_collected',
      coalesce(root.written_reports_collected),
      yesNo,
      'Yes',
    ),
    length_of_suspension: resolve('length_of_suspension', lengthDays, normalizeSuspensionLength, '2'),
    extended_suspension_application: resolve(
      'extended_suspension_application',
      coalesce(root.extended_suspension_application),
      yesNo,
      'No',
    ),
    sssd_referral: resolve('sssd_referral', coalesce(root.sssd_referral), yesNo, 'No'),
    parent_present_at_issue: resolve(
      'parent_present_at_issue',
      coalesce(root.parent_present_at_issue, suspension.parentContacted),
      yesNo,
      'Yes',
    ),
    parent_signed_notice: resolve('parent_signed_notice', coalesce(root.parent_signed_notice), yesNo, 'Yes'),
    discipline_matrix_followed: resolve(
      'discipline_matrix_followed',
      coalesce(root.discipline_matrix_followed),
      yesNo,
      'Yes',
    ),
    level_of_offence: resolve(
      'level_of_offence',
      coalesce(root.level_of_offence),
      (v) => normalizeSuspensionLevel(v, lengthDays),
      () => {
        const n = Number(lengthDays);
        return Number.isFinite(n) && n >= 5 ? 'Major' : 'Minor';
      },
    ),
    parent_name: resolve('parent_name', coalesce(root.parent_name, parent.name, parent.guardianName), String, 'Test Parent'),
    parent_phone_1: resolve(
      'parent_phone_1',
      coalesce(root.parent_phone_1, parent.phone1, parent.phone),
      optionalDigits,
      8681234567,
    ),
    address_house: resolve('address_house', coalesce(root.address_house, address.house), String, '12'),
    address_street: resolve('address_street', coalesce(root.address_street, address.street), String, 'Test Street'),
    address_city: resolve('address_city', coalesce(root.address_city, address.city), String, 'Aranguez'),
  };
  if (additionalInfractions && additionalInfractions.length > 0) {
    normalized.additional_infractions = additionalInfractions;
  }
  if (parentPhone2 !== undefined) {
    normalized.parent_phone_2 = parentPhone2;
  }
  // Conditionally-required incident details: never demo-defaulted.
  if (normalized.additional_infractions_present === 'Yes' && (!additionalInfractions || additionalInfractions.length === 0)) {
    missingFields.push('additional_infractions');
  }
  if (normalized.victim_present === 'Yes' && coalesce(root.victim_type, victim.type) === undefined) {
    missingFields.push('victim_type');
  }
  if (missingFields.length > 0) {
    return { ok: false, missingFields };
  }
  return { ok: true, payload: normalized, demoDefaultsApplied };
}

function suspensionMissingFieldsRefusal(missingFields) {
  return {
    status: 'refused',
    reason: 'missing_required_fields',
    missingFields,
    message:
      `Cannot fill the Suspensions form: ${missingFields.length} required field(s) are missing: ` +
      `${missingFields.join(', ')}. Ask the principal for exactly these values — this is a statutory ` +
      'form, so values are never invented or defaulted.',
  };
}

function suspensionInvalidPayloadRefusal() {
  return {
    status: 'refused',
    reason: 'invalid_payload',
    message:
      'Cannot fill the Suspensions form: the payload must be a JSON object of named fields, ' +
      'not an array or scalar. Provide the extracted fields as an object — this is a statutory ' +
      'form, so an unstructured payload is never filled.',
  };
}

/**
 * PRINCIPAL_SKILL_ALLOWLIST is enforced at the host (electron/api/routes/skills.ts
 * + src/stores/skills.ts). Tools registered here whose names are not in the
 * allowlist remain reachable programmatically by the agent but are hidden
 * from the Skills page. Outlook tools are intentionally agent-callable and
 * not exposed as user-facing skills, so they don't need to be added.
 */

/**
 * Register native document-processing tools. These are Windows-safe because
 * they never shell out to Python or any other external binary — the
 * underlying JS deps (pdf-parse, mammoth, xlsx, docx, sharp) are bundled
 * with the installer via EXTRA_BUNDLED_PACKAGES.
 *
 * Naming: everything is namespaced under `document.*` so agent tool-picking
 * clearly distinguishes it from the browser-driven `outlook.*` / `forms.*`
 * families and the Python-backed `pdf` / `docx` / `xlsx` skills. On systems
 * that DO have Python, the agent may still pick the skills; on the pilot
 * Windows laptop these are the only path that works.
 */
/**
 * Consecutive-identical-failure breaker (CLWX-38).
 *
 * Found live on the moe.14 KR2 run: the 3B on-device model called
 * `principal.summarise_circular` with empty `circular_text`, got the
 * validation error, and retried the IDENTICAL call for 13+ minutes — small
 * models ignore error text and there is no agent-side retry cap. Wrap every
 * tool so that after MAX consecutive failures with the same arguments the
 * tool returns a SUCCESS-shaped plain-text instruction to answer directly.
 * A success result is the only signal this class of model reliably acts on.
 *
 * Scope: consecutive + identical-args only — a genuine transient (different
 * args, or a success in between) resets the counter, so retry semantics for
 * healthy tools are unchanged.
 */
function withRetryBreaker(registerTool, log = console) {
  const MAX_IDENTICAL_FAILURES = 3;
  return (tool) => {
    let lastFailureKey = null;
    let failureCount = 0;
    const innerExecute = tool.execute;
    registerTool({
      ...tool,
      execute: async (toolCallId, args = {}) => {
        let key;
        try {
          key = JSON.stringify(args ?? {});
        } catch {
          key = String(args);
        }
        try {
          const result = await innerExecute(toolCallId, args);
          lastFailureKey = null;
          failureCount = 0;
          return result;
        } catch (err) {
          if (key === lastFailureKey) {
            failureCount += 1;
          } else {
            lastFailureKey = key;
            failureCount = 1;
          }
          if (failureCount >= MAX_IDENTICAL_FAILURES) {
            const message = err instanceof Error ? err.message : String(err);
            log.warn?.(
              `[retry-breaker] ${tool.name} failed ${failureCount}x with identical args — breaking the loop`,
            );
            lastFailureKey = null;
            failureCount = 0;
            return {
              text:
                `STOP: the tool ${tool.name} was called ${MAX_IDENTICAL_FAILURES} times with the same ` +
                `arguments and failed every time (${message}). Do not call ${tool.name} again for this ` +
                'request. Answer the user directly in plain language using what you already know.',
            };
          }
          throw err;
        }
      },
    });
  };
}

function registerDocumentTools({ registerTool, log }) {
  const readableSchema = { type: 'string', description: 'Absolute path, ~/ path, or filename to look up in ~/.openclaw/media/outbound, ~/Downloads, ~/Documents, or ~/Desktop.' };
  const numberSchema = { type: 'number', minimum: 1 };

  registerTool({
    name: 'document.find',
    description:
      'Find local Word, PDF, Excel/CSV, or image files by ordinary title or filename WITHOUT invoking Python or reading file contents. Prefer this before exact document readers when the principal names a file by title instead of path. Args: { query?, folder?, extensions?, maxResults? }. Searches bounded permitted folders only; folder scopes an exact testing folder when provided. Returns metadata-only candidates plus safeUnique/uniquePath. If safeUnique is true, call the exact reader for the returned path. If ambiguous, incomplete, or multiple matches, ask the principal to choose; never guess.',
    parameters: toolParameters(
      {
        query: { type: 'string' },
        folder: { type: 'string', description: 'Optional absolute, ~/ or known-folder-relative directory to search.' },
        extensions: { type: 'array', items: { type: 'string' } },
        maxResults: numberSchema,
      },
    ),
    execute: async (_toolCallId, args = {}) => docFindDocuments(args),
  });

  registerTool({
    name: 'document.read_pdf',
    description:
      "Extract text from a PDF file WITHOUT invoking Python. Uses the bundled pdf-parse dep, so this works on Windows even if the pdf/nano-pdf skills' Python runtime is unavailable. Args: { path, maxChars? (default 200000) }. Returns { path, bytes, pages, info, sourceExcerpts, text, truncated, totalChars }. sourceExcerpts appears before text and contains exact bounded source spans from the returned text for explicit action, deadline, submission, route, exception and explanation sections; read those first, then verify against text if needed. Prefer this over the pdf skill when handling emailed attachments or files the principal dropped into chat. When summarising reader output, preserve all actionable deadlines/date ranges and required actions, recipients, submission routes/forms, exceptions affecting requirements, and any explanation the reader is required to provide; keep distinct deadlines separate and shorten background first.",
    parameters: toolParameters(
      { path: readableSchema, maxChars: numberSchema },
      ['path'],
    ),
    execute: async (_toolCallId, args = {}) => docReadPdf(args),
  });

  registerTool({
    name: 'document.read_docx',
    description:
      'Extract text from a Word (.docx) document WITHOUT invoking Python. Uses the bundled mammoth dep. Args: { path, format? ("markdown"|"html"|"text", default "markdown") }. Returns the parsed content plus any conversion messages. Works on Windows where python-docx is not installed. Prefer this over the docx skill: that skill needs pandoc/python-docx, which are not installed on a principal laptop. Accepts a bare filename and searches Downloads, Documents, Desktop, and the OneDrive-redirected Desktop/Documents, including subfolders.',
    parameters: toolParameters(
      {
        path: readableSchema,
        format: { type: 'string', enum: ['markdown', 'html', 'text', 'plain'] },
      },
      ['path'],
    ),
    execute: async (_toolCallId, args = {}) => docReadDocx(args),
  });

  registerTool({
    name: 'document.write_docx',
    description:
      'Create a new Word (.docx) document WITHOUT invoking Python, using the bundled `docx` dep. Args: { path, title?, paragraphs: string[] }. Relative paths land in ~/.openclaw/media/outbound so ClawX auto-attaches. Returns { path, bytes, paragraphs }. Use this after drafting a letter or report so the principal can attach it to Outlook. Prefer this over the docx skill: that skill needs pandoc/python-docx, which are not installed on a principal laptop.',
    parameters: toolParameters(
      {
        path: readableSchema,
        title: { type: 'string' },
        paragraphs: { type: 'array', items: { type: 'string' } },
      },
      ['path', 'paragraphs'],
    ),
    execute: async (_toolCallId, args = {}) => docWriteDocx(args),
  });

  registerTool({
    name: 'document.read_xlsx',
    description:
      'Read an Excel (.xlsx / .xls / .csv) spreadsheet WITHOUT invoking Python. Uses the bundled xlsx (SheetJS) dep. Args: { path, sheet? (name or index — first sheet by default), maxRows? (default 500) }. Returns { path, sheets, sheet, rows (2D array), totalRows, truncated }. Works on Windows where openpyxl/pandas are not installed. Prefer this over the xlsx skill: that skill needs pandas/openpyxl, which are not installed on a principal laptop. Accepts a bare filename and searches Downloads, Documents, Desktop, and the OneDrive-redirected Desktop/Documents, including subfolders.',
    parameters: toolParameters(
      {
        path: readableSchema,
        sheet: { anyOf: [{ type: 'string' }, { type: 'number', minimum: 0 }] },
        maxRows: numberSchema,
      },
      ['path'],
    ),
    execute: async (_toolCallId, args = {}) => docReadXlsx(args),
  });

  registerTool({
    name: 'document.write_xlsx',
    description:
      'Create a new Excel (.xlsx) workbook WITHOUT invoking Python, using the bundled xlsx (SheetJS) dep. Args: { path, sheets: [{ name, rows: string[][] }] }. Relative paths land in ~/.openclaw/media/outbound. Returns { path, bytes, sheets }. Prefer this over the xlsx skill: that skill needs pandas/openpyxl, which are not installed on a principal laptop.',
    parameters: toolParameters(
      {
        path: readableSchema,
        sheets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              rows: {
                type: 'array',
                items: { type: 'array', items: {} },
              },
            },
            required: ['name', 'rows'],
            additionalProperties: false,
          },
        },
      },
      ['path', 'sheets'],
    ),
    execute: async (_toolCallId, args = {}) => docWriteXlsx(args),
  });

  registerTool({
    name: 'document.read_image',
    description:
      'Read an image (.png/.jpg/.gif/.webp/.bmp/.avif/.tiff) from disk and return metadata plus a native image content block for VLM analysis. Uses Electron\'s bundled sharp module — no Python or ImageMagick. Args: { path, maxDim? (default 768) }. Large images are downscaled server-side so the response stays within model limits. The tool result content contains metadata text and the image itself; details contains { path, bytes, width, height, format, mimeType, imageBytes, resized }. Prefer this over any OCR skill: you read the returned image directly, so pytesseract/Pillow/Tesseract are never needed and must never be requested from the principal. Accepts a bare filename and searches Downloads, Documents, Desktop, and the OneDrive-redirected Desktop/Documents, including subfolders.',
    parameters: toolParameters(
      { path: readableSchema, maxDim: numberSchema },
      ['path'],
    ),
    execute: async (_toolCallId, args = {}) => docReadImage(args),
  });

  log?.info?.(
    'moe-principal-assistant: document.* tools registered (find, read_pdf, read_docx, write_docx, read_xlsx, write_xlsx, read_image)',
  );
}

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
  const { pluginConfig, config, registerTool: rawRegisterTool, log = console, host = {} } = api;
  const registerTool = withRetryBreaker(rawRegisterTool, log);
  const cfg =
    (pluginConfig && typeof pluginConfig === 'object' ? pluginConfig : null) ??
    (typeof config === 'function' ? config() : config) ??
    {};

  // Document-processing tools have no dependency on principal config, so we
  // register them BEFORE the config gate. They matter on Windows especially:
  // the Anthropic pdf/xlsx/docx skills call Python (pypdf, pdfplumber,
  // openpyxl, python-docx) which is not shipped in the pilot runtime. These
  // native handlers use the deps already bundled via EXTRA_BUNDLED_PACKAGES
  // (pdf-parse, mammoth, xlsx, docx, sharp) and never shell out.
  registerDocumentTools({ registerTool, log });

  const required = ['principalName', 'schoolName', 'educationDistrict', 'schoolType'];
  const missing = required.filter((k) => !cfg[k]);
  if (missing.length) {
    log.warn?.(
      `moe-principal-assistant: missing config (${missing.join(', ')}) — principal.* tools will not be registered.`,
    );
    return { registered: false, docToolsRegistered: true };
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
      'Build the exact Microsoft Forms field payload for the Primary School Daily Report. Use this before forms.preview_daily_report. "Nothing to report" means no discipline, transport, meal illness, or whole-term absentee issues; do not invent attendance, teacher, meal, PTSC, or branch-specific counts. Required: date, teacher counts including MOH quarantine/other leave, year_groups enrolled/present counts, and the yes/no + status questions (did_you_have_school_today, principal_status, vice_principal_status, school_receives_nsdsl_meals, students_suspended_today, school_serviced_by_ptsc_maxi_taxi, last_day_of_week). If any of those are missing it returns { status: "refused", missingFields } — ask the principal for exactly those fields; NEVER guess. Returns { form, payload }.',
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

      // CLWX-79: the status/yes-no questions are statutory attestations
      // ("principal physically present", "written reports collected"-class
      // answers). They used to silently default; now a missing value is a
      // refusal listing the field ids. Demo defaults survive ONLY behind the
      // operator-set MOE_DEMO_DEFAULTS env var. We deliberately no longer read
      // args.demo (a model must never be able to trigger fabrication) and no
      // longer honour the generic DEMO=1 the fill-scripts use for "submit".
      const demo = process.env.MOE_DEMO_DEFAULTS === '1';
      const missingFields = [];
      const demoDefaultsApplied = [];
      const resolveChoice = (name, value, allowed, demoDefault) => {
        if (value === undefined || value === null || value === '') {
          if (demo) {
            demoDefaultsApplied.push(name);
            return demoDefault;
          }
          missingFields.push(name);
          return undefined;
        }
        return choice(name, value, allowed);
      };

      const payload = {
        date_being_reported_on: date,
        education_district: cfg.educationDistrict,
        school_type: cfg.schoolType,
        name_of_school: cfg.schoolName,
        did_you_have_school_today: resolveChoice('did_you_have_school_today', args.did_you_have_school_today, YES_NO, 'Yes'),
        principal_status: resolveChoice(
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
        vice_principal_status: resolveChoice(
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
        school_receives_nsdsl_meals: resolveChoice('school_receives_nsdsl_meals', args.school_receives_nsdsl_meals, YES_NO, 'No'),
        students_suspended_today: resolveChoice('students_suspended_today', args.students_suspended_today, YES_NO, 'No'),
        school_serviced_by_ptsc_maxi_taxi: resolveChoice(
          'school_serviced_by_ptsc_maxi_taxi',
          args.school_serviced_by_ptsc_maxi_taxi,
          YES_NO,
          'No',
        ),
        last_day_of_week: resolveChoice('last_day_of_week', args.last_day_of_week, YES_NO, 'No'),
      };

      if (missingFields.length > 0) {
        return {
          status: 'refused',
          reason: 'missing_required_fields',
          missingFields,
          message:
            `Cannot build the Daily Report payload: ${missingFields.length} required field(s) are missing: ` +
            `${missingFields.join(', ')}. Ask the principal for exactly these values — answers are never ` +
            'assumed on a statutory report.',
        };
      }

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

      const result = {
        form: 'primary_school_daily_report',
        term: 'Term 3 2025/26',
        payload,
      };
      if (demoDefaultsApplied.length > 0) {
        log.info?.(
          `principal.daily_report_form_payload: DEMO defaults applied to ${demoDefaultsApplied.length} field(s)`,
        );
        result.demoDefaultsApplied = demoDefaultsApplied;
      }
      return result;
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
      // Same raw-ENOENT class as the NSCC data file (trust lens, 2026-09-06):
      // a missing/corrupt roster must reach the principal as readable prose,
      // never a Node error code with an app-bundle path.
      let parsed;
      try {
        parsed = JSON.parse(await readFile(path.join(PKG_ROOT, 'data', 'schools.json'), 'utf8'));
      } catch {
        throw new Error('The school roster that ships with the app could not be loaded — it appears missing or damaged on this install. The principal should update or reinstall the app.');
      }
      const all = Array.isArray(parsed.schools) ? parsed.schools : [];
      const q = query.trim().toLowerCase();
      const matches = all
        .filter((s) => typeof s?.name === 'string' && s.name.toLowerCase().includes(q))
        .slice(0, 10);
      return { matches, total: matches.length, queriedAgainst: all.length };
    },
  });

  registerTool({
    name: 'principal.nscc_lookup',
    description:
      'Search the National School Code of Conduct (NSCC), Revised Edition (2026) — the Ministry\'s statutory discipline and conduct policy. Args: { query }. Returns the most relevant NSCC passages for the query. Use this for ANY question about the Code of Conduct: discipline, infractions and consequence levels, suspension and expulsion procedure, corporal punishment, attendance, core values and principles, child protection and abuse reporting, roles and responsibilities. Ground the answer in the returned passages and cite the NSCC as the source. The document ships with the app — no file from the principal is needed.',
    parameters: toolParameters(
      {
        query: stringSchema,
      },
      ['query'],
    ),
    execute: async (_toolCallId, args = {}) => {
      const { query } = args;
      requireString('query', query);
      // CLWX-42 design decision: retrieval tool, NOT a workspace bootstrap
      // doc — the full NSCC is ~55k tokens/turn against the KR6 floor; the
      // top passages are a few KB and carry the citation instruction.
      const text = loadNsccText(PKG_ROOT);
      return searchNscc(text, query);
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
  // CLWX-86: one-shot capability handshake at registration. Detects tool<->
  // host-API version skew (plugin newer than the installed app) and self-
  // parks affected tools with a readable update-the-app message instead of
  // letting a raw "No route for POST ..." reach the agent.
  const capabilityGate =
    hostApiPort && hostApiToken
      ? createHostApiCapabilityGate({ port: hostApiPort, token: hostApiToken, log })
      : null;
  if (capabilityGate) void capabilityGate.probe();
  const browser =
    hostApiPort && hostApiToken
      ? gateHostApiFacade(
          createHostApiBrowserFacade(hostApiPort, hostApiToken),
          'browser',
          {
            diagnose: 'POST /api/browser/diagnose',
            repairChromeCdp: 'POST /api/browser/repair-chrome-cdp',
            openChrome: 'POST /api/browser/repair-chrome-cdp',
          },
          capabilityGate,
        )
      : null;
  if (browser) {
    registerTool({
      name: 'browser.open_chrome',
      description:
        'Open Google Chrome for the principal. ALWAYS use this tool when the principal asks to open Chrome, open the browser, or get the browser working again — never the generic/stock browser start tool, which launches a separate managed browser that breaks Microsoft sign-in and can fail with instructions for the wrong operating system. This tool opens the principal\'s system Chrome through ClawX\'s supported Windows path and preserves their tabs, drafts, and sign-in. It never force-closes Chrome, never touches another Windows user\'s Chrome, and reports a typed truthful state: cdp_ready (Chrome is open and connected), chrome_not_found (install Chrome), profile_locked_close_chrome (ask the principal to close all Chrome windows and retry from ClawX), foreign_endpoint_owner (the automation connection belongs to a different Windows session/profile — relay the message exactly; do not retry into another user\'s Chrome), endpoint_owner_unverified (could not confirm ownership — close extra Chrome windows and retry), or a launch/timeout state with a next step. Relay the returned message in plain terms. Never give manual Chrome setup, flags-page, command-line, or macOS menu-bar instructions — recovery guidance must match the principal\'s Windows environment.',
      parameters: emptyParameters,
      execute: async (_toolCallId, _params = {}) => browser.openChrome(),
    });

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
      ? gateHostApiFacade(
          createHostApiOutlookFacade(hostApiPort, hostApiToken),
          'outlook',
          {
            readiness: 'POST /api/outlook/readiness',
            open: 'POST /api/outlook/open',
            readInbox: 'POST /api/outlook/read-inbox',
            draftEmail: 'POST /api/outlook/draft',
            sendEmail: 'POST /api/outlook/send',
            searchInbox: 'POST /api/outlook/search-inbox',
            readEmail: 'POST /api/outlook/read-email',
            reply: 'POST /api/outlook/reply',
            forward: 'POST /api/outlook/forward',
            markRead: 'POST /api/outlook/mark-read',
            listAttachments: 'POST /api/outlook/list-attachments',
            downloadAttachment: 'POST /api/outlook/download-attachment',
          },
          capabilityGate,
        )
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
      name: 'outlook.readiness',
      description:
        'Read-only Outlook/email capability diagnosis. Call this FIRST for any question about whether Microsoft Graph or cloud email is installed, available, configured, signed in, or which path (Microsoft Graph cloud vs the Outlook window in Chrome) email reading/drafting/sending uses. It opens no windows, navigates nothing, and changes nothing. Microsoft Graph support is built into the Ministry of Education app — it is a cloud service that never needs a local API installation. Never inspect configuration files or paths to answer availability questions, and never claim Microsoft Graph is missing because a configuration file or path does not exist. Returns { status: "ok", graph: { integrated, state: "signed_in" | "not_signed_in" | "not_configured" | "unknown", configured, signedIn, mockMailbox, read: { enabled, transport }, compose: { enabled, transport, mailSendScopeGranted } }, browser: { state: "unknown", note }, summary }. Answer the principal from the summary in plain terms, then state the accurate next step (for example: connect Microsoft 365 in Settings, complete sign-in, or continue using the Outlook window). This tool cannot see the Outlook window\'s own sign-in: browser.state stays "unknown" here — use browser.diagnose for Chrome automation readiness, and do not call outlook.open just to answer a status question.',
      parameters: emptyParameters,
      execute: async (_toolCallId, _params = {}) => outlook.readiness(),
    });

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
        'Open a specific message and return its full body, sender, recipients, and attachment list. Canonical action: read-email. Args: { id }. id is the InboxMessage.id from read_inbox or search_inbox (sender|subject|received fingerprint). Returns { status, id, notFoundReason?, subject, sender, receivedAt, body, recipients, attachments: [{ filename, sizeBytes?, mimeType? }], transport?, source?, implementation?, version? }. When status is not_found, notFoundReason distinguishes two different things and you must not conflate them: "not_in_list" means the message could not be reached (it may have moved to Archive/Sent/another folder, or the id is stale) — re-run read_inbox or search_inbox; "stale_read_guard" means the message WAS found and opened but the reading pane could not be confirmed to have settled on it, so nothing was read. On stale_read_guard tell the principal you could not confirm you had the right message open and are retrying — never tell them the message is missing or deleted, because it is still in their mailbox. Use this before summarising a specific message or drafting a reply/forward. If transport/source/implementation/version is present, report it as Outlook Browser v2/browser, Microsoft Graph, or legacy; do not infer it when absent.',
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
      ? gateHostApiFacade(
          createHostApiFormsFacade(hostApiPort, hostApiToken),
          'forms',
          {
            list: 'POST /api/forms/list',
            previewDailyReport: 'POST /api/forms/preview-daily-report',
            submitDailyReport: 'POST /api/forms/submit-daily-report',
            previewSuspension: 'POST /api/forms/preview-suspension',
            submitSuspension: 'POST /api/forms/submit-suspension',
          },
          capabilityGate,
        )
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
        'Open the Suspensions form in the principal\'s browser and fill every field from a typed payload. Accepts either the exact flat Forms field schema or the nested principal.suspension_payload result and normalizes it before filling. Does NOT submit. Returns { status: "previewed", url, filledCount, skippedCount, errors[] }. If required statutory fields are missing it returns { status: "refused", missingFields } instead — ask the principal for exactly those fields; NEVER guess or invent values. If a Chrome/CDP attach error occurs, call browser.diagnose then browser.repair_chrome_cdp before asking the principal to do anything manually. Use this AFTER the user has reviewed the extracted fields and asked you to fill the form. Always call this before forms.submit_suspension.',
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
        // CLWX-79: demo defaults survive ONLY behind the operator-set
        // MOE_DEMO_DEFAULTS env var. We never read args.demo (a model must not
        // be able to trigger statutory fabrication) and no longer honour the
        // fill-scripts' generic DEMO=1. Otherwise a missing field refuses with
        // the exact field ids instead of inventing values.
        const demo = process.env.MOE_DEMO_DEFAULTS === '1';
        const normalized = normalizeSuspensionPreviewPayload(args.payload, cfg, { demo });
        if (!normalized.ok) {
          if (normalized.invalidPayload) {
            return suspensionInvalidPayloadRefusal();
          }
          return suspensionMissingFieldsRefusal(normalized.missingFields);
        }
        const result = await forms.previewSuspension({ payload: normalized.payload });
        if (normalized.demoDefaultsApplied.length > 0) {
          log.info?.(
            `forms.preview_suspension: DEMO defaults applied to ${normalized.demoDefaultsApplied.length} field(s)`,
          );
          return { ...result, demoDefaultsApplied: normalized.demoDefaultsApplied };
        }
        return result;
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
        'Submit the Suspensions form. HARD GATE: refuses unless { confirm: true }. The agent MUST show the principal the filled form (forms.preview_suspension first) and obtain explicit confirmation ("yes, submit") before passing confirm=true. Returns { status: "submitted" | "refused" | "error" | "unavailable", message?, reason? }.',
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
        'Submit the Primary School Daily Report form. HARD GATE: refuses unless { confirm: true }. The agent MUST show the filled form (forms.preview_daily_report first) and obtain explicit confirmation ("yes, submit") before passing confirm=true. Returns { status: "submitted" | "refused" | "error" | "unavailable", message?, reason? }.',
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
      // CLWX-86: the browser family has no allowlist state, so ANY 404
      // ("No route for ...", "Unknown browser endpoint") means the installed
      // app does not serve this route — version skew. Refuse in principal
      // language, never raw HTTP.
      if (resp.status === 404) {
        throw new Error(hostApiSkewMessage('browser'));
      }
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
    // CLWX-130: explicit "open Chrome" intent reuses the SAME Main
    // repair/ensure service and route — same behavior, no parallel service.
    openChrome: () => call('/repair-chrome-cdp'),
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
      // CLWX-86: disambiguate the 404 shapes (see the outlook facade). Only
      // the explicit allowlist body keeps the kill-switch wording; anything
      // else ("No route for ...", "Unknown forms endpoint", unreadable) is
      // version skew.
      const body404 = await resp.text().catch(() => '');
      if (/capability disabled/i.test(body404)) {
        throw new Error(
          `forms capability disabled: ${path} returned 404 — check that 'forms' is in PRINCIPAL_SKILL_ALLOWLIST.`,
        );
      }
      throw new Error(hostApiSkewMessage('forms'));
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
    const text = await resp.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* fall through */ }
    if (resp.status === 404) {
      // CLWX-86: disambiguate the 404 shapes. Only the explicit allowlist
      // body ("capability disabled") keeps the kill-switch wording; every
      // other 404 (global "No route for ...", unknown-endpoint, unreadable
      // body) means the installed app does not serve this route — version
      // skew. The route never executed, so no side effects are possible.
      const bodyMsg = String((data && (data.error || data.message)) || text || '');
      if (/capability disabled/i.test(bodyMsg)) {
        throw new Error(
          `outlook capability disabled: ${path} returned 404 — check that 'outlook' is in PRINCIPAL_SKILL_ALLOWLIST.`,
        );
      }
      return { status: 'unavailable', message: hostApiSkewMessage('outlook') };
    }
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
    readiness: () => call('/readiness'),
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
