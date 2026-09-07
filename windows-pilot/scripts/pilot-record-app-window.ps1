# pilot-record-app-window.ps1 — capture the actual installed app window only.
#
# This is capture evidence, not a visual or product verdict. It must run from
# the interactive user session where the app window is visible. Session 0,
# missing app window, missing ffmpeg, undersized native window/video, and blank
# verified frames fail closed. Guest ffprobe is optional because host-side
# verification can bind the pulled clip after capture.
#
# STATE line contract:
#   STATE:APP_WINDOW_RECORDING_CAPTURE_ONLY manifest=<path> video=<path> frames=<n> duration=<s> w=<w> h=<h> hostVerify=<status> sha256=<sha>
#   STATE:APP_WINDOW_RECORDING_BLOCKED reason=<safe-reason>
#   STATE:APP_WINDOW_RECORDING_INVALID reason=<safe-reason>
[CmdletBinding()]
param(
  [string] $WindowTitle = 'Ministry of Education',
  [string] $ExpectedProcessName = 'Ministry of Education',
  [string] $ExpectedInstallDir = '',
  [string] $OutDir = '',
  [int] $DurationSeconds = 30,
  [int] $FrameCount = 10,
  [int] $MinWidth = 1280,
  [int] $FrameMaxWidth = 2000,
  [int] $FrameRate = 15,
  [switch] $RequireGuestVerification,
  [string] $FfmpegPath = '',
  [string] $FfprobePath = '',
  [string] $RunId = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Write-State($name, $value) {
  Write-Host ("STATE:{0}={1}" -f $name, $value)
}

function ConvertTo-SafeStateValue([string] $value) {
  if ($null -eq $value) { return '' }
  return ($value -replace '[\r\n]', ' ' -replace '\s+', ' ').Trim()
}

function ConvertTo-RoundedDouble([double] $Value, [int] $Digits) {
  $format = '{0:0.' + ('#' * $Digits) + '}'
  return [double]([string]::Format([Globalization.CultureInfo]::InvariantCulture, $format, $Value))
}

function ConvertTo-SafeRunId([string] $value) {
  $candidate = $value
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    $candidate = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 8))
  }
  $safe = ($candidate -replace '[^A-Za-z0-9._-]', '-')
  $safe = $safe.Trim('.-_')
  if ([string]::IsNullOrWhiteSpace($safe)) { throw 'run id is empty after sanitization' }
  return $safe
}

function Get-DefaultOutputRoot {
  if (-not [string]::IsNullOrWhiteSpace($script:OutDir)) { return $script:OutDir }
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    return (Join-Path $env:LOCALAPPDATA 'ClawX\window-recordings')
  }
  return (Join-Path ([System.IO.Path]::GetTempPath()) 'clawx-window-recordings')
}



