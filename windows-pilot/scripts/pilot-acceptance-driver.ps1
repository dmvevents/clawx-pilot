# pilot-acceptance-driver.ps1  (v2)
#
# Runs AS THE ACCEPTANCE USER inside the auto-logon interactive session, started
# from the all-users Startup folder. The app is an Electron GUI, so installed
# acceptance needs a real session; an interactive scheduled task is NOT a working
# substitute on this machine - `schtasks /Run` on an /IT task returns
# "Element not found" with SCHED_S_TASK_HAS_NOT_RUN (267011) even with an active
# console session for that exact user. The Startup shim is the reliable path.
#
# v2 exists because independent review found v1 could report PASS on the very
# defect it was written to detect. Three corrections, all of which matter:
#
#   1. STABILITY. v1 latched readiness on the first positive sample and broke out
#      of the loop. In the real CLWX-136 failure the Gateway *does* bind briefly
#      during a restart attempt before exiting again, and the verified observer
#      required a 20-second stable-ready window. v1 dropped that, so a single
#      lucky sample read as success. v2 requires a contiguous window and records
#      how long readiness actually held and how often it was lost.
#
#   2. OWNERSHIP. v1 asked only "is something listening on 18789". With no
#      free-port precondition and no PID (Start-Process without -PassThru), the
#      other profile's installed app or a straggler could satisfy it - and since
#      the failing app shows a window too, that port check was the only
#      discriminating signal in the whole driver. v2 refuses to start if the port
#      is already held, and requires the listener's owning process to be in the
#      launched app's process set.
#
#   3. REDACTION. v1 copied matching log lines verbatim into a receipt that gets
#      pulled off the machine. A keyword filter is an inclusion filter, not a
#      redaction filter: an error line can carry a token, a signed URL or a
#      recipient. v2 scrubs before recording and keeps full lines on the VM only.
#
# Two cases, no cross-user seeding. Seeding another Windows user's database
# brings DPAPI values that cannot decrypt for this account plus a legacy
# workspace migration, and that produced a failure unrelated to the defect. The
# valid existing-database test is the database THIS account's own app wrote.

$ErrorActionPreference = 'Continue'
$evidence = 'C:\clawx-acceptance'
$log = Join-Path $evidence 'driver-v2.log'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null

function Note($m) {
  Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('o'), $m) -ErrorAction SilentlyContinue
}

$expectedUser = 'ClawXAcc0909'
$doneMarker = Join-Path $evidence 'driver-v2.marker'
if ($env:USERNAME -ne $expectedUser) { exit 0 }
if (Test-Path $doneMarker) { Note 'already ran; exiting'; exit 0 }
Set-Content -Path $doneMarker -Value (Get-Date).ToUniversalTime().ToString('o') -Encoding ascii

$appExe = Join-Path $env:LOCALAPPDATA 'Programs\Ministry of Education\Ministry of Education.exe'
$openclaw = Join-Path $env:USERPROFILE '.openclaw'
$PORT = 18789
$STABLE_MS = 20000          # the verified observer's stable-ready requirement
$SAMPLE_MS = 2000

function Get-AppProcs { @(Get-Process -Name 'Ministry of Education' -ErrorAction SilentlyContinue) }

function Get-PortOwner {
  # Returns the owning PID, or $null when nothing is listening. Ownership is the
  # point: a listener we cannot attribute is not evidence about our app.
  try {
    $c = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $PORT -ErrorAction Stop | Select-Object -First 1
    if ($c) { return [int]$c.OwningProcess }
  } catch { }
  return $null
}

function Scrub([string] $line) {
  if (-not $line) { return '' }
  $s = $line
  $s = $s -replace '(?i)(bearer\s+)\S+', '$1<redacted>'
  $s = $s -replace '(?i)(token|secret|password|apikey|api_key|authorization)(["'':=\s]+)[^\s",}]+', '$1$2<redacted>'
  $s = $s -replace 'https?://[^\s"'')]+', '<url redacted>'
  $s = $s -replace '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '<address redacted>'
  $s = $s -replace '[A-Za-z0-9_\-]{32,}', '<opaque redacted>'
  if ($s.Length -gt 200) { $s = $s.Substring(0, 200) }
  return $s
}

