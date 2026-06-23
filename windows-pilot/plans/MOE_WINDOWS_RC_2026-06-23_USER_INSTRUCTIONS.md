# MoE Windows RC 2026-06-23 - User Instructions

These instructions are for a principal, teacher, or tester installing the
Ministry of Education Windows app on a fresh laptop.

## What You Need

- A Windows 10 or Windows 11 laptop.
- Wi-Fi turned on.
- Your Microsoft 365 work or school account for Outlook and Forms.
- About 10-20 minutes for download, install, first launch, and testing.

You do not need to install Chrome MCP, a Chrome extension, Python, Node,
Playwright, Whisper, or any command-line tool.

Do not paste Gemini, Claude, OpenAI, Vertex, Bedrock, or other model provider
API keys into the app. This release uses the managed online model gateway.

## Download

Open the release page:

```text
https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260623-outlook-reply-fix
```

Download this file from the Assets section:

```text
Ministry.of.Education-0.4.3-moe.10-win-x64.exe
```

Do not download the source code zip or tar.gz files for testing.

Expected SHA-256, if your test coordinator asks you to verify it:

```text
2e189dd004995d6ce18e9e240f8228ba5039c2e384fd479a597137458a9046cf
```

## Install

1. Close any open `Ministry of Education` app windows.
2. Double-click `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`.
3. If Windows SmartScreen appears, click `More info`, then `Run anyway`.
4. Use the normal installer screens and keep the default install location.
5. Keep the desktop shortcut enabled.
6. Finish the installer.

Do not install this release by running hidden command-line `/S` or unattended
installer commands. Use the normal Windows installer screens.

After install, you should see:

- a desktop shortcut named `Ministry of Education`;
- a Start Menu entry named `Ministry of Education`.

## First Launch

1. Open `Ministry of Education` from the desktop shortcut.
2. Leave Wi-Fi on.
3. Wait up to two minutes for the app and gateway to finish starting.
4. If Windows asks whether to allow the app on a private network, allow it.

Expected:

- the app opens to the chat screen;
- the app does not ask you for provider API keys;
- the app uses the managed online gateway, not a local Hermes model.

If the app stays on `thinking` or `connecting` for more than two minutes, close
the app, reopen it from the desktop shortcut, and wait again.

## Microsoft Sign-In

For Outlook and Forms, the app may open a Microsoft sign-in page.

If that happens:

1. Sign in with your Microsoft 365 work or school account.
2. Complete MFA if your organization requires it.
3. Leave the browser window available while the app tests Outlook or Forms.
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
- the assistant summarizes safely instead of printing private email bodies;
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

This release includes the packaged Windows speech helper and bundled
`ffmpeg.exe`. Higher-quality cloud ASR remains a release configuration path and
may not be enabled in every prerelease installer.

## Report A Failure If

The assistant:

- asks you to install Chrome MCP;
- asks you to enable Chrome remote debugging;
- asks you to open `chrome://flags`;
- asks you for Gemini, Claude, OpenAI, Vertex, Bedrock, or other provider API
  keys;
- stays on `thinking` for more than two minutes;
- says it is using a local Hermes model;
- sends email without same-session confirmation;
- submits a form without same-session confirmation;
- puts reply body text in the `To`, `Cc`, or `Bcc` field;
- moves the email being replied to into Archive;
- cannot list files from Downloads;
- cannot open after reinstalling and restarting the laptop.

## Support Evidence

Capture this information for support:

1. A screenshot of the app.
2. The exact prompt you typed.
3. Whether Wi-Fi was on.
4. Whether Microsoft sign-in was completed.
5. The installer filename.
6. Any visible error message.
