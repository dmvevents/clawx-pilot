<powershell>
# EC2 user-data: runs once on first boot. Keep it small — we want a
# near-vanilla Windows to reproduce the installer bug, not a pre-configured
# environment that hides missing dependency detection.

$ErrorActionPreference = 'Continue'
$log = "C:\bootstrap.log"
Start-Transcript -Path $log -Append

# 1. Ensure RDP is enabled (default on Server 2022 but be explicit).
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name 'fDenyTSConnections' -Value 0
Enable-NetFirewallRule -DisplayGroup 'Remote Desktop'

# 2. Chocolatey for grabbing minimal debug tooling only (NOT VS Redist —
#    we want the installer to fail exactly as it does on the pilot laptop).
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

choco install -y 7zip.install
choco install -y sysinternals   # procmon, procexp for tracing the installer

# 3. Create a landing dir for the installer zip.
New-Item -ItemType Directory -Path C:\clawx-installer -Force | Out-Null

# 4. Desktop shortcut to the log path so Anton can find it after RDP-in.
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("C:\Users\Administrator\Desktop\clawx-installer.lnk")
$Shortcut.TargetPath = "C:\clawx-installer"
$Shortcut.Save()

Stop-Transcript
</powershell>
<persist>false</persist>
