# pilot-vm-startup-repair.ps1
#
# GCE Windows instance startup script for the QA lane. Deploy with:
#   python3 -c "..." # splice ~/.ssh/google_compute_engine.pub over the
#   placeholder below, then: gcloud compute instances add-metadata <vm> \
#     --metadata-from-file windows-startup-script-ps1=<spliced file>
#
# The key is spliced at deploy time and never committed: this repository has
# a public mirror.
#
# Why this exists: the previous revision authorized the operator key ONLY in
# administrators_authorized_keys, which sshd consults exclusively for members
# of the Administrators group. When the local account was missing, correct key
# material still produced 'Permission denied (publickey,...)', and that was
# misrecorded as an operator-held-password dependency for days.
#
# It also creates a disposable STANDARD-USER acceptance account with auto-logon,
# because the app is an Electron GUI and installed acceptance needs a real
# interactive session on every boot. That account's password is generated here
# and never leaves the machine.
#
# NOTE the 8-hour auto-shutdown below is a deliberate cost guard, not a fault.
# It is what ended earlier hand-made QA sessions. Start runs from a fresh boot.

$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path "C:\clawx-smoke" | Out-Null
Start-Transcript -Path "C:\clawx-smoke\startup.log" -Append

# Cost guard retained deliberately at its original 8 hours. It is NOT a fault:
# this is what ended the earlier QA session, and the fix is to know about it and
# start runs from a fresh boot, not to quietly weaken the guard.
shutdown.exe /s /t 28800 /c "ClawX Windows RC test VM auto-shutdown after 8 hours"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$chromeMsi = "C:\clawx-smoke\googlechromestandaloneenterprise64.msi"
try {
  if (-not (Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe")) {
    Invoke-WebRequest -Uri "https://dl.google.com/chrome/install/googlechromestandaloneenterprise64.msi" -OutFile $chromeMsi -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$chromeMsi`" /qn /norestart" -Wait
  }
  Write-Host "Chrome install attempted"
} catch { Write-Host "Chrome install failed: $($_.Exception.Message)" }

try {
  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction SilentlyContinue
  Start-Service sshd
  Set-Service -Name sshd -StartupType Automatic
  New-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -ErrorAction SilentlyContinue
  Write-Host "OpenSSH enable attempted"
} catch { Write-Host "OpenSSH enable failed: $($_.Exception.Message)" }

# --- Operator SSH repair -----------------------------------------------------
# The previous script authorized the operator key ONLY in
# administrators_authorized_keys, which sshd consults exclusively for members of
# the Administrators group. If the local account is missing or non-admin, key
# auth fails with "Permission denied (publickey,...)" even though the key is
# correct - which is exactly the observed failure. Ensure the account exists, is
# an administrator, and also carries the key in its own profile so either sshd
# path succeeds.
$pub = 'ssh-rsa OPERATOR_PUBLIC_KEY_PLACEHOLDER antonalexander@Antons-MacBook-Pro.local'
$opUser = 'antonalexander'
try {
  $existing = Get-LocalUser -Name $opUser -ErrorAction SilentlyContinue
  if (-not $existing) {
    # Random throwaway: key auth is the only intended login path for this
    # account, so the password is never used, never printed and never exported.
    $chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@$%*-_"
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $pw = -join ($bytes | ForEach-Object { $chars[[int]$_ % $chars.Length] })
    New-LocalUser -Name $opUser -Password (ConvertTo-SecureString $pw -AsPlainText -Force) `
      -FullName "ClawX operator (key auth only)" -PasswordNeverExpires -ErrorAction Stop | Out-Null
    Write-Host "operator account created"
  } else {
    Write-Host "operator account already present"
  }
  Add-LocalGroupMember -Group "Administrators" -Member $opUser -ErrorAction SilentlyContinue
  Write-Host ("operator admin membership: " + [bool](Get-LocalGroupMember -Group Administrators -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*\$opUser" }))

  $admKeys = "C:\ProgramData\ssh\administrators_authorized_keys"
  New-Item -ItemType Directory -Force -Path "C:\ProgramData\ssh" | Out-Null
  Set-Content -Path $admKeys -Value $pub -Encoding ascii
  icacls $admKeys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null

  # Per-profile copy so a non-admin fallback also works.
  $prof = "C:\Users\$opUser"
  if (Test-Path $prof) {
    New-Item -ItemType Directory -Force -Path "$prof\.ssh" | Out-Null
    Set-Content -Path "$prof\.ssh\authorized_keys" -Value $pub -Encoding ascii
    icacls "$prof\.ssh\authorized_keys" /inheritance:r /grant "${opUser}:F" /grant "SYSTEM:F" /grant "Administrators:F" | Out-Null
  }

  New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force | Out-Null
  Restart-Service sshd -ErrorAction SilentlyContinue
  Write-Host "operator key authorized for sshd"
} catch { Write-Host "sshd key authorize failed: $($_.Exception.Message)" }

# --- Acceptance desktop ------------------------------------------------------
# Every installed acceptance criterion needs a REAL interactive session: the app
# is an Electron GUI, and a scheduled task with an interactive principal returns
# SCHED_S_TASK_HAS_NOT_RUN when no session exists. Auto-logon creates one on
# every boot, which is what makes the run repeatable instead of hand-made.
#
# The acceptance account's password is generated HERE and never leaves the VM:
# nothing sensitive goes into instance metadata, gcloud history or a transcript.
$accUser = 'ClawXAcc0909'
try {
  if (-not (Get-LocalUser -Name $accUser -ErrorAction SilentlyContinue)) {
    $chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $bytes = New-Object byte[] 28
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $accPw = -join ($bytes | ForEach-Object { $chars[[int]$_ % $chars.Length] })
    New-LocalUser -Name $accUser -Password (ConvertTo-SecureString $accPw -AsPlainText -Force) `
      -FullName "ClawX acceptance (standard user)" -Description "Interactive acceptance desktop; disposable" `
      -PasswordNeverExpires -ErrorAction Stop | Out-Null
    Add-LocalGroupMember -Group "Users" -Member $accUser -ErrorAction SilentlyContinue

    # Standard user on purpose: the principal is not an administrator, so
    # acceptance must run without elevation.
    $wl = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
    Set-ItemProperty -Path $wl -Name AutoAdminLogon -Value "1" -Type String -Force
    Set-ItemProperty -Path $wl -Name DefaultUserName -Value $accUser -Type String -Force
    Set-ItemProperty -Path $wl -Name DefaultPassword -Value $accPw -Type String -Force
    Set-ItemProperty -Path $wl -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String -Force
    Remove-ItemProperty -Path $wl -Name AutoLogonCount -ErrorAction SilentlyContinue
    Write-Host "acceptance account created and auto-logon armed"
  } else {
    Write-Host "acceptance account already present; auto-logon left as configured"
  }
} catch { Write-Host "acceptance account setup failed: $($_.Exception.Message)" }

# Marker so the host can confirm which revision of this script actually ran.
Set-Content -Path "C:\clawx-smoke\startup-revision.txt" -Value "clawx-vm-startup-repair v1 $(Get-Date -Format o)" -Encoding ascii
Stop-Transcript
