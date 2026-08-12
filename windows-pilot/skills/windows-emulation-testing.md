---
name: windows-emulation-testing
description: Emulate or approximate the ClawX Windows runtime from the Mac using temp Windows-like paths, Electron E2E, UTM Windows VM, and final physical pilot smoke tests.
metadata:
  os: mac/windows
  related-docs: docs/UTM_WINDOWS_SETUP.md, docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md
---

# Windows emulation and test strategy

## Goal

Catch Windows demo regressions quickly on the Mac before touching the physical pilot laptop.

## Layer 1 - Mac simulator

Use temp Windows-like environment paths:

```bash
APPDATA=/tmp/clawx-win/AppData/Roaming
LOCALAPPDATA=/tmp/clawx-win/AppData/Local
USERPROFILE=/tmp/clawx-win/User
HOME=/tmp/clawx-win/User
```

Run targeted tests:

```bash
pnpm exec vitest run tests/unit/channel-router.test.ts tests/unit/provider-runtime-sync.test.ts
pnpm exec vitest run tests/unit/forms-browser-driver-cdp.test.ts tests/unit/forms-browser-submit-gate.test.ts
pnpm exec vitest run tests/unit/asr-ipc-provider-selection.test.ts tests/unit/asr-feature-flags.test.ts
pnpm run demo:office-analysis -- --excel "<xlsx>" --word "<docx>" --json-out /tmp/office-analysis.json
```

Best missing test: seed divergent Windows-like provider stores, run the real channel/provider preflight, and assert every store converges to the same cloud model.

## Layer 2 - UTM Windows VM

Follow `docs/UTM_WINDOWS_SETUP.md`.

The VM catches:

- NSIS install path and packaged resources.
- `%APPDATA%` / `%LOCALAPPDATA%` behavior.
- Windows file locking and restart behavior.
- Windows ASR helper presence.
- Chrome CDP on Windows.

Run the same `windows-pilot/scripts` probes over SSH against the VM alias.

## Layer 3 - Physical pilot

Use the pilot laptop only after Mac/VM checks pass.

Final smoke:

- app launches from shortcut;
- Gateway live;
- cloud model request succeeds;
- Excel sample parses and summarizes;
- Outlook open/read/draft works through signed-in Chrome;
- Forms preview fills all expected fields;
- send/submit gates still refuse unsafe calls.

## Limits

Mac E2E does not fully exercise Gateway auto-start, Windows native ASR, Windows file locks, or real Chrome/Outlook auth state. Use it to narrow failures, not to certify the demo.
