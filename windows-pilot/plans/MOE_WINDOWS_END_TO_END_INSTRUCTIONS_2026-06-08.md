# MoE Windows RC 2026-06-08 - End-to-End Install and Test Instructions

## Download

Download the Windows installer from the GitHub release named:

`MoE Windows RC 2026-06-08`

Installer asset:

`Ministry.of.Education-0.4.3-moe.10-win-x64.exe`

Expected SHA-256:

`5e66e59476bf510cd2dcf605b999b1c9b525563822f2316a48b96f3902b738b7`

## Before Installing

1. Use Windows 10 or Windows 11 on an x64 laptop.
2. Turn Wi-Fi on before first launch.
3. Close any existing `Ministry of Education` app windows.
4. If Windows SmartScreen appears, choose `More info`, then `Run anyway`.

Do not use silent install as the release validation path for this RC. The `/S`
installer path is still an automation blocker in SSH testing. Use the normal
GUI installer flow for this release candidate.

## Release Operator: Gateway Credential Injection

The user should not paste Gemini, OpenAI, Claude, or Vertex credentials after
install. The installer must be built with the MoE model gateway preseeded.

Before building the installer, create these untracked files:

`resources/cloud-gateway.json`

```json
{
  "enabled": true,
  "providerId": "moe-cloud-gateway",
  "label": "MOE Cloud Gateway",
  "baseUrl": "https://<clawx-litellm-gateway-url>/v1",
  "apiKeyFile": "cloud-gateway.key",
  "model": "moe-demo-pro",
  "models": ["moe-demo-pro", "moe-demo"],
  "fallbackModels": ["moe-demo"],
  "apiProtocol": "openai-completions",
  "setDefault": true,
  "setPreferredChannel": true
}
```

`resources/cloud-gateway.key`

```text
<LiteLLM gateway client key>
```

Both files are intentionally ignored by Git. The packaged app reads
`process.resourcesPath/resources/cloud-gateway.json`, resolves
`cloud-gateway.key` relative to that file, stores the client key in the app's
secure provider store, sets the Online channel, and syncs OpenClaw to:

`custom-moecloud/moe-demo-pro`

Do not package raw upstream provider keys in the desktop app. Gemini, Vertex,
OpenAI, Claude, and Bedrock credentials belong behind the LiteLLM gateway. The
desktop app should contain only the release-scoped gateway client key.

## Install

1. Double-click `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`.
2. Choose the default current-user install location unless you are deliberately
   testing a custom path.
3. Keep the desktop shortcut enabled.
4. Finish the installer.
5. Confirm these shortcuts exist:
   - Desktop: `Ministry of Education`
   - Start Menu: `Ministry of Education`

## First Launch

1. Open the app from the desktop shortcut.
2. Wait for the gateway to become ready. On slower Windows laptops, this can
   take 30-90 seconds.
3. Confirm the model/provider is the cloud gateway route, not a local Hermes
   model. The expected release config is:
   - Provider: `MOE Cloud Gateway`
   - Runtime model: `custom-moecloud/moe-demo-pro`
   - Gateway model: `moe-demo-pro`
4. If Outlook or Forms opens a Chrome window and asks for Microsoft sign-in,
   sign in once. The app may use a ClawX-managed Chrome profile so it does not
   have to attach to the teacher's normal Chrome profile.

If the app still shows a local model after 90 seconds, the installer was not
built with `resources/cloud-gateway.json` and `resources/cloud-gateway.key`, or
the gateway seed failed. Check:

`%APPDATA%\Ministry of Education\logs`

`%APPDATA%\Ministry of Education\clawx-providers.json`

`%USERPROFILE%\.openclaw\openclaw.json`

## Smoke Test: Files

In chat, ask:

`Can you check the files in my downloads folder?`

Expected result:

- The assistant should list files from the signed-in Windows user's Downloads
  folder.
- It should not ask for a username if it can resolve the current user.

## Smoke Test: Email

In chat, ask:

`Can you check my email?`

Expected result:

- The app should use the Outlook tool path through the Electron Host API.
- If Microsoft Graph is not configured, it should use Outlook Web through
  Chrome CDP.
- It should not require the user to manually launch Chrome with remote
  debugging flags.
- If Microsoft sign-in is required in the managed Chrome profile, sign in once
  and retry the request.

### Email Setup Details

For this RC, the verified email path is Outlook Web through Chrome CDP:

Release operator setup:

1. Package the app with the Outlook/CDP Host API path enabled.
2. Do not require Chrome MCP, a Chrome extension, or a manually launched Chrome
   remote-debugging session.
3. Confirm the app can launch its managed Chrome profile from the installed
   desktop shortcut.

Microsoft 365 account setup:

1. Use a demo Microsoft 365 account with an active Outlook mailbox/license.
2. Confirm the account can open Outlook Web manually before the demo.
3. If the tenant requires MFA or conditional access, complete that sign-in flow
   in the Chrome window opened by the app.

Tester steps:

1. Ask `Can you check my email?`
2. The app launches or attaches to Chrome CDP on localhost.
3. The assistant calls the app-owned Host API tools, not direct browser MCP.
4. If a Microsoft sign-in page appears, sign in with the demo Microsoft 365
   account once in that Chrome window.
5. Retry `Can you check my email?`

No Chrome extension, Chrome MCP, manual remote-debugging command, or normal
Chrome profile setup should be required.

Production Graph email is supported only when IT provides Microsoft Entra app
configuration and the user signs in through the app:

