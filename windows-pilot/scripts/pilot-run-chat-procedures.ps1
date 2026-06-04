# pilot-run-chat-procedures.ps1
# Runs repeatable, safe chat procedures against the installed Electron app.
#
# Safe by default:
# - no email send
# - no attachment download
# - no Microsoft Forms submit
# - writes evidence under Downloads
#
# Optional mutation:
# - -Relaunch may relaunch the installed Electron app with CDP 9223 enabled
# - -RunPreflight may launch the separate demo Chrome CDP profile on 18792
# - -SeedDemoDocuments writes sanitized local demo files into Downloads

[CmdletBinding()]
param(
  [string] $Repo = "$env:USERPROFILE\Github\ClawX-release-moe10",
  [string] $ScenarioPath,
  [string] $EvidenceRoot = "$env:USERPROFILE\Downloads",
  [string] $DownloadsPath = "$env:USERPROFILE\Downloads",
  [string] $ElectronEndpoint = "http://127.0.0.1:9223",
  [int] $DefaultWaitMs = 15000,
  [switch] $Relaunch,
  [switch] $RunPreflight,
  [switch] $SeedDemoDocuments
)

$ErrorActionPreference = "Continue"

function New-SafeName($value) {
  return ($value -replace '[^a-zA-Z0-9._-]+', '-').Trim('-')
}

function Write-Line($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  Add-Content -Path $script:RunLog -Value $line
}

function Test-HttpOk($url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Invoke-LoggedCommand {
  param(
    [string] $Name,
    [string] $OutFile,
    [scriptblock] $Script
  )

  Write-Line ("START {0} -> {1}" -f $Name, $OutFile)
  $previousExit = $global:LASTEXITCODE
  $global:LASTEXITCODE = 0
  try {
    $output = & $Script 2>&1
    if ($null -ne $output) {
      $output | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host $_ }
    } else {
      Set-Content -Path $OutFile -Value "" -Encoding UTF8
    }
    $exitCode = $global:LASTEXITCODE
    if ($null -eq $exitCode) { $exitCode = 0 }
  } catch {
    $_ | Out-String | Tee-Object -FilePath $OutFile -Append | ForEach-Object { Write-Host $_ }
    $exitCode = 1
  } finally {
    Add-Content -Path $OutFile -Value ("EXIT_CODE={0}" -f $exitCode)
    $global:LASTEXITCODE = $previousExit
  }
  if ($exitCode -eq 0) {
    Write-Line ("PASS {0}" -f $Name)
  } else {
    Write-Line ("FAIL {0} exit={1}" -f $Name, $exitCode)
  }
  return $exitCode
}

function Get-LatestProbeJson($dir) {
  $json = Get-ChildItem $dir -Filter "clawx-electron-probe*.json" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($json) { return $json.FullName }
  return $null
}

