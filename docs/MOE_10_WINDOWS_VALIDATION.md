# moe.10 Windows validation — 2026-05-26

Static + CI-runtime validation of the moe.10 Windows installer. Built on `windows-latest` GitHub Actions runner from commit `3d2a3b0` (HEAD includes all forms reverse-engineering work, runtime-client, captured submit shape, 4 new auditor sub-agents).

## Score: 8 PASS / 2 WARN / 0 FAIL

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Top-level deps install (`pnpm install`) | PASS | step ✓ |
| 2 | Bundled Windows binaries (`uv` + `node`) downloaded | PASS | step ✓ |
| 3 | `pnpm run package:win` (electron-builder NSIS x64) | PASS | step ✓ |
| 4 | NSIS installer artifact created | PASS | `Ministry of Education-0.4.3-moe.10-win-x64.exe` |
| 5 | Silent install to `%LOCALAPPDATA%\Programs\Ministry of Education\` | PASS | step ✓, install dir verified |
| 6 | `app-update.yml` correctly absent (pilot-mode) | PASS | `publish: null` held |
| 7 | No `google-query-key` enum reseed in build artefacts | PASS | `badEnumHit: false` |
| 8 | No openclaw.json clobber-guard fired during install | PASS | `clobberHit: false` |
| 9 | Gateway port 18789 listening after launch | WARN | runner Session 0 limitation |
| 10 | Host-API port 13210 listening after launch | WARN | runner Session 0 limitation |

## What WARN means here

Items 9-10 are checked by launching the installed `.exe` on a windows-latest runner and probing for ports. The probe times out after 180s with 0 bytes of stdout/stderr.

This is **not a moe.10 regression** — it's a known limitation of GitHub-hosted Windows runners. They run in Session 0 (non-interactive desktop), where GUI Electron apps may launch but Chromium's main process stalls before completing initialization (no display device, no clipboard, no DWM). We hit this same outcome on three prior runs (moe.8, moe.9 first attempt, moe.9 second attempt) and documented it in `.github/workflows/windows-smoke.yml`:

> Verified across runs … GitHub-hosted windows-latest runners cannot complete GUI Electron boot. Process stays alive but app.whenReady() never fires (no userData, no stdout, no stderr, no ports). Session 0 / non-interactive desktop session blocks Chromium init. This is not a build problem — it's a runner-environment limitation.

## What changed vs moe.9 validation

| | moe.8 | moe.9 | **moe.10** |
|---|---|---|---|
| Build | PASS | PASS | PASS |
| Install | PASS | PASS | PASS |
| Mac Mac binaries leak | 67 MB stowaways | fixed | **fixed** |
| `playwright-core` available at runtime | n/a | broken (devDep) | **fixed (runtime dep)** |
| google-query-key reseed | n/a | n/a | **clean** |

## What this report can prove

- The new moe.10 .exe **builds and installs cleanly** with all today's commits including the new forms work.
- The packaging fixes from moe.7 (atomic writes), moe.8 (publish:null), moe.9 (Mac native cleanup), moe.10 (playwright-core runtime dep) all hold.
- No new regressions in the build/install path.

## What this report cannot prove

- The .exe actually launches a UI on a real Windows session
- Gateway boots cleanly on first run
- The 11 Outlook tools register against the live gateway
- The new forms.* tools work on Windows (the code is platform-agnostic; same `chromium.connectOverCDP` path Mac uses)
- The local LLM (Ollama) is reachable

These all need **either** the Cat-5 link to the pilot laptop **or** a Windows 11 VM. Both unblockers were noted in moe.8 validation; both still apply.

## Commit lineage

- HEAD `3d2a3b0` — docs(demo): Windows pre-flight section
- `6ae18d8` — investigation(forms): API submit Bearer attachment status
- `3de77c2` — runtime-client wired to captured shape
- `a7e7623` — captured runtime submit-API shape
- `5e84d49` — DOM auto-fill 30/31 + key learnings
- `97cc6c4` — API-only submit client + Daily Report schema
- `9449d78` — regression-class sub-agents + hard rules
- `eb735c1` — feat(forms): Microsoft Graph + SharePoint List path
- `e26a702` — fix(packaging): playwright-core must be a runtime dep, not devDep

## Build artefacts

- Workflow run: https://github.com/dmvevents/clawx-pilot/actions/runs/26427577195
- Installer: downloadable for 7 days via `gh run download 26427577195 --repo dmvevents/clawx-pilot --name windows-installer-x64`
- Smoke logs: `gh run download 26427577195 --repo dmvevents/clawx-pilot --name smoke-logs`
