# pilot-probe-github-dev.ps1
# Read-only probe for Windows Git/GitHub/Node/Claude dev readiness.
# Secrets: never prints GitHub tokens, AWS keys, passwords, email bodies, Forms URLs, or Host API tokens.

[CmdletBinding()]
param(
  [string] $ProjectDir = "$env:USERPROFILE\Github\ClawX"
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

Add-KnownToolPaths

Write-State "PROJECT_DIR" $ProjectDir
foreach ($cmd in @("git", "gh", "node", "npm", "corepack", "pnpm", "claude", "aws", "wsl")) {
  $cmdState = "MISSING"
  if (Test-Command $cmd) { $cmdState = "PRESENT" }
  Write-State ("CMD_{0}" -f $cmd.ToUpperInvariant()) $cmdState
}

if (Test-Command "git") { Write-State "GIT_VERSION" ((git --version 2>&1 | Select-Object -First 1)) }
if (Test-Command "gh") {
  Write-State "GH_VERSION" ((gh --version 2>&1 | Select-Object -First 1))
  try {
    gh auth status --hostname github.com 1>$null 2>$null
    Write-State "GH_AUTH" "PRESENT"
  } catch {
    Write-State "GH_AUTH" "MISSING"
  }
}
if (Test-Command "node") { Write-State "NODE_VERSION" ((node --version 2>&1 | Select-Object -First 1)) }
if (Test-Command "pnpm") { Write-State "PNPM_VERSION" ((pnpm --version 2>&1 | Select-Object -First 1)) }
if (Test-Command "claude") { Write-State "CLAUDE_VERSION" ((claude --version 2>&1 | Select-Object -First 1)) }

$projectExists = "FALSE"
if (Test-Path $ProjectDir) { $projectExists = "TRUE" }
Write-State "PROJECT_EXISTS" $projectExists
$projectGit = "FALSE"
if (Test-Path (Join-Path $ProjectDir ".git")) { $projectGit = "TRUE" }
Write-State "PROJECT_GIT" $projectGit

if (Test-Path (Join-Path $ProjectDir ".git")) {
  Push-Location $ProjectDir
  try {
    Write-State "BRANCH" ((git branch --show-current 2>$null) -join "")
    $porcelain = git status --short
    Write-State "GIT_DIRTY_LINES" (@($porcelain).Count)
    git remote -v | ForEach-Object { Write-State "REMOTE" $_ }
  } finally {
    Pop-Location
  }
}

if (Test-Command "wsl") {
  try {
    $distros = wsl.exe -l -q 2>$null | Where-Object { $_.Trim().Length -gt 0 }
    Write-State "WSL_DISTRO_COUNT" (@($distros).Count)
    foreach ($distro in $distros) { Write-State "WSL_DISTRO" $distro.Trim() }
  } catch {
    Write-State "WSL" "ERROR"
  }
}

Write-State "DONE" "GITHUB_DEV_PROBE"
