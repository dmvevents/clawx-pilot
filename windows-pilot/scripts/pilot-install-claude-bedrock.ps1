# pilot-install-claude-bedrock.ps1
# Installs/configures Claude Code on the Windows pilot for Amazon Bedrock.
# Idempotent: yes. Mutating: yes, unless -DryRun.
# Secrets: never prints AWS keys, Claude tokens, Host API tokens, passwords, email bodies, or Forms URLs.

[CmdletBinding()]
param(
  [ValidateSet("auto", "winget", "native", "npm", "none")]
  [string] $InstallMethod = "auto",

  [string] $AwsRegion = "us-east-1",
  [string] $AwsProfile = "",
  [string] $SonnetModel = "",
  [string] $HaikuModel = "",

  [switch] $EnableAgentTeams,
  [switch] $SkipInstall,
  [switch] $SkipAwsProbe,
  [switch] $DryRun
)

$ErrorActionPreference = "Stop"

function Write-State($name, $value) {
  Write-Output ("STATE:{0}={1}" -f $name, $value)
}

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Add-ClaudeLocalBinToPath {
  $paths = @(
    (Join-Path $env:APPDATA "npm"),
    (Join-Path $env:USERPROFILE ".local\bin"),
    "$env:ProgramFiles\nodejs",
    "$env:ProgramFiles\Amazon\AWSCLIV2"
  )
  foreach ($path in $paths) {
    if ((Test-Path $path) -and ($env:Path -notlike "*$path*")) {
      $env:Path = "$path;$env:Path"
      Write-State "PATH" ("ADDED:" + $path)
    }
  }
}

function ConvertTo-PlainObject($obj) {
  if ($null -eq $obj) { return $null }
  if ($obj -is [System.Collections.IDictionary]) {
    $hash = [ordered]@{}
    foreach ($key in $obj.Keys) { $hash[$key] = ConvertTo-PlainObject $obj[$key] }
    return $hash
  }
  if ($obj -is [System.Management.Automation.PSCustomObject]) {
    $hash = [ordered]@{}
    foreach ($prop in $obj.PSObject.Properties) { $hash[$prop.Name] = ConvertTo-PlainObject $prop.Value }
    return $hash
  }
  if ($obj -is [System.Collections.IEnumerable] -and -not ($obj -is [string])) {
    $list = New-Object System.Collections.ArrayList
    foreach ($item in $obj) { [void]$list.Add((ConvertTo-PlainObject $item)) }
    return $list
  }
  return $obj
}

function Install-ClaudeCode {
  Add-ClaudeLocalBinToPath

  if ($SkipInstall -or $InstallMethod -eq "none") {
    Write-State "INSTALL" "SKIPPED"
    return
  }

  if (Test-Command "claude") {
    Write-State "INSTALL" "ALREADY_PRESENT"
    return
  }

  $methods = @()
  if ($InstallMethod -eq "auto") { $methods = @("winget", "native", "npm") }
  else { $methods = @($InstallMethod) }

  foreach ($method in $methods) {
    try {
      if ($method -eq "winget") {
        if (-not (Test-Command "winget")) {
          Write-State "INSTALL_WINGET" "UNAVAILABLE"
          continue
        }
        Write-State "INSTALL_WINGET" "START"
        if (-not $DryRun) {
          winget install --id Anthropic.ClaudeCode -e --accept-source-agreements --accept-package-agreements --silent
        }
      } elseif ($method -eq "native") {
        Write-State "INSTALL_NATIVE" "START"
        if (-not $DryRun) {
          $installer = Invoke-RestMethod "https://claude.ai/install.ps1"
          $block = [ScriptBlock]::Create($installer)
          & $block stable
        }
      } elseif ($method -eq "npm") {
        if (-not (Test-Command "npm")) {
          Write-State "INSTALL_NPM" "UNAVAILABLE"
          continue
        }
        Write-State "INSTALL_NPM" "START"
        if (-not $DryRun) {
          npm install -g @anthropic-ai/claude-code@latest
        }
      }

      Add-ClaudeLocalBinToPath
      if ($DryRun -or (Test-Command "claude")) {
        Write-State "INSTALL" ("OK_{0}" -f $method.ToUpperInvariant())
        return
      }
      Write-State ("INSTALL_{0}" -f $method.ToUpperInvariant()) "NO_CLAUDE_ON_PATH"
    } catch {
      Write-State ("INSTALL_{0}" -f $method.ToUpperInvariant()) ("FAILED:" + $_.Exception.Message)
    }
  }

  if (-not $DryRun -and -not (Test-Command "claude")) {
    throw "Claude Code install did not leave a claude command on PATH."
  }
}

