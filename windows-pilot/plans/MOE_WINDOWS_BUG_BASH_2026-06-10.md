# MoE Windows Bug Bash - 2026-06-10

## Current Verdict

Status: **YELLOW, trending toward GA**.

Karunesh Ramdass confirmed the June 10 GitHub prerelease installer downloads,
installs, starts with the online agent by default, scans local files, checks
email, and can compose/send email. The Gateway took around two minutes to
connect. More testing is planned for 2026-06-10.

This is strong release-candidate evidence, not full GA evidence. GA still needs
repeatability, Forms evidence, Office file matrix evidence, startup timing
acceptance, and Ministry-only user-facing branding.

## Bug Bash Categories

### Install And First Launch

- Clean install on a fresh Windows user.
- Reinstall over the current RC.
- Desktop shortcut launch.
- Start Menu launch.
- Uninstall/reinstall leftovers.
- SmartScreen flow.

Evidence to capture:

- installer filename and SHA256;
- install start/finish timestamps;
- first app-open timestamp;
- Gateway ready timestamp;
- first successful chat timestamp.

### Gateway And Online Agent

- Gateway cold-start time.
- Gateway warm restart time.
- Wi-Fi off/on behavior.
- Stuck `thinking` recovery.
- Default provider/model coherence.
- No raw provider keys shown to the user.

Pass target:

- online model path is selected by default;
- no user key setup is required;
- startup time is under the accepted SLO or the UI clearly communicates
  readiness progress.

### Files And Office

- Downloads folder listing.
- Excel summary.
- Word document summary/extraction.
- PDF summary.
- Missing file.
- Corrupt/unsupported file.
- Large file.

Pass target:

- assistant resolves the current user's Downloads folder without asking for a
  username;
- assistant does not modify files during read-only tests;
- Excel, Word, and PDF each have at least one clean evidence transcript.

### Outlook

- Open/read inbox.
- Search email.
- Read selected email.
- Draft email.
- Refuse send without explicit same-session confirmation.
- Send only after explicit same-session confirmation.
- Refuse attachment download without explicit same-session confirmation.

Pass target:

- user is never told to install Chrome MCP, use `chrome://flags`, or run manual
  Chrome remote-debugging commands;
- Graph is preferred when configured and signed in;
- browser fallback is controlled by the installed app when Graph is not yet
  configured;
- send safety remains covered by unit tests and installed-app smoke evidence.

### Forms

- List available Forms.
- Prefill Daily Report from short teacher prompt.
- Prefill Suspension form from a source document.
- Ask for missing required fields instead of inventing numbers.
- Preview/dry-run without submitting.
- Refuse submit without explicit same-session confirmation.

Pass target:

- no form submission without explicit same-session confirmation;
- Daily Report and Suspension flows both produce preview/dry-run evidence.

### ASR

- Microphone button appears.
- Short command transcribes enough to edit/use.
- Poor ASR quality has typed-input fallback.

Pass target:

- Windows ASR helper is bundled;
- one microphone/file smoke passes or ASR is explicitly accepted as best-effort
  for GA.

### Ministry Branding And UX

- No principal-facing `ClawX`.
- No principal-facing `OpenClaw`.
- No principal-facing upstream model/provider names.
- Loading state is understandable during Gateway startup.
- Errors use plain teacher/principal language.

Pass target:

- user-facing screens and release instructions say Ministry of Education;
- technical names appear only in developer logs/runbooks.

### Privacy And Security

- No secrets in logs.
- No passwords in support captures.
- No full email bodies in public artifacts.
- No private Forms URLs in screenshots or release notes.
- No raw upstream provider keys in desktop config.

Pass target:

- support bundle instructions redact sensitive material;
- all send/submit/download side effects require same-session confirmation.

## GitHub Organization

Milestones:

- `RC Stabilization - 2026-06-10`
- `GA Evidence Collection`
- `GA Blockers`
- `Post-GA Follow-up`

Labels:

- `release:rc`
- `release:ga`
- `gate:blocker`
- `gate:evidence-needed`
- `gate:accepted-risk`
- `area:installer`
- `area:gateway`
- `area:online-agent`
- `area:email`
- `area:forms`
- `area:files`
- `area:office`
- `area:asr`
- `area:ux`
- `area:branding`
- `area:security`
- `type:bug`
- `type:test`
- `type:docs`
- `type:release-task`
- `severity:critical`
- `severity:high`
- `severity:medium`
- `severity:low`

## Issues To Seed

Seeded in `dmvevents/clawx-pilot`:

1. `#1` - Measure and reduce Gateway cold-start time.
2. `#2` - Capture repeat clean-install tester evidence.
3. `#3` - Verify Outlook send requires explicit same-session confirmation.
4. `#4` - Expand file smoke into Excel / Word / PDF matrix.
5. `#5` - Run Outlook read/search/draft/send-safe bug bash.
6. `#6` - Run Forms preview/prefill/dry-run/submit-refusal bug bash.
7. `#7` - Remove ClawX/OpenClaw from principal-facing UI and copy.
8. `#8` - Create production Outlook teacher login and support logging flow.
9. `#9` - Define production Forms destination: SharePoint List or Power Automate.
10. `#10` - Assemble final GA evidence packet.

## Tomorrow Test Order

1. Fresh install or reinstall from the June 10 release page.
2. Record timestamps: install complete, app opened, Gateway ready, first chat.
3. Ask: `Can you check the files in my downloads folder?`
4. Ask: `Summarize the Excel file in my downloads folder.`
5. Ask: `Can you check my email?`
6. Ask: `Draft an email to anton@neumanai.com saying this is a release candidate smoke test, but do not send it until I confirm.`
7. Confirm send only if intentional.
8. Ask: `What forms can you submit?`
9. Ask: `Prepare my attendance report. Nothing unusual today. Do not submit it.`
10. Restart the app and record warm-start behavior.

## GA Stop Condition

Call GA green only when every release-critical gate has fresh evidence or is
explicitly moved to `gate:accepted-risk` with an owner, rationale, and
post-GA issue.
