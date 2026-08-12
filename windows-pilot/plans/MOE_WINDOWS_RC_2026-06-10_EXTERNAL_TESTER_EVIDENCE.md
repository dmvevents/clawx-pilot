# MoE Windows RC 2026-06-10 - External Tester Evidence

## Source

External tester: Karunesh Ramdass.

Feedback received by the release lead on 2026-06-09 between 22:40 and 23:12
America/Port_of_Spain time.

## Tested Artifact

GitHub prerelease:

```text
https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260610-bbc4eb1
```

Installer:

```text
Ministry.of.Education-0.4.3-moe.10-win-x64.exe
```

Installer SHA256:

```text
4663ad8a1d46729633132ddac47fc8bc40c1d5d14fd29da231b53941b22d1931
```

## Reported Results

- Download started successfully.
- Installer completed successfully.
- Online agent was set by default.
- No user setup was necessary for the model path.
- Gateway connection wait was around two minutes.
- Local file scanning worked.
- Email checking worked.
- Email compose and send worked.
- Tester plans broader follow-up testing on 2026-06-10.

## Release Interpretation

This is strong RC evidence for:

- install;
- online model default;
- no user provider/API-key setup;
- local file scan;
- Outlook read/check;
- Outlook compose/send.

It is not yet full GA evidence because:

- the result should be repeated on at least one more fresh or reset Windows
  profile;
- Gateway startup needs an accepted SLO or clearer readiness UX;
- Forms preview/dry-run still needs fresh tester evidence;
- Office file handling should be expanded into Excel, Word, and PDF cases;
- send safety still needs explicit same-session confirmation evidence attached
  to the GA packet;
- Ministry-only branding cleanup remains open.

## Follow-Up Issues

- `#1` - Measure and reduce Gateway cold-start time.
- `#2` - Capture repeat clean-install tester evidence.
- `#3` - Verify Outlook send requires explicit same-session confirmation.
- `#4` - Expand file smoke into Excel / Word / PDF matrix.
- `#5` - Run Outlook read/search/draft/send-safe bug bash.
- `#6` - Run Forms preview/prefill/dry-run/submit-refusal bug bash.
- `#7` - Remove ClawX/OpenClaw from principal-facing UI and copy.
- `#8` - Create production Outlook teacher login and support logging flow.
- `#9` - Define production Forms destination via SharePoint or Power Automate.
- `#10` - Assemble final GA evidence packet.
