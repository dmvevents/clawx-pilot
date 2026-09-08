---
name: windows-local-vm-testing
description: Plan, run, or document local Windows VM testing for ClawX Ministry installers from a Mac, distinguishing local UTM/Windows guests from Mac emulation and the GCP VM.
metadata:
  os: mac/windows
  related-docs: docs/testing/WINDOWS_LOCAL_VM_TESTING.md, windows-pilot/vm-testing/README.md, docs/PROJECT_CONTRACT.md
---

# Windows local VM testing

Use this skill when work involves a local Windows VM lane for ClawX / Ministry installer or runtime validation. The goal is to produce honest Windows diagnostic evidence without confusing three different layers:

- Mac Windows-like emulation and source tests.
- A local hypervisor guest such as UTM Windows 11 ARM64.
- The current remotely controlled GCP Windows VM.

Read `docs/testing/WINDOWS_LOCAL_VM_TESTING.md` before giving commands or interpreting evidence.

## Operating boundaries

- Honor current and standing owner authorization for VM testing; do not invent a new confirmation gate for routine reversible test steps that are already authorized. If mutation authority is absent or disputed, stop before the mutation and report the blocker.
- Keep one VM mutator responsible for app, Gateway, Chrome, setup bundle, install, upgrade, profile backup, and guest file transfer changes; coordinate through that owner so two agents do not mutate the same guest concurrently.
- Read-only checks may inspect local hypervisor availability, repo scripts, and existing evidence, but do not scan broad private directories or export private logs.
- Never log credentials, Host API tokens, private Form URLs, email bodies, full recipient lists, raw private logs, or Chrome command lines.
- No Outlook send, Forms submit, attachment download, or stakeholder message without explicit same-session confirmation for that action.

## Evidence language

Use explicit statuses:

- `AVAILABLE PREREQUISITE` when UTM/QEMU or another hypervisor exists but no guest run was verified.
- `NOT_RUN` when no local guest evidence exists for a criterion.
- `PASS` only with dated artifact/environment evidence.
- `FAIL` with the exact failing command, output path, candidate hash, and environment.
- `BLOCKED` when missing authorization, missing VM, missing credentials, or unavailable interactive session prevents progress.

A cloud VM PASS is not a local VM PASS. A local VM PASS is not stakeholder or physical-laptop acceptance.

## Preferred workflow

1. Bind the exact source SHA, installer SHA, ASAR SHA, version, and build profile.
2. Stage the installer and reviewed `windows-pilot/scripts` bundle from the selected source SHA through the single VM mutator.
3. Capture guest environment before install or repair.
4. Back up `%APPDATA%\Ministry of Education` and `%USERPROFILE%\.openclaw` or record their absence.
5. Use the normal visible installer for acceptance; keep silent `/S` as diagnostic-only evidence and record the command or interactive action summary.
6. Verify installed app files/resources with the staged probes.
7. Launch the real installed desktop shortcut in an interactive Windows session.
8. Check Gateway/composer readiness and Electron Host API bridge before model-driven journeys.
9. Run first Online turn, warm Online turn, and document journeys; keep Outlook/Forms no-send/no-submit gates active.
10. Defer ASR quality unless the run is explicitly scoped to audio; helper presence alone is narrower evidence.
11. Return a redacted receipt with candidate, environment, backup, install, runtime, and journey evidence paths.

Prefer existing scripts under `windows-pilot/scripts/` and current candidate manifests over invented commands. If adapting a historical script, state what was changed and why before treating the output as current evidence.

## Checked command surfaces

Before issuing a local VM command, read the helper's current `param(...)` block. The September 8 2026 runbook examples are checked against these scripts:

- `pilot-fresh-install-environment.ps1` for `-Mode Probe`, `-ArtifactRoot`, `-InstallerPattern`, `-JsonOutputPath`, and `-OpenSandbox`.
- `pilot-run-silent-install.ps1` for diagnostic-only unattended runs with `-InstallerPath`, `-TimeoutSeconds`, `-EvidenceRoot`, `-InstallerArgs`, and optional `-StopRunningApp`; pass `-InstallerArgs` as a real PowerShell array from an active PowerShell process.
- `pilot-check-install-artifacts.ps1` for installed app, ASAR, shortcuts, ffmpeg, ASR helper, and packaged resource inventory.
- `pilot-office-runtime-check.ps1` and `pilot-office-write-smoke.ps1` for packaged document dependency load/write proof.
- `pilot-shell-launch-shortcut.ps1`, `pilot-launch-and-run-cdp-smoke.ps1`, and `pilot-run-electron-cdp-probe.ps1` for desktop shortcut launch, Electron CDP, Host API, Gateway, and Outlook/Forms no-send/no-submit probes through the installed app path. `pilot-launch-cdp-task.ps1` is isolated Chrome/CDP diagnostic only because it uses a separate demo profile, so it is not final Microsoft tenant proof.
- `pilot-run-chat-turn.ps1` for first and warm ordinary chat turns with expected channel, terminal quiet window, and redacted evidence output.

Do not claim a command was executed unless there is a returned artifact, transcript, or exit status for that run.
