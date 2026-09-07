param([int]$CdpPort = 9223, [int]$MaxSeconds = 180)
$ErrorActionPreference = "Stop"
$node = @(
  (Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\resources\bin\node.exe"),
  (Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\resources\bin\win32-x64\node.exe"),
  "node.exe"
) | Where-Object { ($_ -eq "node.exe") -or (Test-Path $_) } | Select-Object -First 1
Write-Output ("STATE:NODE=" + $node)
$js = Join-Path $env:USERPROFILE "Downloads\pilot-read-last-message.js"
& $node $js $CdpPort $MaxSeconds
