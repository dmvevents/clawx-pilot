# UTM Windows 11 ARM64 Setup for moe.5 Testing

## Why UTM, why ARM64

Apple Silicon Macs can't run x64 Windows natively at any reasonable
speed. UTM with Windows 11 ARM64 + Microsoft's built-in x64 emulation
runs Electron NSIS installers cleanly. We've used this pattern in
prior MoE pilot test cycles.

UTM.app is already installed at `/Applications/UTM.app`. No license
or paid subscription required.

## One-time setup (~45 min)

### 1. Get the Windows 11 ARM64 ISO

Microsoft requires a captcha for direct download. From the Mac:

1. Open https://www.microsoft.com/software-download/windows11arm64 in a browser
2. Select "Windows 11 (multi-edition ARM64 ISO)"
3. Choose language: English
4. Click "64-bit Download"
5. Save to `~/Downloads/Win11_ARM64.iso` (~5 GB, takes 10-20 min on
   typical connection)

### 2. Create the UTM VM

Open UTM. Click "Create a New Virtual Machine" → "Virtualize" →
"Windows".

Settings:
- **Boot ISO**: `~/Downloads/Win11_ARM64.iso`
- **Hardware**: 4 GB RAM, 4 CPU cores
- **Drives**: 64 GB virtual disk (dynamic). Plenty for Windows + ClawX
  + Ollama + qwen2.5:3b-instruct
- **Sharing**: Enable "Shared Directory" → point at
  `/Users/antonalexander/Github/moe-tt/ClawX/release` so the VM can
  see the freshly-built `.exe` without needing to copy
- **Networking**: Default (NAT) is fine; the VM can reach the host's
  127.0.0.1 services via the auto-assigned bridge IP if we need it
- **Display**: 1920x1080 minimum (Outlook Web is dense)

### 3. Install Windows

Boot the VM. Standard Windows OOBE:
- Region: Trinidad and Tobago (matches pilot)
- Skip Microsoft account when possible — use a local "ClawXTest" account
  to keep the VM disposable
- Skip telemetry / Cortana / OneDrive prompts

Once at desktop, snapshot the VM in UTM (right-click → Save State or
clone for re-runs).

### 4. Install runtime deps

In an Admin PowerShell on the VM:

```powershell
# Chrome (the v2 driver expects system Chrome, not Edge)
winget install --id Google.Chrome -e --accept-source-agreements --accept-package-agreements --silent

# Ollama (matches pilot)
winget install --id Ollama.Ollama -e --silent

# Pull the local model
ollama pull qwen2.5:3b-instruct

# OpenSSH server (for scp/ssh from Mac later)
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

### 5. Snapshot

UTM → Edit → Snapshots → "Pre-ClawX install". Restore here for any
re-run instead of rebuilding the VM from scratch.

## Per-build install loop (~2 min)

Once the VM is set up, every moe.X iteration is:

1. Build on Mac: `pnpm build:win` (~3 min)
2. Copy to VM via the shared folder (already mounted) or scp
3. In VM: `Start-Process -FilePath $exe -ArgumentList '/S' -Wait`
4. Run the v2 smoke test:

```powershell
# Match the v2 smoke we run on Mac
$env:GEMINI_API_KEY = "<paste at first run>"
& "$env:LOCALAPPDATA\Programs\Ministry of Education\Ministry of Education.exe"
```

5. Watch the install logs in `%APPDATA%\Ministry of Education\logs\`

## Network hop: VM → Mac for VLM/agent

If the VM has internet (NAT), it reaches the public Gemini and chat APIs
fine. If not (offline pilot scenario), point the VM at the host Mac via
the auto-bridge IP (Mac side: `ifconfig en0 | grep inet` → use that IP
in Windows env vars).

## Why this is cheaper than the pilot SSH cycle

- Pilot Cat-5 link is intermittent
- Each pilot reinstall takes ~5 min (kill processes, scp, install,
  smoke). Plus the SSH overhead.
- UTM: install ≈ 30 sec, smoke ≈ 1 min. Same fidelity for our test
  surface (Electron NSIS install, Chrome session, Outlook DOM).

## When UTM stops being enough

- **GPU-dependent paths**: UTM ARM64 doesn't expose the host GPU. If we
  ever care about Electron's hardware-accelerated rendering for the
  pilot, we still need the real x64 laptop.
- **Network fingerprinting**: if Microsoft Conditional Access blocks
  the VM's IP/User-Agent for some reason, the live Outlook test won't
  work. Drop back to the pilot for that specific check.

For everything else (config validation, plugin registration, gateway
boot, host-API routing, basic v2 actions), UTM is the right tool.