function ConvertTo-NormalizedPathForBoundary([string] $Path) {
  $separator = [System.IO.Path]::DirectorySeparatorChar.ToString()
  $normalized = $Path.Replace('\', $separator).Replace('/', $separator)
  return [System.IO.Path]::GetFullPath($normalized)
}

function Test-PathUnderDirectory([string] $Path, [string] $Directory) {
  if ([string]::IsNullOrWhiteSpace($Path) -or [string]::IsNullOrWhiteSpace($Directory)) { return $false }
  $pathFull = ConvertTo-NormalizedPathForBoundary $Path
  $directoryFull = (ConvertTo-NormalizedPathForBoundary $Directory).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $directoryWithBoundary = $directoryFull + [System.IO.Path]::DirectorySeparatorChar
  return $pathFull.StartsWith($directoryWithBoundary, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-ExpectedInstallDirectory {
  if (-not [string]::IsNullOrWhiteSpace($script:ExpectedInstallDir)) { return $script:ExpectedInstallDir }
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    return (Join-Path $env:LOCALAPPDATA 'Programs\Ministry of Education')
  }
  return ''
}

function Add-WindowNativeType {
  if ('ClawXWindowNative' -as [type]) { return }
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ClawXWindowNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")]
  public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
'@
}

function Get-WindowDimensions([IntPtr] $Handle) {
  Add-WindowNativeType
  $client = New-Object ClawXWindowNative+RECT
  $window = New-Object ClawXWindowNative+RECT
  if (-not [ClawXWindowNative]::GetClientRect($Handle, [ref]$client)) { throw 'could not read app window client dimensions' }
  if (-not [ClawXWindowNative]::GetWindowRect($Handle, [ref]$window)) { throw 'could not read app window bounds' }
  return [pscustomobject]@{
    clientWidth = [Math]::Max(0, $client.Right - $client.Left)
    clientHeight = [Math]::Max(0, $client.Bottom - $client.Top)
    windowWidth = [Math]::Max(0, $window.Right - $window.Left)
    windowHeight = [Math]::Max(0, $window.Bottom - $window.Top)
  }
}

function New-UniqueRunDirectory([string] $RootDir, [string] $RequestedRunId) {
  $safeRunId = ConvertTo-SafeRunId $RequestedRunId
  if (-not (Test-Path -LiteralPath $RootDir)) {
    New-Item -ItemType Directory -Path $RootDir -Force | Out-Null
  }
  $runDir = Join-Path $RootDir $safeRunId
  if (Test-Path -LiteralPath $runDir) {
    throw "run directory already exists: $runDir"
  }
  New-Item -ItemType Directory -Path $runDir -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $runDir 'frames') -Force | Out-Null
  return $runDir
}

function Resolve-ExecutablePath([string] $ExplicitPath, [string[]] $Candidates, [string] $Name) {
  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    if (Test-Path -LiteralPath $ExplicitPath -PathType Leaf) { return (Resolve-Path -LiteralPath $ExplicitPath).Path }
    throw "$Name not found at explicit path"
  }

  foreach ($candidate in $Candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  throw "$Name not found; pass -$($Name.Substring(0, 1).ToUpperInvariant() + $Name.Substring(1))Path"
}

function Resolve-InstalledFfmpegPath {
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Ministry of Education\resources\bin\ffmpeg.exe')
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Ministry of Education\resources\bin\win32-x64\ffmpeg.exe')
  }
  $scriptRoot = Split-Path -Parent $PSCommandPath
  if ($scriptRoot) {
    $repoRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot '..\..') -ErrorAction SilentlyContinue
    if ($repoRoot) {
      $candidates += (Join-Path $repoRoot.Path 'resources\bin\win32-x64\ffmpeg.exe')
      $candidates += (Join-Path $repoRoot.Path 'resources\bin\ffmpeg.exe')
    }
  }
  return Resolve-ExecutablePath -ExplicitPath $script:FfmpegPath -Candidates $candidates -Name 'ffmpeg'
}

function TryResolve-InstalledFfprobePath {
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Ministry of Education\resources\bin\ffprobe.exe')
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Ministry of Education\resources\bin\win32-x64\ffprobe.exe')
  }
  $scriptRoot = Split-Path -Parent $PSCommandPath
  if ($scriptRoot) {
    $repoRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot '..\..') -ErrorAction SilentlyContinue
    if ($repoRoot) {
      $candidates += (Join-Path $repoRoot.Path 'resources\bin\win32-x64\ffprobe.exe')
      $candidates += (Join-Path $repoRoot.Path 'resources\bin\ffprobe.exe')
    }
  }
  try {
    return Resolve-ExecutablePath -ExplicitPath $script:FfprobePath -Candidates $candidates -Name 'ffprobe'
  } catch {
    if (-not [string]::IsNullOrWhiteSpace($script:FfprobePath)) { throw }
    return ''
  }
}

function Assert-InteractiveSession {
  $isWindowsRuntime = ($env:OS -eq 'Windows_NT' -or [System.IO.Path]::DirectorySeparatorChar -eq '\\')
  if (-not $isWindowsRuntime) { throw 'Windows interactive session required' }
  if (-not [Environment]::UserInteractive) { throw 'interactive user desktop unavailable' }
  $sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
  if ($sessionId -eq 0) { throw 'Session 0 cannot capture the user desktop' }
}

