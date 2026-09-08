# CLWX-135/25 (moe27) native upgrade-preparation behavioral suite.
#
# Runs the compiled silent NSIS fixture (fixture.nsi built against the ACTUAL
# production ClawXPrepareInstallDirectory macro, commit c5c8590b) sequentially
# against synthetic layouts inside ONE newly created fixture root. Windows
# PowerShell 5.1 compatible. No app execution, no registry/process mutation,
# no broad cleanup: evidence and fixture trees are left in place; only
# handles/PIDs this runner opened are released/stopped. Exceptions become
# failed structured evidence; the summary JSON is always written.
#
# Safety ordering: the unsafe/root-target rejection probe runs FIRST and the
# suite stops (exit 3) unless rejection is proven, before any scenario that
# could conceivably mutate outside the fixture root. The probe only ever uses
# the root of an OS-confirmed UNMAPPED drive letter; testing a real mapped
# drive root or any installed/user-data path is out of scope and requires
# separate static safety review (see README.md). All other scenarios target
# only paths inside the new fixture root.
[CmdletBinding()]
param(
  # Compiled fixture, e.g. tests\windows\nsis-upgrade\out\clawx-upgrade-prepare-fixture.exe
  [Parameter(Mandatory = $true)][string] $FixtureExe,
  # Must NOT already exist; validated then created by this runner. No whitespace (NSIS /D=).
  [string] $FixtureRoot,
  # Optional extra copy target for JSON/evidence (e.g. root's private evidence dir).
  [string] $EvidenceDir,
  [int] $TimeoutSeconds = 180
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows is required to run the native upgrade fixture.' }

Add-Type -Namespace ClawXFixture -Name NativeFile -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(
  string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes,
  uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);
'@

$FixtureExe = (Resolve-Path -LiteralPath $FixtureExe).ProviderPath

# --- Fixture-root validation happens BEFORE anything is created. -----------
if (-not $FixtureRoot) {
  $FixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('clawx-nsis-upgrade-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
}
$FixtureRoot = [IO.Path]::GetFullPath($FixtureRoot).TrimEnd('\')
if (-not [IO.Path]::IsPathRooted($FixtureRoot)) { throw "FixtureRoot must be absolute: $FixtureRoot" }
if ($FixtureRoot -match '\s') { throw "FixtureRoot must not contain whitespace (silent NSIS /D= cannot carry quoted spaces): $FixtureRoot" }
if (Test-Path -LiteralPath $FixtureRoot) { throw "FixtureRoot must be a NEW directory owned by this run: $FixtureRoot" }
if ((@($FixtureRoot -split '\\') | Where-Object { $_ }).Count -lt 3) { throw "Refusing shallow fixture root: $FixtureRoot" }
foreach ($forbidden in @($env:windir, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData)) {
  if ($forbidden -and $FixtureRoot.StartsWith($forbidden.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing fixture root under a system/application area: $FixtureRoot"
  }
}
if ($env:USERPROFILE -and ($FixtureRoot.TrimEnd('\') -ieq $env:USERPROFILE.TrimEnd('\'))) { throw 'Refusing the user profile root as fixture root.' }
$FixtureRoot = [IO.Directory]::CreateDirectory($FixtureRoot).FullName.TrimEnd('\')
$evidenceLocal = [IO.Directory]::CreateDirectory((Join-Path $FixtureRoot 'evidence')).FullName

$script:Scenarios = @()
$ExpectedScenarios = @(
  'unsafe-root-target', 'reparse-target', 'plain-file-target',
  'unrecognized-nonempty-target', 'empty-existing-destination',
  'fresh-install', 'upgrade-with-stale-markers',
  'upgrade-hooks-repeated-prep', 'inner-hook-only-prep',
  'locked-old-file', 'acl-denied-listing')

function Write-Utf8NoBom([string] $Path, [string] $Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function New-OldInstall([string] $Dir) {
  # Synthetic previous owned installation: executable + resources/app.asar +
  # bundled runtime dir + an arbitrary stale runtime sentinel + the moe27
  # lifecycle marker in its real location (resources/openclaw/).
  [IO.Directory]::CreateDirectory((Join-Path $Dir 'resources\openclaw')) | Out-Null
  Write-Utf8NoBom (Join-Path $Dir 'ClawX.exe') 'clawx-fixture-old-payload-executable'
  Write-Utf8NoBom (Join-Path $Dir 'resources\app.asar') 'clawx-fixture-old-payload-asar'
  Write-Utf8NoBom (Join-Path $Dir 'stale-runtime.sentinel') 'stale-runtime-marker'
  Write-Utf8NoBom (Join-Path $Dir 'resources\openclaw\.openclaw-lifecycle-pending') 'lifecycle-pending-marker'
}

function Read-FixtureResult([string] $Path) {
  $lines = @()
  if (Test-Path -LiteralPath $Path) { $lines = @(Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue) }
  $phases = @(); $values = @{}
  foreach ($line in $lines) {
    if ($line -match '^phase=(.+)$') { $phases += $Matches[1] }
    elseif ($line -match '^([^=]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
  }
  New-Object psobject -Property @{ Lines = $lines; Phases = $phases; Values = $values }
}

function Invoke-Fixture([string] $ScenarioDir, [string] $TargetDir, [string] $Mode = '', [bool] $ForceRootTarget = $false) {
  if ($TargetDir -match '\s') { throw "Scenario target must not contain whitespace: $TargetDir" }
  $resultPath = Join-Path $ScenarioDir 'fixture-result.txt'
  $env:CLAWX_FIXTURE_RESULT = $resultPath
  $env:CLAWX_FIXTURE_TARGET = $TargetDir
  if ($Mode) { $env:CLAWX_FIXTURE_MODE = $Mode }
  if ($ForceRootTarget) {
    # Unsafe-root probe only: NSIS exehead startup validates the /D= value
    # before .onInit and reverts an invalid bare root (unmapped drive; roots
    # are also invalid without AllowRootDirInstall) to the compiled
    # placeholder InstallDir — natively proven 2026-09-08 (instdirAtInit was
    # "$TEMP\clawx-upgrade-fixture-unset" for /D=Q:\). The fixture binds
    # $INSTDIR to this exact intended path only under its strict .onInit
    # guards (byte-match to CLAWX_FIXTURE_TARGET, bare "<letter>:\" shape,
    # root OS-absent); the normal mismatch guard still runs afterwards.
    if ($TargetDir -notmatch '^[A-Za-z]:\\$') { throw "ForceRootTarget only accepts a bare drive root: $TargetDir" }
    $env:CLAWX_FIXTURE_FORCE_ROOT_TARGET = $TargetDir
  }
  $proc = $null
  $timedOut = $false
  $exitCode = $null
  try {
    $proc = Start-Process -FilePath $FixtureExe -ArgumentList @('/S', "/D=$TargetDir") -PassThru
    if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
      $timedOut = $true
      # Bounded wait exceeded: stop only the PID this runner started.
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      [void]$proc.WaitForExit(15000)
    }
    if ($proc.HasExited) { $exitCode = $proc.ExitCode }
  } finally {
    if ($proc) { $proc.Dispose() }
    Remove-Item Env:CLAWX_FIXTURE_RESULT -ErrorAction SilentlyContinue
    Remove-Item Env:CLAWX_FIXTURE_TARGET -ErrorAction SilentlyContinue
    Remove-Item Env:CLAWX_FIXTURE_MODE -ErrorAction SilentlyContinue
    Remove-Item Env:CLAWX_FIXTURE_FORCE_ROOT_TARGET -ErrorAction SilentlyContinue
  }
  New-Object psobject -Property @{
    ExitCode = $exitCode
    TimedOut = $timedOut
    Result   = (Read-FixtureResult $resultPath)
  }
}

function Test-FileContent([string] $Path, [string] $Expected) {
  (Test-Path -LiteralPath $Path -PathType Leaf) -and (([IO.File]::ReadAllText($Path)).Trim() -eq $Expected)
}

function New-Scenario([string] $Name, [string] $Description) {
  $dir = [IO.Directory]::CreateDirectory((Join-Path (Join-Path $FixtureRoot 'scenarios') $Name)).FullName
  New-Object psobject -Property @{
    Name = $Name; Description = $Description; Dir = $dir; TargetDir = $null
    ExitCode = $null; TimedOut = $false; Phases = @(); StaleInstallDir = $null
    Assertions = @(); Pass = $false; Status = 'NOT_RUN'
    StartedUtc = (Get-Date).ToUniversalTime().ToString('o'); FinishedUtc = $null
  }
}

function Add-Assertion($Scenario, [string] $Name, [bool] $Pass, [string] $Detail) {
  $Scenario.Assertions += (New-Object psobject -Property @{ name = $Name; pass = $Pass; detail = $Detail })
}

function Complete-Scenario($Scenario, $Run) {
  if ($Run) {
    $Scenario.ExitCode = $Run.ExitCode
    $Scenario.TimedOut = $Run.TimedOut
    $Scenario.Phases = @($Run.Result.Phases)
    if ($Run.Result.Values.ContainsKey('staleInstallDir')) { $Scenario.StaleInstallDir = $Run.Result.Values['staleInstallDir'] }
  }
  $Scenario.Pass = (@($Scenario.Assertions | Where-Object { -not $_.pass }).Count -eq 0) -and (-not $Scenario.TimedOut) -and ($Scenario.Assertions.Count -gt 0)
  if ($Scenario.Pass) { $Scenario.Status = 'PASS' } else { $Scenario.Status = 'FAIL' }
  $Scenario.FinishedUtc = (Get-Date).ToUniversalTime().ToString('o')
  $json = $Scenario | Select-Object Name, Description, TargetDir, ExitCode, TimedOut, Phases, StaleInstallDir, Assertions, Pass, Status, StartedUtc, FinishedUtc | ConvertTo-Json -Depth 6
  Write-Utf8NoBom (Join-Path $evidenceLocal ("scenario-" + $Scenario.Name + '.json')) $json
  $script:Scenarios += $Scenario
  Write-Host ("[{0}] {1} exit={2} timedOut={3}" -f $Scenario.Status, $Scenario.Name, $Scenario.ExitCode, $Scenario.TimedOut)
  foreach ($a in $Scenario.Assertions) {
    $mark = 'ok  '; if (-not $a.pass) { $mark = 'FAIL' }
    Write-Host ("   {0} {1}: {2}" -f $mark, $a.name, $a.detail)
  }
  return $Scenario
}

# Run one scenario body; any exception becomes failed structured evidence
# instead of silently losing the scenario or the summary. Never retries.
function Invoke-ScenarioSafely([string] $Name, [scriptblock] $Body) {
  try {
    return (& $Body)
  } catch {
    $s = New-Scenario $Name ("Scenario '" + $Name + "' threw an exception")
    Add-Assertion $s 'no-unhandled-exception' $false (($_ | Out-String).Trim())
    return (Complete-Scenario $s $null)
  }
}

function Assert-RejectedRun($Scenario, $Run) {
  Add-Assertion $Scenario 'native-exit-nonzero' (($Run.ExitCode -ne $null) -and ($Run.ExitCode -ne 0)) ("exit=" + $Run.ExitCode)
  Add-Assertion $Scenario 'not-timed-out' (-not $Run.TimedOut) ("timedOut=" + $Run.TimedOut)
  Add-Assertion $Scenario 'macro-was-reached' ($Run.Result.Phases -contains 'prepare-start') 'phase prepare-start recorded (failure came from the macro, not fixture guards)'
  Add-Assertion $Scenario 'no-prepare-success' (-not ($Run.Result.Phases -contains 'prepare-success')) 'macro did not report success'
  Add-Assertion $Scenario 'no-simulated-payload' (-not ($Run.Result.Phases -contains 'payload-copied')) 'no simulated payload copy/success flag on the failure path'
}

function Assert-SuccessRun($Scenario, $Run, [string] $Target) {
  Add-Assertion $Scenario 'native-exit-zero' ($Run.ExitCode -eq 0) ("exit=" + $Run.ExitCode)
  Add-Assertion $Scenario 'not-timed-out' (-not $Run.TimedOut) ("timedOut=" + $Run.TimedOut)
  Add-Assertion $Scenario 'prepare-success' ($Run.Result.Phases -contains 'prepare-success') 'macro reported success'
  Add-Assertion $Scenario 'payload-copied' ((Test-FileContent (Join-Path $Target 'ClawX.exe') 'clawx-fixture-new-payload-executable') -and (Test-FileContent (Join-Path $Target 'resources\app.asar') 'clawx-fixture-new-payload-asar')) 'simulated new payload present at the destination'
}

function Get-StaleValue($Run) {
  if ($Run.Result.Values.ContainsKey('staleInstallDir')) { return $Run.Result.Values['staleInstallDir'] }
  return ''
}

# ---------------------------------------------------------------------------
# Scenario 1 (safety gate, must run first): unsafe/root target rejection.
# Uses the ROOT of an OS-confirmed UNMAPPED drive letter so that even a
# regressed macro has nothing real to mutate. A probe against a mapped drive
# root would risk real mutation if rejection regressed; it is deliberately
# NOT implemented and requires separate static safety review (README.md).
# ---------------------------------------------------------------------------
function Invoke-UnsafeRootScenario {
  $s = New-Scenario 'unsafe-root-target' 'Root-of-drive target must be rejected before any filesystem move'
  $used = @((Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Name) | ForEach-Object { $_.ToUpperInvariant() })
  $letter = $null
  foreach ($candidate in @('Q','W','Y','Z','X','V','U','T')) { if ($used -notcontains $candidate) { $letter = $candidate; break } }
  if (-not $letter) {
    Add-Assertion $s 'free-drive-letter' $false 'no unmapped drive letter available; unsafe-root probe cannot run safely'
    return (Complete-Scenario $s $null)
  }
  Add-Assertion $s 'drive-letter-unmapped' (-not (Test-Path -LiteralPath ("${letter}:\"))) ("probe drive ${letter}: is not mapped")
  $s.TargetDir = "${letter}:\"
  # /D= cannot deliver a bare root: NSIS startup validation reverts it to the
  # compiled placeholder before .onInit (natively proven 2026-09-08). Request
  # the fixture's strictly guarded test-only binding of $INSTDIR to this
  # exact OS-confirmed-unmapped root so the ACTUAL macro sees the root target.
  $run = Invoke-Fixture $s.Dir $s.TargetDir '' $true
  $forcedTo = ''; $beforeForce = ''
  if ($run.Result.Values.ContainsKey('forcedTarget')) { $forcedTo = $run.Result.Values['forcedTarget'] }
  if ($run.Result.Values.ContainsKey('instdirBeforeForce')) { $beforeForce = $run.Result.Values['instdirBeforeForce'] }
  Add-Assertion $s 'root-target-bound-exactly' (($run.Result.Phases -contains 'target-forced') -and ($forcedTo -ceq $s.TargetDir)) ("fixture bound `$INSTDIR to the exact intended root '" + $forcedTo + "' (instdirBeforeForce='" + $beforeForce + "', NSIS startup had discarded /D=)")
  Assert-RejectedRun $s $run
  Add-Assertion $s 'macro-rejection-exit-2' ($run.ExitCode -eq 2) ("exit=" + $run.ExitCode + " (SetErrorLevel 2 from ClawXFailInstallPrep, not a fixture guard code 3/4/6)")
  return (Complete-Scenario $s $run)
}

# Scenario 2: reparse-point target must be rejected without touching the
# junction's real destination (a decoy directory inside the fixture root).
function Invoke-ReparseScenario {
  $s = New-Scenario 'reparse-target' 'Junction target rejected; junction and its destination untouched'
  $decoy = Join-Path $s.Dir 'decoy-destination'
  [IO.Directory]::CreateDirectory($decoy) | Out-Null
  Write-Utf8NoBom (Join-Path $decoy 'decoy.sentinel') 'decoy-untouched'
  $junction = Join-Path $s.Dir 'install-dir'
  New-Item -ItemType Junction -Path $junction -Value $decoy | Out-Null
  $s.TargetDir = $junction
  $run = Invoke-Fixture $s.Dir $s.TargetDir
  Assert-RejectedRun $s $run
  $junctionItem = Get-Item -LiteralPath $junction -Force -ErrorAction SilentlyContinue
  $stillReparse = ($junctionItem -ne $null) -and (($junctionItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
  Add-Assertion $s 'junction-preserved' $stillReparse 'junction still exists as a reparse point'
  Add-Assertion $s 'decoy-sentinel-preserved' (Test-FileContent (Join-Path $decoy 'decoy.sentinel') 'decoy-untouched') 'real destination behind the junction untouched'
  Add-Assertion $s 'no-payload-behind-junction' (-not (Test-Path -LiteralPath (Join-Path $decoy 'ClawX.exe'))) 'no payload written through the reparse point'
  return (Complete-Scenario $s $run)
}

# Scenario 3: a plain FILE at the destination path must be rejected and kept.
function Invoke-PlainFileScenario {
  $s = New-Scenario 'plain-file-target' 'Plain file at the destination path rejected and preserved'
  $target = Join-Path $s.Dir 'install-dir'
  Write-Utf8NoBom $target 'plain-file-not-a-directory'
  $s.TargetDir = $target
  $run = Invoke-Fixture $s.Dir $s.TargetDir
  Assert-RejectedRun $s $run
  Add-Assertion $s 'file-preserved' (Test-FileContent $target 'plain-file-not-a-directory') 'the preexisting file is intact at the destination path'
  return (Complete-Scenario $s $run)
}

# Scenario 4: unrecognized nonempty target (no ClawX anchor) is preserved.
function Invoke-UnrecognizedScenario {
  $s = New-Scenario 'unrecognized-nonempty-target' 'Nonempty non-ClawX directory rejected and preserved'
  $target = Join-Path $s.Dir 'install-dir'
  [IO.Directory]::CreateDirectory((Join-Path $target 'user-things')) | Out-Null
  Write-Utf8NoBom (Join-Path $target 'unrelated.txt') 'user-owned-file'
  Write-Utf8NoBom (Join-Path $target 'user-things\nested.txt') 'user-owned-nested'
  $s.TargetDir = $target
  $run = Invoke-Fixture $s.Dir $s.TargetDir
  Assert-RejectedRun $s $run
  Add-Assertion $s 'tree-preserved' ((Test-FileContent (Join-Path $target 'unrelated.txt') 'user-owned-file') -and (Test-FileContent (Join-Path $target 'user-things\nested.txt') 'user-owned-nested')) 'unrecognized directory contents intact at the original path'
  Add-Assertion $s 'no-payload' (-not (Test-Path -LiteralPath (Join-Path $target 'ClawX.exe'))) 'no payload written into the preserved directory'
  return (Complete-Scenario $s $run)
}

# Scenario 5: an EXISTING but empty destination directory is used in place.
function Invoke-EmptyExistingScenario {
  $s = New-Scenario 'empty-existing-destination' 'Existing empty destination accepted; no rename recorded'
  $target = Join-Path $s.Dir 'install-dir'
  [IO.Directory]::CreateDirectory($target) | Out-Null
  $s.TargetDir = $target
  $run = Invoke-Fixture $s.Dir $s.TargetDir
  Assert-SuccessRun $s $run $target
  $stale = Get-StaleValue $run
  Add-Assertion $s 'stale-dir-empty' ($stale -eq '') ("staleInstallDir='" + $stale + "' (nothing was moved)")
  Add-Assertion $s 'no-stale-sibling-created' (@(Get-ChildItem -LiteralPath $s.Dir -Filter 'install-dir._stale_*' -Force -ErrorAction SilentlyContinue).Count -eq 0) 'no ._stale_ sibling appeared'
  return (Complete-Scenario $s $run)
}

# Scenario 6: fresh install into a not-yet-existing destination.
function Invoke-FreshInstallScenario {
  $s = New-Scenario 'fresh-install' 'Nonexistent destination prepared; payload lands; no stale dir recorded'
  $target = Join-Path $s.Dir 'install-dir'
  $s.TargetDir = $target
  $run = Invoke-Fixture $s.Dir $s.TargetDir
  Assert-SuccessRun $s $run $target
  $stale = Get-StaleValue $run
  Add-Assertion $s 'stale-dir-empty' ($stale -eq '') ("staleInstallDir='" + $stale + "' (nothing was moved)")
  return (Complete-Scenario $s $run)
}

# Scenario 7: upgrade over a previous owned installation with stale markers.
# Preexisting install-dir._stale_0 / install-dir._stale_1 siblings exercise
# real rollback-name collision: this invocation must pick a fresh name and
# preserve both. External profile sentinels must stay untouched.
function Invoke-UpgradeStaleScenario {
  $s = New-Scenario 'upgrade-with-stale-markers' 'Old install moved aside wholesale under a fresh ._stale_ name; stale markers absent after upgrade; preexisting ._stale_ siblings and external sentinels preserved; old tree recoverable at the recorded exact path'
  $target = Join-Path $s.Dir 'install-dir'
  New-OldInstall $target
  # Actual rollback-name collisions from "earlier runs".
  $stale0 = $target + '._stale_0'
  [IO.Directory]::CreateDirectory($stale0) | Out-Null
  Write-Utf8NoBom (Join-Path $stale0 'stale0.sentinel') 'stale0-untouched'
  $stale1 = $target + '._stale_1'
  [IO.Directory]::CreateDirectory($stale1) | Out-Null
  Write-Utf8NoBom (Join-Path $stale1 'stale1.sentinel') 'stale1-untouched'
  # Similarly named plain sibling directory (must not be moved/deleted).
  $sibling = Join-Path $s.Dir 'install-dir-old'
  [IO.Directory]::CreateDirectory($sibling) | Out-Null
  Write-Utf8NoBom (Join-Path $sibling 'sibling.sentinel') 'sibling-untouched'
  # External synthetic profile sentinels (.openclaw / AppData shapes) inside
  # the fixture root; never the real user profile.
  $openclawProfile = Join-Path $s.Dir 'external\.openclaw'
  [IO.Directory]::CreateDirectory($openclawProfile) | Out-Null
  Write-Utf8NoBom (Join-Path $openclawProfile 'external.sentinel') 'openclaw-profile-untouched'
  $appData = Join-Path $s.Dir 'external\AppData\Roaming\ClawX'
  [IO.Directory]::CreateDirectory($appData) | Out-Null
  Write-Utf8NoBom (Join-Path $appData 'appdata.sentinel') 'appdata-profile-untouched'

  $s.TargetDir = $target
  $run = Invoke-Fixture $s.Dir $s.TargetDir
  Assert-SuccessRun $s $run $target
  $staleLeft = @(Get-ChildItem -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'stale-runtime.sentinel' -or $_.Name -eq '.openclaw-lifecycle-pending' })
  Add-Assertion $s 'stale-markers-absent' ($staleLeft.Count -eq 0) 'arbitrary stale sentinel and resources\openclaw\.openclaw-lifecycle-pending absent from the upgraded destination (the moe27 defect shape)'
  $stale = Get-StaleValue $run
  Add-Assertion $s 'stale-dir-recorded' ($stale -ne '') ("staleInstallDir='" + $stale + "'")
  Add-Assertion $s 'fresh-collision-free-name' (($stale -ne '') -and ($stale -ine $stale0) -and ($stale -ine $stale1)) 'recorded rollback name does not reuse a preexisting ._stale_ sibling'
  $staleInsideRoot = ($stale -ne '') -and $stale.TrimEnd('\').StartsWith($FixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)
  Add-Assertion $s 'stale-dir-inside-fixture-root' $staleInsideRoot 'recorded moved-aside directory stays inside the owned fixture root'
  $recoverable = $false
  if ($staleInsideRoot -and (Test-Path -LiteralPath $stale -PathType Container)) {
    $recoverable = (Test-FileContent (Join-Path $stale 'ClawX.exe') 'clawx-fixture-old-payload-executable') -and
                   (Test-FileContent (Join-Path $stale 'resources\app.asar') 'clawx-fixture-old-payload-asar') -and
                   (Test-FileContent (Join-Path $stale 'stale-runtime.sentinel') 'stale-runtime-marker') -and
                   (Test-FileContent (Join-Path $stale 'resources\openclaw\.openclaw-lifecycle-pending') 'lifecycle-pending-marker')
  }
  Add-Assertion $s 'old-tree-recoverable-at-recorded-path' $recoverable 'the exact recorded path holds the complete prior tree'
  Add-Assertion $s 'stale0-sibling-preserved' (Test-FileContent (Join-Path $stale0 'stale0.sentinel') 'stale0-untouched') 'preexisting install-dir._stale_0 untouched'
  Add-Assertion $s 'stale1-sibling-preserved' (Test-FileContent (Join-Path $stale1 'stale1.sentinel') 'stale1-untouched') 'preexisting install-dir._stale_1 untouched'
  Add-Assertion $s 'sibling-sentinel-preserved' (Test-FileContent (Join-Path $sibling 'sibling.sentinel') 'sibling-untouched') 'similarly named sibling directory untouched'
  Add-Assertion $s 'external-profiles-preserved' ((Test-FileContent (Join-Path $openclawProfile 'external.sentinel') 'openclaw-profile-untouched') -and (Test-FileContent (Join-Path $appData 'appdata.sentinel') 'appdata-profile-untouched')) 'external .openclaw / AppData sentinels untouched'
  return (Complete-Scenario $s $run)
}

# Scenario 8: a REAL, locally PROVEN Windows rename refusal (owned handle
# without FileShare Delete) makes the macro fail closed and preserve the old
# tree. The refusal is established by a negative-control rename attempt
# inside the fixture BEFORE the installer runs — never assumed. If a child
# file handle does not block the parent rename on this OS/filesystem, the
# runner escalates to a held directory handle (FILE_FLAG_BACKUP_SEMANTICS)
# without Delete sharing, restoring the tree if a control rename succeeded.
function Invoke-LockedFileScenario {
  $s = New-Scenario 'locked-old-file' 'Proven rename refusal fails closed and preserves the old tree'
  $target = Join-Path $s.Dir 'install-dir'
  New-OldInstall $target
  $lockedPath = Join-Path $target 'resources\app.asar'
  $probeDest = $target + '.lockprobe'

  $childHandle = $null
  $dirHandle = $null
  $run = $null
  try {
    # Mechanism 1: open handle on a child file, share ReadWrite but NOT Delete.
    $childHandle = [IO.File]::Open($lockedPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $lockMechanism = 'child-file-handle'
    $renameRefused = $false
    try {
      [IO.Directory]::Move($target, $probeDest)
      # Unexpectedly allowed: restore immediately and escalate.
      [IO.Directory]::Move($probeDest, $target)
    } catch { $renameRefused = $true }

    if (-not $renameRefused) {
      $childHandle.Dispose(); $childHandle = $null
      # Mechanism 2: held handle on the DIRECTORY itself without Delete sharing.
      $GENERIC_READ = 0x80000000; $SHARE_READ_WRITE = 0x3
      $OPEN_EXISTING = 3; $FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
      $dirHandle = [ClawXFixture.NativeFile]::CreateFileW($target, [uint32]$GENERIC_READ, [uint32]$SHARE_READ_WRITE, [IntPtr]::Zero, [uint32]$OPEN_EXISTING, [uint32]$FILE_FLAG_BACKUP_SEMANTICS, [IntPtr]::Zero)
      if ($dirHandle.IsInvalid) { throw ('CreateFileW on directory failed: ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
      $lockMechanism = 'directory-handle'
      try {
        [IO.Directory]::Move($target, $probeDest)
        [IO.Directory]::Move($probeDest, $target) # restore; refusal NOT established
      } catch { $renameRefused = $true }
    }

    Add-Assertion $s 'rename-refusal-proven' $renameRefused ('negative-control rename refused via ' + $lockMechanism + ' (never assumed)')
    if (-not $renameRefused) {
      # Precondition unprovable on this volume; record as failed evidence and
      # do NOT run the fixture against an unlocked tree pretending otherwise.
      return (Complete-Scenario $s $null)
    }

    # The macro retries the rename 5 times with 2s sleeps; keep the bounded
    # wait comfortably above that.
    $s.TargetDir = $target
    $run = Invoke-Fixture $s.Dir $s.TargetDir
  } finally {
    # Release only the handles this runner owns.
    if ($childHandle) { $childHandle.Dispose() }
    if ($dirHandle) { $dirHandle.Dispose() }
  }
  Assert-RejectedRun $s $run
  Add-Assertion $s 'old-tree-preserved-in-place' ((Test-FileContent (Join-Path $target 'ClawX.exe') 'clawx-fixture-old-payload-executable') -and (Test-FileContent $lockedPath 'clawx-fixture-old-payload-asar') -and (Test-FileContent (Join-Path $target 'stale-runtime.sentinel') 'stale-runtime-marker') -and (Test-FileContent (Join-Path $target 'resources\openclaw\.openclaw-lifecycle-pending') 'lifecycle-pending-marker')) 'previous installation fully intact at its original path'
  Add-Assertion $s 'no-stale-dir-recorded' ((Get-StaleValue $run) -eq '') 'no rollback directory claimed on the failure path'
  return (Complete-Scenario $s $run)
}


# Shared post-success checks for the upgrade-shaped scenarios: stale markers
# gone, rollback recorded inside the fixture root, old tree recoverable there.
function Assert-UpgradeOutcome($Scenario, $Run, [string] $Target) {
  $staleLeft = @(Get-ChildItem -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'stale-runtime.sentinel' -or $_.Name -eq '.openclaw-lifecycle-pending' })
  Add-Assertion $Scenario 'stale-markers-absent' ($staleLeft.Count -eq 0) 'stale sentinel and lifecycle marker absent from the upgraded destination'
  $stale = Get-StaleValue $Run
  Add-Assertion $Scenario 'stale-dir-recorded' ($stale -ne '') ("staleInstallDir='" + $stale + "'")
  $staleInsideRoot = ($stale -ne '') -and $stale.TrimEnd('\').StartsWith($FixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)
  Add-Assertion $Scenario 'stale-dir-inside-fixture-root' $staleInsideRoot 'recorded moved-aside directory stays inside the owned fixture root'
  $recoverable = $false
  if ($staleInsideRoot -and (Test-Path -LiteralPath $stale -PathType Container)) {
    $recoverable = (Test-FileContent (Join-Path $stale 'ClawX.exe') 'clawx-fixture-old-payload-executable') -and
                   (Test-FileContent (Join-Path $stale 'resources\openclaw\.openclaw-lifecycle-pending') 'lifecycle-pending-marker')
  }
  Add-Assertion $Scenario 'old-tree-recoverable-at-recorded-path' $recoverable 'the exact recorded path holds the prior tree'
  return $stale
}

# Scenario 9 (bc561eb3): non-elevated path — direct prep, then the ACTUAL
# customUnInstallCheck and customUnInstallCheckCurrentUser hooks repeat the
# prep. The rollback pointer set by the moving invocation must be retained
# verbatim and no stale files may ride in through the repeated invocations.
function Invoke-HooksRepeatedPrepScenario {
  $s = New-Scenario 'upgrade-hooks-repeated-prep' 'Direct prep then actual post-uninstall hooks: rollback pointer retained across repeated invocations'
  $target = Join-Path $s.Dir 'install-dir'
  New-OldInstall $target
  $s.TargetDir = $target
  $run = Invoke-Fixture $s.Dir $s.TargetDir 'hooks'
  Assert-SuccessRun $s $run $target
  Add-Assertion $s 'all-invocations-ran' (($run.Result.Phases -contains 'direct-prep-success') -and ($run.Result.Phases -contains 'hook-uninstall-success') -and ($run.Result.Phases -contains 'hook-currentuser-success')) 'direct prep plus both actual hooks completed'
  $stale = Assert-UpgradeOutcome $s $run $target
  $d = ''; $h1 = ''; $h2 = ''
  if ($run.Result.Values.ContainsKey('staleAfterDirect')) { $d = $run.Result.Values['staleAfterDirect'] }
  if ($run.Result.Values.ContainsKey('staleAfterHook1')) { $h1 = $run.Result.Values['staleAfterHook1'] }
  if ($run.Result.Values.ContainsKey('staleAfterHook2')) { $h2 = $run.Result.Values['staleAfterHook2'] }
  Add-Assertion $s 'rollback-pointer-retained' (($d -ne '') -and ($d -ceq $h1) -and ($d -ceq $h2) -and ($d -ceq $stale)) ("direct='" + $d + "' hook1='" + $h1 + "' hook2='" + $h2 + "' (exact prior pointer kept, never reset)")
  return (Complete-Scenario $s $run)
}

# Scenario 10 (bc561eb3 B1 boundary): UAC inner instance — no direct prep
# (customCheckAppRunning skipped by the template); the actual hooks are the
# ONLY preparation before the payload copy and must fully clean the target.
function Invoke-InnerHookOnlyScenario {
  $s = New-Scenario 'inner-hook-only-prep' 'Inner-instance path: actual post-uninstall hooks alone prepare the destination'
  $target = Join-Path $s.Dir 'install-dir'
  New-OldInstall $target
  $s.TargetDir = $target
  $run = Invoke-Fixture $s.Dir $s.TargetDir 'inner-hooks'
  Assert-SuccessRun $s $run $target
  Add-Assertion $s 'both-hooks-ran' (($run.Result.Phases -contains 'hook-uninstall-success') -and ($run.Result.Phases -contains 'hook-currentuser-success')) 'both actual hooks completed'
  Add-Assertion $s 'no-direct-prep' (-not ($run.Result.Phases -contains 'direct-prep-success')) 'customCheckAppRunning path was not simulated (inner instance)'
  $stale = Assert-UpgradeOutcome $s $run $target
  $h1 = ''; $h2 = ''
  if ($run.Result.Values.ContainsKey('staleAfterHook1')) { $h1 = $run.Result.Values['staleAfterHook1'] }
  if ($run.Result.Values.ContainsKey('staleAfterHook2')) { $h2 = $run.Result.Values['staleAfterHook2'] }
  Add-Assertion $s 'pointer-set-by-hook-and-retained' (($h1 -ne '') -and ($h1 -ceq $h2) -and ($h1 -ceq $stale)) ("hook1='" + $h1 + "' hook2='" + $h2 + "' (first hook moved the tree; second retained the pointer)")
  return (Complete-Scenario $s $run)
}

# Scenario 11 (bc561eb3 B2 boundary): the destination exists but LISTING is
# denied by a real ACL for the current user. Root reproduced the original
# defect as STANDARD user ClawXFresh0908 (22:07:09 UTC): native FindFirst
# errored and the 2841f8c0 macro returned exit 0, copied the payload and
# retained the stale sentinel. The corrected macro must abort instead. The
# same deny rule did NOT block enumeration for the lab admin operator, so an
# unenforced denial is recorded as a FAILED/invalid control — never silently
# accepted as an ordinary upgrade nor skipped.
function Invoke-AclDeniedListingScenario {
  $s = New-Scenario 'acl-denied-listing' 'Unenumerable recognized old tree: abort, no payload, tree retained (never classified empty)'
  $target = Join-Path $s.Dir 'install-dir'
  New-OldInstall $target
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $aclOriginal = Get-Acl -LiteralPath $target   # immutable readback for restore
  $aclMutable = Get-Acl -LiteralPath $target    # separate object to mutate
  $denyRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $sid, [System.Security.AccessControl.FileSystemRights]::ListDirectory,
    [System.Security.AccessControl.InheritanceFlags]::None,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Deny)
  $run = $null
  try {
    $aclMutable.AddAccessRule($denyRule)
    Set-Acl -LiteralPath $target -AclObject $aclMutable
    # Managed negative control: enumeration by THIS user must now be denied.
    $controlDenied = $false
    try { [void]@([IO.Directory]::EnumerateFileSystemEntries($target) | Select-Object -First 1) }
    catch { $controlDenied = $true }
    Add-Assertion $s 'acl-denial-enforced' $controlDenied 'deny ListDirectory ACL actually blocks enumeration for the current user (invalid control otherwise, e.g. admin operator)'
    if (-not $controlDenied) {
      # Unenforced denial (root observed this under lab operator clawxlab):
      # FAIL the control instead of accepting ordinary upgrade behavior.
      return (Complete-Scenario $s $null)
    }
    $s.TargetDir = $target
    $run = Invoke-Fixture $s.Dir $s.TargetDir
  } finally {
    # Restore the saved ACL; if an unexpected rename moved the tree aside,
    # roll back exactly the sibling this scenario produced first.
    if (-not (Test-Path -LiteralPath $target)) {
      $moved = @(Get-ChildItem -LiteralPath $s.Dir -Directory -Filter 'install-dir._stale_*' -Force -ErrorAction SilentlyContinue)
      if ($moved.Count -eq 1) { [IO.Directory]::Move($moved[0].FullName, $target) }
    }
    if (Test-Path -LiteralPath $target) { Set-Acl -LiteralPath $target -AclObject $aclOriginal }
  }
  Add-Assertion $s 'native-findfirst-errored' (($run.Result.Values.ContainsKey('diagFindFirstErrors')) -and ($run.Result.Values['diagFindFirstErrors'] -eq '1')) 'fixture-recorded native FindFirst diagnostic reported Errors before the macro ran'
  Assert-RejectedRun $s $run
  Add-Assertion $s 'no-stale-dir-recorded' ((Get-StaleValue $run) -eq '') 'no rollback directory claimed on the failure path'
  Add-Assertion $s 'old-tree-retained' ((Test-FileContent (Join-Path $target 'ClawX.exe') 'clawx-fixture-old-payload-executable') -and (Test-FileContent (Join-Path $target 'stale-runtime.sentinel') 'stale-runtime-marker') -and (Test-FileContent (Join-Path $target 'resources\openclaw\.openclaw-lifecycle-pending') 'lifecycle-pending-marker')) 'previous installation intact at its original path (checked after ACL restore)'
  return (Complete-Scenario $s $run)
}

# ---------------------------------------------------------------------------
# Sequential execution (single guest); never retry a failed case blindly.
# The summary JSON is written even when a scenario throws.
# ---------------------------------------------------------------------------
Write-Host "fixture: $FixtureExe"
Write-Host "fixture root: $FixtureRoot"
$fatal = $false
$summary = $null
try {
  $unsafe = Invoke-ScenarioSafely 'unsafe-root-target' { Invoke-UnsafeRootScenario }
  if ($unsafe.Status -ne 'PASS') {
    # Rejection of unsafe/root targets is unproven (accepted, inconclusive, or
    # the probe could not run). Stop before anything that could mutate outside
    # the fixture root if the macro misbehaved.
    Write-Warning 'SAFETY STOP: unsafe/root-target rejection is unproven. No further scenarios run until this is fixed and reviewed.'
    $fatal = $true
  }

  if (-not $fatal) {
    [void](Invoke-ScenarioSafely 'reparse-target' { Invoke-ReparseScenario })
    [void](Invoke-ScenarioSafely 'plain-file-target' { Invoke-PlainFileScenario })
    [void](Invoke-ScenarioSafely 'unrecognized-nonempty-target' { Invoke-UnrecognizedScenario })
    [void](Invoke-ScenarioSafely 'empty-existing-destination' { Invoke-EmptyExistingScenario })
    [void](Invoke-ScenarioSafely 'fresh-install' { Invoke-FreshInstallScenario })
    [void](Invoke-ScenarioSafely 'upgrade-with-stale-markers' { Invoke-UpgradeStaleScenario })
    [void](Invoke-ScenarioSafely 'upgrade-hooks-repeated-prep' { Invoke-HooksRepeatedPrepScenario })
    [void](Invoke-ScenarioSafely 'inner-hook-only-prep' { Invoke-InnerHookOnlyScenario })
    [void](Invoke-ScenarioSafely 'locked-old-file' { Invoke-LockedFileScenario })
    [void](Invoke-ScenarioSafely 'acl-denied-listing' { Invoke-AclDeniedListingScenario })
  }
} finally {
  $ranNames = @($script:Scenarios | Select-Object -ExpandProperty Name)
  $notRun = @($ExpectedScenarios | Where-Object { $ranNames -notcontains $_ })
  $summary = New-Object psobject -Property @{
    suite          = 'clwx135-moe27-nsis-upgrade-preparation'
    fixtureExe     = $FixtureExe
    fixtureSha256  = (Get-FileHash -LiteralPath $FixtureExe -Algorithm SHA256).Hash
    fixtureRoot    = $FixtureRoot
    machine        = $env:COMPUTERNAME
    timeoutSeconds = $TimeoutSeconds
    startedBy      = $env:USERNAME
    finishedUtc    = (Get-Date).ToUniversalTime().ToString('o')
    safetyStop     = $fatal
    scenariosNotRun = $notRun
    scenarios      = @($script:Scenarios | Select-Object Name, Description, TargetDir, ExitCode, TimedOut, Phases, StaleInstallDir, Assertions, Pass, Status)
    overallPass    = ((-not $fatal) -and ($notRun.Count -eq 0) -and (@($script:Scenarios | Where-Object { $_.Status -ne 'PASS' }).Count -eq 0))
  }
  $summaryJson = $summary | ConvertTo-Json -Depth 8
  Write-Utf8NoBom (Join-Path $evidenceLocal 'suite-summary.json') $summaryJson
  Write-Host ("summary: " + (Join-Path $evidenceLocal 'suite-summary.json'))

  if ($EvidenceDir) {
    [IO.Directory]::CreateDirectory($EvidenceDir) | Out-Null
    Copy-Item -Path (Join-Path $evidenceLocal '*') -Destination $EvidenceDir -Force
    Write-Host "evidence copied to: $EvidenceDir"
  }
}

if ($fatal) { exit 3 }
if ($summary.overallPass) { Write-Host 'SUITE PASS'; exit 0 }
Write-Host 'SUITE FAIL'
exit 1
