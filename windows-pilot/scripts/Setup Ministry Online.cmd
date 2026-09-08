@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-ministry-online.ps1"
set "setupResult=%errorlevel%"
echo.
pause
exit /b %setupResult%