function Resolve-AppWindow([string] $RequestedTitle, [string] $ExpectedName, [string] $InstallDir, [int] $CurrentSessionId) {
  if ([string]::IsNullOrWhiteSpace($RequestedTitle)) { throw 'window title is required' }
  if ([string]::IsNullOrWhiteSpace($ExpectedName)) { throw 'expected process name is required' }
  $windows = @([System.Diagnostics.Process]::GetProcesses() |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) } |
    ForEach-Object {
      $path = $null
      $pathReadable = $true
      try { $path = $_.MainModule.FileName } catch { $pathReadable = $false }
      [pscustomobject]@{
        processId = $_.Id
        processName = $_.ProcessName
        title = $_.MainWindowTitle
        sessionId = $_.SessionId
        handle = $_.MainWindowHandle
        executablePath = $path
        executablePathReadable = $pathReadable
      }
    })

  $matches = @($windows | Where-Object { $_.title -eq $RequestedTitle })
  if ($matches.Count -eq 0) {
    $matches = @($windows | Where-Object { $_.title -like "*$RequestedTitle*" })
  }
  if ($matches.Count -eq 0) { throw "app window not found: $RequestedTitle" }

  $processMatches = @($matches | Where-Object { $_.processName -eq $ExpectedName })
  if ($processMatches.Count -eq 0) { throw "app window did not belong to expected process: $ExpectedName" }

  $sessionMatches = @($processMatches | Where-Object { $_.sessionId -eq $CurrentSessionId })
  if ($sessionMatches.Count -eq 0) { throw "app window not in current interactive session: $CurrentSessionId" }

  $installRoot = ''
  if (-not [string]::IsNullOrWhiteSpace($InstallDir)) {
    $installRoot = ConvertTo-NormalizedPathForBoundary $InstallDir
  }
  $installedMatches = @($sessionMatches | Where-Object {
    if ([string]::IsNullOrWhiteSpace($installRoot)) {
      $true
    } elseif (-not $_.executablePathReadable -or [string]::IsNullOrWhiteSpace($_.executablePath)) {
      $false
    } else {
      Test-PathUnderDirectory -Path $_.executablePath -Directory $installRoot
    }
  })
  if ($installedMatches.Count -eq 0) { throw "app window did not belong to installed Ministry app path: $installRoot" }
  if ($installedMatches.Count -gt 1) { throw "app window title ambiguous: $RequestedTitle" }

  $selected = $installedMatches[0]
  $dimensions = Get-WindowDimensions ([IntPtr]$selected.handle)
  Add-Member -InputObject $selected -NotePropertyName clientWidth -NotePropertyValue $dimensions.clientWidth
  Add-Member -InputObject $selected -NotePropertyName clientHeight -NotePropertyValue $dimensions.clientHeight
  Add-Member -InputObject $selected -NotePropertyName windowWidth -NotePropertyValue $dimensions.windowWidth
  Add-Member -InputObject $selected -NotePropertyName windowHeight -NotePropertyValue $dimensions.windowHeight
  return $selected
}

function Invoke-ExternalTool([string] $FilePath, [string[]] $Arguments, [string] $StdoutPath, [string] $StderrPath) {
  & $FilePath @Arguments > $StdoutPath 2> $StderrPath
  return [pscustomobject]@{ exitCode = $LASTEXITCODE; stdoutPath = $StdoutPath; stderrPath = $StderrPath }
}

function Read-VideoMetadata([string] $Ffprobe, [string] $VideoPath, [string] $RunDir) {
  $stdout = Join-Path $RunDir 'ffprobe-video.json'
  $stderr = Join-Path $RunDir 'ffprobe-video.stderr.txt'
  $result = Invoke-ExternalTool -FilePath $Ffprobe -Arguments @(
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json',
    $VideoPath
  ) -StdoutPath $stdout -StderrPath $stderr
  if ($result.exitCode -ne 0) { throw "ffprobe failed with exit $($result.exitCode)" }
  return Get-Content -LiteralPath $stdout -Raw | ConvertFrom-Json
}

function Get-PrimaryVideoStream($Metadata) {
  $streams = @($Metadata.streams | Where-Object { $_.codec_type -eq 'video' })
  if ($streams.Count -lt 1) { throw 'ffprobe found no video stream' }
  return $streams[0]
}

function Get-VideoDurationSeconds($Metadata) {
  $duration = 0.0
  if ($Metadata.format -and $Metadata.format.duration) {
    $duration = [double]::Parse([string]$Metadata.format.duration, [Globalization.CultureInfo]::InvariantCulture)
  }
  if ($duration -le 0) { throw 'video duration was empty or zero' }
  return $duration
}

