---
name: windows-build-package
description: Build, package, install, and validate the ClawX/Ministry Windows app, including runtime dependencies, Windows ASR helper, NSIS installer, desktop shortcuts, and post-install smoke probes.
---

# Windows Build And Package

## Preflight

Read:

- `docs/WINDOWS_INSTALL_RUNBOOK.md`
- `docs/WINDOWS_PROBLEMS_ATLAS.md`
- `docs/COMPLETION_PLAN.md`
- `docs/build/windows-build-pipeline.md`
- `package.json`
- `electron-builder.yml`

Check that `playwright-core` remains in `dependencies`, not `devDependencies`.

## Local Verification

```bash
pnpm run typecheck
pnpm exec vitest run tests/unit/channel-router.test.ts tests/unit/provider-runtime-sync.test.ts
pnpm exec vitest run tests/unit/forms-browser-driver-cdp.test.ts tests/unit/forms-browser-submit-gate.test.ts
pnpm exec vitest run tests/unit/asr-ipc-provider-selection.test.ts tests/unit/asr-feature-flags.test.ts
```

## Windows Assets

```bash
pnpm run prep:win-binaries
```

This downloads Windows `uv`, Windows `node`, and pinned LGPL FFmpeg with its license/provenance notices, then builds the Windows ASR helper. On Windows, preparation also runs FFmpeg version/build-configuration and audio-transcode checks. The builder validates the required helpers before and after packaging; the release manifest binds the shipped `win:bin` tree. Verify a clean application directory: a helper left by an older installation does not prove it was shipped.

## Package

```bash
pnpm run build:win
```

or:

```bash
pnpm run package:win
```

## Install And Smoke

Use `docs/WINDOWS_INSTALL_RUNBOOK.md` and `windows-pilot/scripts`.

Read-only first:

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
```

After install:

- app launches from shortcut;
- Gateway live;
- provider/model coherent;
- Office parser smoke passes;
- Outlook/Forms CDP probes pass;
- ASR helper exists or ASR is documented as best-effort.

## Failure Classes

- `Cannot find module 'playwright-core'`: runtime dependency misclassified.
- Whisper not found: Windows ASR helper or fallback chain missing.
- Gateway stuck: provider/runtime drift or cloud network issue.
- New Chrome not logged in: CDP/profile mismatch, not a package problem.
