# pilot-install-local-dev-tools.ps1
# Installs local Git/GitHub CLI/Node/AWS CLI installers copied to Windows.
# Idempotent: yes. Mutating: yes.

[CmdletBinding()]
param(
  [string] $ToolDir = "$env:USERPROFILE\Downloads\clawx-tools"
)

$ErrorActionPreference = "Stop"

function Write-State($name, $value) {
  Write-Output ("STATE:{0}={1}" -f $name, $value)
}

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Add-KnownToolPaths {
  $paths = @(
    "$env:ProgramFiles\Git\cmd",
    "$env:ProgramFiles\Git\bin",
    "$env:ProgramFiles\GitHub CLI",
    "$env:ProgramFiles\nodejs",
    "$env:ProgramFiles\Amazon\AWSCLIV2",
    "$env:APPDATA\npm",
    "$env:USERPROFILE\.local\bin",
    "$env:LOCALAPPDATA\Programs\Git\cmd",
    "$env:LOCALAPPDATA\Programs\Git\bin",
    "$env:LOCALAPPDATA\Programs\GitHub CLI",
    "$env:LOCALAPPDATA\Programs\nodejs"
  )
  foreach ($path in $paths) {
    if ((Test-Path $path) -and ($env:Path -notlike "*$path*")) {
      $env:Path = "$path;$env:Path"
    }
  }
}

function Install-Msi($name, $path) {
  if (-not (Test-Path $path)) {
    Write-State $name "MISSING_INSTALLER"
    return
  }
  Write-State $name "START"
  $log = Join-Path $ToolDir "$name.install.log"
  $args = @("/i", $path, "/qn", "/norestart", "/L*v", $log)
  $p = Start-Process -FilePath "msiexec.exe" -ArgumentList $args -Wait -PassThru
  Write-State $name ("EXIT_" + $p.ExitCode)
  Write-State ($name + "_LOG") $log
  Add-KnownToolPaths
}

function Install-Git($path) {
  if (Test-Command "git") {
    Write-State "GIT" "PRESENT"
    return
  }
  if (-not (Test-Path $path)) {
    Write-State "GIT" "MISSING_INSTALLER"
    return
  }
  Write-State "GIT" "START"
  $p = Start-Process -FilePath $path -ArgumentList @("/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES") -Wait -PassThru
  Write-State "GIT" ("EXIT_" + $p.ExitCode)
  Add-KnownToolPaths
}

Write-State "START" "LOCAL_DEV_TOOLS_INSTALL"
Write-State "TOOL_DIR" $ToolDir
if (-not (Test-Path $ToolDir)) {
  Write-State "TOOL_DIR_EXISTS" "FALSE"
  exit 1
}

Add-KnownToolPaths
Install-Git (Join-Path $ToolDir "Git-2.54.0-64-bit.exe")
Install-Msi "GH" (Join-Path $ToolDir "gh_2.93.0_windows_amd64.msi")
Install-Msi "NODE" (Join-Path $ToolDir "node-v24.16.0-x64.msi")
Install-Msi "AWS" (Join-Path $ToolDir "AWSCLIV2.msi")

Add-KnownToolPaths
if (Test-Command "git") { Write-State "GIT_VERSION" ((git --version 2>&1 | Select-Object -First 1)) }
if (Test-Command "gh") { Write-State "GH_VERSION" ((gh --version 2>&1 | Select-Object -First 1)) }
if (Test-Command "node") { Write-State "NODE_VERSION" ((node --version 2>&1 | Select-Object -First 1)) }
if (Test-Command "npm") { Write-State "NPM_VERSION" ((npm --version 2>&1 | Select-Object -First 1)) }
if (Test-Command "aws") { Write-State "AWS_VERSION" ((aws --version 2>&1 | Select-Object -First 1)) }
Write-State "DONE" "LOCAL_DEV_TOOLS_INSTALL"
