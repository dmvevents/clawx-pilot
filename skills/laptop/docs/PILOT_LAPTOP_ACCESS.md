# Pilot Laptop Access (Windows) — Operator Setup

> Temporary operator-only page. Lets the build host reach the pilot laptop over the LAN to install ClawX, run smoke tests, and tear down again.
>
> Last reviewed: **2026-05-21**.

There are two halves: (A) get the **installer** onto the laptop, and (B) optionally enable **SSH** so the operator can drive the laptop from the Mac.

If LAN sharing fails, **(C)** is the USB fallback.

---

## A · Get the .exe onto the laptop

Two routes. Try them in order.

### A.1 — Direct download from the public release (works if internet is up)

Open **Edge** on the Windows laptop and paste:

```
https://github.com/dmvevents/clawx-pilot/releases/download/v0.4.3-moe.1/Ministry.of.Education-0.4.3-win-x64.exe
```

After download, in **PowerShell** (Start → `powershell` → Enter):

```powershell
certutil -hashfile "$env:USERPROFILE\Downloads\Ministry of Education-0.4.3-win-x64.exe" SHA256
```

Expected hash:

```
b0fffd18325ac530d7c33a9a5fc89ef7fa180fda2bc73e9417a6ee8908b6d52b
```

If the hash matches, skip to §D ("Install").

### A.2 — LAN transfer from the Mac (if internet is restricted)

