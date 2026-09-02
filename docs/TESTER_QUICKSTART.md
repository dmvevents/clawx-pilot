# Ministry of Education Assistant — Tester Quickstart (Windows 11)

You are testing **version 0.4.3-moe.15** of the Ministry of Education desktop
assistant. Total time: about 20 minutes. You do not need any account or
sign-in for tasks 1-4 below.

## 1. Download

- Use the private download link in the email that came with this guide.
  The link expires, so download soon after you receive it.
- The file is `Ministry of Education-0.4.3-moe.15-win-x64.exe`, about **390 MB**.
- Quick check after download: right-click the file, choose **Properties**,
  and confirm Size reads **390,104,940 bytes** exactly. The official SHA-256
  checksum is published in the same email as the link; if you know how to
  check a file hash, you can compare it, but the size check is enough.

## 2. Install (about 5 minutes)

- Double-click the downloaded file.
- Windows will show a blue **"Windows protected your PC"** screen because the
  publisher is not yet registered. Click **More info**, then **Run anyway**.
  This is expected for this test build.
- Follow the installer screens and accept the defaults. Please install by
  double-clicking only — do not use any command-line options.

## 3. First launch

- Open **Ministry of Education** from the Start menu.
- The first start takes **about a minute** to get ready. The message box at
  the bottom of the chat stays greyed out while it sets up.
- When you can type in the message box, you are ready. If it is still greyed
  out after 5 minutes, that is a bug — see step 5, then close and reopen the
  app once.

## 4. Five things to try (in order)

Tasks 1-4 need **no account and no sign-in**.

1. **Ask a question:** "What are three things you can help a school principal with?"
2. **Draft a letter:** "Draft a short letter to parents about a school open day next Friday."
3. **Summarise a document:** drag any PDF or Word file into the chat and ask
   "Summarise this document in five bullet points."
4. **Create a file:** "Create a Word document listing five things a principal
   should check every morning, and save it to my Desktop."
5. **Email (only if an email account was set up for you):** "Summarise my last
   5 emails." If no account was set up, skip this and write
   "skipped — no email account" in your notes.

For each task, note: worked / partly worked / failed, and roughly how long it took.

## 5. If something breaks

- Take a screenshot: **Windows key + Shift + S**.
- Write down what you typed and what you expected to happen.
- Grab the newest log file: open File Explorer, paste
  `%APPDATA%\Ministry of Education\logs` into the address bar, press Enter,
  and copy the most recent file. The logs contain no message content or
  passwords.
- If you can, carry on with the next task.

## 6. Send feedback

Reply to the email that contained your download link. Please include:

- How long the download and install took, and anything confusing along the way.
- Your worked / partly / failed notes for each of the five tasks.
- Any screenshots and the log file from step 5.

Thank you — an honest "this confused me" is exactly what we need.

---
*Build: 0.4.3-moe.15 (Windows x64) · SHA-256 `d10de5809b6888a9dbd4a82fea41d8dc20d8bd81193b306c68a163dfc6ce18df` · Guide date: 2026-09-03*
