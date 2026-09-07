# pilot-prod-email-probe.ps1
#
# Production-style Outlook readiness probe for the Windows pilot laptop.
#
# Read-only against app/user data. It writes a timestamped evidence folder under
# Downloads so SSH runs have durable artifacts, but it does not launch Chrome,
# relaunch the app, send mail, submit forms, or uninstall anything.

[CmdletBinding()]
param(
  [string] $EvidenceRoot = "$env:USERPROFILE\Downloads",
  [int] $LogTailLines = 220
)

$ErrorActionPreference = "Continue"

function New-SafeName([string] $value) {
  return ($value -replace '[^a-zA-Z0-9._-]+', '-').Trim('-')
}

function Redact-Text([string] $value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return $value }
  $redacted = $value -replace '(Bearer\s+)[A-Za-z0-9._\-]+', '$1<redacted>'
  $redacted = $redacted -replace 'sk-[A-Za-z0-9._\-]+', '<redacted-key>'
  $redacted = $redacted -replace '#token=[^&\s"]+', '#token=<redacted>'
  $redacted = $redacted -replace '([?&]token=)[^&\s"]+', '$1<redacted>'
  $redacted = $redacted -replace 'https://forms\.(office\.com|cloud\.microsoft)/Pages/ResponsePage\.aspx\?id=[^&\s"]+', 'https://forms.$1/Pages/ResponsePage.aspx?id=<redacted>'
  return $redacted
}

function Write-State([string] $name, $value) {
  $line = "STATE:{0}={1}" -f $name, $value
  Write-Output $line
  if ($script:LogPath) {
    Add-Content -LiteralPath $script:LogPath -Value $line -ErrorAction SilentlyContinue
  }
}

function Write-Section([string] $name) {
  $line = ""
  Write-Output $line
  if ($script:LogPath) { Add-Content -LiteralPath $script:LogPath -Value $line -ErrorAction SilentlyContinue }
  $line = "=== {0} ===" -f $name
  Write-Output $line
  if ($script:LogPath) { Add-Content -LiteralPath $script:LogPath -Value $line -ErrorAction SilentlyContinue }
}

function Test-Port([int] $port) {
  try {
    $conn = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction Stop
    return $null -ne $conn
  } catch {
    return $false
  }
}

function Test-HttpOk([string] $url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-HttpStatus([string] $url, [string] $method = "GET") {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -Method $method -TimeoutSec 3 -ErrorAction Stop
    return [ordered]@{ ok = $true; status = $response.StatusCode; error = "" }
  } catch {
    $statusCode = ""
    try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
    return [ordered]@{ ok = $false; status = $statusCode; error = $_.Exception.Message }
  }
}

