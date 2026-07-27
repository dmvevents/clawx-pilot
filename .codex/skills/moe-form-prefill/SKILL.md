---
name: moe-form-prefill
description: Use when filling MoE Daily Report or Suspension forms and the task involves pre-filling fields, inferring school/profile data from teacher, city, street, school name, prior confirmed defaults, or source documents, or deciding which questions still need to be asked before Forms preview/submit.
---

# MoE Form Prefill

## Rules

- Preview Forms first; never submit unless the principal explicitly confirms the exact form in the same session.
- Use configured school context before asking: principal name, school name, education district, and school type.
- Store only non-PII school profile data. Do not persist pupil names, PINs, DOBs, parent names, phone numbers, addresses, or discipline details.
- Distinguish hard facts from assumptions. Before preview, summarize: inferred values, source, and unresolved questions.
- Speak to principals and teachers in plain English. Avoid internal tool names unless diagnosing or writing developer evidence.
- If required form values are missing, ask for the missing values before preview. Do not call a preview tool just to discover obvious missing counts.

## Lookup Order

1. Active `moe-principal-assistant` config in `~/.openclaw/openclaw.json`.
2. Explicit facts in the prompt, email, document, spreadsheet, or transcript.
3. `principal.find_school({ query })`.
4. Form schema options:
   - `extensions/moe-principal-assistant/forms/daily-report-schema.vlm.json`
   - `extensions/moe-principal-assistant/forms/suspensions-schema.json`
5. Confirmed local school profile values: aliases, city/town/village, streets, teacher-to-school map, enrollment, staff count, NSDSL, PTSC.
6. Calendar/date context.

## Daily Report Flow

1. Resolve school and date.
2. If the prompt says "nothing to report" or "routine day", apply it only to no suspensions, no transport issues, no meal illness, and no whole-term absentee issue. Do not invent attendance, teacher, meal, or route counts.
3. Ask only for missing required values:
   - school operated today?
   - principal and VP/Senior Teacher status
   - teacher counts: staff, present, absent, MOH quarantine, other leave
   - student present counts by year group; use saved enrollment only if confirmed current
   - NSDSL branch values if the school receives meals
   - suspension count/recorded flag if suspensions occurred
   - PTSC route/trip counts if serviced
   - whole-term absentee counts only on the last school day of the week and only if any exist
4. Call `principal.daily_report_form_payload`.
5. Show the payload assumptions briefly.
6. Call `forms.preview_daily_report`.
7. Wait for explicit submit confirmation before `forms.submit_daily_report({ confirm: true })`.

Teacher-facing shortcut:

- If the prompt is only "Submit my attendance report. Nothing unusual today.", respond that you can prepare it but still need teacher/staff counts and pupil present counts by class or year group before preview.
- If the user provides the counts in the same prompt, use profile defaults only for confirmed non-PII school context, list assumptions briefly, then preview.

## Suspension Flow

1. Resolve school from config, explicit school name, teacher, city, street, or local profile.
2. Extract or ask for:
   - student name/initial, sex, class, DOB or age, birth certificate PIN
   - incident date, location/when, primary infraction, additional infractions, victim involvement
   - suspension issue date, length, term suspension count
   - written reports, extended suspension application, SSSD referral, parent present, parent signed notice, discipline matrix followed, level of offence
   - parent/guardian name, phone, house number, street, city/town/village
3. Derive class aliases and age from DOB when available. Suggest dropdown aliases for infractions, but show them for review.
4. Call `principal.suspension_payload`, then `forms.preview_suspension`.
5. Wait for explicit submit confirmation before `forms.submit_suspension({ confirm: true })`.

## Disambiguation Questions

Ask these only when needed:

- "Which form should I prepare: Daily Report or Student Suspension?"
- "I matched `<hint>` to `<school>`. Use that school?"
- "I found multiple schools: `<A>`, `<B>`, `<C>`. Which one?"
- "Can I use the saved enrollment/staff/NSDSL/PTSC profile for this school?"
- "What changed from the normal profile today?"

## Product Reference

For the full implementation plan and profile schema, read `docs/MOE_FORM_PREFILL_STRATEGY.md`.
