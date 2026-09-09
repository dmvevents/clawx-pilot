# moe30-phase2-driver.ps1
#
# Runs AS THE ACCEPTANCE USER inside the auto-logon interactive session, started
# from the all-users Startup folder. This is deliberate: the app is an Electron
# GUI and every installed criterion needs a real session. A scheduled task with
# an interactive principal returns SCHED_S_TASK_HAS_NOT_RUN when no session
# exists, which is what defeated the earlier attempts.
#
# Because it runs from Startup inside the user's own session, NO password is
# needed here, on the host, or in instance metadata.
#
# Two launches, on purpose:
#   Run A - fresh profile state. Baseline: does the installed app start at all?
#   Run B - the real pre-existing state database seeded in. This is the CLWX-136
#           scenario (startup WITH an existing database).
# Without Run A, a Run B failure could not be distinguished from an artifact of
# seeding another user's database. A is the negative control for B.

$ErrorActionPreference = 'Continue'
$evidence = 'C:\clawx-acceptance'
$log = Join-Path $evidence 'phase2-driver.log'
$seed = Join-Path $evidence 'seed-openclaw'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null

function Note($m) {
  Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('o'), $m) -ErrorAction SilentlyContinue
}

# Only the acceptance user runs this, and only once. Guard before anything else
# so a wrong user or a re-logon cannot reinstall or relaunch.
$expectedUser = 'ClawXAcc0909'
$doneMarker = Join-Path $evidence 'phase2-done.marker'
if ($env:USERNAME -ne $expectedUser) { exit 0 }
if (Test-Path $doneMarker) { Note "already ran; exiting"; exit 0 }
Set-Content -Path $doneMarker -Value (Get-Date).ToUniversalTime().ToString('o') -Encoding ascii

$appExe = Join-Path $env:LOCALAPPDATA 'Programs\Ministry of Education\Ministry of Education.exe'
$openclaw = Join-Path $env:USERPROFILE '.openclaw'

function Get-AppProcs { @(Get-Process -Name 'Ministry of Education' -ErrorAction SilentlyContinue) }

function Test-GatewayListening {
  try { return $null -ne (Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort 18789 -ErrorAction Stop | Select-Object -First 1) }
  catch { return $false }
}

function Stop-App {
  foreach ($p in Get-AppProcs) {
    try { $p.CloseMainWindow() | Out-Null } catch {}
  }
  Start-Sleep -Seconds 8
  foreach ($p in Get-AppProcs) {
    try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 4
}

function Collect-Logs($tag) {
  $dirs = @((Join-Path $env:APPDATA 'Ministry of Education\logs'), (Join-Path $openclaw 'logs'))
  $names = @()
  foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { continue }
    foreach ($f in Get-ChildItem $d -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 4) {
      $dest = Join-Path $evidence ("log-$tag-" + $f.Name)
      # Startup-diagnostic lines only. Never copy whole conversations or
      # credential material off the machine wholesale.
      Get-Content $f.FullName -Tail 500 -ErrorAction SilentlyContinue |
        Where-Object { $_ -match '(?i)gateway|sqlite|worker|invalid|error|ready|listen|fatal|exit|spawn' } |
        Set-Content $dest -Encoding utf8 -ErrorAction SilentlyContinue
      $names += $f.Name
    }
  }
  # The specific CLWX-136 signature, looked for explicitly rather than inferred
  # from silence.
  $sig = @()
  foreach ($f in Get-ChildItem $evidence -Filter "log-$tag-*" -File -ErrorAction SilentlyContinue) {
    $hit = Select-String -Path $f.FullName -SimpleMatch -Pattern 'sqlite', 'invalid json', 'Unexpected token', 'read-only' -ErrorAction SilentlyContinue
    if ($hit) { $sig += ($hit | Select-Object -First 6 | ForEach-Object { "$($f.Name):$($_.LineNumber): $($_.Line.Trim().Substring(0, [Math]::Min(160, $_.Line.Trim().Length)))" }) }
  }
  return [ordered]@{ files = $names; signatureHits = $sig }
}

