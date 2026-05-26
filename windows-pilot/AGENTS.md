# Windows Pilot Guidance

This directory contains demo-run scripts, plans, agent prompts, and skills for the Windows pilot laptop.

Rules:

- Prefer SSH alias `pilot` for Windows commands and PowerShell 5.1 compatible syntax.
- Keep scripts idempotent and safe by default.
- Do not print passwords, Host API tokens, Forms response URLs, email bodies, or full recipient lists.
- Do not send email, download attachments, or submit forms unless the user explicitly confirms that exact action in the same session.
- Use `pilot-electron-cdp-probe.js` and `pilot-run-electron-cdp-probe.ps1` for app-path evidence before trying model-driven tool calls.
- Treat standalone `openclaw agent` over SSH as diagnostic only; the real app path needs Electron's private Host API token.
- Put reusable strategy notes in `windows-pilot/plans/`; put disposable output in Windows Downloads or explicit artifact paths.

Verification:

- For app readiness, require `pilot-probe-state.ps1` and `pilot-verify-outlook-tab.ps1`.
- For UI bridge readiness, require Electron CDP probe output showing `hasElectronInvoke: true`, `outlookOpen` status `opened`, and zero renderer errors.
- For model tool readiness, require transcript evidence that the tool result is not `tool.execute is not a function`.
