---
name: pilot-ssh-ops
description: Use safe SSH and PowerShell patterns for the Windows pilot laptop, including read-only probes, script copy/run flow, no-secret logging, and preserving user state during installation and debugging.
---

# Pilot SSH Operations

## Rule

Prefer checked-in PowerShell scripts over complex inline SSH quoting. Keep probes read-only unless the task explicitly authorizes mutation.

## First Probe

```bash
ssh pilot 'powershell -NoProfile -Command "$PSVersionTable.PSVersion; whoami; hostname"'
```

Then use the repo scripts:

```bash
scp windows-pilot/scripts/pilot-probe-state.ps1 pilot:
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
```

## Mutating Scripts

Before install, uninstall, config repair, or app restart:

1. State the target change and expected validation artifact.
2. Back up `%APPDATA%\Ministry of Education` and `%USERPROFILE%\.openclaw`.
3. Avoid printing secrets, tokens, URLs containing private IDs, email body text, or recipient lists.
4. Report the script path, exit status, and artifact locations.

## References

- `docs/PILOT_LAPTOP_ACCESS.md`
- `docs/WINDOWS_INSTALL_RUNBOOK.md`
- `windows-pilot/README.md`
