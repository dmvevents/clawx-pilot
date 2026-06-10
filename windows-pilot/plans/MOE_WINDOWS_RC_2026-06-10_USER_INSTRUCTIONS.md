# MoE Windows RC 2026-06-10 - User Instructions

These instructions are for a principal, teacher, or tester installing the
Ministry of Education Windows app on a fresh laptop.

## What You Need

- A Windows 10 or Windows 11 laptop.
- Wi-Fi turned on.
- Your Microsoft 365 work or school account for Outlook and Forms.
- About 10 minutes for download, install, first launch, and testing.

You do not need to install Chrome MCP, a Chrome extension, Python, Node,
Playwright, Whisper, or any command-line tool.

Do not paste Gemini, Claude, OpenAI, Vertex, or Bedrock API keys into the app.
The release build is intended to use the managed online model gateway.

## Download

Open the release page:

```text
https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260610-bbc4eb1
```

Download this file from the Assets section:

```text
Ministry.of.Education-0.4.3-moe.10-win-x64.exe
```

Do not download the source code zip or tar.gz files for testing.

Expected installer size:

```text
About 372 MB
```

Expected SHA-256, if your test coordinator asks you to verify it:

```text
4663ad8a1d46729633132ddac47fc8bc40c1d5d14fd29da231b53941b22d1931
```

## Install

1. Close any open `Ministry of Education` app windows.
2. Double-click `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`.
3. If Windows SmartScreen appears, click `More info`, then `Run anyway`.
4. Use the normal installer screens and keep the default install location.
5. Keep the desktop shortcut enabled.
6. Finish the installer.

After install, you should see:

- a desktop shortcut named `Ministry of Education`;
- a Start Menu entry named `Ministry of Education`.

## First Launch

1. Open `Ministry of Education` from the desktop shortcut.
2. Leave Wi-Fi on.
3. Wait up to 90 seconds for the app and gateway to finish starting.
4. If Windows asks whether to allow the app on a private network, allow it.

Expected:

- the app opens to the chat screen;
- the app does not ask you for provider API keys;
- the app should use the managed online gateway, not a local Hermes model.

If the app stays on `thinking` or `connecting` for more than two minutes, close
the app, reopen it from the desktop shortcut, and wait again.

## Microsoft Sign-In

For Outlook and Forms, the app may open a Microsoft sign-in page.

If that happens:

1. Sign in with your Microsoft 365 work or school account.
2. Complete MFA if your organization requires it.
3. Leave the browser window available while the app is testing Outlook or Forms.
4. Return to the Ministry app and retry the request.

Do not enable Chrome remote debugging manually.
Do not open `chrome://flags`.
Do not install Chrome MCP.
Do not run PowerShell or command-line Chrome commands.

## Test 1 - Downloads Folder

In the app chat, type:

```text
Can you check the files in my downloads folder?
```

Expected:

- the assistant lists files from your Windows Downloads folder;
- the assistant does not ask for your Windows username unless it cannot resolve
  the folder automatically;
- the assistant does not modify, delete, or upload files.

If there is a sample Excel or Word file in Downloads, test one of these:

```text
Summarize the Excel file in my downloads folder.
```

```text
Read the suspension document in my downloads folder and tell me what fields it contains. Do not submit any form.
```

## Test 2 - Email

In the app chat, type:

```text
Can you check my email?
```

Expected:

- the assistant uses the app's Outlook path;
- if Microsoft asks you to sign in, sign in once and retry;
- the assistant gives a safe summary instead of printing private email bodies;
- the assistant does not ask you to enable Chrome debugging.

Safe draft test:

```text
Draft an email to anton@neumanai.com saying this is a release candidate smoke test, but do not send it until I confirm.
```

Expected:

- the assistant may prepare a draft;
- the assistant must not send the email yet.

Only send a real email if you intentionally want that side effect. The exact
confirmation prompt should be in the same chat session, for example:

```text
Yes, send that email now.
```

## Test 3 - Forms

In the app chat, type:

```text
What forms can you submit?
```

Expected:

- the assistant lists the Daily Report and Suspension form paths available to
  the app;
- the assistant does not submit anything.

Daily report dry run:

```text
Prepare my attendance report. Nothing unusual today. Do not submit it.
```

Expected:

- the assistant asks for required missing attendance counts or school details;
- the assistant does not invent numbers;
- the assistant does not submit the form.

Suspension dry run:

```text
Use the suspension document in my downloads folder to prepare the suspension form. Do not submit it.
```

Expected:

- the assistant extracts the available fields;
- the assistant asks for missing required fields;
- the assistant previews or summarizes the form data only;
- the assistant does not submit the form.

Only submit a real form if you intentionally want that side effect. The exact
confirmation prompt must be in the same chat session, for example:

```text
Yes, submit that form now.
```

## Test 4 - Voice Input

If the microphone button is available:

1. Click the microphone button.
2. Say a short command such as `Check my downloads folder`.
3. Stop recording.

Expected:

- the app transcribes the command into the chat box or sends it to the
  assistant;
- the wording may not be perfect, but it should be recognizable enough to edit.

If transcription quality is poor, type the command manually. Do not spend demo
time troubleshooting ASR unless the test coordinator asks for it.

## Things That Are Not Expected

Report a failure if the assistant:

- asks you to install Chrome MCP;
- asks you to enable Chrome remote debugging;
- asks you to open `chrome://flags`;
- asks you for Gemini, Claude, OpenAI, Vertex, or Bedrock API keys;
- stays on `thinking` for more than two minutes;
- says it is using a local Hermes model;
- sends email without same-session confirmation;
- submits a form without same-session confirmation;
- cannot list files from Downloads;
- cannot open after reinstalling and restarting the laptop.

## If Something Fails

Capture this information for support:

1. A screenshot of the app.
2. The exact prompt you typed.
3. Whether Wi-Fi was on.
4. Whether Microsoft sign-in was completed.
5. The installer filename.
6. Any visible error message.

If you are comfortable opening File Explorer, collect these folders/files:

```text
%APPDATA%\Ministry of Education\logs
%APPDATA%\Ministry of Education\clawx-providers.json
%USERPROFILE%\.openclaw\openclaw.json
```

Do not share passwords, API keys, full email bodies, full recipient lists, or
private Microsoft Forms links in screenshots or support messages.

## Current Release Notes For Testers

This release is intended to remove the Chrome debugging setup problem from the
tester experience. Outlook may still require normal Microsoft sign-in.

Microsoft Graph bootstrap support is included in the app, but this exact
package does not yet include the real MoE Entra public client ID. Once IT
provides that tenant configuration, the next package can make Outlook use Graph
after sign-in instead of the browser fallback.

Production Forms submission should eventually go through an IT-owned
SharePoint or Power Automate destination. For this test, Forms are treated as
a preview/dry-run flow unless the tester explicitly confirms submission in the
same chat session.