function Collect-Findings($tag) {
  # Full lines stay on the machine; only scrubbed, bounded excerpts are recorded.
  $dirs = @((Join-Path $env:APPDATA 'Ministry of Education\logs'), (Join-Path $openclaw 'logs'))
  $findings = @()
  $files = @()
  foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { continue }
    foreach ($f in Get-ChildItem $d -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 4) {
      $dest = Join-Path $evidence ("log-$tag-" + $f.Name)
      Get-Content $f.FullName -Tail 600 -ErrorAction SilentlyContinue | Set-Content $dest -Encoding utf8 -ErrorAction SilentlyContinue
      $files += $f.Name
      foreach ($pat in @('invalid JSON', 'Unexpected token', 'SECRETS_DEGRADED', 'requires migration',
                         'restart-loop breaker', 'failed to start', 'read-only')) {
        $m = Select-String -Path $dest -SimpleMatch -Pattern $pat -ErrorAction SilentlyContinue
        foreach ($hit in ($m | Select-Object -First 3)) {
          $findings += [ordered]@{ pattern = $pat; file = $f.Name; line = $hit.LineNumber; excerpt = (Scrub $hit.Line.Trim()) }
        }
      }
    }
  }
  return [ordered]@{ files = $files; findings = $findings }
}

function Invoke-Case($tag, $budgetSeconds) {
  $res = [ordered]@{ tag = $tag; budgetSeconds = $budgetSeconds; port = $PORT; stableRequiredMs = $STABLE_MS }

  # Free-port precondition. A pre-existing holder makes the run undecidable, so
  # refuse rather than produce a contaminated verdict.
  $pre = Get-PortOwner
  if ($null -ne $pre) {
    $name = (Get-Process -Id $pre -ErrorAction SilentlyContinue).ProcessName
    $res.result = 'BLOCKED_PORT_IN_USE'
    $res.preexistingOwnerPid = $pre
    $res.preexistingOwnerName = $name
    Note "$tag BLOCKED: port $PORT already held by pid $pre ($name)"
    return $res
  }

  $proc = Start-Process -FilePath $appExe -PassThru
  $res.launchedPid = $proc.Id
  Note "$tag launched pid=$($proc.Id)"

  $launchedAt = Get-Date
  $deadline = $launchedAt.AddSeconds($budgetSeconds)
  $samples = @()
  $bestStableMs = 0
  $runStart = $null
  $readyLostCount = 0
  $firstOwnedAt = $null
  $windowAt = $null
  $foreignOwnerSeen = @()
  # Duplicate GUI instances must be judged across the whole window, not from one
  # snapshot: a second instance can appear later, or still be exiting under the
  # single-instance lock at the moment a single snapshot is taken.
  $maxWindowed = 0
  $stableReachedAt = $null

  while ((Get-Date) -lt $deadline) {
    $procs = Get-AppProcs
    $pids = @($procs | ForEach-Object { $_.Id })
    if ($pids -notcontains $proc.Id -and -not $proc.HasExited) { $proc.Refresh() }
    $ownerPid = Get-PortOwner
    $owned = ($null -ne $ownerPid -and $pids -contains $ownerPid)
    if ($null -ne $ownerPid -and -not $owned) { $foreignOwnerSeen += $ownerPid }
    $windowed = @($procs | Where-Object { $_.MainWindowHandle -ne 0 })
    $now = Get-Date
    $good = ($owned -and $windowed.Count -gt 0)

    if ($good) {
      if (-not $runStart) { $runStart = $now }
      $heldMs = [int]((New-TimeSpan -Start $runStart -End $now).TotalMilliseconds)
      if ($heldMs -gt $bestStableMs) { $bestStableMs = $heldMs }
      if (-not $firstOwnedAt) { $firstOwnedAt = $now.ToUniversalTime().ToString('o') }
    } else {
      if ($runStart) { $readyLostCount += 1 }   # a positive run broke: instability
      $runStart = $null
    }
    if ($windowed.Count -gt 0 -and -not $windowAt) { $windowAt = $now.ToUniversalTime().ToString('o') }
    if ($windowed.Count -gt $maxWindowed) { $maxWindowed = $windowed.Count }
    if ($bestStableMs -ge $STABLE_MS -and -not $stableReachedAt) { $stableReachedAt = $now }

    $samples += [ordered]@{
      t = $now.ToUniversalTime().ToString('o')
      procs = $procs.Count
      portOwnerPid = $ownerPid
      ownedByApp = $owned
      windowed = $windowed.Count
      heldMs = if ($runStart) { [int]((New-TimeSpan -Start $runStart -End $now).TotalMilliseconds) } else { 0 }
    }

    # Only a contiguous window satisfying the stability requirement stops the run.
    if ($bestStableMs -ge $STABLE_MS) { break }
    # All app processes gone is terminal; no point waiting out the budget.
    if ($procs.Count -eq 0 -and $samples.Count -gt 3) { break }
    Start-Sleep -Milliseconds $SAMPLE_MS
  }

  $final = Get-AppProcs
  $windowedFinal = @($final | Where-Object { $_.MainWindowHandle -ne 0 })
  $res.sampleCount = $samples.Count
  $res.samples = $samples
  $res.stableReadyMs = $bestStableMs
  $res.readyLostCount = $readyLostCount
  $res.firstOwnedListenerAt = $firstOwnedAt
  $res.mainWindowSeenAt = $windowAt
  $res.windowShown = [bool]$windowAt
  $res.ownedListenerEverSeen = [bool]$firstOwnedAt
  $res.stableReady = ($bestStableMs -ge $STABLE_MS)
  $res.foreignPortOwnersSeen = @($foreignOwnerSeen | Sort-Object -Unique)
  $res.finalProcessCount = $final.Count
  $res.windowedProcessCount = $windowedFinal.Count
  $res.maxWindowedObserved = $maxWindowed
  # Judged across the window, not from the final snapshot.
  $res.secondGuiInstance = ($maxWindowed -gt 1)

  # Time-to-ready, recorded rather than assumed. A listener that only appears as
  # the budget runs out is not the same outcome as one that appears promptly, and
  # without these numbers both read as PASS.
  $res.timeToFirstOwnedListenerMs = if ($firstOwnedAt) { [int]((New-TimeSpan -Start $launchedAt -End ([DateTime]::Parse($firstOwnedAt).ToLocalTime())).TotalMilliseconds) } else { $null }
  $res.timeToStableReadyMs = if ($stableReachedAt) { [int]((New-TimeSpan -Start $launchedAt -End $stableReachedAt).TotalMilliseconds) } else { $null }
  $res.budgetMs = $budgetSeconds * 1000
  # Flagged, not auto-failed: the acceptable start latency is an owner decision
  # (CLWX-43), not this harness's to invent. The flag makes a near-deadline pass
  # impossible to mistake for a prompt one.
  $res.readyNearDeadline = ($null -ne $res.timeToStableReadyMs -and $res.timeToStableReadyMs -gt (0.8 * $res.budgetMs))
  $res.launchedProcessExited = $proc.HasExited
  if ($proc.HasExited) { $res.launchedExitCode = $proc.ExitCode }
  $res.logs = Collect-Findings $tag

  if ($res.stableReady -and $res.windowShown -and -not $res.secondGuiInstance) {
    $res.result = 'PASS'
  } else {
    $res.result = 'FAIL'
    $res.reason = ("stableReadyMs=$($res.stableReadyMs)/$STABLE_MS ownedListenerEverSeen=$($res.ownedListenerEverSeen) " +
                   "readyLostCount=$($res.readyLostCount) windowShown=$($res.windowShown) secondGui=$($res.secondGuiInstance)")
  }
  # State what was measured, not a broader claim. "Readiness" here is an owned,
  # stable listener - a visible window alone is present in the failure mode too,
  # so it evidences nothing by itself.
  $res.measured = ("port $PORT bound by the app's own process continuously for $($res.stableReadyMs) ms " +
                   "(requirement $STABLE_MS ms); readiness lost $($res.readyLostCount) time(s); " +
                   "max windowed processes observed across the window: $maxWindowed; " +
                   "time to stable readiness: $(if ($null -ne $res.timeToStableReadyMs) { "$($res.timeToStableReadyMs) ms" } else { 'never' })")
  Note "$tag result=$($res.result) stableMs=$($res.stableReadyMs) lost=$($res.readyLostCount)"
  return $res
}

