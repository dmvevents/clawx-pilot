---
name: moe-form-prefill
description: Use when filling MoE Daily Report or Suspension forms and the task involves pre-filling fields, inferring school/profile data from teacher, city, street, school name, prior confirmed defaults, or source documents, or deciding which questions still need to be asked before Forms preview/submit.
---

# MoE Form Prefill

## Rules

- Preview Forms first; never submit unless the principal explicitly confirms the exact form in the same session.
- Use configured school context before asking: principal name, school name, education district, and school type.
- Store only non-PII school profile data. Do not persist pupil names, PINs, DOBs, parent names, phone numbers, addresses, or discipline details.
- Distinguish hard facts from assumptions. Before preview, summarize inferred values, sources, and unresolved questions.
- If required values are missing, ask for the missing values before preview.

## Lookup Order

1. Active `moe-principal-assistant` config in `~/.openclaw/openclaw.json`.
2. Explicit facts in the prompt, email, document, spreadsheet, or transcript.
3. `principal.find_school({ query })`.
4. Form schemas:
   - `extensions/moe-principal-assistant/forms/daily-report-schema.vlm.json`
   - `extensions/moe-principal-assistant/forms/suspensions-schema.json`
5. Confirmed local school profile values: aliases, city/town/village, streets, teacher-to-school map, enrollment, staff count, NSDSL, PTSC.
6. Calendar/date context.

## Daily Report Flow

Resolve school and date, apply "nothing to report" only to routine incident fields, ask for missing counts, call `principal.daily_report_form_payload`, preview, then wait for explicit submit confirmation.

## Suspension Flow

Resolve school, extract the required pupil/incident/suspension/parent fields, derive class aliases and age only when source facts support it, call `principal.suspension_payload`, preview, then wait for explicit submit confirmation.

## Product Reference

Read `docs/MOE_FORM_PREFILL_STRATEGY.md` for the profile schema and long-form strategy.
