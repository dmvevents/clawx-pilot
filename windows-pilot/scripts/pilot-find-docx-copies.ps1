$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$name = "moe-demo-suspension-source.docx"
$roots = @(
  $env:USERPROFILE,
  (Join-Path $env:USERPROFILE "Downloads"),
  (Join-Path $env:USERPROFILE "Desktop"),
  (Join-Path $env:USERPROFILE "Documents"),
  (Join-Path $env:USERPROFILE "OneDrive"),
  (Join-Path $env:USERPROFILE "OneDrive\Desktop"),
  (Join-Path $env:USERPROFILE "OneDrive\Documents"),
  (Join-Path $env:USERPROFILE ".openclaw\workspace")
)
$seen = @{}
foreach ($r in $roots) {
  if (-not (Test-Path -LiteralPath $r)) { continue }
  Get-ChildItem -LiteralPath $r -Recurse -Filter $name -ErrorAction SilentlyContinue | ForEach-Object {
    if ($seen.ContainsKey($_.FullName)) { return }
    $seen[$_.FullName] = $true
    $bad = "n/a"; $docBytes = "n/a"
    try {
      $zip = [System.IO.Compression.ZipFile]::OpenRead($_.FullName)
      $b = @($zip.Entries | Where-Object { $_.FullName.Contains("\") })
      $bad = $(if ($b.Count) { "YES(" + $b.Count + ")" } else { "no" })
      $d = $zip.Entries | Where-Object { $_.FullName -eq "word/document.xml" }
      $docBytes = $(if ($d) { $d.Length } else { "MISSING" })
      $zip.Dispose()
    } catch { $bad = "OPEN_ERR" }
    Write-Output ("COPY|{0}|bytes={1}|backslash={2}|docxml={3}" -f $_.FullName, $_.Length, $bad, $docBytes)
  }
}
Write-Output "DONE"