function Stop-App {
  foreach ($p in Get-AppProcs) { try { $p.CloseMainWindow() | Out-Null } catch { } }
  Start-Sleep -Seconds 10
  foreach ($p in Get-AppProcs) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { } }
  Start-Sleep -Seconds 5
}

$r = [ordered]@{}
$r.at = (Get-Date).ToUniversalTime().ToString('o')
$r.driverVersion = 2
$r.user = "$env:USERNAME"
$r.sessionName = "$env:SESSIONNAME"
$r.isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Note "driver v2 start user=$env:USERNAME session=$env:SESSIONNAME elevated=$($r.isElevated)"

# Install only if absent; a present install is reported with its identity.
$installer = 'C:\Users\Public\Downloads\moe30.exe'
$expected = '9f8a2dc5fc5c238d49935a7f1b0b9b90205c104ddf933124196c62210114aff7'
$r.appPresentBefore = Test-Path $appExe
if (-not $r.appPresentBefore) {
  if (-not (Test-Path $installer)) {
    $r.result = 'BLOCKED'; $r.reason = 'no app and no installer'
    $r | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'driver-v2-receipt.json') -Encoding ascii
    exit 1
  }
  $r.installerSha256 = (Get-FileHash -Algorithm SHA256 -Path $installer).Hash.ToLower()
  if ($r.installerSha256 -ne $expected) {
    $r.result = 'BLOCKED'; $r.reason = 'installer hash mismatch'
    $r | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'driver-v2-receipt.json') -Encoding ascii
    exit 1
  }
  $p = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -Wait
  $r.installExitCode = $p.ExitCode
}
$r.appPresentAfter = Test-Path $appExe
if ($r.appPresentAfter) {
  $r.installedProductVersion = (Get-Item $appExe).VersionInfo.ProductVersion
  $r.installedExeSha256 = (Get-FileHash -Algorithm SHA256 -Path $appExe).Hash.ToLower()
}

