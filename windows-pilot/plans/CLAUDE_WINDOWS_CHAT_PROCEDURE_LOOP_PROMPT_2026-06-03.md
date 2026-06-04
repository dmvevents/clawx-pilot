# Claude Windows Chat Procedure Loop Prompt - 2026-06-03

Use this prompt inside Claude Code on the Windows pilot laptop.

```text
You are Claude Code running on the Windows pilot laptop.

Working directory:
C:\Users\VYONIX\Github\ClawX-release-moe10

Goal:
For up to eight hours, keep the ClawX / Ministry of Education Windows demo ready by repeatedly running the safe chat-procedure harness, reading the evidence, and fixing only repo-code failures. The demo must prove Outlook, Microsoft Forms, and Downloads document interactions through the installed Electron app path, not by bypassing the app.

Current known facts:
- The active release repo is C:\Users\VYONIX\Github\ClawX-release-moe10.
- The active branch is pilot/release/moe10-windows-laptop-ready-20260529.
- Chrome CDP should be on http://127.0.0.1:18792 using the signed-in Chrome profile.
- Electron CDP should be on http://127.0.0.1:9223.
- Outlook is expected to already be signed in in Chrome.
- The harness writes evidence under C:\Users\VYONIX\Downloads\clawx-chat-procedures-*.
- WiFi being off previously caused model/gateway failures. Check network before changing code.

Hard safety rules:
1. Do not print or store secrets: provider keys, AWS keys, Host API bearer tokens, passwords, cookies, full email bodies, full recipient lists, or Microsoft Forms response URLs.
2. Do not send email, reply, forward, download attachments, or submit Forms unless the user explicitly confirms that exact external action in the same Claude session.
3. Do not use managed Playwright Chromium for Outlook or Forms. Use the signed-in Chrome/CDP path on port 18792.
4. Do not delete or reset user state. If a fix requires touching %APPDATA%\Ministry of Education or %USERPROFILE%\.openclaw, first create a timestamped backup and explain why in the evidence report.
5. Do not run destructive git commands. Never reset hard, clean untracked files, or overwrite unrelated work.

First command:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-run-chat-procedures.ps1 -Repo C:\Users\VYONIX\Github\ClawX-release-moe10 -EvidenceRoot C:\Users\VYONIX\Downloads -DownloadsPath C:\Users\VYONIX\Downloads -RunPreflight -Relaunch

Broader acceptance command after the chat procedure harness is green:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-run-demo-acceptance.ps1 -Repo C:\Users\VYONIX\Github\ClawX-release-moe10 -EvidenceRoot C:\Users\VYONIX\Downloads -RunChatProcedures

Acceptance criteria:
- Chrome CDP 18792 is up and Outlook is signed in.
- Electron CDP 9223 is up.
- Electron renderer exposes window.electron.ipcRenderer.invoke.
- Safe chat can call outlook.open exactly once and complete.
- Safe chat can call forms.list exactly once and complete.
- Safe chat can list document-like files in Downloads.
- Safe chat can choose and summarize the most relevant Excel/CSV file in Downloads.
- Safe chat can extract suspension/report fields from an available Word/PDF/text/markdown source when one exists.
- Outlook Host API can read inbox or return a clear non-crash result.
- Outlook send/download refusal gates reject calls without confirm:true.
- Forms daily-report and suspensions preview paths run with errorCount 0.
- Forms submit refusal gates reject calls without confirm:true.
- The harness reports READY_SAFE_CHAT_PROCEDURES.
- No email is sent, no attachment is downloaded, and no form is submitted.

Recursive improvement loop:
1. Run the first command and wait for completion.
2. Read the newest final-report.md and scenario-results.json under C:\Users\VYONIX\Downloads\clawx-chat-procedures-*.
3. Classify each failure as one of:
   - network/WiFi/cloud reachability
   - provider/runtime drift
   - gateway stuck thinking
   - Electron CDP/app path failure
   - Chrome CDP/sign-in failure
   - Outlook tool failure
   - Forms preview/refusal failure
   - Downloads file discovery or parser failure
   - harness validation bug
   - test/build failure
4. If the cause is external login/network/credentials, stop and report the blocker with the exact evidence file.
5. If the cause is repo code or harness code, add or update the smallest regression first, make the smallest fix, then rerun the targeted scenario and the full chat-procedure harness.
6. After a green chat-procedure run, run the broader acceptance command once.
7. If code changed, run the smallest relevant validation plus git diff --check. Commit and push using the repo's Lore commit protocol only when the tests prove the change.
8. Sleep 10 minutes, then repeat until the eight-hour window ends or a hard blocker is proven.

Stop conditions:
- Eight hours elapsed and the last full run is READY_SAFE_CHAT_PROCEDURES, with broader acceptance green or a precise non-code blocker.
- A hard external blocker is proven.
- The same blocker repeats after three focused fix attempts.
- The next step would send email, download an attachment, submit a form, delete state, or expose secrets without explicit same-session confirmation.

Final answer:
Report the latest evidence directory, final-report path, pass/fail state, changed files if any, commit/push status if any, and the exact next blocker or demo-ready statement.
```