function Assert-CaptureMetadata($Metadata, [int] $MinimumWidth, [double] $MinimumDurationSeconds) {
  $stream = Get-PrimaryVideoStream $Metadata
  $duration = Get-VideoDurationSeconds $Metadata
  $width = [int]$stream.width
  $height = [int]$stream.height
  if ($width -lt $MinimumWidth) { throw "capture width $width is below required $MinimumWidth" }
  if ($height -lt 1) { throw 'capture height is invalid' }
  if ($duration -lt $MinimumDurationSeconds) { throw "capture duration $duration is shorter than required $MinimumDurationSeconds" }
  return [pscustomobject]@{ durationSeconds = $duration; width = $width; height = $height }
}

function New-FrameSchedule([double] $DurationSeconds, [int] $Count) {
  if ($Count -lt 8) { throw 'at least 8 frames are required' }
  if ($DurationSeconds -le 0) { throw 'duration must be positive' }
  $last = [Math]::Max([double]0, [double]($DurationSeconds - 0.2))
  $frames = @()
  for ($i = 0; $i -lt $Count; $i += 1) {
    if ($Count -eq 1) { $seconds = 0.0 } else { $seconds = ($last * $i) / ($Count - 1) }
    $frames += [pscustomobject]@{ index = $i; seconds = (ConvertTo-RoundedDouble -Value $seconds -Digits 3) }
  }
  return $frames
}

