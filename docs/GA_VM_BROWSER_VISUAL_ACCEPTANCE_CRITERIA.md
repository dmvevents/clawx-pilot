# GA VM/Browser Visual Acceptance Criteria

Last updated: 2026-06-23.

## Purpose

Use this checklist when a human reviewer or visual model reviews VM/browser screenshots for GA release evidence. The review must prove the installed Windows Electron app path and browser-assisted Outlook/Forms flows without causing live side effects.

This document supplements `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` and `.agents/skills/windows-vm-smoke/SKILL.md`. Record final gate evidence in the manifest.

## Status Vocabulary

| Status | Meaning |
|---|---|
| `PASS` | Screenshot and artifact evidence prove the required state through the installed app path, with redaction complete and no unsafe side effects. |
| `YELLOW` | Evidence is useful but incomplete, blocked by sign-in/tenant access/timing, or requires an accepted GA deferral. No unsafe side effect occurred. |
| `RED` | Evidence shows a failed installed path, bypassed safety gate, unredacted private data, or any unconfirmed send, submit, or download. |

The evidence manifest may translate a visual `PASS` into a `GREEN` release row. Keep visual review output itself in `PASS`, `YELLOW`, or `RED`.

## Non-Negotiable Safety Gates

Visual acceptance is always no-send, no-submit, and no-download unless a separate, exact same-session confirmation is explicitly assigned for a non-GA test.

- Do not send email.
- Do not submit Microsoft Forms.
- Do not download attachments.
- Do not click links in private email or Forms content unless the current test case explicitly defines a safe internal URL.
- Do not expose provider keys, passwords, Host API tokens, private Forms URLs, email bodies, student identifiers, full recipient lists, or key-file hashes in screenshots, OCR text, transcripts, logs, or release notes.
- If a screenshot captures private content that is not needed for review, redact it before VLM review and before attaching it to the evidence packet.

Any unconfirmed send, submit, download, or private-data exposure is `RED`.

## Evidence Inputs

Each visual review packet should include:

- VM or laptop name, date, installer SHA256, and smoke artifact root.
- Install evidence proving that the installer completed and that the app exe exists. Hidden WinRM/SSH silent-installer timeouts are `RED` for visual acceptance until rerun through an assisted desktop install or a longer bounded smoke that reaches the installed app.
- Installed Electron app screenshot from the shipped app path, not Vite/dev mode.
- Browser screenshots opened by the installed app's Outlook/Forms path, not a manually prepared browser-only demo.
- Electron CDP or Host API probe artifact path proving the app can call the installed Host API.
- Chrome CDP or Microsoft Graph context artifact path proving the Outlook/Forms browser context is the signed-in tenant context, or a precise sign-in-required diagnostic.
- Redaction note confirming that screenshots and extracted text omit secrets and private content.

Installed path evidence must point to the per-user Windows install, for example `%LOCALAPPDATA%\Programs\Ministry of Education\Ministry of Education.exe`, the Desktop shortcut, or the Start Menu shortcut. A screenshot from `pnpm dev`, a local browser tab, or unpackaged Electron is not GA visual proof.

## Visual Reviewer Instructions

Ask the human reviewer or VLM to judge observable UI state only. Do not ask it to infer hidden tool calls, credentials, or tenant permissions from screenshots.

The reviewer should report:

| Field | Required content |
|---|---|
| `status` | `PASS`, `YELLOW`, or `RED`. |
| `surface` | `installed-electron`, `outlook-inbox-list`, `outlook-reply-draft`, `forms-preview`, or `forms-sign-in-required`. |
| `artifacts` | Screenshot paths and probe artifact paths. |
| `observations` | Visible state needed for the verdict, with private content summarized or redacted. |
| `safety` | Explicit statement that no email was sent, no form was submitted, and no attachment was downloaded. |
| `redaction` | Explicit statement that secrets, private URLs, email bodies, student identifiers, and full recipient lists are absent or redacted. |
| `blocker` | Required for `YELLOW` or `RED`; name the missing evidence or failed criterion. |

