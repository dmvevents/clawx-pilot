# Claude Windows Demo Acceptance Prompt - 2026-05-29

Use this prompt inside Claude Code on the Windows laptop.

```text
You are Claude Code running on the Windows pilot laptop.

Working directory:
C:\Users\VYONIX\Github\ClawX

Goal:
Recursively test and improve the ClawX / Ministry of Education demo until the safe acceptance path is ready, or until a real external blocker is proven with logs. The app is installed as Ministry of Education v0.4.3-moe.10. The model path should stay on Gemini/cloud unless the user explicitly changes it.

Current known facts:
- Git repo is cloned at C:\Users\VYONIX\Github\ClawX.
- Node, pnpm, Git, gh, AWS CLI, and Claude Code are installed.
- Claude Code is configured for Bedrock mode, but AWS credentials/model access may still be unverified.
- WiFi was previously off, causing Gemini DNS failures. WiFi is now on.
- Chrome CDP should be on http://127.0.0.1:18792.
- Electron CDP should be on http://127.0.0.1:9223 after relaunch.
- The safe probe after WiFi returned proved forms.list safe chat, Outlook smoke, Forms preview, and send/submit refusal gates.

Hard safety rules:
1. Do not print or store secrets: provider keys, AWS keys, Host API bearer tokens, passwords, cookies, full email bodies, full recipient lists, or Microsoft Forms response URLs.
2. Do not send email, download attachments, or submit Forms unless the user explicitly confirms that exact external action in the same Claude session.
3. Do not use managed Playwright Chromium for Outlook or Forms. Use the signed-in Chrome/CDP path on port 18792.
4. Do not delete or reset user state. If a fix requires touching %APPDATA%\Ministry of Education or %USERPROFILE%\.openclaw, first create a timestamped backup and explain why.
5. Do not commit, push, rebase, reset, or run destructive git commands.

First command:
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-run-demo-acceptance.ps1

If broader local regression evidence is needed:
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-run-demo-acceptance.ps1 -RunRegressionTests

Acceptance criteria:
- WiFi/cloud provider reachability succeeds for generativelanguage.googleapis.com:443.
- App is installed and gateway/API are up.
- Chrome CDP 18792 is up.
- Electron CDP 9223 is up.
- Electron renderer exposes window.electron.ipcRenderer.invoke.
- outlook.open succeeds through the app Host API.
- forms.list succeeds through the app Host API.
- Safe chat completes through Gemini and calls the expected tool exactly once.
- Safe chat has no banned side effects.
- Outlook smoke reads inbox or returns a clear non-crash result.
- Outlook send/download refuse without confirm:true.
- Forms daily-report and suspensions preview/fill run with errorCount 0 or precise field-level errors.
- Forms submit refuses without confirm:true.
- Typecheck passes.
- Evidence artifacts are written under Downloads\clawx-demo-evidence-*.

Recursive improvement loop:
1. Read the newest final-report.md and step-results.json in the evidence directory.
2. Classify failures as one of:
   - network/Gemini DNS
   - Bedrock/Claude credential/model access
   - provider/runtime drift
   - gateway stuck thinking
   - Electron Host API failure
   - Chrome CDP/sign-in failure
   - Outlook tool failure
   - Forms fill/gate failure
   - Office parser failure
   - test/build failure
3. If the cause is external login/network/credentials, stop and report the blocker with the exact evidence file.
4. If the cause is repo code, add or update the smallest regression test first, make the smallest fix, then rerun the targeted probe and typecheck.
5. Keep model provider configured to Gemini/cloud unless the user explicitly asks to switch.

Stop conditions:
- READY_SAFE final-report exists with no failed steps.
- A hard external blocker is proven.
- The next step would send email, download an attachment, submit a form, delete state, or expose secrets without explicit same-session confirmation.
- The same blocker repeats after three focused fix attempts.

Final answer:
Report the latest evidence directory, final-report path, pass/fail state, changed files if any, and the exact next blocker or demo-ready statement.
```