Stop-App

# --- Case 1: fresh state ----------------------------------------------------
# Any prior .openclaw is moved aside, not deleted, so nothing is destroyed.
if (Test-Path $openclaw) {
  $aside = Join-Path $evidence ('preexisting-openclaw-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))
  Move-Item $openclaw $aside -Force -ErrorAction SilentlyContinue
  $r.priorStateMovedTo = $aside
}
$r.case1 = Invoke-Case 'case1-fresh' 300
Stop-App

# --- Case 2: existing state database, same user ------------------------------
# The database now on disk was written by THIS account's own app during case 1,
# so there is no cross-user DPAPI or migration confound. This is the criterion.
$r.case2StateFileCount = @(Get-ChildItem $openclaw -Recurse -File -ErrorAction SilentlyContinue).Count
$sq = Get-ChildItem $openclaw -Recurse -Filter 'openclaw.sqlite' -ErrorAction SilentlyContinue | Select-Object -First 1
$r.case2SqliteBytes = if ($sq) { $sq.Length } else { $null }
if ($r.case2StateFileCount -gt 0) {
  $r.case2 = Invoke-Case 'case2-existing-db' 360
  Stop-App
} else {
  $r.case2 = [ordered]@{ tag = 'case2-existing-db'; result = 'NOT_RUN'; reason = 'case 1 left no state to reuse' }
}

$c1 = $r.case1.result; $c2 = $r.case2.result
$r.result = if ($c1 -eq 'PASS' -and $c2 -eq 'PASS') { 'PASS' }
            elseif ($c1 -eq 'PASS' -and $c2 -eq 'FAIL') { 'FAIL_EXISTING_DB_ONLY' }
            elseif ($c1 -eq 'FAIL') { 'FAIL_FRESH' }
            else { "case1=$c1 case2=$c2" }
$r.criterion = ("Installed startup reaches Gateway readiness - a listener on 127.0.0.1:$PORT owned by the app's own " +
                "process, held continuously for at least $STABLE_MS ms, with a visible window and no second GUI instance.")
$r.notClaimed = ('Readiness here is an owned, stable TCP listener, which is stronger than a running process but weaker ' +
                 'than an in-app assertion that a turn completes. Ordinary chat, the doctor-repair path, and all ' +
                 'document, browser, tenant and external-tester criteria are NOT_RUN.')
$r | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidence 'driver-v2-receipt.json') -Encoding ascii
Note "driver v2 done result=$($r.result)"