function Write-ClaudeSettings {
  $claudeDir = Join-Path $env:USERPROFILE ".claude"
  $settingsPath = Join-Path $claudeDir "settings.json"

  if (-not (Test-Path $claudeDir)) {
    if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null }
  }

  $settings = [ordered]@{}
  if (Test-Path $settingsPath) {
    $raw = Get-Content -Raw -Path $settingsPath
    if ($raw.Trim().Length -gt 0) {
      $settings = ConvertTo-PlainObject ($raw | ConvertFrom-Json)
    }
    $backup = "$settingsPath.bak.$(Get-Date -Format yyyyMMdd-HHmmss)"
    if (-not $DryRun) { Copy-Item -Path $settingsPath -Destination $backup -Force }
    Write-State "SETTINGS_BACKUP" $backup
  }

  if (-not $settings.Contains("env") -or $null -eq $settings["env"]) {
    $settings["env"] = [ordered]@{}
  }
  $envSettings = ConvertTo-PlainObject $settings["env"]

  $envSettings["CLAUDE_CODE_USE_BEDROCK"] = "1"
  $envSettings["AWS_REGION"] = $AwsRegion
  if ($AwsProfile.Trim().Length -gt 0) { $envSettings["AWS_PROFILE"] = $AwsProfile }
  if ($SonnetModel.Trim().Length -gt 0) {
    $envSettings["ANTHROPIC_MODEL"] = $SonnetModel
    $envSettings["ANTHROPIC_DEFAULT_SONNET_MODEL"] = $SonnetModel
  }
  if ($HaikuModel.Trim().Length -gt 0) {
    $envSettings["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = $HaikuModel
  }
  if ($EnableAgentTeams) {
    $envSettings["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] = "1"
  }

  $settings["env"] = $envSettings

  if (-not $settings.Contains("permissions") -or $null -eq $settings["permissions"]) {
    $settings["permissions"] = [ordered]@{}
  }
  $permissions = ConvertTo-PlainObject $settings["permissions"]
  if (-not $permissions.Contains("deny") -or $null -eq $permissions["deny"]) {
    $permissions["deny"] = New-Object System.Collections.ArrayList
  }
  $deny = New-Object System.Collections.ArrayList
  foreach ($item in $permissions["deny"]) { [void]$deny.Add($item) }
  foreach ($pattern in @("Read(**/.env)", "Read(**/.env.*)", "Read(**/*secret*)", "Read(**/*token*)")) {
    if (-not ($deny -contains $pattern)) { [void]$deny.Add($pattern) }
  }
  $permissions["deny"] = $deny
  $settings["permissions"] = $permissions

  Write-State "BEDROCK" "ENABLED"
  Write-State "AWS_REGION" $AwsRegion
  if ($AwsProfile.Trim().Length -gt 0) { Write-State "AWS_PROFILE" $AwsProfile }
  if ($SonnetModel.Trim().Length -gt 0) { Write-State "SONNET_MODEL" $SonnetModel }
  if ($HaikuModel.Trim().Length -gt 0) { Write-State "HAIKU_MODEL" $HaikuModel }
  if ($EnableAgentTeams) { Write-State "AGENT_TEAMS" "ENABLED" }

  if (-not $DryRun) {
    $settings | ConvertTo-Json -Depth 20 | Set-Content -Path $settingsPath -Encoding UTF8
  }
  Write-State "SETTINGS_PATH" $settingsPath
}

function Invoke-SafeProbe {
  if (Test-Command "claude") {
    try {
      $version = (& claude --version 2>&1 | Select-Object -First 1)
      Write-State "CLAUDE_VERSION" $version
    } catch {
      Write-State "CLAUDE_VERSION" ("FAILED:" + $_.Exception.Message)
    }
  } else {
    Write-State "CLAUDE_VERSION" "MISSING"
  }

  if ($SkipAwsProbe) {
    Write-State "AWS_PROBE" "SKIPPED"
    return
  }

  if (-not (Test-Command "aws")) {
    Write-State "AWS_CLI" "MISSING"
    Write-State "AWS_PROBE" "SKIPPED_NO_AWS_CLI"
    return
  }

  Write-State "AWS_CLI" "PRESENT"
  try {
    $identity = aws sts get-caller-identity --region $AwsRegion --output json 2>$null | ConvertFrom-Json
    if ($identity.Account) { Write-State "AWS_IDENTITY_ACCOUNT" $identity.Account }
    else { Write-State "AWS_IDENTITY" "UNKNOWN" }
  } catch {
    Write-State "AWS_IDENTITY" "FAILED_OR_NOT_CONFIGURED"
  }

  try {
    $models = aws bedrock list-foundation-models --region $AwsRegion --by-provider Anthropic --output json 2>$null | ConvertFrom-Json
    $count = 0
    if ($models.modelSummaries) { $count = @($models.modelSummaries).Count }
    Write-State "BEDROCK_ANTHROPIC_MODEL_COUNT" $count
  } catch {
    Write-State "BEDROCK_LIST_MODELS" "FAILED_OR_NOT_AUTHORIZED"
  }
}

Write-State "START" "CLAUDE_BEDROCK_INSTALL"
Install-ClaudeCode
Write-ClaudeSettings
Invoke-SafeProbe
Write-State "DONE" "CLAUDE_BEDROCK_INSTALL"
