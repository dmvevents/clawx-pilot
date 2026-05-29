# pilot-install-demo-shortcuts.ps1 - install desktop shortcuts for the Windows demo.
#
# Read-only: NO - creates/updates .lnk files on the current user's Desktop.
# Idempotent: yes - re-running refreshes the same shortcuts.
#
# Optional:
#   -SetOutlookV2UserEnv sets CLAWX_OUTLOOK_V2=1 for future app launches.
#     The already-running app still needs a restart to observe that env var.

param(
    [switch]$SetOutlookV2UserEnv = $false
)

$ErrorActionPreference = "Stop"

$desktop = [Environment]::GetFolderPath("Desktop")
$userHome = $env:USERPROFILE
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$appExe = "$env:LOCALAPPDATA\Programs\Ministry of Education\Ministry of Education.exe"

function New-Shortcut {
    param(
        [string]$Name,
        [string]$TargetPath,
        [string]$Arguments = "",
        [string]$WorkingDirectory = $userHome,
        [string]$IconLocation = ""
    )

    $shell = New-Object -ComObject WScript.Shell
    $path = Join-Path $desktop $Name
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $TargetPath
    $shortcut.Arguments = $Arguments
    $shortcut.WorkingDirectory = $WorkingDirectory
    if ($IconLocation) {
        $shortcut.IconLocation = $IconLocation
    }
    $shortcut.Save()
    "SHORTCUT: $path"
}

if ($SetOutlookV2UserEnv) {
    [Environment]::SetEnvironmentVariable("CLAWX_OUTLOOK_V2", "1", "User")
    "CONFIG: set user env CLAWX_OUTLOOK_V2=1 for future app launches"
}

New-Shortcut `
    -Name "Ministry Demo - CDP Chrome.lnk" `
    -TargetPath $powershell `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$userHome\pilot-attach-chrome-cdp-demo.ps1`" -WaitSeconds 20" `
    -IconLocation $chrome

New-Shortcut `
    -Name "Ministry Demo - Probe State.lnk" `
    -TargetPath $powershell `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$userHome\pilot-probe-state.ps1`""

New-Shortcut `
    -Name "Ministry Demo - Outlook Check.lnk" `
    -TargetPath $powershell `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$userHome\pilot-verify-outlook-tab.ps1`""

if (Test-Path "$userHome\pilot-office-runtime-check.ps1") {
    New-Shortcut `
        -Name "Ministry Demo - Office Runtime Check.lnk" `
        -TargetPath $powershell `
        -Arguments "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$userHome\pilot-office-runtime-check.ps1`""
}

if (Test-Path "$desktop\AGENT_SELF_TEST.txt") {
    New-Shortcut `
        -Name "Ministry Demo - Self Test Prompt.lnk" `
        -TargetPath "notepad.exe" `
        -Arguments "`"$desktop\AGENT_SELF_TEST.txt`""
}

if (Test-Path "$desktop\AGENT_FORMS_TEST.txt") {
    New-Shortcut `
        -Name "Ministry Demo - Forms Test Prompt.lnk" `
        -TargetPath "notepad.exe" `
        -Arguments "`"$desktop\AGENT_FORMS_TEST.txt`""
}

if (Test-Path $appExe) {
    $appCommand = "`$env:CLAWX_OUTLOOK_V2='1'; Start-Process -FilePath '$appExe'"
    New-Shortcut `
        -Name "Ministry Demo - App Outlook V2.lnk" `
        -TargetPath $powershell `
        -Arguments "-NoProfile -ExecutionPolicy Bypass -Command `"$appCommand`"" `
        -IconLocation $appExe
}

"STATE: SHORTCUTS_READY"
