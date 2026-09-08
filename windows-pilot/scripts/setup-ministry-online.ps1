# Requires only Windows PowerShell 5.1. The private config and key stay local.
[CmdletBinding()]
param(
  [string] $ConfigPath = (Join-Path $PSScriptRoot 'ministry-online.private.json'),
  [switch] $Json
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Assert-SetupRegularPath([string] $Path) {
  if ($Path.StartsWith('\\')) { throw 'FILE_PATH_INVALID' }
  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'FILE_PATH_INVALID'
    }
  }
}

function Assert-MinistryAppClosed {
  if (@(Get-Process -Name 'Ministry of Education' -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'APP_RUNNING'
  }
  $nodes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'")
  if (@($nodes | Where-Object {
    $_.ExecutablePath -like '*\Ministry of Education\resources\*\node.exe' -or
    $_.CommandLine -like '*\Ministry of Education\resources\openclaw\openclaw.mjs*'
  }).Count -gt 0) { throw 'APP_RUNNING' }
}

function Set-SetupOwnerOnly([string] $Path, [switch] $Directory) {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $sections = [Security.AccessControl.AccessControlSections]'Access,Owner'
  if ($Directory) {
    $acl = [IO.Directory]::GetAccessControl($Path, $sections)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $sid, [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
      [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
  } else {
    $acl = [IO.File]::GetAccessControl($Path, $sections)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)
  }
  # These files must already belong to this user. Persist only DACL changes;
  # assigning an owner again can require a privilege absent from standard users.
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) {
    throw 'SAVE_FAILED'
  }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($existing in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
    $acl.RemoveAccessRuleSpecific($existing)
  }
  $acl.AddAccessRule($rule)
  if ($Directory) { [IO.Directory]::SetAccessControl($Path, $acl) }
  else { [IO.File]::SetAccessControl($Path, $acl) }
}

function Read-MinistrySetupInput([string] $Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  Assert-SetupRegularPath $fullPath
  if (-not [IO.File]::Exists($fullPath) -or (Get-Item -LiteralPath $fullPath).Length -gt 16384) {
    throw 'CONFIG_INVALID'
  }
  try {
    $configText = [IO.File]::ReadAllText($fullPath)
    if (-not $configText.TrimStart().StartsWith('{')) { throw 'CONFIG_INVALID' }
    $config = $configText | ConvertFrom-Json
  } catch { throw 'CONFIG_INVALID' }
  if ($null -eq $config -or $config -isnot [pscustomobject]) { throw 'CONFIG_INVALID' }
  $allowed = @('baseUrl', 'apiKeyFile', 'providerId', 'label', 'model', 'models', 'apiProtocol', 'enabled', 'setDefault', 'setPreferredChannel')
  foreach ($property in $config.PSObject.Properties) {
    if ($allowed -cnotcontains $property.Name) { throw 'CONFIG_INVALID' }
  }
  $values = @{}
  foreach ($property in $config.PSObject.Properties) { $values[$property.Name] = $property.Value }
  $uri = $null
  if ($values['baseUrl'] -isnot [string] -or
      -not [Uri]::TryCreate($values.baseUrl.Trim(), [UriKind]::Absolute, [ref] $uri) -or
      $uri.Scheme -ne 'https' -or -not $uri.Host -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
      -not $uri.AbsolutePath.TrimEnd('/').EndsWith('/v1', [StringComparison]::Ordinal)) {
    throw 'CONFIG_INVALID'
  }
  foreach ($pair in @(@('providerId', 'moe-cloud-gateway'), @('label', 'Ministry Online'), @('apiProtocol', 'openai-completions'))) {
    if ($values.ContainsKey($pair[0]) -and $values[$pair[0]] -cne $pair[1]) { throw 'CONFIG_INVALID' }
  }
  foreach ($name in @('enabled', 'setDefault', 'setPreferredChannel')) {
    if ($values.ContainsKey($name) -and ($values[$name] -isnot [bool] -or $values[$name] -ne $true)) { throw 'CONFIG_INVALID' }
  }
  $aliases = @('moe-demo-pro', 'moe-demo')
  $model = 'moe-demo-pro'
  if ($values.ContainsKey('model')) {
    if ($values.model -isnot [string] -or $aliases -cnotcontains $values.model) { throw 'CONFIG_INVALID' }
    $model = $values.model
  }
  if ($values.ContainsKey('models')) {
    if ($values.models -isnot [Array] -or $values.models.Count -ne 2 -or
        @($values.models | Where-Object { $_ -isnot [string] -or $aliases -cnotcontains $_ }).Count -ne 0 -or
        @($values.models | Select-Object -Unique).Count -ne 2) { throw 'CONFIG_INVALID' }
  }
  $keyName = $values['apiKeyFile']
  if ($keyName -isnot [string] -or -not $keyName -or $keyName -in @('.', '..') -or
      $keyName.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or
      [IO.Path]::GetFileName($keyName) -cne $keyName) { throw 'KEY_INVALID' }
  $keyPath = Join-Path ([IO.Path]::GetDirectoryName($fullPath)) $keyName
  Assert-SetupRegularPath $keyPath
  if (-not [IO.File]::Exists($keyPath) -or (Get-Item -LiteralPath $keyPath).Length -gt 8192) { throw 'KEY_INVALID' }
  $key = [IO.File]::ReadAllText($keyPath).Trim()
  if (-not $key -or $key -match '\s|[\x00-\x1f\x7f]') { throw 'KEY_INVALID' }
  $seed = [ordered]@{
    enabled = $true; providerId = 'moe-cloud-gateway'; label = 'Ministry Online'
    baseUrl = $uri.AbsoluteUri.TrimEnd('/'); apiKeyFile = 'cloud-gateway.key'
    model = $model; models = $aliases; apiProtocol = 'openai-completions'
    setDefault = $true; setPreferredChannel = $true
  }
  return @{ Config = ($seed | ConvertTo-Json -Depth 4); Key = $key }
}

function Move-SetupFileAtomically([string] $Source, [string] $Destination) {
  if ([IO.File]::Exists($Destination)) {
    [IO.File]::Replace($Source, $Destination, [System.Management.Automation.Language.NullString]::Value)
  } else {
    [IO.File]::Move($Source, $Destination)
  }
}

function Get-SetupFailureDiagnostic($Failure, [string] $Phase) {
  # Types and source line numbers only: exception messages can contain private input.
  return [pscustomobject]@{
    phase = $Phase
    exceptionType = $Failure.Exception.GetType().FullName
    hresult = $Failure.Exception.HResult
    innerExceptionType = $(if ($Failure.Exception.InnerException) { $Failure.Exception.InnerException.GetType().FullName } else { $null })
    innerHresult = $(if ($Failure.Exception.InnerException) { $Failure.Exception.InnerException.HResult } else { $null })
    line = $Failure.InvocationInfo.ScriptLineNumber
  }
}

function Invoke-MinistryOnlineSetup([string] $InputConfigPath, [switch] $Diagnostic) {
  $lock = $null; $lockPath = $null; $stage = $null; $backup = $null
  $updated = @(); $original = @{}; $targets = @{}; $backupId = $null
  $phase = 'environment'
  try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'WINDOWS_REQUIRED' }
    $overrides = @([Environment]::GetEnvironmentVariables().Keys | Where-Object {
      ($_ -like 'CLAWX_CLOUD_GATEWAY_*' -or $_ -in @('CLAWX_E2E', 'CLAWX_USER_DATA_DIR')) -and
      [Environment]::GetEnvironmentVariable($_)
    })
    if ($overrides.Count -gt 0) { throw 'ENVIRONMENT_OVERRIDE' }
    $phase = 'app-closed'
    Assert-MinistryAppClosed
    $phase = 'read-input'
    $seedInput = Read-MinistrySetupInput $InputConfigPath
    $phase = 'user-data'
    if (-not $env:APPDATA -or -not [IO.Path]::IsPathRooted($env:APPDATA)) { throw 'FILE_PATH_INVALID' }
    $userData = Join-Path $env:APPDATA 'Ministry of Education'
    Assert-SetupRegularPath $userData
    [IO.Directory]::CreateDirectory($userData) | Out-Null
    $lockPath = Join-Path $userData '.ministry-online-setup.lock'
    Assert-SetupRegularPath $lockPath
    $phase = 'lock'
    try { $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') } catch { throw 'SETUP_BUSY' }
    $phase = 'existing-files'
    foreach ($name in @('cloud-gateway.key', 'cloud-gateway.json')) {
      $targets[$name] = Join-Path $userData $name
      Assert-SetupRegularPath $targets[$name]
      if (Test-Path -LiteralPath $targets[$name] -PathType Container) { throw 'FILE_PATH_INVALID' }
      $original[$name] = [IO.File]::Exists($targets[$name])
    }
    if ($original['cloud-gateway.key'] -and $original['cloud-gateway.json'] -and
        [IO.File]::ReadAllText($targets['cloud-gateway.key']) -ceq $seedInput.Key -and
        [IO.File]::ReadAllText($targets['cloud-gateway.json']) -ceq $seedInput.Config) {
      $phase = 'unchanged-key-acl'
      Set-SetupOwnerOnly $targets['cloud-gateway.key']
      return [pscustomobject]@{ status = 'UNCHANGED'; code = 'OK'; changed = $false; backupId = $null }
    }
    $phase = 'stage-directory'
    $stage = Join-Path $userData ('.ministry-online-stage-' + [guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    $phase = 'stage-directory-acl'
    Set-SetupOwnerOnly $stage -Directory
    $phase = 'stage-files'
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $stage 'cloud-gateway.key'), $seedInput.Key, $utf8)
    [IO.File]::WriteAllText((Join-Path $stage 'cloud-gateway.json'), $seedInput.Config, $utf8)
    $phase = 'stage-key-acl'
    Set-SetupOwnerOnly (Join-Path $stage 'cloud-gateway.key')
    if (@($original.Values | Where-Object { $_ }).Count -gt 0) {
      $phase = 'backup-directory'
      $backupRoot = Join-Path $userData '.ministry-online-backups'
      Assert-SetupRegularPath $backupRoot
      [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
      Set-SetupOwnerOnly $backupRoot -Directory
      $backupId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N')
      $backup = Join-Path $backupRoot $backupId
      [IO.Directory]::CreateDirectory($backup) | Out-Null
      Set-SetupOwnerOnly $backup -Directory
      $phase = 'backup-files'
      foreach ($name in $targets.Keys) {
        if ($original[$name]) {
          $backupFile = Join-Path $backup $name
          [IO.File]::Copy($targets[$name], $backupFile, $false)
          Set-SetupOwnerOnly $backupFile
        }
      }
    }
    # The app must stay closed throughout the short two-file commit.
    $phase = 'recheck-app-closed'
    Assert-MinistryAppClosed
    foreach ($name in @('cloud-gateway.key', 'cloud-gateway.json')) {
      $phase = $(if ($name -eq 'cloud-gateway.key') { 'commit-key' } else { 'commit-config' })
      Move-SetupFileAtomically (Join-Path $stage $name) $targets[$name]
      $updated += $name
      if ($name -eq 'cloud-gateway.key') {
        $phase = 'committed-key-acl'
        Set-SetupOwnerOnly $targets[$name]
      }
    }
    return [pscustomobject]@{ status = 'READY'; code = 'OK'; changed = $true; backupId = $backupId }
  } catch {
    $failureDiagnostic = $(if ($Diagnostic) { Get-SetupFailureDiagnostic $_ $phase } else { $null })
    $code = $_.Exception.Message
    $known = @('APP_RUNNING', 'CONFIG_INVALID', 'KEY_INVALID', 'FILE_PATH_INVALID', 'SETUP_BUSY', 'ENVIRONMENT_OVERRIDE', 'WINDOWS_REQUIRED')
    if ($known -cnotcontains $code) { $code = 'SAVE_FAILED' }
    try {
      foreach ($name in $updated) {
        if ($original[$name]) {
          $restore = Join-Path $stage ('restore-' + $name)
          [IO.File]::Copy((Join-Path $backup $name), $restore, $false)
          Move-SetupFileAtomically $restore $targets[$name]
          if ($name -eq 'cloud-gateway.key') { Set-SetupOwnerOnly $targets[$name] }
        } else { [IO.File]::Delete($targets[$name]) }
      }
    } catch {
      $code = 'RESTORE_FAILED'
      if ($Diagnostic) { $failureDiagnostic = Get-SetupFailureDiagnostic $_ 'restore' }
    }
    $status = 'FAILED'
    if ($code -in @('APP_RUNNING', 'SETUP_BUSY', 'ENVIRONMENT_OVERRIDE')) { $status = 'BLOCKED' }
    $result = [ordered]@{ status = $status; code = $code; changed = ($code -eq 'RESTORE_FAILED'); backupId = $backupId }
    if ($Diagnostic) { $result.diagnostic = $failureDiagnostic }
    return [pscustomobject] $result
  } finally {
    if ($stage -and [IO.Directory]::Exists($stage)) {
      try { [IO.Directory]::Delete($stage, $true) } catch { }
    }
    if ($lock) {
      $lock.Dispose()
      try { [IO.File]::Delete($lockPath) } catch { }
    }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  $result = Invoke-MinistryOnlineSetup $ConfigPath
  $messages = @{
    OK = 'Online setup is saved. Open Ministry of Education. If you previously selected On this device, choose Online after opening it.'
    APP_RUNNING = 'Close Ministry of Education completely, including its notification-area icon, then run setup again. Setup has not changed your connection files.'
    CONFIG_INVALID = 'The setup bundle is incomplete or has an unsupported connection. Extract the complete private bundle provided by support and try again.'
    KEY_INVALID = 'The private connection file is missing or invalid. Extract the complete private bundle provided by support and try again.'
    FILE_PATH_INVALID = 'Setup needs ordinary local files. Extract the private bundle into a local folder and try again.'
    SETUP_BUSY = 'Another Online setup is running. Wait for it to finish, then try again.'
    ENVIRONMENT_OVERRIDE = 'This Windows session has a development connection override. Contact support to remove that override before setup.'
    WINDOWS_REQUIRED = 'Run this setup on Windows.'
    SAVE_FAILED = 'Setup could not save the connection. Previous connection files were preserved or restored. Keep the app closed and contact support if retrying does not help.'
    RESTORE_FAILED = 'Setup could not finish restoring the previous connection. Keep Ministry of Education closed and contact support.'
  }
  if ($Json) {
    Write-Output ('CLWX_SETUP_RESULT=' + ($result | ConvertTo-Json -Compress))
  } else {
    Write-Output $messages[$result.code]
  }
  if ($result.code -ne 'OK') { exit 1 }
}
