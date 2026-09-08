# Native contract checks: synthetic files in a temporary APPDATA, no network or real profile writes.
[CmdletBinding()]
param([switch] $AclProbeOnly)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows is required for native ACL and atomic-file checks.' }
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$helper = Join-Path $repo 'windows-pilot\scripts\setup-ministry-online.ps1'
. $helper
if ($AclProbeOnly) {
  # No APPDATA, app or credential access: reproduce protection after move/replace.
  $probeRoot = Join-Path ([IO.Path]::GetTempPath()) ('ministry-acl-probe-' + [guid]::NewGuid().ToString('N'))
  $probePhase = 'directory'; $probePassed = 0
  try {
    [IO.Directory]::CreateDirectory($probeRoot) | Out-Null
    Set-SetupOwnerOnly $probeRoot -Directory
    $probePassed++; Write-Output 'PASS protect directory'
    $probeFile = Join-Path $probeRoot 'source.txt'
    $probeTarget = Join-Path $probeRoot 'target.txt'
    $probePhase = 'new-file'
    [IO.File]::WriteAllText($probeFile, 'synthetic-acl-probe')
    Set-SetupOwnerOnly $probeFile
    $probePassed++; Write-Output 'PASS protect new file'
    $probePhase = 'moved-file'
    Move-SetupFileAtomically $probeFile $probeTarget
    Set-SetupOwnerOnly $probeTarget
    $probePassed++; Write-Output 'PASS protect moved file'
    $probePhase = 'replaced-file'
    [IO.File]::WriteAllText($probeFile, 'synthetic-acl-replacement')
    Set-SetupOwnerOnly $probeFile
    Move-SetupFileAtomically $probeFile $probeTarget
    Set-SetupOwnerOnly $probeTarget
    $probePassed++; Write-Output 'PASS protect replaced file'
    $probePhase = 'repeat-and-verify'
    Set-SetupOwnerOnly $probeTarget
    Set-SetupOwnerOnly $probeRoot -Directory
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach ($probePath in @($probeRoot, $probeTarget)) {
      $acl = Get-Acl -LiteralPath $probePath
      $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
      if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid -or
          $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid -or $rules[0].AccessControlType -ne 'Allow' -or
          $rules[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'ACL_CONTRACT_FAILED' }
    }
    $probePassed++; Write-Output 'PASS repeated protection preserves owner-only full control'
  } catch {
    Write-Output ('FAIL ACL probe ' + ((Get-SetupFailureDiagnostic $_ $probePhase) | ConvertTo-Json -Compress))
  } finally {
    if ([IO.Directory]::Exists($probeRoot)) { [IO.Directory]::Delete($probeRoot, $true) }
  }
  [pscustomobject]@{ status = $(if ($probePassed -eq 5) { 'PASS' } else { 'FAIL' }); passed = $probePassed; expected = 5 } | ConvertTo-Json -Compress
  if ($probePassed -ne 5) { exit 1 }
  exit 0
}
Assert-MinistryAppClosed
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('ministry-online-contract-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
Set-SetupOwnerOnly $testRoot -Directory
$originalAppData = $env:APPDATA
$env:APPDATA = Join-Path $testRoot 'appdata'
$bundle = Join-Path $testRoot 'bundle'
[IO.Directory]::CreateDirectory($bundle) | Out-Null
$config = Join-Path $bundle 'ministry-online.private.json'
$keyFile = Join-Path $bundle 'client.key'
$userData = Join-Path $env:APPDATA 'Ministry of Education'
$targetConfig = Join-Path $userData 'cloud-gateway.json'
$targetKey = Join-Path $userData 'cloud-gateway.key'
$utf8 = New-Object Text.UTF8Encoding($false)
$script:passed = 0; $script:failed = 0
$script:originalAtomicMove = ${function:Move-SetupFileAtomically}
$script:failSecondWrite = $false
$script:injectedFailureObserved = $false
function Move-SetupFileAtomically([string] $Source, [string] $Destination) {
  if ($script:failSecondWrite -and [IO.Path]::GetFileName($Source) -eq 'cloud-gateway.json') {
    $script:injectedFailureObserved = $true
    throw 'SYNTHETIC_SECOND_WRITE_FAILURE'
  }
  & $script:originalAtomicMove $Source $Destination
}

function Assert-Contract([bool] $Condition, [string] $Label) {
  if (-not $Condition) {
    $script:lastAssertion = $Label
    throw 'CONTRACT_ASSERTION_FAILED'
  }
}
function Invoke-TestSetup([string] $InputConfigPath) {
  $result = Invoke-MinistryOnlineSetup $InputConfigPath -Diagnostic
  $script:lastSetup = [ordered]@{
    status = $result.status; code = $result.code; changed = $result.changed
    backupPresent = [bool] $result.backupId
  }
  if ($result.PSObject.Properties['diagnostic']) { $script:lastSetup.diagnostic = $result.diagnostic }
  return $result
}
function Write-TestBundle([hashtable] $Changes = @{}, [string] $Key = 'synthetic-client-key-one') {
  $value = @{ baseUrl = 'https://ministry-setup.invalid/v1'; apiKeyFile = 'client.key' }
  foreach ($name in $Changes.Keys) { $value[$name] = $Changes[$name] }
  [IO.File]::WriteAllText($config, ($value | ConvertTo-Json -Depth 4), $utf8)
  [IO.File]::WriteAllText($keyFile, $Key, $utf8)
}
function Invoke-SetupEntryProcess([string] $Program, [string] $Arguments, [string] $ChildAppData) {
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $Program; $start.Arguments = $Arguments
  $start.WorkingDirectory = $testRoot
  $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
  $start.EnvironmentVariables['APPDATA'] = $ChildAppData
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  try {
    [void] $process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.WriteLine(); $process.StandardInput.Close()
    Assert-Contract ($process.WaitForExit(30000)) 'Fresh setup process must finish within 30 seconds'
    $result = [pscustomobject]@{ exitCode = $process.ExitCode; stdout = $stdout.Result; stderr = $stderr.Result }
    $script:lastSetup = @{ phase = 'fresh-process'; exitCode = $result.exitCode; stdoutLength = $result.stdout.Length; stderrLength = $result.stderr.Length }
    return $result
  } finally {
    if (-not $process.HasExited) { $process.Kill(); [void] $process.WaitForExit(5000) }
    $process.Dispose()
  }
}
function Assert-OwnerOnly([string] $Path) {
  $acl = Get-Acl -LiteralPath $Path
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  Assert-Contract $acl.AreAccessRulesProtected 'ACL inheritance must be disabled'
  Assert-Contract ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid) 'Owner must be current user'
  Assert-Contract ($rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $sid -and $rules[0].AccessControlType -eq 'Allow') 'Only current user may access protected files'
}
function Invoke-ContractTest([string] $Name, [scriptblock] $Body) {
  $script:lastAssertion = $null; $script:lastSetup = $null
  $script:injectedFailureObserved = $false
  try { & $Body; $script:passed++; Write-Output ('PASS ' + $Name) }
  catch {
    $script:failed++
    $detail = [ordered]@{
      assertion = $script:lastAssertion
      error = (Get-SetupFailureDiagnostic $_ 'test')
      setup = $script:lastSetup
    }
    Write-Output ('FAIL ' + $Name + ' ' + ($detail | ConvertTo-Json -Depth 5 -Compress))
  }
}

