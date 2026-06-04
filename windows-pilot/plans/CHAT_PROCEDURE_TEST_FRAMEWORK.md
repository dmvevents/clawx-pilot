# Chat Procedure Test Framework

Purpose: run safe, repeatable app-path procedures through the installed ClawX Electron app for Outlook, Microsoft Forms, and files in the Windows Downloads folder.

## Command

From `C:\Users\VYONIX\Github\ClawX-release-moe10`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-run-chat-procedures.ps1" `
  -Repo "C:\Users\VYONIX\Github\ClawX-release-moe10" `
  -EvidenceRoot "C:\Users\VYONIX\Downloads" `
  -DownloadsPath "C:\Users\VYONIX\Downloads" `
  -RunPreflight `
  -Relaunch
```

To include it inside the broader acceptance suite:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-run-demo-acceptance.ps1" `
  -Repo "C:\Users\VYONIX\Github\ClawX-release-moe10" `
  -EvidenceRoot "C:\Users\VYONIX\Downloads" `
  -RunChatProcedures
```

## Scenario Source

Default scenarios live in:

```text
windows-pilot\scenarios\demo-chat-procedures.json
```

The current set covers:

- `safechat-outlook-open`: chat invokes `outlook.open`.
- `safechat-forms-list`: chat invokes `forms.list`.
- `downloads-document-inventory`: chat lists document-like files in Downloads.
- `downloads-excel-summary`: chat selects and summarizes a spreadsheet from Downloads.
- `downloads-word-suspension-fields`: optional chat inspection for suspension/report source documents.
- `outlook-and-forms-hostapi-smoke`: Host API read/preview/refusal checks for Outlook and Forms.

Scenario prompts use `{{DOWNLOADS_PATH}}`; the runner expands it from `-DownloadsPath`, which defaults to the current Windows user's Downloads folder.

## Safety Contract

The framework must remain safe by default:

- No email is sent.
- No attachment is downloaded.
- No Microsoft Form is submitted.
- Forms preview is allowed; submit is checked only through refusal without confirmation.
- Outlook send/download gates are checked only through refusal without confirmation.
- Logs must not print secrets, tokens, Forms URLs, email bodies, or full recipient lists.

## Passing Evidence

Each run creates:

```text
C:\Users\VYONIX\Downloads\clawx-chat-procedures-<timestamp>\
```

The pass condition is:

- `final-report.md` status is `READY_SAFE_CHAT_PROCEDURES`.
- All required scenarios pass.
- Optional scenarios may warn without blocking if no suitable source document exists.
- `scenario-results.json` contains per-scenario artifact paths.
- The Downloads inventory is captured as `downloads-inventory.json`.
- Safe chat scenarios prove `chat.send`, current-prompt scoping, final verification-token echo, no banned side effects, expected tool evidence, and required answer patterns.
- Forms smoke proves `status=previewed`, meaningful filled-field counts, zero preview errors, and refusal status for submit without confirmation.

## When It Fails

Use the per-scenario artifact directory first. Each scenario has:

- `probe-output.txt`
- one or more `clawx-electron-probe-*.json` summaries
- screenshots from the packaged Electron app

Fix repo-side failures with targeted tests, then rerun the failing scenario or the whole framework. Do not bypass send/submit/download gates to make the run pass.