- Tenant id or verified domain.
- Public-client app id.
- Redirect URI: `http://localhost:53682/callback`.
- Delegated scopes: `openid profile email offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send`.
- Tenant/admin consent where required.

Until that Graph setup is complete, Outlook Web/CDP is the expected fallback.

Safe send test:

`Draft an email to anton@neumanai.com saying this is a release candidate smoke test, but do not send it until I confirm.`

Expected result:

- The assistant may draft or prepare the email.
- It must not send without explicit confirmation.

Confirmed send test:

Only run this when real email side effects are acceptable.

`Send the release candidate smoke test email to anton@neumanai.com now.`

Expected result:

- The assistant sends the email only after the explicit confirmation request.

## Smoke Test: Forms

In chat, ask:

`Submit my attendance report. I have nothing to report today.`

Current RC caveat:

- Outlook is verified.
- Microsoft Forms preview is still a known risk in automation. The latest full
  smoke reached Forms but timed out waiting for question items to render within
  30 seconds. If Forms fails, capture logs and continue with email/file demos.

### Forms Setup Details

The app supports two bundled test forms:

- `daily-report`
  - Title: `Primary School Daily Report: Term 3 2025/26`
  - URL file:
    `extensions/moe-principal-assistant/forms/daily-report-test-fac-url.txt`
- `suspensions`
  - Title: `Primary School Student Suspensions: Term 3 2025/26`
  - URL file:
    `extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt`

Those URL files must be present in the packaged extension. They point to test
Microsoft Forms response pages owned by the demo/test Microsoft 365 account.

Release operator setup:

1. Confirm these files are present before building and after install:
   - `extensions/moe-principal-assistant/forms/daily-report-test-fac-url.txt`
   - `extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt`
2. Confirm each file contains the intended test Microsoft Forms response URL.
3. Confirm the packaged extension can read both URLs through `forms.list`.

Microsoft 365 / Forms owner setup:

1. The test Forms must accept responses from the demo Microsoft 365 account used
   for Outlook.
2. If the form is organization-restricted, the demo account must belong to the
   allowed tenant.
3. Keep test Forms separate from any live MoE production submission destination.
4. Do not require the teacher to create Forms, copy URLs, or configure
   permissions during install.

The agent workflow is:

1. Call `forms.list`.
2. Build the payload from the user's request or source document.
3. Call `forms.preview_daily_report` or `forms.preview_suspension`.
4. Stop for human review.
5. Call the matching `forms.submit_*` tool only after an explicit same-session
   confirmation.

The submit tools refuse without `confirm: true`. The app must not submit a real
form from an implied or stale confirmation.

If Forms asks for Microsoft sign-in, use the same demo Microsoft 365 account as
Outlook in the Chrome window opened by the app. If question items do not render
within 30 seconds, collect logs and use email/file flows for the demo.

Tester steps:

1. Ask `What forms can you submit?`
2. Confirm the assistant lists `daily-report` and `suspensions`.
3. Ask `Submit my attendance report. I have nothing to report today.`
4. Review the preview page before submit.
5. Confirm only with a clear command such as `Yes, submit this form now.`
6. For the suspension demo, place the sample suspension document in Downloads
   and ask the assistant to read it before previewing the suspension form.

Production Forms should move to an IT-owned Power Automate flow or SharePoint
list target. Ask the administrator for:

- SharePoint hostname, site id/path, list id/name, and column internal names;
  or a Power Automate HTTP trigger URL per official form.
- Permission model: `Sites.Selected` preferred, or the least broader delegated
  scope IT approves.
- Test destination separate from live MoE submissions.
- Confirmation and audit requirements for submit actions.

## Verification Evidence From This RC

Windows laptop Outlook-only smoke:

- Artifact directory:
  `C:\Users\Public\Downloads\clawx-cdp-smoke-20260607-154048`
- Result:
  `STATE:RESULT=COMPLETE`
- `outlookSmoke.readInbox`:
  HTTP `200`, result `status: ok`
- Unsafe send/download calls without confirmation:
  correctly refused.

Final installer copied to the Windows laptop:

`C:\Users\Public\Downloads\Ministry.of.Education-0.4.3-moe.10-current-win-x64.exe`

Laptop hash matched:

`5E66E59476BF510CD2DCF605B999B1C9B525563822F2316A48B96F3902B738B7`

## Logs and Diagnostics

App logs:

`%APPDATA%\Ministry of Education\logs`

OpenClaw config:

`%USERPROFILE%\.openclaw\openclaw.json`

Installed app:

`%LOCALAPPDATA%\Programs\Ministry of Education`

Packaged Playwright runtime check:

`%LOCALAPPDATA%\Programs\Ministry of Education\resources\openclaw\node_modules\playwright-core\package.json`

## Known RC Gaps

1. Microsoft Forms render/fill automation needs another pass.
2. Silent NSIS install remains an automation blocker.
3. Microsoft Graph is not yet enabled on the pilot laptop; browser/CDP fallback
   is the verified email path.
4. 400-concurrent-user gateway load testing has not been completed for this RC.

## Support Checklist

If the app appears stuck:

1. Confirm Wi-Fi is on.
2. Wait 90 seconds after first launch.
3. Restart the app from the desktop shortcut.
4. Check `%APPDATA%\Ministry of Education\logs`.
5. If Outlook asks for sign-in in a Chrome window, sign in and retry.
6. If a Forms task fails, collect the latest app log and note whether the form
   page visibly loaded.
