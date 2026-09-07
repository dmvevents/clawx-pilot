---
name: pilot-ssh-ops
description: Use safe SSH and PowerShell patterns for the Windows pilot laptop, including read-only probes, copying scripts, avoiding shell quoting failures, and preserving user state.
---

# Pilot SSH Operations

## Rule

Prefer copying a `.ps1` script and running it with `powershell -File`. Do not inline complex PowerShell through nested shell quoting.

## First Probe

```bash
ssh pilot 'echo ok'
```

Then run read-only scripts:

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-verify-outlook-tab.ps1"'
```

## Script Copy Pattern

```bash
scp windows-pilot/scripts/pilot-probe-state.ps1 pilot:/Users/vyonix/
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/pilot-probe-state.ps1'
```

## Mutating Scripts

Before mutating Windows state:

- capture read-only state;
- back up `%APPDATA%\Ministry of Education`;
- back up `%USERPROFILE%\.openclaw`;
- state exactly what will change;
- avoid printing secrets.

## References

- `windows-pilot/skills/pilot-ssh-ops.md`
- `docs/WINDOWS_INSTALL_RUNBOOK.md`
- `docs/PILOT_LAPTOP_ACCESS.md`
