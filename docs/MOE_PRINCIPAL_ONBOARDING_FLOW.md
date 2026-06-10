# MoE Principal Onboarding Flow

Last updated: 2026-06-10

## Objective

Principals should be able to install the Ministry assistant, sign in to
Microsoft 365, configure their Ministry form links, and complete Outlook/Form
tasks with minimal setup. The app must not collect or store Microsoft passwords.

## Credential Boundary

- Principals enter email and password only on Microsoft's sign-in page.
- The app uses Microsoft Graph OAuth when tenant/client settings are packaged
  or admin-configured.
- The app may store OAuth token material in the existing local Microsoft Graph
  store, but it must never render, log, or export passwords, access tokens, or
  refresh tokens.
- If the Graph tenant/client configuration is missing, the app shows the
  administrator configuration fields in Settings > Microsoft 365 sign-in.

## Principal First-Run Flow

1. Open the installed Ministry assistant.
2. Go to Settings > Microsoft 365 sign-in.
3. Select Sign in and complete the Microsoft-owned login page.
4. Go to Settings > Principal setup.
5. Paste the Ministry Daily Report response link.
6. Paste the Student Suspensions response link.
7. Ask the assistant to check email, draft/send mail, or prepare a form.

The Principal setup panel stores only Microsoft Forms response links in the
local MoE form-filler store. It accepts only HTTPS links from
`forms.office.com` or `forms.cloud.microsoft` response paths.

## Administrator Setup

For an out-of-box installer, IT should package or provision:

- Microsoft Graph tenant ID or verified domain.
- Microsoft Graph public-client application ID.
- Delegated Graph scopes required by the app: `Mail.Read`, `Mail.ReadWrite`,
  `Mail.Send`, `Calendars.Read`, `offline_access`, and `User.Read`.
- Ministry form response links for Daily Report and Student Suspensions, if
  those are stable across the pilot cohort.
- Optional school profile seed data for known principals and schools.

If form links vary by school, the app asks the principal to paste them once and
stores them locally. If links are district-wide, package them or seed them
through the existing `moeforms:set-urls` path during deployment.

## Pre-Qualifying Questions

The assistant should ask only for missing fields. Known school data should be
inferred from a confirmed school profile, prior local profile entries, or
administrator-provided lookup tables.

Ask once per principal profile:

- Principal name and title.
- School name.
- Education district.
- School address or city/town/village.
- School type, if needed by the form: Government, Denominational, Assisted,
  or Private.
- Official school email address.
- Daily Report response link, if not already saved.
- Student Suspensions response link, if not already saved.

Ask only when needed for a specific Daily Report:

- Report date.
- Whether there is anything to report.
- Attendance/enrolment values required by the current form.
- Staff absence or operational incident details.
- Whether PTSC, school feeding, security, maintenance, or other services were
  affected.

Ask only when needed for a Suspension form:

- Student identifier and class/form.
- Incident date.
- Suspension start and end date.
- Number of days.
- Reason/category.
- Whether parent/guardian notification occurred.
- Whether supporting documents should be attached.

Do not persist student PII as a reusable profile default. Treat suspension
details as one-run form data.

## Agent Behavior

- Prefer saved school/form defaults before asking questions.
- Show a preview before sending email or submitting a form.
- Do not submit Forms without explicit same-session confirmation.
- Do not send email without explicit same-session confirmation.
- If a required form field is missing, ask for that field instead of declaring
  the task failed.
- If the browser opens a fresh non-signed-in window, prefer the Graph path for
  Outlook and use the saved Microsoft account state rather than asking users to
  configure Chrome debugging.

## Current Implementation Hooks

- Settings > Microsoft 365 sign-in uses the existing Microsoft Graph renderer
  wrapper and OAuth store.
- Settings > Principal setup uses `moeforms:get-urls` and `moeforms:set-urls`.
- The MoE form filler reads saved form URLs from
  `electron/services/moe-form-filler/store.ts`.
- URL validation is covered by
  `tests/unit/moe-principal-setup-section.test.ts`.

## GA Follow-Ups

- Add an administrator seed file for school profile lookup data.
- Add a principal profile store for non-PII defaults such as school name,
  district, and city.
- Add a Settings import/export path for non-secret deployment configuration.
- Add an E2E Settings test that saves form links through the renderer and
  verifies the form-filler sees the saved values.
