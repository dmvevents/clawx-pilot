# clawx-run-interactive.ps1
# Register+run an arbitrary command as an INTERACTIVE scheduled task so it lands
# in the logged-on user's console session (session 1). Used for ffmpeg gdigrab,
# which must run in the session that owns the visible desktop.
param(
    [Parameter(Mandatory=$true)][string]$TaskName,
    [Parameter(Mandatory=$true)][string]$Exe,
    [Parameter(Mandatory=$true)][string]$Args,
    [switch]$WaitExit,
    [int]$WaitTimeoutSeconds = 30
)
$ErrorActionPreference = "Stop"
$action = New-ScheduledTaskAction -Execute $Exe -Argument $Args
$principal = New-ScheduledTaskPrincipal -UserId "clawxtest" -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output "STATE: STARTED $TaskName"
if ($WaitExit) {
    $deadline = (Get-Date).AddSeconds($WaitTimeoutSeconds)
    do {
        Start-Sleep -Seconds 2
        $info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
        $state = (Get-ScheduledTask -TaskName $TaskName).State
    } while ($state -eq "Running" -and (Get-Date) -lt $deadline)
    Write-Output ("STATE: TASK_STATE {0} LAST_RESULT {1}" -f $state, $info.LastTaskResult)
}
