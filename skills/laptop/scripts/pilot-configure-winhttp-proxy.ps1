# pilot-configure-winhttp-proxy.ps1
# Configures or resets WinHTTP proxy for temporary Mac-bridged internet access.
# Idempotent: yes. Mutating: yes unless -ProbeOnly.

[CmdletBinding()]
param(
  [string] $Proxy = "169.254.254.6:18798",
  [switch] $Reset,
  [switch] $ProbeOnly
)

$ErrorActionPreference = "Stop"

function Write-State($name, $value) {
  Write-Output ("STATE:{0}={1}" -f $name, $value)
}

Write-State "START" "WINHTTP_PROXY"
Write-State "CURRENT" ((netsh winhttp show proxy) -join " | ")

if (-not $ProbeOnly) {
  if ($Reset) {
    netsh winhttp reset proxy | Out-Null
    Write-State "APPLY" "RESET"
  } else {
    netsh winhttp set proxy $Proxy | Out-Null
    Write-State "APPLY" $Proxy
  }
}

Write-State "AFTER" ((netsh winhttp show proxy) -join " | ")

try {
  $github = Invoke-WebRequest -Uri "https://github.com" -UseBasicParsing -TimeoutSec 15
  Write-State "HTTPS_GITHUB" $github.StatusCode
} catch {
  Write-State "HTTPS_GITHUB" ("FAILED:" + $_.Exception.Message)
}

try {
  $winget = Invoke-WebRequest -Uri "https://cdn.winget.microsoft.com" -UseBasicParsing -TimeoutSec 15
  Write-State "HTTPS_WINGET_CDN" $winget.StatusCode
} catch {
  Write-State "HTTPS_WINGET_CDN" ("FAILED:" + $_.Exception.Message)
}

Write-State "DONE" "WINHTTP_PROXY"
