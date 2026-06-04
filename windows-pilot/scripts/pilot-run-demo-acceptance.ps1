# pilot-run-demo-acceptance.ps1
# Runs the Windows demo acceptance loop with safe defaults.
#
# Default behavior is read-only / no external side effects:
# - does not send email
# - does not download attachments
# - does not submit Microsoft Forms
# - writes evidence under Downloads
#
# Mutating behavior:
# - may launch Chrome CDP via a scheduled task
# - may relaunch the installed app with Electron CDP enabled

[CmdletBinding()]
param(
  [string] $Repo = "$env:USERPROFILE\Github\ClawX",
  [string] $EvidenceRoot = "$env:USERPROFILE\Downloads",
  [string] $ElectronEndpoint = "http://127.0.0.1:9223",
  [int] $WaitMs = 10000,
  [switch] $SkipRelaunch,
  [switch] $RunRegressionTests,
  [switch] $RunChatProcedures,
  [switch] $SkipChatProcedures
)

$ErrorActionPreference = "Continue"

function New-SafeName($value) {
  return ($value -replace '[^a-zA-Z0-9._-]+', '-').Trim('-')
}

function Write-Line($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Output $line
  Add-Content -Path $script:RunLog -Value $line
}

function Invoke-Step {
  param(
    [string] $Name,
    [scriptblock] $Script
  )

  $script:Step += 1
  $safeName = New-SafeName $Name
  $outFile = Join-Path $script:Evidence ("{0:00}-{1}.txt" -f $script:Step, $safeName)
  Write-Line ("START {0} -> {1}" -f $Name, $outFile)

  $previousExit = $global:LASTEXITCODE
  $global:LASTEXITCODE = 0
  try {
    & $Script 2>&1 | Tee-Object -FilePath $outFile
    $exitCode = $global:LASTEXITCODE
    if ($null -eq $exitCode) { $exitCode = 0 }
  } catch {
    $_ | Out-String | Tee-Object -FilePath $outFile -Append
    $exitCode = 1
  } finally {
    Add-Content -Path $outFile -Value ("EXIT_CODE={0}" -f $exitCode)
    $script:Results += [ordered]@{
      step = $Name
      exitCode = $exitCode
      path = $outFile
    }
    $global:LASTEXITCODE = $previousExit
  }

  if ($exitCode -eq 0) {
    Write-Line ("PASS {0}" -f $Name)
  } else {
    Write-Line ("FAIL {0} exit={1}" -f $Name, $exitCode)
  }
}