function Invoke-LaunchObservation($tag, $budgetSeconds) {
  Note "$tag launch begin"
  # Never -WindowStyle Hidden: hiding the window kills the Gateway through the
  # app's own `deferred start:finally` restart path. Recorded trap.
  Start-Process -FilePath $appExe | Out-Null
  $deadline = (Get-Date).AddSeconds($budgetSeconds)
  $samples = @(); $readyAt = $null; $windowAt = $null
  while ((Get-Date) -lt $deadline) {
    $procs = Get-AppProcs
    $listening = Test-GatewayListening
    $windowed = @($procs | Where-Object { $_.MainWindowHandle -ne 0 })
    $samples += [ordered]@{
      t = (Get-Date).ToUniversalTime().ToString('o')
      procs = $procs.Count; listening = $listening; windowed = $windowed.Count
    }
    if ($listening -and -not $readyAt) { $readyAt = (Get-Date).ToUniversalTime().ToString('o') }
    if ($windowed.Count -gt 0 -and -not $windowAt) { $windowAt = (Get-Date).ToUniversalTime().ToString('o') }
    if ($readyAt -and $windowAt) { break }
    Start-Sleep -Seconds 5
  }
  $final = Get-AppProcs
  $windowedFinal = @($final | Where-Object { $_.MainWindowHandle -ne 0 })
  $logs = Collect-Logs $tag
  $res = [ordered]@{
    tag = $tag
    budgetSeconds = $budgetSeconds
    sampleCount = $samples.Count
    samples = $samples
    gatewayReadyAt = $readyAt
    mainWindowSeenAt = $windowAt
    gatewayReady = [bool]$readyAt
    windowShown = [bool]$windowAt
    finalProcessCount = $final.Count
    windowedProcessCount = $windowedFinal.Count
    secondGuiInstance = ($windowedFinal.Count -gt 1)
    logs = $logs
  }
  $res.result = if ($res.gatewayReady -and $res.windowShown -and -not $res.secondGuiInstance) { 'PASS' } else { 'FAIL' }
  if ($res.result -eq 'FAIL') {
    $res.reason = "gatewayReady=$($res.gatewayReady) windowShown=$($res.windowShown) secondGui=$($res.secondGuiInstance)"
  }
  Note "$tag result=$($res.result) ready=$($res.gatewayReady) window=$($res.windowShown)"
  return $res
}

$r = [ordered]@{}
$r.at = (Get-Date).ToUniversalTime().ToString('o')
$r.user = "$env:USERNAME"
$r.computer = "$env:COMPUTERNAME"
$r.sessionName = "$env:SESSIONNAME"
$r.isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Note "driver start user=$env:USERNAME session=$env:SESSIONNAME elevated=$($r.isElevated)"

# --- installer identity, re-verified in the session that runs it -------------
$installer = 'C:\Users\Public\Downloads\moe30.exe'
$expected = '9f8a2dc5fc5c238d49935a7f1b0b9b90205c104ddf933124196c62210114aff7'
if (-not (Test-Path $installer)) {
  $r.result = 'BLOCKED'; $r.reason = 'installer not present in session'
  $r | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'phase2-receipt.json') -Encoding ascii
  exit 1
}
$r.installerSha256 = (Get-FileHash -Algorithm SHA256 -Path $installer).Hash.ToLower()
$r.installerBytes = (Get-Item $installer).Length
$r.installerHashMatches = ($r.installerSha256 -eq $expected)
if (-not $r.installerHashMatches) {
  $r.result = 'BLOCKED'; $r.reason = 'installer hash does not match the verified candidate'
  $r | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'phase2-receipt.json') -Encoding ascii
  exit 1
}

