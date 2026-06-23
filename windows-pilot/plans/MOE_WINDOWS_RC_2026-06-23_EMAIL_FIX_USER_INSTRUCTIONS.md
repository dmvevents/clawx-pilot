# Ministry of Education Windows RC - Email Fix

Download the installer from the GitHub prerelease:

`https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260623-email-draft-fix`

Use:

- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`

Expected SHA256:

`e35ee6cda63a942a585b0638831487562d66a0901b006cf2ccadfe81b0e6f182`

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
- "Reply to the latest email with: Testing the reply feature. Do not send it."
- "Reply all to the latest email with: Testing reply all. Do not send it."
- "Forward the latest email to a test address with: Forwarding smoke test. Do not send it."

Expected behavior:

- Inbox results should come from the main Inbox, not Sent, Drafts, or Archive.
- Month searches should include older visible June rows, not only the current week.
- The assistant should not claim it found every email in the mailbox unless the tool reports the scan is exhaustive.
- Reply should open a draft for review and should not ask for the recipient after Outlook pre-fills it.
- Reply, reply-all, and forward should put the requested message in the email body, not in the To field.
- If the app creates no-send validation drafts during testing, it should close only its own ClawX-marked test drafts and should not discard unrelated user drafts.
- Sending still requires explicit confirmation after review.

Do not test real sends unless the sender and recipient are test accounts and the send is intentionally confirmed in the same session.
