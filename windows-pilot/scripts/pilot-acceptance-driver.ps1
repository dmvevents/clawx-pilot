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

[CmdletBinding()]
param(
  # Budget is a parameter with real headroom. With a contiguous 20 s stability
  # window required, a 300 s budget left only ~70 s of slack against a measured
  # 209 s cold start - and a slower boot would then produce a timeout that is
  # indistinguishable in the receipt from a genuine non-start. The stability fix
  # would have introduced a new false FAIL at exactly the latency being measured.
  [int] $ColdBudgetSeconds = 600,
  [int] $WarmBudgetSeconds = 420
)

$ErrorActionPreference = 'Continue'
# LOW-10: the guard runs BEFORE anything touches disk, and reads the token rather
# than $env:USERNAME, which the account under test can set for itself.
$expectedUser = 'ClawXAcc0909'
$tokenName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($tokenName -notlike "*\$expectedUser") { exit 0 }

$root = 'C:\clawx-acceptance'
# Per-run directory: a shared directory let one run's copied log files be picked
# up by the next run's signature scan and attributed to it.
$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$evidence = Join-Path $root "run-$runId"
$log = Join-Path $evidence 'driver.log'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null

function Note($m) {
  Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('o'), $m) -ErrorAction SilentlyContinue
}

$doneMarker = Join-Path $root 'driver-v2.marker'
if (Test-Path $doneMarker) { Note 'already ran; exiting'; exit 0 }
Set-Content -Path $doneMarker -Value (Get-Date).ToUniversalTime().ToString('o') -Encoding ascii

# M4: a marker written before any work means a crash - or the deliberate 8 h
# auto-shutdown firing mid-run - leaves no receipt at all, which is the exact
# ambiguity that cost the previous session. Write an IN_PROGRESS receipt
# immediately, carrying the shutdown deadline, and overwrite it at every exit.
$receiptPath = Join-Path $evidence 'receipt.json'
$bootedAt = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
[ordered]@{
  status = 'IN_PROGRESS'
  at = (Get-Date).ToUniversalTime().ToString('o')
  runId = $runId
  user = "$env:USERNAME"
  bootedAt = $bootedAt.ToUniversalTime().ToString('o')
  autoShutdownDueAt = $bootedAt.AddSeconds(28800).ToUniversalTime().ToString('o')
  note = 'If this file still says IN_PROGRESS, the run did not reach a terminal state. Check the auto-shutdown deadline before assuming a product failure.'
} | ConvertTo-Json -Depth 4 | ForEach-Object { [System.IO.File]::WriteAllText($receiptPath, $_, (New-Object Text.UTF8Encoding($false))) }

# The default per-user location, but installation directory is user-changeable, so
# a prior install can sit elsewhere. Consult the per-user Uninstall key before
# concluding the install produced no executable - otherwise a harness path
# assumption reads as an app failure. This matters most for the upgrade case,
# where moe.30 lands over an existing location.
$appExe = Join-Path $env:LOCALAPPDATA 'Programs\Ministry of Education\Ministry of Education.exe'
if (-not (Test-Path $appExe)) {
  foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                     'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
    foreach ($entry in (Get-ItemProperty $key -ErrorAction SilentlyContinue |
                        Where-Object { $_.DisplayName -like '*Ministry of Education*' -and $_.InstallLocation })) {
      $candidate = Join-Path $entry.InstallLocation 'Ministry of Education.exe'
      if (Test-Path $candidate) { $appExe = $candidate; break }
    }
  }
}
$openclaw = Join-Path $env:USERPROFILE '.openclaw'
$PORT = 18789
$STABLE_MS = 20000          # the verified observer's stable-ready requirement
$SAMPLE_MS = 2000
# docs/WINDOWS_DEPLOYMENT_PLAN.md:165 - "Gateway port 18789 listens within 30s of
# launch". A documented expectation, so the harness enforces it rather than
# inventing one. Distinct from CLWX-43, which is per-turn p50/p90 and does need
# an owner decision; conflating the two is what let a ~55 s start read as PASS.
$READY_BUDGET_MS = 30000

