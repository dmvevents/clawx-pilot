# Runs the recorded-use-case driver with the app's bundled node.exe.
$ErrorActionPreference = "Continue"
$node = Join-Path $env:LOCALAPPDATA "Programs\Ministry of Education\resources\bin\node.exe"
$driver = "C:\Users\clawxtest\clawx-recorded-usecase-driver.js"
$outdir = "C:\Users\clawxtest\clawx-usecase-rec"
$prompt = "Draft a short letter to parents about the Term 1 parent-teacher meeting on Friday"
& $node $driver --prompt $prompt --port 9223 --turn-timeout 240 --outdir $outdir --prefer-online
Write-Output ("DRIVER_EXIT=" + $LASTEXITCODE)
