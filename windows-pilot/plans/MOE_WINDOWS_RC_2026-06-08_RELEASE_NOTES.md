# MoE Windows RC 2026-06-08

Windows release candidate for the Ministry of Education pilot.

Source commit:

See the GitHub release tag target commit.

## Assets

- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`
  - SHA-256: `b981bde084340bcfafb6d527aba1a963118a82873a3c0b1b0c531eaf63cc8ecd`
- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe.blockmap`
  - SHA-256: `c06534f6a47fc3a1a4313803f41063a3b82c053df210e112f0941fc115ace703`
- `MOE-Windows-RC-2026-06-08-End-to-End-Instructions.md`
  - Full download, install, first-launch, email, Forms, and diagnostic instructions.

## Validation

- Local tests passed:
  - `pnpm exec vitest run tests/unit/chrome-cdp.test.ts tests/unit/outlook-playwright-driver-cdp.test.ts tests/unit/outlook-routes-graph.test.ts tests/unit/windows-pilot-electron-cdp-probe.test.ts`
  - Result: 4 files / 30 tests passed.
- Typecheck passed:
  - `pnpm run typecheck`
- Windows laptop Outlook-only smoke passed:
  - Artifact: `C:\Users\Public\Downloads\clawx-cdp-smoke-20260607-154048`
  - Result: `STATE:RESULT=COMPLETE`
  - `outlookSmoke.readInbox`: HTTP `200`, result `status: ok`
  - Unsafe send/download calls without confirmation were refused.
- Credentialed release installer local hash verified:
  - `B981BDE084340BCFAFB6D527ABA1A963118A82873A3C0B1B0C531EAF63CC8ECD`

## Important Install Notes

Use the normal GUI installer flow for this RC.

Do not use `/S` silent install as the release validation path. In SSH testing,
`/S` and `/S /currentuser` both hung as a lone NSIS installer process before
overwriting the app executable.

For a true out-of-box installer, the release build must include:

- `resources/cloud-gateway.json`
- `resources/cloud-gateway.key`

Those files are intentionally ignored by Git. The app seeds the Online provider
from packaged resources on first launch. Upstream Gemini/Vertex/OpenAI/Claude
provider keys stay behind the LiteLLM gateway; the desktop should contain only
the release-scoped gateway client key.

## Email Access Path

The app routes Outlook tool calls through the Electron Host API. Host API uses
Microsoft Graph when configured and signed in; otherwise it falls back to
Outlook Web through Chrome CDP.

This RC includes the managed Chrome profile fallback so users should not need
to relaunch their normal Chrome profile with remote-debugging flags.

Expected RC setup:

- No Chrome MCP or Chrome extension setup.
- If Outlook opens a Microsoft sign-in page, sign in once in the app-opened
  Chrome window and retry the email request.
- The Microsoft 365 account must have an Outlook mailbox/license and permission
  to use Outlook Web.
- Production Graph mode requires Entra tenant/client configuration, delegated
  mail scopes, and consent.

## Forms Access Path

The app bundles two test Forms URL files under the MoE principal assistant
extension:

- `daily-report`: Primary School Daily Report.
- `suspensions`: Primary School Student Suspensions.

The agent should call `forms.list`, preview the filled response page, stop for
human review, then submit only after explicit same-session confirmation.

Production Forms should use an IT-owned SharePoint list or Power Automate HTTP
trigger instead of depending on Microsoft Forms UI automation.

Expected RC setup:

- The packaged extension must include the two test form URL files.
- The test Microsoft 365 account used for Outlook must also be allowed to open
  and submit the test Forms response pages.
- The assistant must preview the filled form and require explicit same-session
  confirmation before submit.

## Known Gaps

- Microsoft Forms preview/fill is still a known risk. Automation reached Forms
  but timed out waiting for question items to render within 30 seconds.
- Microsoft Graph is not enabled on the pilot laptop yet; browser/CDP fallback
  is the verified email path.
- 400-concurrent-user gateway load testing has not been completed for this RC.

## First User Test

1. Download and run `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`.
2. Launch `Ministry of Education` from the desktop shortcut.
3. Wait up to 90 seconds for the gateway to become ready.
4. Ask: `Can you check the files in my downloads folder?`
5. Ask: `Can you check my email?`
6. If Outlook asks for Microsoft sign-in in Chrome, sign in once and retry.

For the complete flow, download `MOE-Windows-RC-2026-06-08-End-to-End-Instructions.md` from this release.
