# pilot-bootstrap-github-dev.ps1
# Installs Git/GitHub developer tooling and clones/updates the ClawX pilot repo.
# Idempotent: yes. Mutating: yes, unless -DryRun.
# Secrets: never prints GitHub tokens or credentials.

[CmdletBinding()]
param(
  [string] $RepoSlug = "dmvevents/clawx-pilot",
  [string] $RepoUrl = "https://github.com/dmvevents/clawx-pilot.git",
  [string] $ProjectDir = "$env:USERPROFILE\Github\ClawX",
  [string] $GitUserName = "",
  [string] $GitUserEmail = "",
  [switch] $RunGhLogin,
  [switch] $RunInstall,
  [switch] $InstallAwsCli,
  [switch] $DryRun
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

function Invoke-WingetInstall($id) {
  if (-not (Test-Command "winget")) {
    Write-State ("INSTALL_{0}" -f $id) "BLOCKED_NO_WINGET"
    return $false
  }
  Write-State ("INSTALL_{0}" -f $id) "START"
  if (-not $DryRun) {
    winget install --id $id -e --source winget --accept-source-agreements --accept-package-agreements --silent
    if ($LASTEXITCODE -ne 0) {
      Write-State ("INSTALL_{0}" -f $id) ("FAILED_EXIT_" + $LASTEXITCODE)
      return $false
    }
  }
  Add-KnownToolPaths
  Write-State ("INSTALL_{0}" -f $id) "DONE"
  return $true
}

Write-State "START" "GITHUB_DEV_BOOTSTRAP"
Write-State "PROJECT_DIR" $ProjectDir
Add-KnownToolPaths

if (-not (Test-Command "git")) { Invoke-WingetInstall "Git.Git" }
else { Write-State "GIT" "PRESENT" }

if (-not (Test-Command "gh")) { Invoke-WingetInstall "GitHub.cli" }
else { Write-State "GH" "PRESENT" }

if (-not (Test-Command "node")) { Invoke-WingetInstall "OpenJS.NodeJS.LTS" }
else { Write-State "NODE" "PRESENT" }

if ($InstallAwsCli) {
  if (-not (Test-Command "aws")) { Invoke-WingetInstall "Amazon.AWSCLI" }
  else { Write-State "AWS_CLI" "PRESENT" }
}

if (Test-Command "git") {
  if ($GitUserName.Trim().Length -gt 0) {
    if (-not $DryRun) { git config --global user.name $GitUserName }
    Write-State "GIT_USER_NAME" "SET"
  }
  if ($GitUserEmail.Trim().Length -gt 0) {
    if (-not $DryRun) { git config --global user.email $GitUserEmail }
    Write-State "GIT_USER_EMAIL" "SET"
  }
  Write-State "GIT_VERSION" ((git --version 2>&1 | Select-Object -First 1))
}

if (Test-Command "gh") {
  Write-State "GH_VERSION" ((gh --version 2>&1 | Select-Object -First 1))
  $ghAuthed = $false
  try {
    gh auth status --hostname github.com 1>$null 2>$null
    $ghAuthed = $true
    Write-State "GH_AUTH" "PRESENT"
  } catch {
    Write-State "GH_AUTH" "MISSING"
  }

  if ($RunGhLogin -and -not $ghAuthed) {
    Write-State "GH_LOGIN" "START_BROWSER_FLOW"
    if (-not $DryRun) {
      gh auth login --hostname github.com --git-protocol https --web
    }
  }
}

$parent = Split-Path -Parent $ProjectDir
if (-not (Test-Path $parent)) {
  if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
}

if (Test-Path (Join-Path $ProjectDir ".git")) {
  Write-State "REPO" "EXISTS"
  if (-not $DryRun -and (Test-Command "git")) {
    Push-Location $ProjectDir
    try {
      git remote -v | ForEach-Object { Write-State "REMOTE" $_ }
      git fetch --all --prune
      Write-State "FETCH" "OK"
    } finally {
      Pop-Location
    }
  }
} else {
  Write-State "REPO" "MISSING"
  if (-not (Test-Command "git")) {
    Write-State "CLONE" "BLOCKED_NO_GIT"
  } elseif (Test-Command "gh") {
    try {
      gh auth status --hostname github.com 1>$null 2>$null
      Write-State "CLONE" "GH_REPO_CLONE"
      if (-not $DryRun) { gh repo clone $RepoSlug $ProjectDir }
    } catch {
      Write-State "CLONE" "FALLBACK_GIT_CLONE_OR_AUTH_REQUIRED"
      if (-not $DryRun) { git clone $RepoUrl $ProjectDir }
    }
  } else {
    Write-State "CLONE" "GIT_CLONE"
    if (-not $DryRun) { git clone $RepoUrl $ProjectDir }
  }
}

if (Test-Path (Join-Path $ProjectDir "package.json")) {
  Push-Location $ProjectDir
  try {
    if (Test-Command "corepack") {
      if (-not $DryRun) { corepack enable }
      Write-State "COREPACK" "ENABLED"
    }
    if ($RunInstall) {
      if (Test-Command "pnpm") {
        Write-State "PNPM_INSTALL" "START"
        if (-not $DryRun) { pnpm install }
        Write-State "PNPM_INSTALL" "DONE"
      } else {
        Write-State "PNPM" "MISSING_AFTER_COREPACK"
      }
    }
  } finally {
    Pop-Location
  }
}

Write-State "DONE" "GITHUB_DEV_BOOTSTRAP"
