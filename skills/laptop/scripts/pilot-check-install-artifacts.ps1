# pilot-check-install-artifacts.ps1
#
# Report installed payload and shortcut evidence for the Windows pilot app.

[CmdletBinding()]
param(
  [string] $InstallDir = "$env:LOCALAPPDATA\Programs\Ministry of Education"
)

$ErrorActionPreference = "Continue"

$paths = @(
  (Join-Path $InstallDir "Ministry of Education.exe"),
  (Join-Path $InstallDir "resources\app.asar"),
  (Join-Path $InstallDir "resources\openclaw\node_modules\playwright-core\package.json"),
  (Join-Path $InstallDir "resources\bin\ffmpeg.exe"),
  (Join-Path $InstallDir "resources\bin\WinSpeechRecognize.exe"),
  (Join-Path $InstallDir "resources\resources\cloud-gateway.json"),
  (Join-Path $InstallDir "resources\resources\cloud-gateway.key"),
  (Join-Path $InstallDir "resources\resources\azure-speech.example.json"),
  (Join-Path $InstallDir "resources\resources\azure-speech.json"),
  (Join-Path $InstallDir "resources\resources\azure-speech.key"),
  (Join-Path $env:USERPROFILE "Desktop\Ministry of Education.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Ministry of Education.lnk")
)

$rows = foreach ($path in $paths) {
  if (Test-Path -LiteralPath $path) {
    $item = Get-Item -LiteralPath $path
    $hash = $null
    $isSecretMetadataOnly = $item.Name -like "*.key"
    if (-not $item.PSIsContainer -and $item.Length -lt 500MB -and -not $isSecretMetadataOnly) {
      try {
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
      } catch {}
    }
    [pscustomobject]@{
      Path = $path
      Exists = $true
      Length = $item.Length
      Modified = $item.LastWriteTime.ToString("o")
      Sha256 = $hash
      SecretMetadataOnly = $isSecretMetadataOnly
    }
  } else {
    [pscustomobject]@{
      Path = $path
      Exists = $false
      Length = $null
      Modified = $null
      Sha256 = $null
      SecretMetadataOnly = $path -like "*.key"
    }
  }
}

$rows | ConvertTo-Json -Depth 4