# --- pre-state --------------------------------------------------------------
$r.profileHadOpenclawBefore = Test-Path $openclaw
$r.appPresentBefore = Test-Path $appExe

# --- silent per-user install -------------------------------------------------
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -Wait
$r.installExitCode = $p.ExitCode
$r.installSeconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
$r.appPresentAfter = Test-Path $appExe
Note "install exit=$($p.ExitCode) $($r.installSeconds)s present=$($r.appPresentAfter)"
if (-not $r.appPresentAfter) {
  $r.result = 'FAIL'; $r.reason = 'install produced no executable'
  $r | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'phase2-receipt.json') -Encoding ascii
  exit 1
}
$vi = (Get-Item $appExe).VersionInfo
$r.installedProductVersion = $vi.ProductVersion
$r.installedExeSha256 = (Get-FileHash -Algorithm SHA256 -Path $appExe).Hash.ToLower()

# --- Run A: baseline on fresh profile state ---------------------------------
$r.runA = Invoke-LaunchObservation 'runA-fresh' 300
Stop-App

# --- Run B: the CLWX-136 scenario, real pre-existing database ---------------
$r.seedAvailable = Test-Path $seed
if ($r.seedAvailable) {
  # Record what the app itself wrote in Run A before replacing it, so the two
  # runs stay distinguishable.
  if (Test-Path $openclaw) {
    $keep = Join-Path $evidence 'runA-openclaw-snapshot'
    New-Item -ItemType Directory -Force -Path $keep | Out-Null
    Copy-Item (Join-Path $openclaw '*') $keep -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $openclaw -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Force -Path $openclaw | Out-Null
  Copy-Item (Join-Path $seed '*') $openclaw -Recurse -Force -ErrorAction SilentlyContinue
  $r.seededFiles = @(Get-ChildItem $openclaw -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name)|$($_.Length)" })
  $r.seededSqliteBytes = (Get-ChildItem $openclaw -Recurse -Filter 'openclaw.sqlite' -ErrorAction SilentlyContinue | Select-Object -First 1).Length
  Note "seeded $($r.seededFiles.Count) files; openclaw.sqlite=$($r.seededSqliteBytes)"
  $r.runB = Invoke-LaunchObservation 'runB-existing-db' 360
  Stop-App
} else {
  $r.runB = [ordered]@{ tag = 'runB-existing-db'; result = 'NOT_RUN'; reason = 'no seed database staged' }
}

# --- combined reading -------------------------------------------------------
$a = $r.runA.result; $b = $r.runB.result
$r.result = if ($a -eq 'PASS' -and $b -eq 'PASS') { 'PASS' } elseif ($a -eq 'PASS' -and $b -eq 'FAIL') { 'FAIL_EXISTING_DB_ONLY' } elseif ($a -eq 'FAIL') { 'FAIL_BASELINE' } else { "A=$a B=$b" }
$r.interpretation = switch ($r.result) {
  'PASS' { 'Installed startup reaches Gateway readiness with a visible window and no second GUI instance, both on fresh state and with the real pre-existing database.' }
  'FAIL_EXISTING_DB_ONLY' { 'Baseline start works; the failure is specific to an existing state database. That is the CLWX-136 shape and the seeded database is the discriminator.' }
  'FAIL_BASELINE' { 'The app does not start even on fresh state, so the existing-database question is not yet reachable. Do not attribute this to CLWX-136 without further isolation.' }
  default { 'Mixed or incomplete; read the per-run records rather than this summary.' }
}
$r.scope = 'Installed startup only. Ordinary chat, doctor-repair, document, browser, tenant and external-tester criteria are separate stages and remain NOT_RUN here.'
$r.seedCaveat = 'The seeded database was written by a different Windows user, so DPAPI-protected values inside it will not decrypt for this account. That affects secrets, not SQLite readability, and Run A bounds any confusion.'
$r | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'phase2-receipt.json') -Encoding ascii
Note "driver done result=$($r.result)"
