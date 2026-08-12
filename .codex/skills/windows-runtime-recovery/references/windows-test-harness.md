# Windows Test Harness Strategy

Use this reference when asked to emulate Windows on the Mac, create a Windows VM, or add automated tests for Windows-only runtime behavior.

## Three Layers

1. Mac-side simulator for fast deterministic tests.
2. Windows VM on the Mac for packaged runtime behavior.
3. Physical Windows pilot laptop for final demo truth.

## Mac Simulator

Use temp Windows-like paths:

```bash
APPDATA=/tmp/clawx-win/AppData/Roaming
LOCALAPPDATA=/tmp/clawx-win/AppData/Local
USERPROFILE=/tmp/clawx-win/User
HOME=/tmp/clawx-win/User
```

Good candidates:

```bash
pnpm exec vitest run tests/unit/channel-router.test.ts tests/unit/provider-runtime-sync.test.ts
pnpm exec vitest run tests/unit/forms-browser-driver-cdp.test.ts tests/unit/forms-browser-submit-gate.test.ts
pnpm exec vitest run tests/unit/asr-ipc-provider-selection.test.ts tests/unit/asr-feature-flags.test.ts
pnpm run demo:office-analysis -- --excel "<xlsx>" --word "<docx>" --json-out /tmp/office-analysis.json
```

Limit: Electron E2E skips Gateway auto-start and heavy side effects, so it cannot prove real Windows Gateway/model behavior alone.

## Windows VM

Use `docs/UTM_WINDOWS_SETUP.md`. Install Chrome, OpenSSH Server, and the packaged Ministry app. Run the same `windows-pilot/scripts` probes as the physical pilot.

The VM catches NSIS install behavior, `%APPDATA%` paths, Windows file locking, packaged helper availability, Chrome CDP, and native ASR presence.

## Physical Pilot

Use the physical laptop only for final smoke after local/VM checks:

- app launch from shortcut
- Gateway live
- cloud model request succeeds
- Office file prompt works
- Outlook open/read/draft works
- Forms preview fills all fields
- send/submit gates still block unsafe calls

Do not let the pilot become the first place a newly suspected regression is tested if a Mac/VM check can isolate it.
