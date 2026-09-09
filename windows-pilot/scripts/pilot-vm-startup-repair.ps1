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

[CmdletBinding()]
param(
  # LOW-8: AutoAdminLogon stores the password in cleartext at
  # HKLM\...\Winlogon\DefaultPassword and nothing ever removes it, so any
  # snapshot, image or disk export of this machine carries a live credential for an
  # account that stays enabled. That is inherent to auto-logon and acceptable for a
  # disposable QA VM, but there has to be a way back. Run with -Disarm once the
  # receipts are off the machine.
  [switch] $Disarm
)

$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force -Path "C:\clawx-smoke" | Out-Null

if ($Disarm) {
  $wl = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
  foreach ($n in @('AutoAdminLogon', 'DefaultPassword', 'DefaultUserName', 'DefaultDomainName', 'AutoLogonSID', 'AutoLogonCount')) {
    Remove-ItemProperty -Path $wl -Name $n -ErrorAction SilentlyContinue
  }
  $after = Get-ItemProperty -Path $wl -ErrorAction SilentlyContinue
  Disable-LocalUser -Name 'ClawXAcc0909' -ErrorAction SilentlyContinue
  $acct = Get-LocalUser -Name 'ClawXAcc0909' -ErrorAction SilentlyContinue
  [ordered]@{
    disarmedAt = (Get-Date).ToUniversalTime().ToString('o')
    autoAdminLogonCleared = ($null -eq $after.AutoAdminLogon)
    defaultPasswordCleared = ($null -eq $after.DefaultPassword)
    acceptanceAccountEnabled = if ($acct) { $acct.Enabled } else { 'ABSENT' }
  } | ConvertTo-Json -Compress
  exit 0
}
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
    # Single-quoted deliberately: in a double-quoted string the '$%' sequence
    # invites the parser to look for a variable, and a silently shortened alphabet
    # would change the category arithmetic that the complexity guarantee relies on.
    $chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@$%*-_'
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
  # Append if absent rather than rewrite: this runs on every boot, and a rewrite
  # would silently remove any key another operator had added.
  $existingKeys = @()
  if (Test-Path $admKeys) { $existingKeys = @(Get-Content $admKeys -ErrorAction SilentlyContinue) }
  if ($existingKeys -notcontains $pub) {
    Set-Content -Path $admKeys -Value (@($existingKeys | Where-Object { $_ -and $_.Trim() }) + $pub) -Encoding ascii
  }
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
  $wl = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
  $existing = Get-LocalUser -Name $accUser -ErrorAction SilentlyContinue

  # Arm and VERIFY on every boot, not only when creating the account.
  #
  # This was observed failing in the field: after a session cycle, auto-logon did
  # not re-fire, the console session sat in "Conn" with no user, and Winlogon held
  # an AutoLogonSID value. Because the account already existed, re-running this
  # script would have taken a "leave as configured" branch and repaired nothing -
  # so the lane could lose its interactive session permanently with no operator
  # error, which is the exact state this script exists to prevent. Windows also
  # clears AutoAdminLogon/DefaultPassword on some failed-autologon paths, and the
  # password is deliberately unrecoverable, so "leave as configured" is not a safe
  # default: the only self-healing option is to set a fresh password and re-arm.
  $current = Get-ItemProperty -Path $wl -ErrorAction SilentlyContinue
  $armed = ($current.AutoAdminLogon -eq '1' -and $current.DefaultUserName -eq $accUser -and $current.DefaultPassword)
  Write-Host ("acceptance auto-logon armed on entry: " + [bool]$armed)

  $chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  $needPassword = -not $existing -or -not $armed

  if ($needPassword) {
    # Complexity must be GUARANTEED, not left to chance. A 28-character draw from
    # a 57-character alphanumeric alphabet has roughly a 1.5% chance of containing
    # no digit, which is only two of the four required categories and is rejected
    # outright by the local password policy. With auto-logon now re-arming on any
    # boot where it is found unarmed, that would be a recurring dice roll that
    # silently costs the lane its interactive session.
    $lower = 'abcdefghijkmnopqrstuvwxyz'
    $upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    $digit = '23456789'
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    function Get-RandomChar([string] $set) {
      $b = New-Object byte[] 1
      $rng.GetBytes($b)
      return $set[[int]$b[0] % $set.Length]
    }
    # One from each required category, then fill, then shuffle so the guaranteed
    # characters are not always in the same positions.
    $picked = @((Get-RandomChar $lower), (Get-RandomChar $upper), (Get-RandomChar $digit))
    while ($picked.Count -lt 28) { $picked += (Get-RandomChar ($lower + $upper + $digit)) }
    $order = New-Object byte[] $picked.Count
    $rng.GetBytes($order)
    $accPw = -join (0..($picked.Count - 1) | Sort-Object { $order[$_] } | ForEach-Object { $picked[$_] })
    if (-not $existing) {
      New-LocalUser -Name $accUser -Password (ConvertTo-SecureString $accPw -AsPlainText -Force) `
        -FullName "ClawX acceptance (standard user)" -Description "Interactive acceptance desktop; disposable" `
        -PasswordNeverExpires -ErrorAction Stop | Out-Null
      Write-Host "acceptance account created"
    } else {
      # The old password is unrecoverable by design, so rotate rather than guess.
      Set-LocalUser -Name $accUser -Password (ConvertTo-SecureString $accPw -AsPlainText -Force) -ErrorAction Stop
      Write-Host "acceptance password rotated to re-arm auto-logon"
    }
    # Standard user on purpose: the principal is not an administrator, so
    # acceptance must run without elevation.
    Add-LocalGroupMember -Group "Users" -Member $accUser -ErrorAction SilentlyContinue
    Set-ItemProperty -Path $wl -Name DefaultPassword -Value $accPw -Type String -Force
  }

  Set-ItemProperty -Path $wl -Name AutoAdminLogon -Value "1" -Type String -Force
  Set-ItemProperty -Path $wl -Name DefaultUserName -Value $accUser -Type String -Force
  Set-ItemProperty -Path $wl -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String -Force
  # AutoLogonCount consumes the credential; AutoLogonSID suppresses repeats.
  # Both must be absent for auto-logon to fire on every boot.
  Remove-ItemProperty -Path $wl -Name AutoLogonCount -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $wl -Name AutoLogonSID -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $wl -Name AutoLogonChecked -ErrorAction SilentlyContinue

  $after = Get-ItemProperty -Path $wl -ErrorAction SilentlyContinue
  $ok = ($after.AutoAdminLogon -eq '1' -and $after.DefaultUserName -eq $accUser -and $after.DefaultPassword -and -not $after.AutoLogonSID)
  Write-Host ("acceptance auto-logon armed and verified: " + [bool]$ok)
  # Never the value; presence and identity only.
  Set-Content -Path "C:\clawx-smoke\autologon-state.txt" -Encoding ascii -Value ("armed=$ok user=$accUser rotated=$needPassword at=" + (Get-Date -Format o))
} catch { Write-Host "acceptance account setup failed: $($_.Exception.Message)" }

# Marker so the host can confirm which revision of this script actually ran.
Set-Content -Path "C:\clawx-smoke\startup-revision.txt" -Value "clawx-vm-startup-repair v1 $(Get-Date -Format o)" -Encoding ascii
Stop-Transcript
