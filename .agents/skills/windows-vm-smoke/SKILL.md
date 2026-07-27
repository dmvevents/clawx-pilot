---
name: windows-vm-smoke
description: Run clean Windows install, VM, or physical laptop smoke validation for the Ministry of Education app after a Windows installer build, release candidate, GA bug bash, or package/runtime fix. Covers installer download/hash verification, silent install, desktop shortcut launch, Gateway and Host API readiness, Electron/Chrome CDP probes, packaged runtime artifacts, Office helper checks, ASR helper smoke, Outlook/Forms no-send/no-submit probes, artifact collection, and redacted evidence updates.
---

# Windows VM Smoke

## Objective

Prove the installed Windows app path from a clean environment. Unit tests and local package inspection are not enough for GA.

## First Reads

- `docs/WINDOWS_INSTALL_RUNBOOK.md`
- `docs/CURRENT_WINDOWS_RC.md`
- `docs/GA_RELEASE_EVIDENCE_MANIFEST.md`
- `docs/WINDOWS_PROBLEMS_ATLAS.md`
- `.agents/skills/windows-build-package/SKILL.md`
- `.agents/skills/windows-runtime-recovery/SKILL.md`
- `.agents/skills/windows-outlook-forms/SKILL.md`

## Smoke Ladder

Use the highest available rung:

1. Local package inspection: `release/win-unpacked` and `windows-pilot/scripts/pilot-check-install-artifacts.ps1`.
2. GCP Windows VM or UTM Windows VM clean user.
3. Physical pilot laptop over SSH/WinRM.
4. External tester only after a VM or laptop smoke is green/yellow with documented limitations.

## Required Checks

- Installer SHA256 matches `docs/CURRENT_WINDOWS_RC.md`.
- Prior app/process state is stopped and user state is backed up before mutation.
- Silent install exits `0`.
- Desktop and Start Menu shortcuts exist.
- `resources/app.asar`, `resources/openclaw/node_modules/playwright-core/package.json`, `resources/bin/ffmpeg.exe`, and `resources/bin/WinSpeechRecognize.exe` exist.
- Cloud gateway seed exists when the package is intended to be online-first.
- Azure Speech seed or explicit ASR deferral is recorded.
- Gateway and Host API become reachable.
- Electron CDP probe can invoke Host API routes.
- Chrome CDP probe reports signed-in state or a clear sign-in-required diagnostic.
- Outlook and Forms probes stay no-send/no-submit unless exact same-session confirmation is assigned.
- Office runtime checks prove parser/helper availability.
- ASR smoke proves bundled ffmpeg/native recognizer or records the exact fallback blocker.

## Commands

Prefer the checked-in scripts over ad hoc commands:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows-pilot/scripts/pilot-check-install-artifacts.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File windows-pilot/scripts/pilot-run-installed-gateway-smoke.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File windows-pilot/scripts/pilot-launch-and-run-cdp-smoke.ps1 -OutlookOnly
powershell -NoProfile -ExecutionPolicy Bypass -File windows-pilot/scripts/pilot-office-runtime-check.ps1
```

For VM runners, upload scripts into the test user's Downloads folder and record the output directory path. Do not print passwords or raw tokens from the VM bootstrap.

## Evidence

Update `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` with:

- VM/laptop name and date.
- Installer SHA256.
- Install exit code.
- Artifact probe JSON path.
- Gateway/Host API/CDP smoke output path.
- Office/ASR smoke output path.
- Outlook/Forms result as `PASS`, `SIGN_IN_REQUIRED`, `REFUSED_WITHOUT_CONFIRM`, or `BLOCKED`.
- Redaction note confirming no keys, key hashes, private URLs, email bodies, or full recipient lists were printed.

## Stop Condition

Stop when the VM/laptop smoke has enough evidence to mark the clean-install gate green/yellow/red in the evidence manifest. Do not publish or tag from this skill; hand off to `ga-release-readiness`.
