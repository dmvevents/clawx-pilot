# MoE Form Prefill Strategy

## Goal

Reduce form filling to "known context plus exceptions" while preserving the safety rule: the assistant may preview a filled Microsoft Form, but it must not submit without explicit same-session confirmation.

The current app already has the right insertion point:

- `principal.daily_report_form_payload` builds the exact Daily Report payload before `forms.preview_daily_report`.
- `principal.suspension_payload` builds the structured suspension payload before `forms.preview_suspension`.
- `principal.find_school` searches the local school roster.
- The browser drivers fill the visible Microsoft Forms fields and skip branch-only fields that are hidden.

The prefill layer should run before those payload tools. It should produce a payload draft, a list of inferred fields with sources, and a short list of remaining questions.

## Inference Policy

Auto-fill without asking when the value is deterministic:

- School identity from configured `moe-principal-assistant` config: principal name, school name, education district, school type.
- Canonical school form option when the source name exactly or confidently maps to a Microsoft Forms option.
- Date when the user says "today", "yesterday", or names a concrete date.
- Derived student age when date of birth and report date are known.
- Branch-hidden fields: do not ask for a value if the controlling answer makes the field invisible.
- Saved non-PII school profile defaults, after the principal has confirmed them once.

Ask once, then remember only non-PII profile values:

- Teacher or staff member to school mapping.
- School aliases, nearby streets, city/town/village, and common shorthand names.
- Regular staff count.
- Enrollment by year group.
- Whether the school receives NSDSL meals.
- Whether the school is serviced by PTSC and the approved route count.
- Whether there is normally a VP/Senior Teacher.

Do not infer or persist sensitive pupil/parent values:

- Pupil full name, birth certificate PIN, date of birth, address, parent name, parent phone.
- Discipline/legal judgement that is not stated in the source. The assistant can suggest a likely dropdown value, but should show it for confirmation.
- Attendance counts, meal delivery counts, illness counts, and whole-term absentee counts unless supplied by a source document or a confirmed school profile.

## Lookup Order

1. Active plugin config in `~/.openclaw/openclaw.json`: principal, school, district, school type.
2. User prompt and attached file text: explicit facts beat defaults.
3. Local school roster: `extensions/moe-principal-assistant/data/schools.json`.
4. Microsoft Forms schema options:
   - `extensions/moe-principal-assistant/forms/daily-report-schema.vlm.json`
   - `extensions/moe-principal-assistant/forms/suspensions-schema.json`
5. Saved school profile store, future path: `extensions/moe-principal-assistant/data/school-profiles.local.json` or user config.
6. Teacher directory / alias index, future path: local non-PII profile data.
7. Previous confirmed non-PII form profile values.
8. Calendar context for weekdays, last school day, and term labels.

## Profile Shape

Use a profile shape like this for future implementation. Keep it local to the principal's machine.

```json
{
  "schools": [
    {
      "id": "aranguez-gps",
      "canonicalName": "Aranguez GPS",
      "aliases": ["Aranguez Government Primary School", "Aranguez Primary"],
      "educationDistrict": "North Eastern",
      "schoolType": "Government",
      "cityTownVillage": "Aranguez",
      "streets": ["Boundary Road", "Railway Road"],
      "principalName": "Principal Name",
      "hasVicePrincipalOrSeniorTeacher": true,
      "teacherCountOnStaff": 12,
      "enrollmentByGroup": {
        "first_year": 20,
        "second_year": 18,
        "standard_1": 22,
        "standard_2": 21,
        "standard_3": 20,
        "standard_4": 19,
        "standard_5": 17
      },
      "nsdsl": {
        "receivesMeals": true
      },
      "ptsc": {
        "serviced": false,
        "approvedRoutes": 0
      }
    }
  ],
  "teachers": [
    {
      "name": "Teacher Name",
      "schoolId": "aranguez-gps",
      "role": "Standard 4 teacher"
    }
  ]
}
```

## Daily Report Questions

First identify the school and date:

1. "Is this the Daily Report for `<school>` on `<date>`?"
2. If school is ambiguous: "I found these matches: A, B, C. Which school?"
3. If a teacher/city/street is provided: "I matched `<teacher/street/city>` to `<school>`. Use that school?"

For a normal school day, ask only the values that cannot be safely inferred:

1. "Did school operate today?"
2. "Were the Principal and VP/Senior Teacher physically present, or should I mark a different status?"
3. "How many teachers were present, absent, on MOH quarantine, and on other leave?"
4. "For each year group, how many pupils were present? I can use the saved enrollment numbers if still current."
5. If the profile says NSDSL meals are received: "Were breakfast and lunch received? How many were delivered and left over? Portion size enough? Any illness?"
6. "Were any students suspended today? If yes, how many, and was each suspension recorded on the suspension form?"
7. If the profile says PTSC-serviced: "How many approved routes and morning trips today?"
8. If this is the last school day of the week: "Any pupils absent for the entire term to date? If yes, give counts by year group."

Shortcut prompt for a routine day:

> "Submit my attendance report. Nothing unusual today. Teachers: 11 present, 1 sick, 0 quarantine, 0 other leave. Student present counts are 19, 18, 20, 21, 20, 19, 16."

The assistant should use the profile for school identity and enrollment, apply "nothing unusual" only to incident/transport/illness branches, build `principal.daily_report_form_payload`, preview the form, and wait for confirmation before submit.

## Suspension Questions

Resolve school context first from config, teacher, city, street, or explicit school name. Then ask only missing form-critical facts:

1. Student: name or initial, sex, class, date of birth or age, birth certificate PIN.
2. Incident: date, where/when it occurred, primary infraction, additional infractions, victim involvement.
3. Suspension: issue date, length in days, number of suspensions this term.
4. Process: written reports collected, extended suspension application, SSSD referral, parent present, parent signed notice, discipline matrix followed, level of offence.
5. Parent/guardian: name, phone, house number, street, city/town/village.

Derived values:

- Class aliases: Infant 1 -> First Year, Infant 2 -> Second Year.
- Infraction aliases already map common wording like "fighting", "defiance", and "disruptive behaviour" to canonical dropdown values.
- Level can be suggested from stated discipline matrix level or suspension length, but should be shown for review.
- Age can be derived from DOB.

## Product Implementation Path

1. Add a local school profile store with non-PII fields only.
2. Add lookup helpers: school alias match, teacher match, city/street match, canonical Microsoft Forms school option match.
3. Add a prefill planner that returns `{ payloadDraft, inferred, missingQuestions, warnings }`.
4. Teach the model skill to call the planner before `principal.daily_report_form_payload` or `principal.suspension_payload`.
5. Show inferred values in chat before previewing the form.
6. Keep the existing hard gates: preview first, submit only after explicit confirmation.

## Acceptance Criteria

- With only configured school + routine-day counts, Daily Report preview fills without required-field errors.
- With teacher/city/street hints, the assistant resolves the school or asks a short disambiguation question.
- The assistant never stores pupil/parent PII in profile memory.
- The assistant lists assumptions before preview.
- `forms.submit_*` continues to refuse without `confirm:true`.