function Extract-VideoFrames([string] $Ffmpeg, [string] $VideoPath, [string] $FrameDir, [object[]] $Schedule, [int] $MaxWidth) {
  $files = @()
  foreach ($frame in $Schedule) {
    $framePath = Join-Path $FrameDir ("frame-{0:D2}.png" -f $frame.index)
    $stdout = "$framePath.stdout.txt"
    $stderr = "$framePath.stderr.txt"
    $vf = "scale='min($MaxWidth,iw)':-2"
    $result = Invoke-ExternalTool -FilePath $Ffmpeg -Arguments @(
      '-hide_banner', '-loglevel', 'error',
      '-ss', ([string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:0.###}', $frame.seconds)),
      '-i', $VideoPath,
      '-frames:v', '1',
      '-vf', $vf,
      '-y',
      $framePath
    ) -StdoutPath $stdout -StderrPath $stderr
    if ($result.exitCode -ne 0 -or -not (Test-Path -LiteralPath $framePath -PathType Leaf)) {
      throw "frame extraction failed at index $($frame.index)"
    }
    $files += [pscustomobject]@{ path = $framePath; seconds = $frame.seconds; sha256 = Get-Sha256 $framePath }
  }
  return $files
}

function Get-ImageSampleStats([string] $ImagePath) {
  Add-Type -AssemblyName System.Drawing
  $bmp = [System.Drawing.Bitmap]::FromFile($ImagePath)
  try {
    $samples = 0
    $sum = 0.0
    $sum2 = 0.0
    $min = 255.0
    $max = 0.0
    $stepX = [Math]::Max(1, [int][Math]::Floor($bmp.Width / 20))
    $stepY = [Math]::Max(1, [int][Math]::Floor($bmp.Height / 20))
    for ($x = 0; $x -lt $bmp.Width; $x += $stepX) {
      for ($y = 0; $y -lt $bmp.Height; $y += $stepY) {
        $p = $bmp.GetPixel($x, $y)
        $lum = (0.2126 * $p.R) + (0.7152 * $p.G) + (0.0722 * $p.B)
        $samples += 1
        $sum += $lum
        $sum2 += ($lum * $lum)
        if ($lum -lt $min) { $min = $lum }
        if ($lum -gt $max) { $max = $lum }
      }
    }
    $mean = $sum / [Math]::Max(1, $samples)
    $variance = ($sum2 / [Math]::Max(1, $samples)) - ($mean * $mean)
    return [pscustomobject]@{ samples = $samples; mean = $mean; variance = $variance; range = ($max - $min) }
  } finally {
    $bmp.Dispose()
  }
}

function Assert-NonBlankFrames([object[]] $FrameFiles) {
  $nonBlank = 0
  $stats = @()
  foreach ($frame in $FrameFiles) {
    $s = Get-ImageSampleStats $frame.path
    $isBlank = ($s.range -lt 5 -or $s.variance -lt 1)
    if (-not $isBlank) { $nonBlank += 1 }
    $stats += [pscustomobject]@{ path = $frame.path; range = (ConvertTo-RoundedDouble -Value $s.range -Digits 3); variance = (ConvertTo-RoundedDouble -Value $s.variance -Digits 3); blank = $isBlank }
  }
  if ($nonBlank -lt 1) { throw 'all extracted frames appear blank' }
  return $stats
}

function Get-Sha256([string] $Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function ConvertTo-RelativePath([string] $Root, [string] $Path) {
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $pathFull = [System.IO.Path]::GetFullPath($Path)
  $rootUri = [Uri]($rootFull + [System.IO.Path]::DirectorySeparatorChar)
  $pathUri = [Uri]$pathFull
  return [Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString()).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
}

function Write-Manifest([string] $ManifestPath, [object] $Manifest) {
  # BOM-less on purpose: PS 5.1 Set-Content -Encoding UTF8 writes a BOM that breaks strict JSON consumers.
  [System.IO.File]::WriteAllText($ManifestPath, ($Manifest | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
}

if ($env:CLAWX_RECORD_APP_WINDOW_DOT_SOURCE_ONLY -eq '1') { return }

$startedAt = (Get-Date).ToUniversalTime().ToString('o')
try {
  if ($DurationSeconds -lt 5 -or $DurationSeconds -gt 300) { throw 'DurationSeconds must be between 5 and 300' }
  if ($FrameCount -lt 8) { throw 'FrameCount must be at least 8' }
  if ($MinWidth -lt 1280) { throw 'MinWidth must be at least 1280' }

  Assert-InteractiveSession
  $currentSessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
  $expectedInstallRoot = Get-ExpectedInstallDirectory
  $window = Resolve-AppWindow -RequestedTitle $WindowTitle -ExpectedName $ExpectedProcessName -InstallDir $expectedInstallRoot -CurrentSessionId $currentSessionId
  if ($window.clientWidth -lt $MinWidth) { throw "native app window client width $($window.clientWidth) is below required $MinWidth" }
  $ffmpeg = Resolve-InstalledFfmpegPath
  $ffprobe = TryResolve-InstalledFfprobePath
  if ($RequireGuestVerification -and [string]::IsNullOrWhiteSpace($ffprobe)) { throw 'ffprobe not found; guest verification required' }
  $rootDir = Get-DefaultOutputRoot
  $runDir = New-UniqueRunDirectory -RootDir $rootDir -RequestedRunId $RunId
  $frameDir = Join-Path $runDir 'frames'
  $videoPath = Join-Path $runDir 'app-window.mp4'
  $manifestPath = Join-Path $runDir 'manifest.json'
  $captureStdout = Join-Path $runDir 'ffmpeg-capture.stdout.txt'
  $captureStderr = Join-Path $runDir 'ffmpeg-capture.stderr.txt'

  $captureArgs = @(
    '-hide_banner', '-loglevel', 'error',
    '-f', 'gdigrab',
    '-draw_mouse', '0',
    '-framerate', ([string]$FrameRate),
    '-t', ([string]$DurationSeconds),
    '-i', "title=$($window.title)",
    '-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-n',
    $videoPath
  )
  $capture = Invoke-ExternalTool -FilePath $ffmpeg -Arguments $captureArgs -StdoutPath $captureStdout -StderrPath $captureStderr
  if ($capture.exitCode -ne 0 -or -not (Test-Path -LiteralPath $videoPath -PathType Leaf)) {
    throw "ffmpeg capture failed with exit $($capture.exitCode)"
  }

  $videoHash = Get-Sha256 $videoPath
  $verified = $null
  $schedule = @()
  $frames = @()
  $frameStats = @()
  $guestVerificationStatus = 'HOST_VERIFY_REQUIRED'
  if (-not [string]::IsNullOrWhiteSpace($ffprobe)) {
    $metadata = Read-VideoMetadata -Ffprobe $ffprobe -VideoPath $videoPath -RunDir $runDir
    $minimumDuration = [Math]::Max([double]1.0, [double]($DurationSeconds - 2.0))
    $verified = Assert-CaptureMetadata -Metadata $metadata -MinimumWidth $MinWidth -MinimumDurationSeconds $minimumDuration
    $schedule = @(New-FrameSchedule -DurationSeconds $verified.durationSeconds -Count $FrameCount)
    $frames = @(Extract-VideoFrames -Ffmpeg $ffmpeg -VideoPath $videoPath -FrameDir $frameDir -Schedule $schedule -MaxWidth $FrameMaxWidth)
    $frameStats = @(Assert-NonBlankFrames $frames)
    $guestVerificationStatus = 'GUEST_CAPTURE_VERIFIED'
  }
  $completedAt = (Get-Date).ToUniversalTime().ToString('o')

  $manifestFiles = @(
    [pscustomobject]@{ role = 'video'; path = (ConvertTo-RelativePath $runDir $videoPath); sha256 = $videoHash }
  )
  foreach ($frame in $frames) {
    $manifestFiles += [pscustomobject]@{ role = 'frame'; path = (ConvertTo-RelativePath $runDir $frame.path); seconds = $frame.seconds; sha256 = $frame.sha256 }
  }

  $manifest = [ordered]@{
    schemaVersion = 1
    kind = 'clawx.appWindowRecording'
    status = 'CAPTURE_ONLY'
    visualVerdict = 'NOT_RUN'
    productVerdict = 'NOT_RUN'
    reason = 'Captured actual named app window only; requires separate host/VLM/human and product-outcome review.'
    startedAt = $startedAt
    completedAt = $completedAt
    window = [ordered]@{
      requestedTitle = $WindowTitle
      exactTitle = $window.title
      processId = $window.processId
      processName = $window.processName
      sessionId = $window.sessionId
      executablePath = $window.executablePath
      expectedProcessName = $ExpectedProcessName
      expectedInstallDir = $expectedInstallRoot
      clientWidth = $window.clientWidth
      clientHeight = $window.clientHeight
      windowWidth = $window.windowWidth
      windowHeight = $window.windowHeight
    }
    source = [ordered]@{
      nativeClientWidth = $window.clientWidth
      nativeClientHeight = $window.clientHeight
      nativeWindowWidth = $window.windowWidth
      nativeWindowHeight = $window.windowHeight
      ffmpegInput = "title=$($window.title)"
      preserveNativeSize = $true
      videoFilter = 'crop=trunc(iw/2)*2:trunc(ih/2)*2'
    }
    capture = [ordered]@{
      guestVerificationStatus = $guestVerificationStatus
      durationSeconds = $(if ($verified) { ConvertTo-RoundedDouble -Value $verified.durationSeconds -Digits 3 } else { $null })
      width = $(if ($verified) { $verified.width } else { $null })
      height = $(if ($verified) { $verified.height } else { $null })
      minWidth = $MinWidth
      frameRate = $FrameRate
      frameCount = $frames.Count
      frameScheduleSeconds = @($schedule | ForEach-Object { $_.seconds })
      frameStats = $frameStats
    }
    tools = [ordered]@{
      ffmpegPath = $ffmpeg
      ffprobePath = $(if ([string]::IsNullOrWhiteSpace($ffprobe)) { $null } else { $ffprobe })
    }
    files = $manifestFiles
  }
  Write-Manifest -ManifestPath $manifestPath -Manifest $manifest

  $durationState = if ($verified) { ConvertTo-RoundedDouble -Value $verified.durationSeconds -Digits 3 } else { 'UNVERIFIED' }
  $widthState = if ($verified) { $verified.width } else { 'UNVERIFIED' }
  $heightState = if ($verified) { $verified.height } else { 'UNVERIFIED' }
  Write-State 'APP_WINDOW_RECORDING_CAPTURE_ONLY' ("manifest={0} video={1} frames={2} duration={3} w={4} h={5} hostVerify={6} sha256={7}" -f $manifestPath, $videoPath, $frames.Count, $durationState, $widthState, $heightState, $guestVerificationStatus, $videoHash)
  exit 0
} catch {
  $message = ConvertTo-SafeStateValue $_.Exception.Message
  if ($message -match 'interactive|Session 0|not found|ambiguous|expected process|installed Ministry app path|current interactive session|native app window client width|ffmpeg|ffprobe|run directory already exists') {
    Write-State 'APP_WINDOW_RECORDING_BLOCKED' "reason=$message"
    exit 3
  }
  Write-State 'APP_WINDOW_RECORDING_INVALID' "reason=$message"
  exit 1
}