function Get-InstallerCandidates {
  $roots = @(
    "$env:USERPROFILE\Downloads",
    "$env:PUBLIC\Downloads",
    "$env:USERPROFILE\Desktop",
    (Get-Location).Path
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

  $items = @()
  foreach ($root in $roots) {
    $items += Get-ChildItem -LiteralPath $root -Filter "Ministry.of.Education-*-win-x64.exe" -File -ErrorAction SilentlyContinue
  }
  return @($items | Sort-Object LastWriteTime -Descending)
}

function Write-KeyValue([string] $name, $value) {
  $line = "{0}: {1}" -f $name, $value
  Write-Output $line
  if ($script:LogPath) { Add-Content -LiteralPath $script:LogPath -Value $line -ErrorAction SilentlyContinue }
}

if (-not (Test-Path $EvidenceRoot)) {
  New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$script:Evidence = Join-Path $EvidenceRoot ("clawx-prod-email-probe-" + $stamp)
New-Item -ItemType Directory -Force -Path $script:Evidence | Out-Null
$script:LogPath = Join-Path $script:Evidence "probe.log"
"ClawX production email probe: $(Get-Date -Format o)" | Set-Content -LiteralPath $script:LogPath -Encoding UTF8

Write-State "MODE" "ProdEmailProbe"
Write-State "TIMESTAMP" (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")
Write-State "USER" $env:USERNAME
Write-State "COMPUTER" $env:COMPUTERNAME
Write-State "EVIDENCE_DIR" $script:Evidence

Write-Section "Installed App"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education"
$appExe = Join-Path $installDir "Ministry of Education.exe"
$resourcesDir = Join-Path $installDir "resources"
$appAsar = Join-Path $resourcesDir "app.asar"
$appAsarUnpacked = Join-Path $resourcesDir "app.asar.unpacked"
Write-State "INSTALL_DIR_EXISTS" (Test-Path $installDir)
Write-State "APP_EXE_EXISTS" (Test-Path $appExe)
if (Test-Path $appExe) {
  $item = Get-Item $appExe
  $ver = [Diagnostics.FileVersionInfo]::GetVersionInfo($appExe)
  Write-KeyValue "AppExe" $appExe
  Write-KeyValue "FileVersion" $ver.FileVersion
  Write-KeyValue "ProductVersion" $ver.ProductVersion
  Write-KeyValue "SizeMB" ([math]::Round($item.Length / 1MB, 1))
  Write-KeyValue "Modified" $item.LastWriteTime
}
Write-State "RESOURCES_DIR_EXISTS" (Test-Path $resourcesDir)
Write-State "APP_ASAR_EXISTS" (Test-Path $appAsar)
Write-State "APP_ASAR_UNPACKED_EXISTS" (Test-Path $appAsarUnpacked)

$playwrightEvidence = @(
  (Join-Path $resourcesDir "openclaw\node_modules\playwright-core"),
  (Join-Path $resourcesDir "openclaw\node_modules\playwright"),
  (Join-Path $resourcesDir "node_modules\playwright-core"),
  (Join-Path $resourcesDir "node_modules\playwright"),
  (Join-Path $appAsarUnpacked "node_modules\playwright-core"),
  (Join-Path $appAsarUnpacked "node_modules\playwright"),
  (Join-Path $appAsarUnpacked "node_modules\.pnpm")
)
foreach ($path in $playwrightEvidence) {
  Write-State ("PACKAGE_PATH_" + (New-SafeName $path)) (Test-Path $path)
}

Write-Section "Installer Candidates"
$installers = @(Get-InstallerCandidates)
Write-State "INSTALLER_COUNT" $installers.Count
foreach ($installer in $installers | Select-Object -First 10) {
  Write-KeyValue "Installer" ("{0}|{1:n1}MB|{2}" -f $installer.FullName, ($installer.Length / 1MB), $installer.LastWriteTime)
}

Write-Section "Ports And HTTP"
$ports = @(13210, 18789, 18791, 18792, 9223)
foreach ($port in $ports) {
  $listening = Test-Port $port
  Write-State ("PORT_{0}" -f $port) ($(if ($listening) { "LISTEN" } else { "DOWN" }))
}
$chromeCdpOk = Test-HttpOk "http://127.0.0.1:18792/json/version"
$electronCdpOk = Test-HttpOk "http://127.0.0.1:9223/json/version"
Write-State "CHROME_CDP_HTTP_OK" $chromeCdpOk
Write-State "ELECTRON_CDP_HTTP_OK" $electronCdpOk
$hostApiDiag = Get-HttpStatus "http://127.0.0.1:13210/api/browser/diagnose" "POST"
Write-State "HOSTAPI_BROWSER_DIAG_UNAUTH_STATUS" $hostApiDiag.status
Write-KeyValue "HostApiBrowserDiagUnauthError" (Redact-Text $hostApiDiag.error)

Write-Section "Chrome CDP Tabs"
if ($chromeCdpOk) {
  try {
    $tabs = (Invoke-WebRequest -Uri "http://127.0.0.1:18792/json" -UseBasicParsing -TimeoutSec 3).Content | ConvertFrom-Json
    $pages = @($tabs | Where-Object { $_.type -eq "page" })
    Write-State "CHROME_CDP_TAB_COUNT" $pages.Count
    $pages |
      Select-Object @{N="url";E={ Redact-Text $_.url }}, title |
      ConvertTo-Json -Depth 4 |
      Set-Content -LiteralPath (Join-Path $script:Evidence "chrome-tabs.json") -Encoding UTF8
    $outlook = @($pages | Where-Object { $_.url -match "outlook\.(office\.com|office365\.com|cloud\.microsoft|live\.com)" })
    Write-State "OUTLOOK_TAB_COUNT" $outlook.Count
    if ($outlook.Count -gt 0) {
      $first = $outlook[0]
      Write-KeyValue "OutlookTabUrl" (Redact-Text $first.url)
      Write-KeyValue "OutlookTabTitle" $first.title
      if ($first.url -match "/login|/signin|loginerror|wreply=") {
        Write-State "OUTLOOK_BROWSER_STATE" "LOGIN_REQUIRED"
      } elseif ($first.url -match "/mail/|/owa/|/inbox") {
        Write-State "OUTLOOK_BROWSER_STATE" "READY"
      } else {
        Write-State "OUTLOOK_BROWSER_STATE" "AMBIGUOUS"
      }
    } else {
      Write-State "OUTLOOK_BROWSER_STATE" "NO_OUTLOOK_TAB"
    }
  } catch {
    Write-State "CHROME_CDP_TAB_PROBE_ERROR" (Redact-Text $_.Exception.Message)
  }
} else {
  Write-State "OUTLOOK_BROWSER_STATE" "CDP_DOWN"
}

Write-Section "OpenClaw Config"
$openclawConfig = Join-Path $env:USERPROFILE ".openclaw\openclaw.json"
Write-State "OPENCLAW_CONFIG_EXISTS" (Test-Path $openclawConfig)
if (Test-Path $openclawConfig) {
  Write-KeyValue "OpenClawConfig" $openclawConfig
  Write-KeyValue "OpenClawConfigModified" (Get-Item $openclawConfig).LastWriteTime
  try {
    $config = Get-Content -LiteralPath $openclawConfig -Raw | ConvertFrom-Json
    Write-State "MODEL_DEFAULT_PRIMARY" $config.agents.defaults.model.primary
    Write-State "MOE_PLUGIN_ENABLED" $config.plugins.entries.'moe-principal-assistant'.enabled
    Write-State "BROWSER_PLUGIN_ENABLED" $config.plugins.entries.browser.enabled
    Write-State "MICROSOFT_GRAPH_ENABLED" $config.plugins.entries.'microsoft-graph'.enabled
    $graphConfig = $config.plugins.entries.'microsoft-graph'.config
    if ($graphConfig) {
      Write-State "MICROSOFT_GRAPH_TENANT_PRESENT" (-not [string]::IsNullOrWhiteSpace([string]$graphConfig.tenantId))
      Write-State "MICROSOFT_GRAPH_CLIENT_PRESENT" (-not [string]::IsNullOrWhiteSpace([string]$graphConfig.clientId))
      Write-State "MICROSOFT_GRAPH_AUTH_FLOW" $graphConfig.authFlow
    }
  } catch {
    Write-State "OPENCLAW_CONFIG_PARSE_ERROR" (Redact-Text $_.Exception.Message)
  }
}

Write-Section "Relevant Processes"
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match "Ministry|chrome|openclaw|node" } |
  Select-Object ProcessId,Name,@{N="CommandLine";E={ Redact-Text $_.CommandLine }} |
  ConvertTo-Json -Depth 4 |
  Set-Content -LiteralPath (Join-Path $script:Evidence "processes.json") -Encoding UTF8

Write-Section "Latest Log Tail"
$logDir = Join-Path $env:APPDATA "Ministry of Education\logs"
Write-State "LOG_DIR_EXISTS" (Test-Path $logDir)
if (Test-Path $logDir) {
  $latest = Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($latest) {
    Write-KeyValue "LatestLog" $latest.FullName
    Write-KeyValue "LatestLogModified" $latest.LastWriteTime
    $tailPath = Join-Path $script:Evidence ("tail-" + $latest.Name)
    Get-Content -LiteralPath $latest.FullName -Tail $LogTailLines -ErrorAction SilentlyContinue |
      ForEach-Object { Redact-Text $_ } |
      Set-Content -LiteralPath $tailPath -Encoding UTF8
    Write-State "LOG_TAIL_PATH" $tailPath
  } else {
    Write-State "LATEST_LOG_EXISTS" $false
  }
}

Write-Section "Verdict"
$graphEnabled = $false
$graphTenant = $false
$graphClient = $false
if (Test-Path $openclawConfig) {
  try {
    $config = Get-Content -LiteralPath $openclawConfig -Raw | ConvertFrom-Json
    $graphEnabled = [bool]$config.plugins.entries.'microsoft-graph'.enabled
    $graphTenant = -not [string]::IsNullOrWhiteSpace([string]$config.plugins.entries.'microsoft-graph'.config.tenantId)
    $graphClient = -not [string]::IsNullOrWhiteSpace([string]$config.plugins.entries.'microsoft-graph'.config.clientId)
  } catch {}
}

if ($graphEnabled -and $graphTenant -and $graphClient) {
  Write-State "EMAIL_ACCESS_PATH" "MICROSOFT_GRAPH_CONFIGURED"
} elseif ($chromeCdpOk) {
  Write-State "EMAIL_ACCESS_PATH" "OUTLOOK_WEB_CHROME_CDP"
} else {
  Write-State "EMAIL_ACCESS_PATH" "BLOCKED_NO_GRAPH_AND_NO_CHROME_CDP"
}

Write-State "RESULT" "COMPLETE"
Write-Output ("EVIDENCE_DIR={0}" -f $script:Evidence)
exit 0
