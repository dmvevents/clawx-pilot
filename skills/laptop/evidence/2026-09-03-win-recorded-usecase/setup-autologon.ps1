# setup-autologon.ps1 - configure AutoAdminLogon for clawxtest on the disposable
# test VM so a real interactive console session exists after reboot.
# Reads the password from a cred file (avoids any command-line/registry echo in
# operator logs), writes the Winlogon keys, then deletes the cred file.
# DISARM: set AutoAdminLogon=0 and remove DefaultPassword (see RESULT.md).
param(
    [string]$CredFile = "$env:USERPROFILE\autologon-cred.txt",
    [string]$User = "clawxtest"
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path $CredFile)) {
    Write-Output "STATE: CRED_FILE_MISSING $CredFile"
    exit 40
}
$pw = (Get-Content -Raw $CredFile).Trim()
if ($pw.Length -lt 8) {
    Write-Output "STATE: CRED_TOO_SHORT"
    exit 41
}

$k = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty -Path $k -Name DefaultUserName   -Value $User        -Type String
Set-ItemProperty -Path $k -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String
Set-ItemProperty -Path $k -Name DefaultPassword   -Value $pw          -Type String
Set-ItemProperty -Path $k -Name AutoAdminLogon    -Value "1"          -Type String
# Belt and braces: some Server images require CAD disabled for autologon.
$pol = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
Set-ItemProperty -Path $pol -Name DisableCAD -Value 1 -Type DWord -ErrorAction SilentlyContinue

Remove-Item -Force $CredFile

# Report state WITHOUT the password value.
$v = Get-ItemProperty -Path $k
Write-Output ("STATE: AUTOLOGON={0} USER={1} DOMAIN={2} PW_SET={3}" -f `
    $v.AutoAdminLogon, $v.DefaultUserName, $v.DefaultDomainName, `
    [bool]($v.DefaultPassword))
Write-Output "STATE: SETUP_OK"