The build host (operator's Mac) is currently serving the .exe at:

```
http://172.20.3.0:8765/
```

Open that URL in **Edge** on the Windows laptop and click `Ministry of Education-0.4.3-win-x64.exe` to download.

If the page **fails to load**:

```powershell
# 1. Confirm the laptop is on the same subnet as the Mac
ipconfig | findstr "IPv4"
# IPv4 should start with 172.20. — if it doesn't, you're on a different SSID/VLAN

# 2. Confirm port 8765 is reachable
Test-NetConnection -ComputerName 172.20.3.0 -Port 8765
# Look for: TcpTestSucceeded : True
```

If `TcpTestSucceeded : False`:

```powershell
# Temporarily allow outbound from this laptop (Defender Firewall)
# Run as Administrator (Start → "PowerShell" → right-click → Run as administrator)
Set-NetFirewallProfile -Profile Public -Enabled False
# … retry the download …
# RESTORE WHEN DONE:
Set-NetFirewallProfile -Profile Public -Enabled True
```

> **Don't leave the firewall off**. Re-enable as soon as the download finishes.

---

## B · Optional: SSH access from the Mac

Lets the operator drive the laptop without leaning over your shoulder.

### B.1 — Install OpenSSH Server (Admin PowerShell)

Open **PowerShell as Administrator** (right-click PowerShell → Run as administrator):

```powershell
# Install the OpenSSH Server feature (idempotent)
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Start the service and set it to autostart
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'

# Open inbound port 22 in the firewall
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' `
  -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22

# Confirm it's running and listening
Get-Service sshd
Get-NetTCPConnection -LocalPort 22 -State Listen
```

Expected:

- `Get-Service sshd` → `Status : Running`
- `Get-NetTCPConnection ... 22 ... Listen` → at least one row

### B.2 — Confirm your Windows username

```powershell
whoami
```

Output looks like `desktop-abc123\anton`. Send the operator the part **after the backslash**.

### B.3 — Set a password for the local account (if you only sign in with a PIN)

Settings → Accounts → Sign-in options → **Password** → Add.

SSH cannot use a Windows Hello PIN.

### B.4 — Operator connects from the Mac

```bash
ssh <windows-username>@172.20.8.45
```

You'll be prompted for the Windows password locally — the operator never sees it.

### B.5 — (Recommended) Switch to key auth after the first login

On the Windows laptop, after the operator's first password login:

```powershell
# Create the .ssh dir if missing
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.ssh" | Out-Null

# Paste the operator's public key into authorized_keys
# (operator will send their ed25519 pubkey)
notepad "$env:USERPROFILE\.ssh\authorized_keys"

# Tighten permissions so OpenSSH accepts the file
icacls "$env:USERPROFILE\.ssh\authorized_keys" /inheritance:r
icacls "$env:USERPROFILE\.ssh\authorized_keys" /grant:r "$($env:USERNAME):F"
```

If you're an **Administrator** account on the laptop, OpenSSH on Windows reads admin keys from `C:\ProgramData\ssh\administrators_authorized_keys` instead — paste the same key there, then:

```powershell
icacls "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r
icacls "C:\ProgramData\ssh\administrators_authorized_keys" /grant SYSTEM:F /grant BUILTIN\Administrators:F
Restart-Service sshd
```

### B.6 — Tear down when done

```powershell
Stop-Service sshd
Set-Service -Name sshd -StartupType 'Disabled'
Remove-NetFirewallRule -Name sshd
```

---

## C · Fallback: USB stick

If both LAN and SSH are blocked by site policy:

1. On the Mac (build host), copy `release/Ministry of Education-0.4.3-win-x64.exe` to a USB stick.
2. Plug into the laptop.
3. Copy to `C:\Users\<you>\Downloads\`.
4. Verify the SHA-256 (see §A.1).

---

## D · Install (after any of A/C)

Double-click the .exe.

- **SmartScreen will warn** that Windows protected your PC — click **More info → Run anyway** (the installer is unsigned during pilot).
- Accept the default install location.
- Finish.

First launch:

- The gateway boots on `127.0.0.1:18789`
- The seeder writes a valid `~/.openclaw/openclaw.json` skeleton
- 17 pre-installed skills materialise under `%USERPROFILE%\.openclaw\skills\`

Then proceed to:

- [`FIRST_RUN_GUIDE.md`](./FIRST_RUN_GUIDE.md) §1 — Ollama + `hermes3:8b` pre-flight
- [`ANTHROPIC_SETUP.md`](./ANTHROPIC_SETUP.md) — wire up Claude as cloud failover

---

## E · Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `Test-NetConnection` says `TcpTestSucceeded : False` | Defender Firewall blocking outbound on Public profile | Temporarily disable Public profile (§A.2). Re-enable after. |
| Edge shows "can't reach this site" for `http://172.20...` | Wi-Fi has client isolation enabled (common on guest SSIDs) | Switch to a non-guest SSID, or use USB (§C) |
| `ssh` from Mac hangs at "kex_exchange_identification" | Windows firewall blocking inbound 22 | Re-run the `New-NetFirewallRule` line in §B.1 |
| `ssh` says "Permission denied (password)" | PIN-only account; SSH needs a password | §B.3 |
| Windows Hello PIN works but SSH password fails | Same as above | §B.3 |
| `certutil -hashfile` returns a different hash | Truncated download or wrong file | Retry; if persistently wrong, alert the operator |

---

## F · Tear-down (when the laptop is being repurposed)

```powershell
# Disable SSH server
Stop-Service sshd
Set-Service -Name sshd -StartupType 'Disabled'
Remove-NetFirewallRule -Name sshd

# Re-enable firewall if it was disabled in §A.2
Set-NetFirewallProfile -Profile Public -Enabled True
Set-NetFirewallProfile -Profile Private -Enabled True
Set-NetFirewallProfile -Profile Domain -Enabled True

# Uninstall ClawX (preserves user data in %USERPROFILE%\.openclaw\)
# Settings → Apps → "Ministry of Education" → Uninstall
# Then if you want a clean wipe:
Remove-Item -Recurse -Force "$env:USERPROFILE\.openclaw"
```

---

## Cross-references

- Distribution: [`WINDOWS_DEPLOY.md`](./WINDOWS_DEPLOY.md)
- First-run on the principal's account: [`FIRST_RUN_GUIDE.md`](./FIRST_RUN_GUIDE.md)
- Cloud provider wiring: [`ANTHROPIC_SETUP.md`](./ANTHROPIC_SETUP.md)
- Production gate: [`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md)