function Test-HttpOk($url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Add-ToolPaths {
  $desiredPaths = @(
    "$env:APPDATA\npm",
    "$env:ProgramFiles\nodejs",
    "$env:ProgramFiles\Git\cmd",
    "$env:ProgramFiles\Git\bin",
    "$env:ProgramFiles\GitHub CLI",
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
}

Add-ToolPaths

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$script:Evidence = Join-Path $EvidenceRoot ("clawx-demo-evidence-" + $stamp)
New-Item -ItemType Directory -Force -Path $script:Evidence | Out-Null
$script:RunLog = Join-Path $script:Evidence "run.log"
$script:Step = 0
$script:Results = @()

Write-Line "ClawX Windows demo acceptance run"
Write-Line ("Repo: {0}" -f $Repo)
Write-Line ("Evidence: {0}" -f $script:Evidence)

if (-not (Test-Path $Repo)) {
  Write-Line ("BLOCKED repo missing: {0}" -f $Repo)
  exit 2
}

Set-Location $Repo
$repoNodeModulesReady = Test-Path (Join-Path $Repo "node_modules")
$repoTypecheckMode = "pending"

Invoke-Step "git-status" { git status --short }
Invoke-Step "tool-versions" {
  node --version
  pnpm --version
  claude --version
  git --version
}
Invoke-Step "claude-bedrock-probe" {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-probe-claude-bedrock.ps1"
}
Invoke-Step "gemini-network" {
  Test-NetConnection generativelanguage.googleapis.com -Port 443
  curl.exe --noproxy "*" --ssl-no-revoke --connect-timeout 10 --max-time 20 -I https://generativelanguage.googleapis.com
}
Invoke-Step "pilot-state-baseline" {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-probe-state.ps1"
}
Invoke-Step "gateway-tail-baseline" {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-tail-gateway-log.ps1" -Lines 220
}
Invoke-Step "chrome-cdp-launch" {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-launch-cdp-task.ps1" -WaitSeconds 30
}
Invoke-Step "outlook-tab-verify" {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-verify-outlook-tab.ps1"
}

if (-not $SkipRelaunch) {
  Invoke-Step "electron-relaunch" {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-relaunch-app-outlook-v2.ps1" -WaitSeconds 60
  }
}

Invoke-Step "safechat-outlook-open" {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-run-electron-cdp-probe.ps1" `
    -Endpoint $ElectronEndpoint `
    -SafeChat `
    -SafeChatMode outlook-open `
    -WaitMs $WaitMs `
    -ArtifactDir $script:Evidence
}

Invoke-Step "safechat-forms-list" {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-run-electron-cdp-probe.ps1" `
    -Endpoint $ElectronEndpoint `
    -SafeChat `
    -SafeChatMode forms-list `
    -WaitMs $WaitMs `
    -ArtifactDir $script:Evidence
}

Invoke-Step "hostapi-outlook-forms-smoke" {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-run-electron-cdp-probe.ps1" `
    -Endpoint $ElectronEndpoint `
    -OutlookSmoke `
    -FormsSmoke `
    -WaitMs $WaitMs `
    -ArtifactDir $script:Evidence
}

Invoke-Step "office-runtime-check" {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-office-runtime-check.ps1"
}

if ($RunChatProcedures -or -not $SkipChatProcedures) {
  Invoke-Step "chat-procedures" {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-run-chat-procedures.ps1" `
      -Repo $Repo `
      -EvidenceRoot $script:Evidence `
      -DownloadsPath (Join-Path $env:USERPROFILE "Downloads") `
      -ElectronEndpoint $ElectronEndpoint `
      -DefaultWaitMs $WaitMs
  }
}

if ($RunRegressionTests) {
  $repoTypecheckMode = "required_with_regression_tests"
  Invoke-Step "provider-tests" {
    pnpm exec vitest run tests/unit/channel-router.test.ts tests/unit/provider-runtime-sync.test.ts
  }
  Invoke-Step "forms-tests" {
    pnpm exec vitest run tests/unit/forms-browser-driver-cdp.test.ts tests/unit/forms-browser-submit-gate.test.ts
  }
  Invoke-Step "asr-tests" {
    pnpm exec vitest run tests/unit/asr-ipc-provider-selection.test.ts tests/unit/asr-feature-flags.test.ts
  }
  Invoke-Step "comms-replay" { pnpm run comms:replay }
  Invoke-Step "comms-compare" { pnpm run comms:compare }
  Invoke-Step "typecheck" { pnpm run typecheck }
} else {
  if ($repoNodeModulesReady) {
    $repoTypecheckMode = "ran"
    Invoke-Step "typecheck" { pnpm run typecheck }
  } else {
    $repoTypecheckMode = "skipped_node_modules_missing"
    Invoke-Step "typecheck-skipped-node-modules-missing" {
      Write-Output "SKIPPED: node_modules is missing in this clean release worktree."
      Write-Output "Runtime acceptance can still pass because the installed Electron app is already packaged."
      Write-Output "Run pnpm install --frozen-lockfile in the repo worktree to enable repo typecheck here."
    }
  }
}

Invoke-Step "gateway-tail-final" {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-tail-gateway-log.ps1" -Lines 260
}

$jsonPath = Join-Path $script:Evidence "step-results.json"
$script:Results | ConvertTo-Json -Depth 6 | Set-Content -Path $jsonPath -Encoding UTF8

$failed = @($script:Results | Where-Object { $_.exitCode -ne 0 })
$electronCdpUp = Test-HttpOk "$ElectronEndpoint/json/version"
$chromeCdpUp = Test-HttpOk "http://127.0.0.1:18792/json/version"
$status = if ($failed.Count -eq 0 -and $electronCdpUp -and $chromeCdpUp) { "READY_SAFE" } else { "NOT_READY" }

$reportPath = Join-Path $script:Evidence "final-report.md"
$report = @(
  "# ClawX Windows Demo Acceptance",
  "",
  "- status: $status",
  "- evidence: $script:Evidence",
  "- repo: $Repo",
  "- generated: $(Get-Date -Format o)",
  "- repo_node_modules: $repoNodeModulesReady",
  "- repo_typecheck: $repoTypecheckMode",
  "- chrome_cdp_18792: $chromeCdpUp",
  "- electron_cdp_9223: $electronCdpUp",
  "- failed_steps: $($failed.Count)",
  "",
  "## Failed Steps",
  ""
)
if ($failed.Count -eq 0) {
  $report += "- none"
} else {
  foreach ($item in $failed) {
    $report += ("- {0}: exit {1} ({2})" -f $item.step, $item.exitCode, $item.path)
  }
}
$report += @(
  "",
  "## Safety",
  "",
  "- No email was sent.",
  "- No attachment was downloaded.",
  "- No Microsoft Form was submitted.",
  "- Send/download/submit gates were tested only through refusal paths.",
  "",
  "## Artifacts",
  "",
  "- step results: $jsonPath",
  "- run log: $script:RunLog",
  "- Electron probe JSON/screenshots: see this evidence directory"
)
$report | Set-Content -Path $reportPath -Encoding UTF8

Write-Line ("FINAL_STATUS {0}" -f $status)
Write-Line ("FINAL_REPORT {0}" -f $reportPath)
Write-Output ("EVIDENCE_DIR={0}" -f $script:Evidence)
Write-Output ("FINAL_REPORT={0}" -f $reportPath)

if ($status -eq "READY_SAFE") {
  exit 0
}
exit 1