## Installed Electron Criteria

`PASS` requires all of the following:

- The screenshot shows the shipped Ministry of Education Electron app launched from the installed Windows app path or shortcut.
- The app is not visibly running from Vite, localhost dev UI, or an unpackaged developer build.
- The app can reach the Host API and Gateway according to the paired probe artifact.
- Any visible account, path, or diagnostic text is safe to publish or redacted.

`YELLOW` is acceptable only when the installed app launches and the missing item is explicitly outside the visual surface, such as a slow Gateway readiness window already captured in logs.

`RED` applies if the screenshot is from the wrong runtime path, the app cannot launch, the app is blank, or the evidence exposes secrets/private data.

## Outlook Inbox-List Criteria

`PASS` requires all of the following:

- The browser surface is Outlook Web or Graph-backed Outlook evidence reached from the installed app path.
- The visible state is an inbox or message list, not only a Microsoft landing page.
- The account is signed in to the intended Microsoft tenant or the artifact records the correct signed-in context.
- At least one list row or inbox state is visible enough to prove the inbox loaded, with sender, subject, preview text, and recipient data redacted as needed.
- No message body is exposed unless the test fixture is synthetic and marked as such.
- No attachment is downloaded.

`YELLOW` applies when the installed app reaches Microsoft sign-in or tenant consent and records a precise sign-in-required diagnostic without exposing private content.

`RED` applies when the browser was prepared outside the installed app path, Outlook never loads beyond a generic landing/error page, private email content is exposed, or an attachment download occurs.

## Outlook Reply-Draft Criteria

`PASS` requires all of the following:

- The screenshot shows a reply compose surface opened through the installed app's Outlook path.
- The draft is visibly a reply, such as a `Re:` subject or reply pane tied to the selected message.
- Draft recipient, subject, and body are present enough to prove a reply was composed, with private details redacted.
- The message remains in draft/review state.
- There is no sent confirmation, sent-items view, transport success toast, or equivalent proof of delivery.
- No attachment is downloaded.

`YELLOW` applies when the installed app reaches the correct message and can open Outlook but compose is blocked by sign-in, tenant policy, or a documented UI timing issue.

`RED` applies when the message is sent without explicit same-session confirmation, the draft targets the wrong recipient/thread, the reviewer cannot tell whether it is a draft, or private email content is exposed.

## Forms Preview Criteria

`PASS` requires all of the following:

- The browser surface is a Microsoft Forms response preview reached from the installed app path.
- The visible form is the intended Daily Report or Student Suspensions form.
- Question items render visibly, with expected prefilled or selected values shown where the scenario requires them.
- Test values are synthetic or redacted.
- The form remains on the preview/fill page.
- There is no submitted/thank-you page, submission confirmation, response receipt, or equivalent proof of submission.

`YELLOW` applies when Forms redirects to Microsoft sign-in, tenant consent, or an access interstitial and the artifact records that exact blocker while preserving no-submit safety.

`RED` applies when the browser opens the form editor instead of the response page, no question items render and no precise sign-in/access diagnostic exists, private Forms URLs or student data are exposed, or a submission occurs.

## Release Gate Rollup

Use the strictest status across the surfaces:

| Surface | PASS requirement | Yellow example | Red example |
|---|---|---|---|
| Installed Electron | Shipped app path, Host API/Gateway proof, no private data | Gateway slow but later ready in paired artifact | Dev/runtime path or blank installed app |
| Outlook inbox list | Signed-in inbox list loaded through app path | Microsoft sign-in required | Private email exposed or attachment downloaded |
| Outlook reply draft | Reply compose remains unsent and redacted | Compose blocked after correct sign-in diagnostic | Unconfirmed send or wrong recipient/thread |
| Forms preview | Intended form questions render without submit | Sign-in/access interstitial with precise diagnostic | Submitted form or private Forms URL exposed |

A GA visual packet is `PASS` only when every required surface is `PASS`. A single `YELLOW` keeps the release gate `YELLOW` until the deferral is accepted in the evidence manifest. A single `RED` blocks GA.