function Read-JsonFile($path) {
  if (-not $path -or -not (Test-Path $path)) { return $null }
  try {
    return Get-Content -Path $path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Add-Reason {
  param(
    [System.Collections.ArrayList] $Reasons,
    [string] $Reason
  )
  [void] $Reasons.Add($Reason)
}

function Expand-ScenarioText($value) {
  if ($null -eq $value) { return "" }
  return ([string] $value).Replace("{{DOWNLOADS_PATH}}", $script:DownloadsPath)
}

function Get-SafeChatCorpus($History) {
  $parts = New-Object System.Collections.ArrayList
  if ($History.finalAnswerTextSample) {
    [void] $parts.Add([string] $History.finalAnswerTextSample)
  }
  foreach ($message in @($History.recent)) {
    foreach ($text in @($message.text)) {
      if ($text) { [void] $parts.Add([string] $text) }
    }
  }
  return (($parts | ForEach-Object { [string] $_ }) -join "`n")
}

function Test-RegexPattern {
  param(
    [string] $Text,
    [string] $Pattern
  )
  if (-not $Pattern) { return $true }
  try {
    return [System.Text.RegularExpressions.Regex]::IsMatch(
      $Text,
      $Pattern,
      [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
  } catch {
    return $false
  }
}

function Test-CustomScenarioAssertions {
  param(
    $Scenario,
    $History,
    [System.Collections.ArrayList] $Reasons
  )

  if ($null -eq $Scenario -or $null -eq $History) { return }

  $observedToolNames = @()
  foreach ($toolCall in @($History.observedToolCalls)) {
    if ($toolCall.name) { $observedToolNames += [string] $toolCall.name }
  }
  foreach ($toolResult in @($History.observedToolResults)) {
    if ($toolResult.name) { $observedToolNames += [string] $toolResult.name }
  }
  $observedToolNames = @($observedToolNames | Select-Object -Unique)

  $expectedAny = @()
  if ($Scenario.PSObject.Properties.Name -contains "expectedToolAny" -and $null -ne $Scenario.expectedToolAny) {
    $expectedAny = @($Scenario.expectedToolAny) | Where-Object { $null -ne $_ -and ([string] $_).Length -gt 0 }
  }
  if ($expectedAny.Count -gt 0) {
    $matched = $false
    $matchedNonErrorResult = $false
    foreach ($expectedTool in $expectedAny) {
      $expectedName = [string] $expectedTool
      if ($observedToolNames -contains $expectedName) {
        $matched = $true
      }
      foreach ($toolResult in @($History.observedToolResults)) {
        if ([string] $toolResult.name -eq $expectedName -and $toolResult.isError -ne $true) {
          $matchedNonErrorResult = $true
        }
      }
    }
    if (-not $matched) {
      Add-Reason $Reasons ("expected at least one tool from [{0}], observed [{1}]" -f (($expectedAny | ForEach-Object { [string] $_ }) -join ", "), ($observedToolNames -join ", "))
    }
    if (-not $matchedNonErrorResult) {
      Add-Reason $Reasons ("expected at least one non-error tool result from [{0}]" -f (($expectedAny | ForEach-Object { [string] $_ }) -join ", "))
    }
  }

  $bannedAny = @()
  if ($Scenario.PSObject.Properties.Name -contains "bannedToolAny" -and $null -ne $Scenario.bannedToolAny) {
    $bannedAny = @($Scenario.bannedToolAny) | Where-Object { $null -ne $_ -and ([string] $_).Length -gt 0 }
  }
  foreach ($bannedTool in $bannedAny) {
    if ($observedToolNames -contains ([string] $bannedTool)) {
      Add-Reason $Reasons ("banned tool observed: {0}" -f ([string] $bannedTool))
    }
  }

  $bannedInputPatterns = @()
  if ($Scenario.PSObject.Properties.Name -contains "bannedToolInputPatterns" -and $null -ne $Scenario.bannedToolInputPatterns) {
    $bannedInputPatterns = @($Scenario.bannedToolInputPatterns) | Where-Object { $null -ne $_ -and ([string] $_).Length -gt 0 }
  }
  foreach ($pattern in $bannedInputPatterns) {
    $expandedPattern = Expand-ScenarioText $pattern
    foreach ($toolCall in @($History.observedToolCalls)) {
      $inputSample = [string] $toolCall.inputTextSample
      if ($inputSample -and (Test-RegexPattern $inputSample $expandedPattern)) {
        Add-Reason $Reasons ("banned tool input pattern observed: {0} in {1}" -f $expandedPattern, ([string] $toolCall.name))
      }
    }
  }

  $corpus = Get-SafeChatCorpus $History
  $requiredPatterns = @()
  if ($Scenario.PSObject.Properties.Name -contains "requiredAnswerPatterns" -and $null -ne $Scenario.requiredAnswerPatterns) {
    $requiredPatterns = @($Scenario.requiredAnswerPatterns) | Where-Object { $null -ne $_ -and ([string] $_).Length -gt 0 }
  }
  foreach ($pattern in $requiredPatterns) {
    $expandedPattern = Expand-ScenarioText $pattern
    if (-not (Test-RegexPattern $corpus $expandedPattern)) {
      Add-Reason $Reasons ("required answer pattern missing: {0}" -f $expandedPattern)
    }
  }
}

function Get-BlockingRendererEvents {
  param($Probe)

  $blocking = New-Object System.Collections.ArrayList
  if ($null -eq $Probe -or $null -eq $Probe.events) {
    return $blocking
  }

  foreach ($event in @($Probe.events)) {
    $type = [string] $event.type
    $level = [string] $event.level
    $text = [string] $event.text

    if ($type -eq "console") {
      if ($level -eq "info" -and $text.StartsWith("[ui-metric]")) {
        continue
      }
      if ($level -eq "error" -or $level -eq "warning") {
        [void] $blocking.Add($event)
      }
      continue
    }

    if ($type) {
      [void] $blocking.Add($event)
    }
  }

  return $blocking
}

function Test-SafeChatResult {
  param(
    $Probe,
    $Scenario,
    [string] $Type,
    [System.Collections.ArrayList] $Reasons
  )

  if ($null -eq $Probe) {
    Add-Reason $Reasons "probe JSON missing or invalid"
    return $false
  }
  if ($Probe.state -ne "ELECTRON_CDP_PROBE_DONE") {
    Add-Reason $Reasons ("probe state was {0}" -f $Probe.state)
  }
  if ($Probe.renderer.hasElectronInvoke -ne $true) {
    Add-Reason $Reasons "renderer did not expose electron ipc invoke"
  }
  $blockingEvents = Get-BlockingRendererEvents $Probe
  if ($blockingEvents.Count -ne 0) {
    Add-Reason $Reasons ("blocking renderer events observed: {0}" -f $blockingEvents.Count)
  }

  $send = $Probe.safeChat.send
  if ($null -eq $send -or $send.skipped -eq $true) {
    Add-Reason $Reasons "safe chat send missing or skipped"
  } elseif ($send.success -ne $true) {
    Add-Reason $Reasons "safe chat send was not successful"
  }

  $history = $Probe.safeChat.history
  if ($null -eq $history -or $history.skipped -eq $true) {
    Add-Reason $Reasons "safe chat history missing"
  } else {
    if ($history.ok -ne $true) { Add-Reason $Reasons "safe chat history was not ok" }
    if ($history.scopedToCurrentPrompt -ne $true) { Add-Reason $Reasons "safe chat did not scope to current prompt" }
    if ($history.completed -ne $true) { Add-Reason $Reasons "safe chat did not complete" }
    if ($history.finalAnswerEchoedMarker -ne $true) { Add-Reason $Reasons "safe chat final answer did not echo verification token" }
    if ($history.expectedToolResultOk -ne $true) { Add-Reason $Reasons "expected tool result was not ok" }
    if ($Type -eq "safe-chat-mode" -and $history.expectedToolOnly -ne $true) {
      $unexpected = @($history.unexpectedToolCalls | ForEach-Object { [string] $_.name }) -join ", "
      Add-Reason $Reasons ("safe chat used unexpected tool(s): {0}" -f $unexpected)
    }
    if ($history.noBannedSideEffects -ne $true) { Add-Reason $Reasons "banned send/download/submit/background-session tool was observed" }
    if ($Type -eq "safe-chat-custom") {
      Test-CustomScenarioAssertions $Scenario $history $Reasons
    }
  }

  return ($Reasons.Count -eq 0)
}

function Test-PreviewResult {
  param(
    $Preview,
    [string] $Label,
    [int] $MinFilled,
    [System.Collections.ArrayList] $Reasons
  )

  if ($Preview.ok -ne $true) {
    Add-Reason $Reasons ("{0} preview was not ok" -f $Label)
    return
  }
  if ($Preview.result.status -ne "previewed") {
    Add-Reason $Reasons ("{0} preview status was {1}" -f $Label, $Preview.result.status)
  }
  if ([int] $Preview.result.filledCount -lt $MinFilled) {
    Add-Reason $Reasons ("{0} preview filledCount was {1}, expected at least {2}" -f $Label, $Preview.result.filledCount, $MinFilled)
  }
  if ($Preview.result.errorCount -ne 0) {
    Add-Reason $Reasons ("{0} preview errorCount was {1}" -f $Label, $Preview.result.errorCount)
  }
}

$ExpectedDailyReportSmokeFilledCount = 30
$ExpectedSuspensionSmokeFilledCount = 31

function Test-HostApiSmokeResult {
  param(
    $Probe,
    [System.Collections.ArrayList] $Reasons
  )

  if ($null -eq $Probe) {
    Add-Reason $Reasons "probe JSON missing or invalid"
    return $false
  }
  if ($Probe.state -ne "ELECTRON_CDP_PROBE_DONE") {
    Add-Reason $Reasons ("probe state was {0}" -f $Probe.state)
  }
  if ($Probe.renderer.hasElectronInvoke -ne $true) {
    Add-Reason $Reasons "renderer did not expose electron ipc invoke"
  }
  $blockingEvents = Get-BlockingRendererEvents $Probe
  if ($blockingEvents.Count -ne 0) {
    Add-Reason $Reasons ("blocking renderer events observed: {0}" -f $blockingEvents.Count)
  }

  $outlook = $Probe.outlookSmoke
  if ($null -eq $outlook -or $outlook.skipped -eq $true) {
    Add-Reason $Reasons "outlook smoke skipped or missing"
  } else {
    if ($outlook.readInbox.ok -ne $true) { Add-Reason $Reasons "outlook readInbox was not ok" }
    if ($outlook.sendWithoutConfirm.result.status -ne "refused") { Add-Reason $Reasons ("outlook send without confirm status was {0}" -f $outlook.sendWithoutConfirm.result.status) }
    if ($outlook.sendWithoutConfirm.result.refused -ne $true) { Add-Reason $Reasons "outlook send without confirm was not refused" }
    if ($outlook.downloadWithoutConfirm.result.status -ne "refused") { Add-Reason $Reasons ("outlook download without confirm status was {0}" -f $outlook.downloadWithoutConfirm.result.status) }
    if ($outlook.downloadWithoutConfirm.result.refused -ne $true) { Add-Reason $Reasons "outlook download without confirm was not refused" }
  }

  $forms = $Probe.formsSmoke
  if ($null -eq $forms -or $forms.skipped -eq $true) {
    Add-Reason $Reasons "forms smoke skipped or missing"
  } else {
    Test-PreviewResult $forms.dailyPreview "daily report" $ExpectedDailyReportSmokeFilledCount $Reasons
    if ($forms.dailySubmitWithoutConfirm.result.status -ne "refused") { Add-Reason $Reasons ("daily report submit without confirm status was {0}" -f $forms.dailySubmitWithoutConfirm.result.status) }
    if ($forms.dailySubmitWithoutConfirm.result.refused -ne $true) { Add-Reason $Reasons "daily report submit without confirm was not refused" }
    Test-PreviewResult $forms.preview "suspension" $ExpectedSuspensionSmokeFilledCount $Reasons
    if ($forms.submitWithoutConfirm.result.status -ne "refused") { Add-Reason $Reasons ("suspension submit without confirm status was {0}" -f $forms.submitWithoutConfirm.result.status) }
    if ($forms.submitWithoutConfirm.result.refused -ne $true) { Add-Reason $Reasons "suspension submit without confirm was not refused" }
  }

  return ($Reasons.Count -eq 0)
}

function Test-HardFailureReason {
  param([string] $Reason)

  return (
    $Reason -like "blocking renderer events observed:*" -or
    $Reason -eq "safe chat send missing or skipped" -or
    $Reason -eq "safe chat send was not successful" -or
    $Reason -eq "safe chat history missing" -or
    $Reason -eq "safe chat history was not ok" -or
    $Reason -eq "safe chat did not scope to current prompt" -or
    $Reason -eq "banned send/download/submit/background-session tool was observed" -or
    $Reason -like "banned tool observed:*" -or
    $Reason -like "banned tool input pattern observed:*"
  )
}

function Invoke-Scenario {
  param($Scenario)

  $id = [string] $Scenario.id
  if (-not $id) { $id = "scenario-$($script:ScenarioIndex)" }
  $safeId = New-SafeName $id
  $scenarioDir = Join-Path $script:Evidence ("{0:00}-{1}" -f $script:ScenarioIndex, $safeId)
  New-Item -ItemType Directory -Force -Path $scenarioDir | Out-Null
  $outFile = Join-Path $scenarioDir "probe-output.txt"
  $waitMs = $DefaultWaitMs
  if ($Scenario.waitMs) { $waitMs = [int] $Scenario.waitMs }
  $required = $true
  if ($Scenario.PSObject.Properties.Name -contains "required") {
    $required = [bool] $Scenario.required
  }

  $script:ScenarioIndex += 1
  $type = [string] $Scenario.type
  Write-Line ("SCENARIO {0} type={1} required={2}" -f $id, $type, $required)

  if ($type -eq "safe-chat-mode") {
    $mode = [string] $Scenario.mode
    if (-not $mode) { $mode = "outlook-open" }
    $exitCode = Invoke-LoggedCommand $id $outFile {
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-run-electron-cdp-probe.ps1" `
        -Endpoint $ElectronEndpoint `
        -SafeChat `
        -SafeChatMode $mode `
        -WaitMs $waitMs `
        -ArtifactDir $scenarioDir
    }
  } elseif ($type -eq "safe-chat-custom") {
    $prompt = Expand-ScenarioText $Scenario.prompt
    $exitCode = Invoke-LoggedCommand $id $outFile {
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-run-electron-cdp-probe.ps1" `
        -Endpoint $ElectronEndpoint `
        -SafeChat `
        -SafeChatPrompt $prompt `
        -WaitMs $waitMs `
        -ArtifactDir $scenarioDir
    }
  } elseif ($type -eq "hostapi-smoke") {
    $exitCode = Invoke-LoggedCommand $id $outFile {
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-run-electron-cdp-probe.ps1" `
        -Endpoint $ElectronEndpoint `
        -OutlookSmoke `
        -FormsSmoke `
        -WaitMs $waitMs `
        -ArtifactDir $scenarioDir
    }
  } else {
    $exitCode = 99
    "Unknown scenario type: $type" | Tee-Object -FilePath $outFile
  }

  $probePath = Get-LatestProbeJson $scenarioDir
  $probe = Read-JsonFile $probePath
  $reasons = New-Object System.Collections.ArrayList
  $hardFailure = $false
  if ($exitCode -ne 0) {
    $hardFailure = $true
    Add-Reason $reasons ("probe command exited {0}" -f $exitCode)
  }
  if (-not $probePath -or $null -eq $probe) {
    $hardFailure = $true
    Add-Reason $reasons "probe JSON missing or invalid"
  } elseif ($probe.state -ne "ELECTRON_CDP_PROBE_DONE") {
    $hardFailure = $true
    Add-Reason $reasons ("probe state was {0}" -f $probe.state)
  }
  if ($type -eq "hostapi-smoke") {
    [void] (Test-HostApiSmokeResult $probe $reasons)
  } elseif ($type -eq "safe-chat-mode" -or $type -eq "safe-chat-custom") {
    [void] (Test-SafeChatResult $probe $Scenario $type $reasons)
  } else {
    $hardFailure = $true
    Add-Reason $reasons ("unknown scenario type {0}" -f $type)
  }
  foreach ($reason in @($reasons)) {
    if (Test-HardFailureReason ([string] $reason)) {
      $hardFailure = $true
    }
  }

  $passed = ($reasons.Count -eq 0)
  $status = if ($passed) { "PASS" } elseif ($required -or $hardFailure) { "FAIL" } else { "WARN" }
  Write-Line ("SCENARIO_RESULT {0} {1}" -f $id, $status)

  return [ordered]@{
    id = $id
    title = [string] $Scenario.title
    type = $type
    required = $required
    status = $status
    passed = $passed
    hardFailure = $hardFailure
    exitCode = $exitCode
    reasons = @($reasons)
    artifactDir = $scenarioDir
    probeJson = $probePath
    output = $outFile
  }
}

if (-not (Test-Path $Repo)) {
  Write-Output ("BLOCKED repo missing: {0}" -f $Repo)
  exit 2
}

Set-Location $Repo

if (-not $ScenarioPath) {
  $ScenarioPath = Join-Path $Repo "windows-pilot\scenarios\demo-chat-procedures.json"
}
if (-not (Test-Path $ScenarioPath)) {
  Write-Output ("BLOCKED scenario file missing: {0}" -f $ScenarioPath)
  exit 3
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$script:Evidence = Join-Path $EvidenceRoot ("clawx-chat-procedures-" + $stamp)
New-Item -ItemType Directory -Force -Path $script:Evidence | Out-Null
$script:RunLog = Join-Path $script:Evidence "run.log"
$script:ScenarioIndex = 1
$script:Results = @()

Write-Line "ClawX Windows chat procedure run"
Write-Line ("Repo: {0}" -f $Repo)
Write-Line ("Scenarios: {0}" -f $ScenarioPath)
Write-Line ("Evidence: {0}" -f $script:Evidence)
Write-Line ("DownloadsPath: {0}" -f $DownloadsPath)
Write-Line ("ElectronEndpoint: {0}" -f $ElectronEndpoint)

$script:DownloadsPath = $DownloadsPath

$scenarioDoc = Read-JsonFile $ScenarioPath
if ($null -eq $scenarioDoc -or $null -eq $scenarioDoc.scenarios) {
  Write-Line "BLOCKED scenario JSON is invalid or has no scenarios"
  exit 4
}

if ($RunPreflight) {
  $chromeOut = Join-Path $script:Evidence "00-chrome-cdp-launch.txt"
  Invoke-LoggedCommand "chrome-cdp-launch" $chromeOut {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-launch-cdp-task.ps1" -WaitSeconds 30
  } | Out-Null
  $outlookOut = Join-Path $script:Evidence "00-outlook-tab-verify.txt"
  Invoke-LoggedCommand "outlook-tab-verify" $outlookOut {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-verify-outlook-tab.ps1"
  } | Out-Null
}

if (-not (Test-HttpOk "$ElectronEndpoint/json/version")) {
  if ($Relaunch) {
    $relaunchOut = Join-Path $script:Evidence "00-electron-relaunch.txt"
    Invoke-LoggedCommand "electron-relaunch" $relaunchOut {
      powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-relaunch-app-outlook-v2.ps1" -WaitSeconds 60
    } | Out-Null
  }
}

if (-not (Test-HttpOk "$ElectronEndpoint/json/version")) {
  Write-Line ("BLOCKED Electron CDP is down: {0}" -f $ElectronEndpoint)
  $reportPath = Join-Path $script:Evidence "final-report.md"
  @(
    "# ClawX Chat Procedures",
    "",
    "- status: BLOCKED",
    "- reason: Electron CDP is down",
    "- endpoint: $ElectronEndpoint",
    "- evidence: $script:Evidence"
  ) | Set-Content -Path $reportPath -Encoding UTF8
  exit 5
}

if ($SeedDemoDocuments) {
  $seedOut = Join-Path $script:Evidence "00-seed-demo-documents.txt"
  $seedExit = Invoke-LoggedCommand "seed-demo-documents" $seedOut {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\windows-pilot\scripts\pilot-seed-demo-documents.ps1" `
      -DownloadsPath $script:DownloadsPath
  }
  if ($seedExit -ne 0) {
    Write-Line ("BLOCKED seed-demo-documents failed exit={0}" -f $seedExit)
    exit 6
  }
}

$downloadInventory = Join-Path $script:Evidence "downloads-inventory.json"
Get-ChildItem $script:DownloadsPath -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -match '^\.(xlsx|xls|docx|doc|pdf|csv|txt|md)$' } |
  Sort-Object LastWriteTime -Descending |
  Select-Object Name,Extension,Length,LastWriteTime |
  ConvertTo-Json -Depth 4 |
  Set-Content -Path $downloadInventory -Encoding UTF8

foreach ($scenario in @($scenarioDoc.scenarios)) {
  $script:Results += Invoke-Scenario $scenario
}

$jsonPath = Join-Path $script:Evidence "scenario-results.json"
$script:Results | ConvertTo-Json -Depth 8 | Set-Content -Path $jsonPath -Encoding UTF8

$hardFailures = @($script:Results | Where-Object { $_.hardFailure -eq $true })
$failedRequired = @($script:Results | Where-Object { $_.required -eq $true -and $_.passed -ne $true })
$warnings = @($script:Results | Where-Object { $_.required -ne $true -and $_.passed -ne $true })
$status = if ($hardFailures.Count -eq 0 -and $failedRequired.Count -eq 0) { "READY_SAFE_CHAT_PROCEDURES" } else { "NOT_READY" }

$reportPath = Join-Path $script:Evidence "final-report.md"
$report = @(
  "# ClawX Chat Procedures",
  "",
  "- status: $status",
  "- evidence: $script:Evidence",
  "- repo: $Repo",
  "- scenarios: $ScenarioPath",
  "- generated: $(Get-Date -Format o)",
  "- chrome_cdp_18792: $(Test-HttpOk 'http://127.0.0.1:18792/json/version')",
  "- electron_cdp_9223: $(Test-HttpOk "$ElectronEndpoint/json/version")",
  "- hard_failures: $($hardFailures.Count)",
  "- required_failures: $($failedRequired.Count)",
  "- optional_warnings: $($warnings.Count)",
  "",
  "## Scenario Results",
  ""
)
foreach ($result in $script:Results) {
  $line = "- {0}: {1} ({2})" -f $result.id, $result.status, $result.artifactDir
  $report += $line
  foreach ($reason in @($result.reasons)) {
    $report += ("  - {0}" -f $reason)
  }
}
$report += @(
  "",
  "## Safety",
  "",
  "- No email was sent.",
  "- No attachment was downloaded.",
  "- No Microsoft Form was submitted.",
  "- Send/download/submit gates are checked only through refusal paths.",
  "",
  "## Artifacts",
  "",
  "- scenario results: $jsonPath",
  "- downloads inventory: $downloadInventory",
  "- run log: $script:RunLog"
)
$report | Set-Content -Path $reportPath -Encoding UTF8

Write-Line ("FINAL_STATUS {0}" -f $status)
Write-Line ("FINAL_REPORT {0}" -f $reportPath)
Write-Output ("EVIDENCE_DIR={0}" -f $script:Evidence)
Write-Output ("FINAL_REPORT={0}" -f $reportPath)

if ($status -eq "READY_SAFE_CHAT_PROCEDURES") {
  exit 0
}
exit 1
