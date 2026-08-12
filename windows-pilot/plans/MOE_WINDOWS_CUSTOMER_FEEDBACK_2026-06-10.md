# MoE Windows Pre-Release Customer Feedback - 2026-06-10

## Purpose

Collect structured feedback from principals, teachers, and pilot testers after
they install the Windows pre-release. Avoid collecting passwords, API keys,
private Microsoft Forms links, full email bodies, student PII, or screenshots
that expose private content.

## Current Pre-Release Candidate

- Release page:
  `https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260610-bbc4eb1`
- Recommended installer asset:
  `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`
- Manual workflow source run:
  `https://github.com/dmvevents/clawx-pilot/actions/runs/27299469846`
- Commit:
  `832aaf3d70baa9bc377bfaaffeb984cd9986334b`
- Expected installer SHA-256:
  `fe8d7af9fe2db1054ec7ee2bfdd22d05f932ba486644b7d15b6153bb5f8f9219`

## Feedback Channels

Use any low-friction channel the customer already uses:

- WhatsApp/email summary to the demo coordinator.
- GitHub issue comment on the pilot tracker.
- Screen-share bug bash with notes captured by the operator.

Do not ask testers to create GitHub accounts unless they already have one.

## Tester Information

Ask for:

- Tester name or initials.
- School or organization, if they are comfortable sharing.
- Windows version if known.
- Laptop type if known.
- Installer filename used.
- Whether Wi-Fi was on during first launch.
- Whether Microsoft sign-in completed.

Do not ask for Microsoft passwords or MFA details.

## Required Smoke Prompts

Ask the tester to run these prompts and record pass/fail plus short notes:

```text
Can you check the files in my downloads folder?
```

```text
Can you check my email?
```

```text
Draft an email to anton@neumanai.com saying this is a release candidate smoke test, but do not send it until I confirm.
```

```text
What forms can you submit?
```

```text
Prepare my attendance report. Nothing unusual today. Do not submit it.
```

```text
Use the suspension document in my downloads folder to prepare the suspension form. Do not submit it.
```

If a sample Excel, Word, or PDF file exists in Downloads, ask:

```text
Summarize the Excel, Word, or PDF file in my downloads folder.
```

If voice input is available, ask the tester to try one short command:

```text
Check my downloads folder
```

## Feedback Questions

Use these questions after the smoke prompts:

1. Did the installer complete without help?
2. Did the desktop shortcut appear and launch the app?
3. How long did first launch take before the app was usable?
4. Did the app ask for provider API keys? Expected answer: no.
5. Did the app ever ask you to install Chrome MCP, enable Chrome debugging, or
   open `chrome://flags`? Expected answer: no.
6. Did Microsoft sign-in feel normal and trustworthy?
7. Did email checking work?
8. Did draft email stay unsent until you confirmed?
9. Did Forms setup make sense?
10. Did the Forms dry run ask for missing required fields instead of inventing
    data?
11. Could the app read files from Downloads?
12. Was voice input useful enough for a demo, or should testers type commands?
13. What was confusing or slow?
14. What would stop you from using this in a real school office?
15. What is the one thing that would make this feel ready for more principals?

## Bug Report Template

```text
Tester:
Date/time:
Installer filename:
Installer SHA checked? yes/no
Windows version:
Wi-Fi on? yes/no
Microsoft sign-in completed? yes/no/not needed
Prompt typed:
Expected result:
Actual result:
Screenshot available? yes/no
Logs collected? yes/no
Private data removed from screenshot/logs? yes/no
Severity: blocker / high / medium / low
Notes:
```

## Success Criteria For Pre-Release

Pre-release is healthy enough for broader pilot feedback when:

- At least two fresh installs complete without developer intervention.
- At least one tester completes Downloads, email, and a no-submit Forms dry run.
- No tester is asked for provider API keys or Chrome debugging setup.
- No email is sent without same-session confirmation.
- No form is submitted without same-session confirmation.
- Any `thinking`/Gateway startup delay is under an accepted support threshold
  or has clear user-facing recovery steps.

## Escalation Criteria

Treat as release blockers:

- Installer does not open or shortcut does not launch.
- App asks for model provider API keys.
- Assistant tells tester to install Chrome MCP or enable Chrome debugging.
- Assistant sends email without confirmation.
- Assistant submits a form without confirmation.
- App cannot list Downloads on a normal Windows profile.
- Gateway/model remains stuck beyond two minutes after restart.
