---
name: windows-build-package
description: Build, package, install, and validate the ClawX/Ministry Windows app, including runtime dependencies, Windows ASR helper, NSIS installer, desktop shortcuts, and post-install smoke probes.
---

# Windows Build And Package

## Preflight

Read:

- `docs/WINDOWS_INSTALL_RUNBOOK.md`
- `docs/WINDOWS_PROBLEMS_ATLAS.md`
- `docs/GA_RELEASE_PLAN_2026-06-09.md`
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

This downloads Windows `uv`, Windows `node`, and builds the Windows ASR helper.

## Package

```bash
pnpm run build:win
```

## Install And Smoke

Use `windows-pilot/scripts` and `docs/WINDOWS_INSTALL_RUNBOOK.md`.

Minimum installed-app evidence:

- desktop shortcut launches the app;
- Gateway and Host API are live;
- provider/model stores are coherent;
- Office parser smoke passes on sample Excel/Word files;
- Outlook/Forms CDP probes pass without send/submit;
- ASR helper exists or ASR is clearly documented as best-effort.
