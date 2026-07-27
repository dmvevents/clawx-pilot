---
name: pilot-ssh-ops
description: Safe patterns for running PowerShell on the Windows pilot via SSH multiplexer. Avoids the escaping landmines that bite us repeatedly.
metadata:
  os: mac (caller); windows (target)
  pilot-shell: PowerShell 5.1
  ssh-host: pilot (alias for vyonix@169.254.46.90, multiplexed)
---

# Pilot SSH operations

## When to use

Any time you're about to run something on the pilot via `ssh pilot '...'`. Read this first. The escaping issues here have eaten 30+ minutes of debugging across past sessions.

## The golden rule

**Don't inline-quote PowerShell. Write a `.ps1` file, scp it, run it.**

```bash
# BAD (escaping eats the command silently or partially):
ssh pilot 'powershell -NoProfile -c "Get-Process | Where-Object { $_.Name -match \"chrome\" }"'

# GOOD:
cat > /tmp/probe.ps1 <<'PS1'
Get-Process | Where-Object { $_.Name -match "chrome" } | Select-Object Name, Id
PS1
scp -q /tmp/probe.ps1 pilot:/Users/vyonix/probe.ps1
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File C:/Users/vyonix/probe.ps1'
```

The HEREDOC (`<<'PS1'`) with **single-quoted delimiter** is the key — bash + zsh do NOT expand `$_`, `$env:`, `$$`, etc. inside it. The remote `powershell -File` then interprets the script natively. No layered escaping.

## SSH multiplexer

`~/.ssh/config` has:
```
Host pilot
  HostName 169.254.46.90
  User vyonix
  ControlMaster auto
  ControlPath ~/.ssh/cm/%r@%h:%p
  ControlPersist 30m
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
```

First `ssh pilot ...` → ~0.3s (TCP + auth handshake).
Subsequent calls within 30 min → ~50ms (reuses the master connection).

If a call hangs >5s on a previously-fast multiplexer, the master may have died. Force a new master:
```bash
ssh -O exit pilot 2>/dev/null  # tear down the dead master
ssh pilot 'echo ok'             # establishes new master
```

## Path conventions

- The pilot user is `vyonix` (lowercase in path strings, sometimes `VYONIX` in env).
- Home directory in `scp` paths: `/Users/vyonix/` (treat Windows like POSIX for SSH).
- In PowerShell scripts, use `$env:USERPROFILE`, `$env:LOCALAPPDATA`, `$env:APPDATA` — these are robust across user-name variants.
- Never hardcode `C:\Users\vyonix\` inside scripts. Use `$env:USERPROFILE`.

## Idempotent script template

Every `windows-pilot/scripts/*.ps1` follows this shape:

```powershell
# pilot-do-thing.ps1 — what this does
# Idempotent: safe to run repeatedly.
# Read-only: <yes/no — explicitly call out>
$ErrorActionPreference = "Stop"

function Probe { ... }   # read-only checks
function Apply { ... }   # the change (skip if $script:DryRun)

$state = Probe
if ($state.AlreadyDone) {
    "STATE: ALREADY_DONE"
    exit 0
}

Apply
$verify = Probe
if (-not $verify.AlreadyDone) {
    "STATE: VERIFY_FAILED"
    exit 1
}
"STATE: APPLIED"
exit 0
```

The agent reading the output greps for `STATE:` and routes accordingly.

## Read-only vs. mutating

Tag every script with one of:
- `# Read-only: yes` — only `Get-*`, `Test-*`, `Invoke-WebRequest`, no `Set-*` / `New-*` / `Stop-Process` / `Start-Process` (except probes that fail-fast).
- `# Read-only: no` — explicitly mutating; the script must be idempotent.

The plan's Phase 0 should ONLY run read-only scripts. The agent who chooses to run a mutating script asserts "I have permission" before invoking.

## Quoting cheat sheet (PowerShell-side, NOT bash-side)

```powershell
# Single quotes = literal. No interpolation. SAFE for matchers.
Where-Object { $_.Name -match 'Ministry|Education' }

# Double quotes = interpolation. Use for $env: + computed strings.
$exe = "$env:LOCALAPPDATA\Programs\Ministry of Education\Ministry of Education.exe"

# Backtick + n / r / t for newlines / tabs (NOT \n).
$msg = "line1`nline2"
```

## SSH-over-bash escaping cheat sheet (when you MUST inline)

If you have to inline (e.g., one-liner CI shell), the rules are:

1. Outer wrapper: single quotes — bash doesn't interpolate.
2. Inside: PowerShell sees the bytes. Write PS-native syntax.
3. PowerShell single-quoted strings cannot contain literal single quotes. Use `''` (doubled) to escape.

```bash
ssh pilot 'powershell -NoProfile -c "Get-Process | Where-Object { $_.Name -match ''chrome'' }"'
#                                                                              ^^                ^^
#                                                                              two single-quotes = one literal
```

This is ugly. **Prefer the HEREDOC pattern above.**

## Common pitfalls

| Bug | Cause | Fix |
|---|---|---|
| Empty stdout, no errors | Bash ate `$_` or `$env:` before SSH sent it | HEREDOC `.ps1` |
| `Unexpected token '||'` | bash pipe inside double-quoted PS string | Use single quotes for the matcher |
| Output truncated mid-line | `Out-String -Stream` not used; PS native record | Pipe through `| Out-String` once at the end |
| `Could not find a part of the path` | Forward slashes in literal Windows path | Use `$env:` vars; PS accepts `/` in most places |
| `Execution policy ...` | Default ExecutionPolicy = Restricted | Always invoke with `-ExecutionPolicy Bypass` |
| `Stop-Process: Cannot find a process with the name` | Strict mode | Use `-ErrorAction SilentlyContinue` |

## Cross-references

- Multiplexer config: `~/.ssh/config` on Mac
- Runbook usage: `docs/WINDOWS_INSTALL_RUNBOOK.md`
- Scripts that follow this pattern: `windows-pilot/scripts/*.ps1`