try {
  $entryBundle = Join-Path $testRoot 'private bundle with spaces'
  [IO.Directory]::CreateDirectory($entryBundle) | Out-Null
  $entryHelper = Join-Path $entryBundle 'setup-ministry-online.ps1'
  $entryCmd = Join-Path $entryBundle 'Setup Ministry Online.cmd'
  [IO.File]::Copy($helper, $entryHelper, $false)
  [IO.File]::Copy((Join-Path $repo 'windows-pilot\scripts\Setup Ministry Online.cmd'), $entryCmd, $false)
  [IO.File]::WriteAllText((Join-Path $entryBundle 'ministry-online.private.json'), '{"baseUrl":"https://entrypoint.invalid/v1","apiKeyFile":"client.key"}', $utf8)
  [IO.File]::WriteAllText((Join-Path $entryBundle 'client.key'), 'synthetic-entrypoint-key', $utf8)
  $entryAppData = Join-Path $testRoot 'entrypoint appdata'
  $entryUserData = Join-Path $entryAppData 'Ministry of Education'
  $entryConfig = Join-Path $entryUserData 'cloud-gateway.json'
  $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Invoke-ContractTest 'actual CMD resolves its default config in a fresh process from a bundle path with spaces' {
    $r = Invoke-SetupEntryProcess $env:ComSpec ('/d /c ""' + $entryCmd + '""') $entryAppData
    Assert-Contract ($r.exitCode -eq 0 -and -not $r.stderr) 'CMD entrypoint succeeds without stderr'
    Assert-Contract ($r.stdout.Contains('Online setup is saved.') -and $r.stdout -notmatch 'CLWX_SETUP_RESULT|synthetic|https|backupId') 'CMD displays only friendly setup output'
    $seed = [IO.File]::ReadAllText($entryConfig) | ConvertFrom-Json
    Assert-Contract ($seed.baseUrl -ceq 'https://entrypoint.invalid/v1' -and $seed.providerId -ceq 'moe-cloud-gateway') 'CMD consumes the adjacent private config'
    Assert-Contract ($seed.model -ceq 'moe-demo-pro' -and $seed.apiKeyFile -ceq 'cloud-gateway.key') 'CMD writes the supported seed'
    $entryKey = Join-Path $entryUserData 'cloud-gateway.key'
    Assert-Contract ([IO.File]::ReadAllText($entryKey) -ceq 'synthetic-entrypoint-key') 'CMD writes the separate key'
    Assert-OwnerOnly $entryKey
  }
  Invoke-ContractTest 'fresh PowerShell default config preserves JSON output and idempotence' {
    $r = Invoke-SetupEntryProcess $windowsPowerShell ('-NoProfile -ExecutionPolicy Bypass -File "' + $entryHelper + '" -Json') $entryAppData
    Assert-Contract ($r.exitCode -eq 0 -and -not $r.stderr) 'Fresh JSON entrypoint succeeds without stderr'
    $line = $r.stdout.Trim()
    Assert-Contract ($line.StartsWith('CLWX_SETUP_RESULT=') -and $line -notmatch '[\r\n]|synthetic|https') 'JSON entrypoint emits one private-data-free record'
    $record = $line.Substring('CLWX_SETUP_RESULT='.Length) | ConvertFrom-Json
    Assert-Contract ($record.code -eq 'OK' -and $record.status -eq 'UNCHANGED' -and -not $record.changed) 'Fresh default JSON invocation is idempotent'
    Assert-Contract (($record.PSObject.Properties.Name | Sort-Object) -join ',' -ceq 'backupId,changed,code,status') 'JSON output fields stay allowlisted'
  }
  Invoke-ContractTest 'fresh PowerShell honors an explicit config path instead of the adjacent default' {
    $explicitConfig = Join-Path $entryBundle 'explicit connection.json'
    [IO.File]::WriteAllText($explicitConfig, '{"baseUrl":"https://explicit-entrypoint.invalid/v1","apiKeyFile":"client.key","model":"moe-demo"}', $utf8)
    $r = Invoke-SetupEntryProcess $windowsPowerShell ('-NoProfile -ExecutionPolicy Bypass -File "' + $entryHelper + '" -ConfigPath "' + $explicitConfig + '" -Json') $entryAppData
    Assert-Contract ($r.exitCode -eq 0 -and -not $r.stderr) 'Fresh explicit-path entrypoint succeeds'
    $seed = [IO.File]::ReadAllText($entryConfig) | ConvertFrom-Json
    Assert-Contract ($seed.baseUrl -ceq 'https://explicit-entrypoint.invalid/v1' -and $seed.model -ceq 'moe-demo') 'Explicit config overrides the adjacent default'
  }
  Invoke-ContractTest 'initial setup produces the supported seed without inline key or BOM' {
    Write-TestBundle
    $r = Invoke-TestSetup $config
    Assert-Contract ($r.status -eq 'READY' -and $r.changed -and $null -eq $r.backupId) 'Initial setup result'
    $seed = [IO.File]::ReadAllText($targetConfig) | ConvertFrom-Json
    Assert-Contract ($seed.providerId -ceq 'moe-cloud-gateway' -and $seed.label -ceq 'Ministry Online') 'Provider identity'
    Assert-Contract ($seed.model -ceq 'moe-demo-pro' -and ($seed.models -join ',') -ceq 'moe-demo-pro,moe-demo') 'Public aliases'
    Assert-Contract ($seed.setDefault -eq $true -and $seed.setPreferredChannel -eq $true -and $seed.apiKeyFile -ceq 'cloud-gateway.key') 'Seed options'
    Assert-Contract ($null -eq $seed.PSObject.Properties['apiKey']) 'No inline key'
    Assert-Contract ([IO.File]::ReadAllText($targetKey) -ceq 'synthetic-client-key-one') 'Separate key bytes'
    Assert-Contract ([IO.File]::ReadAllBytes($targetConfig)[0] -eq 123) 'BOM-less JSON'
    Assert-OwnerOnly $targetKey
  }
  Invoke-ContractTest 'identical setup preserves content timestamps and creates no backup' {
    $before = (Get-Item -LiteralPath $targetConfig).LastWriteTimeUtc
    $r = Invoke-TestSetup $config
    Assert-Contract ($r.status -eq 'UNCHANGED' -and -not $r.changed -and $null -eq $r.backupId) 'Idempotent result'
    Assert-Contract ((Get-Item -LiteralPath $targetConfig).LastWriteTimeUtc -eq $before) 'No content rewrite'
    Assert-Contract (-not (Test-Path (Join-Path $userData '.ministry-online-backups'))) 'No redundant backup'
  }
  Invoke-ContractTest 'replacement preserves both old files and unrelated settings with protected backups' {
    $oldConfig = [IO.File]::ReadAllText($targetConfig)
    [IO.File]::WriteAllText((Join-Path $userData 'settings.json'), 'unrelated-settings-sentinel', $utf8)
    Write-TestBundle @{ model = 'moe-demo' } 'synthetic-client-key-two'
    $r = Invoke-TestSetup $config
    Assert-Contract ($r.status -eq 'READY' -and $r.backupId) 'Replacement result'
    $backup = Join-Path (Join-Path $userData '.ministry-online-backups') $r.backupId
    Assert-Contract ([IO.File]::ReadAllText((Join-Path $backup 'cloud-gateway.json')) -ceq $oldConfig) 'Old config preserved'
    Assert-Contract ([IO.File]::ReadAllText((Join-Path $backup 'cloud-gateway.key')) -ceq 'synthetic-client-key-one') 'Old key preserved'
    Assert-Contract ([IO.File]::ReadAllText((Join-Path $userData 'settings.json')) -ceq 'unrelated-settings-sentinel') 'Unrelated settings preserved'
    foreach ($item in @($backup, (Join-Path $backup 'cloud-gateway.key'), (Join-Path $backup 'cloud-gateway.json'), $targetKey)) { Assert-OwnerOnly $item }
  }
  foreach ($case in @(
    @{ name = 'reject HTTP'; change = @{ baseUrl = 'http://ministry-setup.invalid/v1' } },
    @{ name = 'reject query credentials'; change = @{ baseUrl = 'https://ministry-setup.invalid/v1?key=synthetic' } },
    @{ name = 'reject missing v1 path'; change = @{ baseUrl = 'https://ministry-setup.invalid' } },
    @{ name = 'reject upstream model ID'; change = @{ model = 'gemini-2.5-pro' } },
    @{ name = 'reject extra alias'; change = @{ models = @('moe-demo-pro', 'other-model') } },
    @{ name = 'reject inline key'; change = @{ apiKey = 'synthetic-inline-key' } },
    @{ name = 'reject different provider'; change = @{ providerId = 'other-provider' } },
    @{ name = 'reject disabled defaults'; change = @{ setDefault = $false } }
  )) {
    Invoke-ContractTest $case.name {
      $before = [IO.File]::ReadAllText($targetConfig)
      Write-TestBundle $case.change
      $r = Invoke-TestSetup $config
      Assert-Contract ($r.code -eq 'CONFIG_INVALID' -and -not $r.changed) 'Invalid config refused'
      Assert-Contract ([IO.File]::ReadAllText($targetConfig) -ceq $before) 'No change on invalid input'
    }
  }
  Invoke-ContractTest 'reject empty key and bundle path escape' {
    Write-TestBundle @{} ' '
    Assert-Contract ((Invoke-TestSetup $config).code -eq 'KEY_INVALID') 'Empty key refused'
    Write-TestBundle @{ apiKeyFile = '..\outside.key' }
    Assert-Contract ((Invoke-TestSetup $config).code -eq 'KEY_INVALID') 'Path escape refused'
  }
  Invoke-ContractTest 'missing and array-shaped config fail without exposing input' {
    Assert-Contract ((Invoke-TestSetup (Join-Path $bundle 'missing.json')).code -eq 'CONFIG_INVALID') 'Missing config refused'
    [IO.File]::WriteAllText($config, '[{}]', $utf8)
    $r = Invoke-TestSetup $config
    Assert-Contract ($r.code -eq 'CONFIG_INVALID') 'Root array refused'
    $serialized = $r | ConvertTo-Json -Compress
    Assert-Contract ($serialized -notmatch 'https|synthetic|apiKey') 'Allowlisted result'
  }
  Invoke-ContractTest 'concurrent helper refuses without changing files' {
    Write-TestBundle
    $held = [IO.File]::Open((Join-Path $userData '.ministry-online-setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    try { Assert-Contract ((Invoke-TestSetup $config).code -eq 'SETUP_BUSY') 'Concurrent setup refused' }
    finally { $held.Dispose(); [IO.File]::Delete((Join-Path $userData '.ministry-online-setup.lock')) }
  }
  Invoke-ContractTest 'running application name blocks setup without terminating its process' {
    # This is a copied cmd.exe fixture owned by this test, never the installed app.
    $fakeApp = Join-Path $testRoot 'Ministry of Education.exe'
    [IO.File]::Copy($env:ComSpec, $fakeApp, $false)
    $fixtureProcess = Start-Process -FilePath $fakeApp -ArgumentList '/d /c "ping 127.0.0.1 -n 20 >nul"' -WindowStyle Hidden -PassThru
    try {
      Start-Sleep -Milliseconds 200
      Assert-Contract (-not $fixtureProcess.HasExited) 'Fixture process running'
      $r = Invoke-TestSetup $config
      Assert-Contract ($r.code -eq 'APP_RUNNING') 'Open app refused'
      Assert-Contract (-not $fixtureProcess.HasExited) 'Helper did not terminate process'
    } finally {
      try {
        if (-not $fixtureProcess.HasExited) {
          Stop-Process -InputObject $fixtureProcess -Force -ErrorAction SilentlyContinue
        }
        Assert-Contract ($fixtureProcess.WaitForExit(5000)) 'Test-owned fixture must exit before the next case'
      } finally { $fixtureProcess.Dispose() }
    }
  }
  Invoke-ContractTest 'failed second replacement restores the exact previous pair' {
    $oldConfig = [IO.File]::ReadAllText($targetConfig); $oldKey = [IO.File]::ReadAllText($targetKey)
    Write-TestBundle @{} 'synthetic-rollback-key'
    $script:failSecondWrite = $true
    try {
      $r = Invoke-TestSetup $config
      Assert-Contract $script:injectedFailureObserved 'Reached the injected second replacement failure'
      Assert-Contract ($r.code -eq 'SAVE_FAILED' -and -not $r.changed -and $r.backupId) 'Recoverable partial commit'
      Assert-Contract ([IO.File]::ReadAllText($targetConfig) -ceq $oldConfig) 'Previous config restored'
      Assert-Contract ([IO.File]::ReadAllText($targetKey) -ceq $oldKey) 'Previous key restored'
      Assert-OwnerOnly $targetKey
    } finally { $script:failSecondWrite = $false }
  }
  Invoke-ContractTest 'failed first setup removes only its newly committed key' {
    $savedAppData = $env:APPDATA
    $env:APPDATA = Join-Path $testRoot 'fresh-appdata'
    $script:failSecondWrite = $true
    try {
      $r = Invoke-TestSetup $config
      Assert-Contract $script:injectedFailureObserved 'Reached the injected first setup failure'
      Assert-Contract ($r.code -eq 'SAVE_FAILED' -and -not $r.changed) 'Failed initial setup result'
      Assert-Contract (-not (Test-Path (Join-Path $env:APPDATA 'Ministry of Education\cloud-gateway.key'))) 'New key removed'
      Assert-Contract (-not (Test-Path (Join-Path $env:APPDATA 'Ministry of Education\cloud-gateway.json'))) 'No partial config'
    } finally { $env:APPDATA = $savedAppData; $script:failSecondWrite = $false }
  }
} finally {
  $env:APPDATA = $originalAppData
  $script:failSecondWrite = $false
  [IO.Directory]::Delete($testRoot, $true)
}
[pscustomobject]@{ status = $(if ($script:failed -eq 0) { 'PASS' } else { 'FAIL' }); passed = $script:passed; failed = $script:failed } | ConvertTo-Json -Compress
if ($script:failed -gt 0) { exit 1 }