function Get-AppProcs { @(Get-Process -Name 'Ministry of Education' -ErrorAction SilentlyContinue) }

function Get-PortOwner {
  # Returns the owning PID, or $null when nothing is listening. Ownership is the
  # point: a listener we cannot attribute is not evidence about our app.
  #
  # Deliberately NOT filtered on -LocalAddress 127.0.0.1. That filter matches only
  # a listener bound literally to 127.0.0.1, and the bind address is not pinned
  # anywhere in this repo (config-sync passes no --host), so a 0.0.0.0 or ::1 bind
  # would make the check permanently false and produce a FAIL that blames the app
  # for a harness assumption. Attribution is handled by the owning-process check
  # instead, which is the part that actually matters.
  try {
    $c = Get-NetTCPConnection -State Listen -LocalPort $PORT -ErrorAction Stop | Select-Object -First 1
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

$tsRe2 = [regex]'\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\]'

function Get-LogOffsets {
  # Byte length of each log file at the moment a case starts. Anything beyond it
  # belongs to that case; anything before it does not, regardless of timestamp
  # format. The application writes ONE file per day, so without this a tail reads
  # back into earlier runs - observed attributing a previous run's secrets and
  # migration errors to a case that had neither.
  $dirs = @((Join-Path $env:APPDATA 'Ministry of Education\logs'), (Join-Path $openclaw 'logs'))
  $map = @{}
  foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { continue }
    foreach ($f in Get-ChildItem $d -File -ErrorAction SilentlyContinue) { $map[$f.FullName] = $f.Length }
  }
  return $map
}

function Collect-Findings($tag, $since, $offsets) {
  # Full lines stay on the machine; only scrubbed, bounded excerpts are recorded.
  #
  # Findings MUST be restricted to lines timestamped inside this case's own
  # window. The app writes a DAILY log file, so tailing it reaches back across
  # earlier runs, and per-run output directories do not help because the
  # contamination is in the source file. This was observed: an earlier run's
  # SECRETS_DEGRADED and "requires migration" lines were attributed to a later
  # run that had neither, which would have manufactured a defect out of nothing.
  $dirs = @((Join-Path $env:APPDATA 'Ministry of Education\logs'), (Join-Path $openclaw 'logs'))
  $findings = @()
  $files = @()
  # NOTE: [datetime]::TryParse needs a DECLARED [datetime] target on 5.1; a
  # $null-initialised [ref] fails overload resolution at runtime, which no parse
  # check can catch.
  $tsRe = [regex]'\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\]'
  foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { continue }
    foreach ($f in Get-ChildItem $d -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 4) {
      # Discriminate by source directory: the two log directories can hold a
      # same-named file, and without this the second silently overwrote the first.
      $srcTag = if ($d -like '*.openclaw*') { 'openclaw' } else { 'appdata' }
      $dest = Join-Path $evidence ("log-$tag-$srcTag-" + $f.Name)
      # Byte offset is the primitive, not the timestamp. Reading only the bytes
      # written after the case began is exact, format-independent, and needs no
      # parsing - whereas a strict timestamp filter silently drops continuation
      # lines that carry no timestamp of their own, and drops EVERYTHING if the
      # format is local-time or dateless. The timestamp check is kept only as a
      # cross-check, and the counts are recorded so silent over-filtering is
      # visible rather than invisible.
      $startOffset = 0
      if ($offsets.ContainsKey($f.FullName)) { $startOffset = [int64] $offsets[$f.FullName] }
      $all = @(Get-Content $f.FullName -ErrorAction SilentlyContinue)
      $kept = @()
      $droppedUnparseable = 0
      $beforeWindowByTimestamp = 0
      if ($startOffset -gt 0 -and (Get-Item $f.FullName).Length -gt $startOffset) {
        $reader = $null
        try {
          $fs = [System.IO.File]::Open($f.FullName, 'Open', 'Read', 'ReadWrite')
          $fs.Seek($startOffset, 'Begin') | Out-Null
          $reader = New-Object System.IO.StreamReader($fs)
          while ($null -ne ($line = $reader.ReadLine())) { $kept += $line }
        } catch {
          $kept = @()
        } finally {
          if ($reader) { $reader.Dispose() }
        }
      }
      if ($kept.Count -eq 0) {
        # No offset recorded (file appeared mid-case) - fall back to the
        # timestamp filter rather than to an unbounded tail.
        foreach ($line in $all) {
          $m = $tsRe.Match($line)
          if ($m.Success) {
            [datetime] $t = [datetime]::MinValue
            if ([datetime]::TryParse($m.Groups[1].Value, [ref] $t)) {
              if ($t.ToUniversalTime() -ge $since.ToUniversalTime()) { $kept += $line }
              else { $beforeWindowByTimestamp += 1 }
            } else { $droppedUnparseable += 1 }
          } elseif ($kept.Count -gt 0) {
            $kept += $line   # continuation attached to its timestamped parent
          } else { $droppedUnparseable += 1 }
        }
      }
      # Cross-check: any kept line whose timestamp predates the case is suspect.
      $suspect = 0
      foreach ($line in $kept) {
        $m = $tsRe.Match($line)
        if ($m.Success) {
          [datetime] $t = [datetime]::MinValue
          if ([datetime]::TryParse($m.Groups[1].Value, [ref] $t) -and $t.ToUniversalTime() -lt $since.ToUniversalTime()) { $suspect += 1 }
        }
      }
      Set-Content -Path $dest -Value $kept -Encoding utf8 -ErrorAction SilentlyContinue
      $files += [ordered]@{
        name = $f.Name
        source = $srcTag
        startOffsetBytes = $startOffset
        linesSeen = $all.Count
        linesKept = $kept.Count
        droppedUnparseable = $droppedUnparseable
        beforeWindowByTimestamp = $beforeWindowByTimestamp
        keptButOlderThanCase = $suspect
      }
      foreach ($pat in @('invalid JSON', 'Unexpected token', 'SECRETS_DEGRADED', 'requires migration',
                         'restart-loop breaker', 'failed to start', 'read-only',
                         # Migration-shaped failures belong inside the receipt, not
                         # diagnosed alongside it - the upgrade case is exactly
                         # where they surface.
                         'DPAPI', 'decrypt', 'ProtectedData', 'ENOENT', 'NODE_MODULE_VERSION')) {
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

  $offsets = Get-LogOffsets
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
  $res.budgetRemainingMs = [int]((New-TimeSpan -Start (Get-Date) -End $deadline).TotalMilliseconds)
  if ($res.budgetRemainingMs -lt 0) { $res.budgetRemainingMs = 0 }
  # Flagged, not auto-failed: the acceptable start latency is an owner decision
  # (CLWX-43), not this harness's to invent. The flag makes a near-deadline pass
  # impossible to mistake for a prompt one.
  $res.readyBudgetMs = $READY_BUDGET_MS
  $res.withinDocumentedBudget = ($null -ne $res.timeToFirstOwnedListenerMs -and $res.timeToFirstOwnedListenerMs -le $READY_BUDGET_MS)
  # Readiness arriving in the last tenth of the observation window is a timeout
  # that happened to land, not a pass.
  $res.readyInFinalTenth = ($null -ne $res.timeToStableReadyMs -and $res.timeToStableReadyMs -gt (0.9 * $res.budgetMs))
  $res.launchedProcessExited = $proc.HasExited
  if ($proc.HasExited) { $res.launchedExitCode = $proc.ExitCode }
  $res.logs = Collect-Findings $tag $launchedAt $offsets

  # Split the latency rather than reporting one number. The invariant is the
  # finding: if the gateway process starts within a second but takes the same
  # ~76 s to listen whether cold or warm, that is not work - work varies with
  # cache warmth. A constant delay looks like a timeout being waited out: an
  # outbound call, a provider or MCP handshake, or a retry ladder expiring. That
  # is a testable prediction, and far more actionable for the latency card than
  # "209 s, slow", which would send it chasing cold-boot environment cost.
  $gwRequested = $null; $gwStarted = $null
  foreach ($lf in (Get-ChildItem $evidence -Filter "log-$tag-*" -File -ErrorAction SilentlyContinue)) {
    foreach ($line in (Get-Content $lf.FullName -ErrorAction SilentlyContinue)) {
      $m = $tsRe2.Match($line)
      if (-not $m.Success) { continue }
      [datetime] $t = [datetime]::MinValue
      if (-not [datetime]::TryParse($m.Groups[1].Value, [ref] $t)) { continue }
      if (-not $gwRequested -and $line -match 'Gateway start requested') { $gwRequested = $t.ToUniversalTime() }
      if (-not $gwStarted -and $line -match 'Gateway process started') { $gwStarted = $t.ToUniversalTime() }
    }
  }
  $res.gatewayStartRequestedAt = if ($gwRequested) { $gwRequested.ToString('o') } else { $null }
  $res.gatewayProcessStartedAt = if ($gwStarted) { $gwStarted.ToString('o') } else { $null }
  $res.launchToGatewayProcessMs = if ($gwStarted) { [int]((New-TimeSpan -Start $launchedAt.ToUniversalTime() -End $gwStarted).TotalMilliseconds) } else { $null }
  $res.gatewayProcessToListenMs = if ($gwStarted -and $firstOwnedAt) { [int]((New-TimeSpan -Start $gwStarted -End ([datetime]::Parse($firstOwnedAt).ToUniversalTime())).TotalMilliseconds) } else { $null }

  if ($res.stableReady -and $res.windowShown -and -not $res.secondGuiInstance -and -not $res.readyInFinalTenth) {
    # The verdict stays inside the contract's four states. DEGRADED is a
    # CLASSIFICATION recorded alongside a typed result, not a fifth state - a
    # floating extra state is the composed-verdict problem in a new costume, and
    # it would let a measured miss against a documented figure read as neither a
    # pass nor a failure. The harness puts the measured number and the documented
    # threshold side by side; it does not get to decide the threshold is
    # negotiable.
    if ($res.withinDocumentedBudget) {
      $res.result = 'PASS'
      $res.classification = 'WITHIN_DOCUMENTED_BUDGET'
    } else {
      $res.result = 'FAIL'
      $res.classification = 'DEGRADED_STARTED_BUT_OVER_DOCUMENTED_BUDGET'
      $res.reason = "started and held readiness, but took $($res.timeToFirstOwnedListenerMs) ms to bind against the documented $READY_BUDGET_MS ms expectation ($($res.timeToFirstOwnedListenerMs / $READY_BUDGET_MS)x)"
    }
  } else {
    $res.result = 'FAIL'
    $res.classification = 'DID_NOT_REACH_STABLE_OWNED_READINESS'
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
# M7: a receipt that cannot name the script revision that produced it cannot be
# attributed - which matters here because a retracted earlier revision's receipts
# share this lineage.
$r.resolvedAppExe = $appExe
$r.driverPath = $PSCommandPath
$r.driverSha256 = if ($PSCommandPath -and (Test-Path $PSCommandPath)) { (Get-FileHash -Algorithm SHA256 -Path $PSCommandPath).Hash.ToLower() } else { $null }
$r.status = 'COMPLETE'
$r.runId = $runId
$r.autoShutdownDueAt = $bootedAt.AddSeconds(28800).ToUniversalTime().ToString('o')
$r.at = (Get-Date).ToUniversalTime().ToString('o')
$r.driverVersion = 2
# M8: isElevated=false proves not-elevated, NOT standard-user - an unelevated
# administrator yields the same value - and $env:USERNAME is settable by the very
# account under test. "The principal is not an administrator" is the premise of
# this whole design, so it has to be evidenced from the token and group
# membership, not from an environment variable.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$r.identityName = $identity.Name
$r.identitySid = $identity.User.Value
$r.envUserName = "$env:USERNAME"
$r.envUserNameMatchesToken = ($identity.Name -like "*\$env:USERNAME")
$r.sessionName = "$env:SESSIONNAME"
$r.isElevated = ([Security.Principal.WindowsPrincipal] $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$adminSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
$r.tokenGroupsIncludeAdministrators = ($identity.Groups | Where-Object { $_.Value -eq $adminSid.Value }) -ne $null
try {
  $r.inAdministratorsGroup = @(Get-LocalGroupMember -Group 'Administrators' -ErrorAction Stop |
    Where-Object { $_.SID.Value -eq $identity.User.Value }).Count -gt 0
} catch { $r.inAdministratorsGroup = 'UNKNOWN' }
$r.standardUserProven = (-not $r.isElevated -and $r.tokenGroupsIncludeAdministrators -eq $false -and $r.inAdministratorsGroup -eq $false)
Note "driver v2 start user=$env:USERNAME session=$env:SESSIONNAME elevated=$($r.isElevated)"

# Install only if absent; a present install is reported with its identity.
$installer = 'C:\Users\Public\Downloads\moe30.exe'
$expected = '9f8a2dc5fc5c238d49935a7f1b0b9b90205c104ddf933124196c62210114aff7'
$r.appPresentBefore = Test-Path $appExe
if (-not $r.appPresentBefore) {
  if (-not (Test-Path $installer)) {
    $r.result = 'BLOCKED'; $r.reason = 'no app and no installer'
    # BOM-free UTF-8, not ascii: ascii turns any non-ASCII in a collected log line
# into "?", which is lossy for evidence. A BOM would break consumers that parse
# the JSON, hence WriteAllText with an explicit no-BOM encoding.
$r | ConvertTo-Json -Depth 8 | ForEach-Object { [System.IO.File]::WriteAllText((Join-Path $evidence 'receipt.json'), $_, (New-Object Text.UTF8Encoding($false))) }
    exit 1
  }
  $r.installerSha256 = (Get-FileHash -Algorithm SHA256 -Path $installer).Hash.ToLower()
  if ($r.installerSha256 -ne $expected) {
    $r.result = 'BLOCKED'; $r.reason = 'installer hash mismatch'
    # BOM-free UTF-8, not ascii: ascii turns any non-ASCII in a collected log line
# into "?", which is lossy for evidence. A BOM would break consumers that parse
# the JSON, hence WriteAllText with an explicit no-BOM encoding.
$r | ConvertTo-Json -Depth 8 | ForEach-Object { [System.IO.File]::WriteAllText((Join-Path $evidence 'receipt.json'), $_, (New-Object Text.UTF8Encoding($false))) }
    exit 1
  }
  $p = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -Wait
  $r.installExitCode = $p.ExitCode
  # The installer schedules a detached stale-directory cleanup ~60 s later, and
  # its Defender exclusion needs elevation that a standard user cannot get, with a
  # documented 10-30 s first-launch penalty as a result. Both land inside the first
  # case's window, so record when the install finished: a slow first case can then
  # be attributed to install aftermath rather than to the application.
  $r.installCompletedAt = (Get-Date).ToUniversalTime().ToString('o')
  $r.installAftermathNote = 'Installer fires a detached cleanup ~60s post-install; Defender exclusion requires elevation and silently fails for a standard user (documented 10-30s fresh-launch penalty).'
}
$r.appPresentAfter = Test-Path $appExe
if ($r.appPresentAfter) {
  $r.installedProductVersion = (Get-Item $appExe).VersionInfo.ProductVersion
  $r.installedExeSha256 = (Get-FileHash -Algorithm SHA256 -Path $appExe).Hash.ToLower()
}

Stop-App

# --- Case 1: fresh state ----------------------------------------------------
# Any prior .openclaw is moved aside, not deleted, so nothing is destroyed.
# M9: fresh state is ENFORCED here, not merely observed - but it must also be
# proven, so record what was moved aside and how much of it there was. Nothing is
# deleted.
$r.priorStateExisted = Test-Path $openclaw
if ($r.priorStateExisted) {
  $r.priorStateFileCount = @(Get-ChildItem $openclaw -Recurse -File -ErrorAction SilentlyContinue).Count
  $aside = Join-Path $evidence 'preexisting-openclaw'
  Move-Item $openclaw $aside -Force -ErrorAction SilentlyContinue
  $r.priorStateMovedTo = $aside
  $r.priorStateMoveVerified = ((Test-Path $aside) -and -not (Test-Path $openclaw))
}
$r.case1StartedFromEmptyState = -not (Test-Path $openclaw)
$r.case1 = Invoke-Case 'case1-fresh' $ColdBudgetSeconds
Stop-App

# --- Case 2: existing state database, same user ------------------------------
# The database now on disk was written by THIS account's own app during case 1,
# so there is no cross-user DPAPI or migration confound. This is the criterion.
$r.case2StateFileCount = @(Get-ChildItem $openclaw -Recurse -File -ErrorAction SilentlyContinue).Count
$sq = Get-ChildItem $openclaw -Recurse -Filter 'openclaw.sqlite' -ErrorAction SilentlyContinue | Select-Object -First 1
$r.case2SqliteBytes = if ($sq) { $sq.Length } else { $null }
if ($r.case2StateFileCount -gt 0) {
  $r.case2 = Invoke-Case 'case2-existing-db' $WarmBudgetSeconds
  Stop-App
} else {
  $r.case2 = [ordered]@{ tag = 'case2-existing-db'; result = 'NOT_RUN'; reason = 'case 1 left no state to reuse' }
}

$c1 = $r.case1.result; $c2 = $r.case2.result
# Typed verdicts only. A composed string such as "case1=PASS case2=NOT_RUN" is
# not a verdict and, worse, CONTAINS the substring PASS - any grep or automation
# scanning for it would match a non-pass outcome.
$r.case1Result = $c1
$r.case2Result = $c2
$r.case1Classification = $r.case1.classification
$r.case2Classification = $r.case2.classification
$r.result = if ($c1 -eq 'PASS' -and $c2 -eq 'PASS') { 'PASS' }
            elseif ($c1 -like 'BLOCKED*' -or $c2 -like 'BLOCKED*') { 'BLOCKED' }
            elseif ($c1 -eq 'FAIL' -or $c2 -eq 'FAIL') { 'FAIL' }
            elseif ($c1 -eq 'NOT_RUN' -and $c2 -eq 'NOT_RUN') { 'NOT_RUN' }
            else { 'INCOMPLETE' }
$r.criterion = ("Installed startup reaches Gateway readiness - a listener on 127.0.0.1:$PORT owned by the app's own " +
                "process, held continuously for at least $STABLE_MS ms, with a visible window and no second GUI instance.")
$r.notClaimed = ('Readiness here is an owned, stable TCP listener, which is stronger than a running process but weaker ' +
                 'than an in-app assertion that a turn completes. Ordinary chat, the doctor-repair path, and all ' +
                 'document, browser, tenant and external-tester criteria are NOT_RUN.')
# BOM-free UTF-8, not ascii: ascii turns any non-ASCII in a collected log line
# into "?", which is lossy for evidence. A BOM would break consumers that parse
# the JSON, hence WriteAllText with an explicit no-BOM encoding.
$r | ConvertTo-Json -Depth 8 | ForEach-Object { [System.IO.File]::WriteAllText((Join-Path $evidence 'receipt.json'), $_, (New-Object Text.UTF8Encoding($false))) }
Note "driver v2 done result=$($r.result)"
