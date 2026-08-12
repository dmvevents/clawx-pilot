# Ministry of Education Windows RC - Outlook Green

Download the installer from the GitHub prerelease:

`https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260623-outlook-green-b38b620`

Use:

- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`

Expected SHA256:

`a19a9c62eaacd958df772b432277dd220a38e61e5f0e69b449ee6b66ef00c6ee`

## Install

1. Download the `.exe`.
2. Double-click it.
3. Keep the default install options, including the desktop shortcut.
4. Open **Ministry of Education** from the desktop shortcut.
5. Wait for the gateway connection on first launch. On slower Windows machines this can take around two minutes.

## Email Test

Use a signed-in Microsoft account in the Chrome window opened by the app. If Microsoft asks you to sign in, complete the normal Microsoft sign-in in Chrome.

Suggested checks:

- "Check my inbox and show me the latest emails."
- "Show me all emails from June. Tell me how many recent Inbox rows you scanned."
- "Show me all emails from Raj."
- "Compose an email to my test address with subject: ClawX compose smoke. Body: Testing compose. Let me review it, then send it."
- "Reply to the latest test email with: Testing the reply feature. Let me review it, then send it."
- "Reply all to the latest test email with: Testing reply all. Let me review it, then send it."
- "Forward the latest test email to my test address with: Forwarding smoke test. Let me review it, then send it."

Expected behavior:

- Inbox results should come from the main Inbox, not Sent, Drafts, or Archive.
- Month searches should include older visible June rows, not only the current week.
- The assistant should not claim it found every email in the mailbox unless the tool reports the scan is exhaustive.
- Reply should open a draft for review and should not ask for the recipient after Outlook pre-fills it.
- Reply, reply-all, and forward should put the requested message in the email body, not in the To field.
- If the app creates validation drafts during testing, it should close only its own ClawX-marked test drafts and should not discard unrelated user drafts.
- Sending still requires explicit confirmation after review.

Do not test real sends unless the sender and recipient are test accounts and the send is intentionally confirmed in the same session.
