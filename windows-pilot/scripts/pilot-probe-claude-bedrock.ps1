# pilot-probe-claude-bedrock.ps1
# Read-only probe for Claude Code + Amazon Bedrock readiness on Windows.
# Secrets: never prints AWS keys, Claude tokens, Host API tokens, passwords, email bodies, or Forms URLs.

[CmdletBinding()]
param(
  [string] $AwsRegion = "",
  [switch] $SkipAwsProbe
)

$ErrorActionPreference = "Stop"

function Write-State($name, $value) {
  Write-Output ("STATE:{0}={1}" -f $name, $value)
}

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Add-ClaudeLocalBinToPath {
  $desiredPaths = @(
    (Join-Path $env:APPDATA "npm"),
    (Join-Path $env:USERPROFILE ".local\bin"),
    "$env:ProgramFiles\nodejs",
    "$env:ProgramFiles\Amazon\AWSCLIV2"
  )
  $prefix = @()
  foreach ($path in $desiredPaths) {
    if (Test-Path $path) { $prefix += $path }
  }
  $rest = @($env:Path -split ';' | Where-Object {
    $entry = $_
    $entry -and -not ($prefix | Where-Object { $_ -ieq $entry })
  })
  $env:Path = (@($prefix) + @($rest)) -join ';'
  foreach ($path in $prefix) {
    Write-State "PATH" ("READY:" + $path)
  }
}

function Set-EnvFromClaudeSettings($envSettings) {
  if (-not $envSettings) { return }
  foreach ($name in @(
    "CLAUDE_CODE_USE_BEDROCK",
    "AWS_PROFILE",
    "AWS_REGION",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"
  )) {
    if ($envSettings.PSObject.Properties[$name]) {
      [Environment]::SetEnvironmentVariable($name, [string] $envSettings.$name, "Process")
    }
  }
}

$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"

Add-ClaudeLocalBinToPath

$claudeCommandState = "MISSING"
if (Test-Command "claude") { $claudeCommandState = "PRESENT" }
Write-State "CLAUDE_COMMAND" $claudeCommandState
if (Test-Command "claude") {
  try {
    Write-State "CLAUDE_VERSION" ((& claude --version 2>&1 | Select-Object -First 1))
  } catch {
    Write-State "CLAUDE_VERSION" ("FAILED:" + $_.Exception.Message)
  }
}

Write-State "SETTINGS_PATH" $settingsPath
$settingsExists = "FALSE"
if (Test-Path $settingsPath) { $settingsExists = "TRUE" }
Write-State "SETTINGS_EXISTS" $settingsExists

if (Test-Path $settingsPath) {
  try {
    $settings = Get-Content -Raw -Path $settingsPath | ConvertFrom-Json
    $envSettings = $settings.env
    Set-EnvFromClaudeSettings $envSettings
    $bedrockEnabled = "FALSE"
    if ($envSettings.CLAUDE_CODE_USE_BEDROCK -eq "1") { $bedrockEnabled = "TRUE" }
    Write-State "BEDROCK_ENABLED" $bedrockEnabled
    Write-State "AWS_REGION" ($envSettings.AWS_REGION)
    $hasAwsProfile = "FALSE"
    if ($envSettings.AWS_PROFILE) { $hasAwsProfile = "TRUE" }
    Write-State "HAS_AWS_PROFILE" $hasAwsProfile
    $hasSonnetPin = "FALSE"
    if ($envSettings.ANTHROPIC_DEFAULT_SONNET_MODEL -or $envSettings.ANTHROPIC_MODEL) { $hasSonnetPin = "TRUE" }
    Write-State "HAS_SONNET_PIN" $hasSonnetPin
    $hasHaikuPin = "FALSE"
    if ($envSettings.ANTHROPIC_DEFAULT_HAIKU_MODEL) { $hasHaikuPin = "TRUE" }
    Write-State "HAS_HAIKU_PIN" $hasHaikuPin
    $agentTeams = "FALSE"
    if ($envSettings.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS -eq "1") { $agentTeams = "TRUE" }
    Write-State "AGENT_TEAMS" $agentTeams
  } catch {
    Write-State "SETTINGS_PARSE" ("FAILED:" + $_.Exception.Message)
  }
}

if (-not $AwsRegion) {
  $AwsRegion = $env:AWS_REGION
}
if (-not $AwsRegion) {
  $AwsRegion = "us-east-1"
}
Write-State "AWS_PROBE_REGION" $AwsRegion

$awsCliState = "MISSING"
if (Test-Command "aws") { $awsCliState = "PRESENT" }
Write-State "AWS_CLI" $awsCliState
if (-not $SkipAwsProbe -and (Test-Command "aws")) {
  try {
    $identity = aws sts get-caller-identity --region $AwsRegion --output json 2>$null | ConvertFrom-Json
    Write-State "AWS_IDENTITY_ACCOUNT" $identity.Account
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
} else {
  Write-State "AWS_PROBE" "SKIPPED"
}

Write-State "DONE" "CLAUDE_BEDROCK_PROBE"
