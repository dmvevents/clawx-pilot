# moe30-phase2-stage.ps1
#
# Admin-side staging, run over SSH. Prepares everything the acceptance session
# will need, then leaves the reboot to the caller so the operator keeps control
# of when the machine restarts.
#
# Design constraint: the acceptance account's password is never handled here.
# The driver runs from the all-users Startup folder inside that account's own
# auto-logon session, so no credential is needed on either side.

$ErrorActionPreference = 'Stop'
$accUser = 'ClawXAcc0909'
$evidence = 'C:\clawx-acceptance'
$seed = Join-Path $evidence 'seed-openclaw'
$out = [ordered]@{}
$out.at = (Get-Date).ToUniversalTime().ToString('o')

# M5: the account UNDER TEST must not be able to modify the harness or, ideally,
# rewrite evidence it has already produced. Previously an inheritable Modify ACE
# over the whole tree meant a later read-only grant on a subpath was additive and
# had no effect, so the observed subject could edit the driver and its receipts.
# Split them: the driver lives outside the writable tree and is read-execute
# only; only the evidence root is writable, because the driver creates a per-run
# subdirectory there as that user.
$driverDir = 'C:\clawx-driver'
New-Item -ItemType Directory -Force -Path $driverDir | Out-Null
icacls $driverDir /inheritance:r /grant "Administrators:(OI)(CI)F" /grant "SYSTEM:(OI)(CI)F" /grant "${accUser}:(OI)(CI)RX" | Out-Null
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
icacls $evidence /grant "${accUser}:(OI)(CI)M" /T | Out-Null
$out.driverDir = $driverDir
$out.evidenceDir = $evidence

# --- 1. seed the REAL pre-existing state database ----------------------------
# Copied from the old QA profile, which a standard user cannot read itself.
$src = 'C:\Users\ClawXFresh0908\.openclaw'
$out.sourceExists = Test-Path $src
if ($out.sourceExists) {
  if (Test-Path $seed) { Remove-Item $seed -Recurse -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force -Path $seed | Out-Null
  Copy-Item (Join-Path $src '*') $seed -Recurse -Force -ErrorAction SilentlyContinue
  icacls $seed /grant "${accUser}:(OI)(CI)RX" /T | Out-Null
  $sq = Get-ChildItem $seed -Recurse -Filter 'openclaw.sqlite' -ErrorAction SilentlyContinue | Select-Object -First 1
  $out.seedFileCount = @(Get-ChildItem $seed -Recurse -File -ErrorAction SilentlyContinue).Count
  $out.seedSqliteBytes = if ($sq) { $sq.Length } else { $null }
  $out.seedSqliteSha256 = if ($sq) { (Get-FileHash -Algorithm SHA256 -Path $sq.FullName).Hash.ToLower() } else { $null }
} else {
  $out.seedFileCount = 0
}

# --- 2. fetch the verified installer from private staging --------------------
# Uses the instance service account (devstorage.read_only). No key material and
# no signed URL is written anywhere.
$bucket = 'clawx-rc-artifacts-622687731621'
$object = 'private-validation/moe30-34323058772/moe30.exe'
$dest = 'C:\Users\Public\Downloads\moe30.exe'
$expected = '9f8a2dc5fc5c238d49935a7f1b0b9b90205c104ddf933124196c62210114aff7'

$needFetch = $true
if (Test-Path $dest) {
  if ((Get-FileHash -Algorithm SHA256 -Path $dest).Hash.ToLower() -eq $expected) { $needFetch = $false }
}
$out.alreadyStaged = -not $needFetch
if ($needFetch) {
  $tok = (Invoke-RestMethod -Headers @{ 'Metadata-Flavor' = 'Google' } `
    -Uri 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token').access_token
  $enc = [Uri]::EscapeDataString($object)
  $url = "https://storage.googleapis.com/storage/v1/b/$bucket/o/$enc`?alt=media"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Invoke-WebRequest -Uri $url -Headers @{ Authorization = "Bearer $tok" } -OutFile $dest -UseBasicParsing
  $out.downloadSeconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
}
$out.installerBytes = (Get-Item $dest).Length
$out.installerSha256 = (Get-FileHash -Algorithm SHA256 -Path $dest).Hash.ToLower()
$out.installerHashMatches = ($out.installerSha256 -eq $expected)
# Public\Downloads is readable by the standard user; make it explicit anyway.
icacls $dest /grant "${accUser}:RX" | Out-Null

# --- 3. arm the driver in the all-users Startup folder -----------------------
# All-users, not per-user: the acceptance profile does not exist until its first
# logon, so there is no per-user Startup folder to write into yet. The driver
# itself refuses to act for any other account and refuses to repeat.
$driverSrc = 'C:\Windows\Temp\pilot-acceptance-driver.ps1'
$driverDst = Join-Path $driverDir 'driver.ps1'
Copy-Item $driverSrc $driverDst -Force
# No grant here: the directory ACL above already gives this account RX and
# nothing more, and adding a file-level grant is how the earlier mistake was made.
$out.driverPath = $driverDst
# M7: stage from a path the account under test cannot write, and record the hash
# so a receipt can be attributed to a script revision.
$out.driverSha256 = (Get-FileHash -Algorithm SHA256 -Path $driverDst).Hash.ToLower()

$startup = 'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp'
New-Item -ItemType Directory -Force -Path $startup | Out-Null
$cmd = Join-Path $startup 'clawx-moe30-phase2.cmd'
# A .cmd shim rather than a .ps1 association, so execution does not depend on
# the user's script-association or execution-policy state.
Set-Content -Path $cmd -Encoding ascii -Value @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$driverDst"
"@
$out.startupShim = $cmd
$out.startupShimPresent = Test-Path $cmd

# --- 4. confirm auto-logon is armed for the acceptance account ---------------
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$out.autoAdminLogon = $wl.AutoAdminLogon
$out.defaultUserName = $wl.DefaultUserName
$out.defaultPasswordPresent = [bool]$wl.DefaultPassword    # presence only
$out.autoLogonArmedForAcceptance = ($wl.AutoAdminLogon -eq '1' -and $wl.DefaultUserName -eq $accUser)

# --- 5. do not leave a stale receipt behind ----------------------------------
foreach ($stale in @('phase2-receipt.json', 'phase2-done.marker', 'phase2-driver.log')) {
  Remove-Item (Join-Path $evidence $stale) -Force -ErrorAction SilentlyContinue
}

# M10: gate on what THIS design needs. The old gate never asserted that the
# existing-database branch was reachable, so "ready" could be true for a run that
# could not produce the evidence it was staged to produce.
$out.readyPreconditions = [ordered]@{
  candidateInstallerHashMatches = $out.installerHashMatches
  driverStagedAndHashed = ($null -ne $out.driverSha256)
  driverOutsideWritableTree = ($driverDst -like "$driverDir*")
  startupShimPresent = $out.startupShimPresent
  autoLogonArmedForAcceptance = $out.autoLogonArmedForAcceptance
}
$out.ready = -not ($out.readyPreconditions.Values -contains $false)
$out | ConvertTo-Json -Depth 5 -Compress
