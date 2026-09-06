# pilot-desktop-screenshot.ps1 — capture the REAL Windows desktop (all of it,
# not a CDP viewport) for VLM grading (moe.19 verify directive, 2026-09-06).
#
# Must run in the INTERACTIVE session (scheduled task / RDP), never Session 0
# — CopyFromScreen sees only the calling session's desktop.
#
# Output is scaled to MaxWidth (default 2000) because Bedrock caps images
# near 2000px — larger frames get downscaled server-side unpredictably and
# produce false FAILs in grading (owner trap note).
#
# STATE line contract: STATE: DESKTOP_SHOT_OK path=<out> w=<w> h=<h>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $OutPath,
  [int] $MaxWidth = 2000
)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $gfx.Dispose()

  if ($bmp.Width -gt $MaxWidth) {
    $scale = $MaxWidth / $bmp.Width
    $w = [int]($bmp.Width * $scale)
    $h = [int]($bmp.Height * $scale)
    $scaled = New-Object System.Drawing.Bitmap($w, $h)
    $g2 = [System.Drawing.Graphics]::FromImage($scaled)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.DrawImage($bmp, 0, 0, $w, $h)
    $g2.Dispose(); $bmp.Dispose()
    $bmp = $scaled
  }

  $dir = Split-Path -Parent $OutPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host ("STATE: DESKTOP_SHOT_OK path={0} w={1} h={2}" -f $OutPath, $bmp.Width, $bmp.Height)
  $bmp.Dispose()
  exit 0
} catch {
  Write-Host ("STATE: DESKTOP_SHOT_FAIL reason=" + $_.Exception.Message)
  exit 1
}
