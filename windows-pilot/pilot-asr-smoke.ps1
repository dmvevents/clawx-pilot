# pilot-asr-smoke.ps1 - prove the packaged Windows ASR path works end to end
# without a microphone.
#
# Fills gap C in docs/APP_WORKFLOWS_TEST_MATRIX.md ("Create pilot-asr-smoke.ps1
# (none exists)"). Companion to windows-pilot/scripts/pilot-office-write-smoke.ps1
# (same STATE-line style). It mirrors the app's own transcription flow from
# electron/main/asr-ipc.ts + electron/main/asr-native-windows.ts:
#
#   1. Locate the packaged WinSpeechRecognize.exe
#      (%LOCALAPPDATA%\Programs\Ministry of Education\resources\bin\ in installed
#      builds; electron-builder maps resources/bin/win32-x64/ -> resources\bin).
#   2. Synthesize a short WAV locally with System.Speech SpeechSynthesizer -
#      deterministic, no mic dependency (16 kHz 16-bit mono PCM, the same format
#      the app's ffmpeg transcode targets).
#   3. Run the app's two-file transcode flow: clip-input.wav -> ffmpeg
#      -ar 16000 -ac 1 -f wav -> clip.wav. Degrades gracefully when ffmpeg is
#      missing or fails, exactly like asr-ipc.ts (transcodeSkippedReason).
#   4. Invoke WinSpeechRecognize.exe <wav> <locale> and parse its single-line
#      JSON stdout ({"text":"...","language":"..."}).
#   5. Assert the transcript contains the expected keyword.
#
# Exit-code contract of the helper (keep in sync with Program.cs /
# asr-native-windows.ts): 0 ok, 1 generic failure, 2 permission denied,
# 3 audio not found.
#
# STATE lines:
#   ASR_SMOKE_OK                        - transcript produced and keyword found
#   ASR_SMOKE_BLOCKED_NO_BINARY         - WinSpeechRecognize.exe absent (paths printed)
#   ASR_SMOKE_BLOCKED_NO_TTS_VOICE      - System.Speech synthesis unavailable (no voice)
#   ASR_SMOKE_BLOCKED_NO_RECOGNIZER     - no desktop speech recognizer installed
#   ASR_SMOKE_FAILED_WAV_INVALID        - synthesized/transcoded WAV not a RIFF file
#   ASR_SMOKE_FAILED_TIMEOUT            - helper did not exit within the timeout
#   ASR_SMOKE_FAILED_PERMISSION         - helper exit 2 (speech privacy gate)
#   ASR_SMOKE_FAILED_AUDIO              - helper exit 3 (could not read the WAV)
#   ASR_SMOKE_FAILED_RECOGNIZER         - helper nonzero exit, other
#   ASR_SMOKE_FAILED_BAD_JSON           - helper stdout was not the JSON contract
#   ASR_SMOKE_FAILED_EMPTY_TRANSCRIPT   - recognizer returned no text
#   ASR_SMOKE_FAILED_KEYWORD            - transcript present but keyword missing
#
# Desk-checked only (authored on macOS, not yet executed on a Windows box).
# Assumptions to verify on first run:
#   - System.Speech recognition needs the desktop recognizer; Windows Server
#     SKUs without Desktop Experience lack it (BLOCKED_NO_RECOGNIZER is the
#     expected state there, not a script bug).
#   - Dictation over a TTS voice is reliable for common words but not verbatim;
#     the assertion is a single-keyword substring match, not full-phrase equality.
#   - SpeechSynthesizer only finalizes the WAV on SetOutputToNull()/Dispose();
#     both are called before the file is read back.

[CmdletBinding()]
param(
  [string] $InstallDir = "$env:LOCALAPPDATA\Programs\Ministry of Education",
  [string] $Locale = "en-US",
  [string] $Phrase = "The attendance report for the school is ready for review",
  [string] $Keyword = "attendance",
  [int] $RecognizeTimeoutSeconds = 60,
  [switch] $KeepArtifacts
)

$ErrorActionPreference = "Continue"

$script:workDir = $null

function Exit-Smoke {
  param([string] $State, [int] $Code)

  if ($script:workDir -and (Test-Path $script:workDir)) {
    if ($Code -ne 0 -or $KeepArtifacts) {
      # Keep the WAVs + helper stdout/stderr for diagnosis on any failure.
      "WORK_DIR_RETAINED: $script:workDir"
    } else {
      Remove-Item $script:workDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  "`n=== STATE LINE ==="
  "STATE: $State"
  exit $Code
}

function Quote-ProcessArgument($value) {
  $s = [string] $value
  if ($s.Length -eq 0) { return '""' }
  if ($s -notmatch '[\s"]') { return $s }

  # Windows CreateProcess receives one command line string.  Start-Process
  # joins -ArgumentList arrays in Windows PowerShell 5, so quote paths with
  # spaces before passing the command line through.
  $escaped = $s -replace '"', '\"'
  return '"' + $escaped + '"'
}

function Test-RiffWav {
  param([string] $Path)

  if (-not (Test-Path $Path)) { return $false }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  # 44 bytes = canonical PCM WAV header; anything smaller has no audio data.
  return ($bytes.Length -gt 44) -and
    ($bytes[0] -eq 0x52) -and ($bytes[1] -eq 0x49) -and
    ($bytes[2] -eq 0x46) -and ($bytes[3] -eq 0x46)
}

"=== ASR HELPER BINARY ==="
$exeCandidates = @()
$fromEnv = $env:WIN_SPEECH_RECOGNIZE_PATH
if ($fromEnv) {
  # Same override asr-native-windows.ts honours.
  $exeCandidates += $fromEnv
}
$exeCandidates += (Join-Path $InstallDir "resources\bin\WinSpeechRecognize.exe")
$exeCandidates += (Join-Path $InstallDir "resources\bin\win32-x64\WinSpeechRecognize.exe")

$exe = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) {
  "BINARY: missing"
  "Searched:"
  $exeCandidates | ForEach-Object { "  $_" }
  "Rebuild with: pnpm run prep:win-binaries (win-asr:build:x64 emits the helper)"
  Exit-Smoke "ASR_SMOKE_BLOCKED_NO_BINARY" 2
}
$exeItem = Get-Item $exe
"BINARY: $exe"
"BINARY_SIZE: $($exeItem.Length)"
"BINARY_MODIFIED: $($exeItem.LastWriteTime)"
# net48 helper ships a .exe.config alongside; missing is a warning, not a blocker.
"BINARY_CONFIG_PRESENT: $(Test-Path ($exe + '.config'))"

"`n=== INSTALLED RECOGNIZERS ==="
try {
  Add-Type -AssemblyName System.Speech
  $recognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  "RECOGNIZER_COUNT: $($recognizers.Count)"
  $recognizers | ForEach-Object { "RECOGNIZER: $($_.Culture.Name) $($_.Description)" }
  if ($recognizers.Count -eq 0) {
    "No desktop speech recognizer installed (expected on Server SKUs without Desktop Experience)."
    Exit-Smoke "ASR_SMOKE_BLOCKED_NO_RECOGNIZER" 4
  }
} catch {
  "RECOGNIZER_ENUM_ERROR: $($_.Exception.Message)"
  # Enumeration failing here usually means System.Speech itself is unusable;
  # the helper would hit the same wall, so treat it as the recognizer gap.
  Exit-Smoke "ASR_SMOKE_BLOCKED_NO_RECOGNIZER" 4
}

"`n=== SYNTHESIZE TEST WAV ==="
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$script:workDir = Join-Path $env:TEMP ("clawx-asr-smoke-" + $stamp)
New-Item -ItemType Directory -Force -Path $script:workDir | Out-Null
"WORK_DIR: $script:workDir"

# Match the app's temp naming: raw clip is clip-input.wav, transcode target is
# clip.wav (asr-ipc.ts asr:saveBlob).
$rawWav = Join-Path $script:workDir "clip-input.wav"
$synth = $null
try {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  # 16 kHz 16-bit mono PCM - the exact format asr-ipc.ts transcodes to.
  $formatArgs = @(
    16000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
  )
  $format = New-Object -TypeName System.Speech.AudioFormat.SpeechAudioFormatInfo -ArgumentList $formatArgs
  $synth.SetOutputToWaveFile($rawWav, $format)
  # Slightly slower speech recognizes more reliably than the default rate.
  $synth.Rate = -2
  $synth.Speak($Phrase)
  # The WAV header is only finalized when output is detached.
  $synth.SetOutputToNull()
} catch {
  "TTS_ERROR: $($_.Exception.Message)"
  Exit-Smoke "ASR_SMOKE_BLOCKED_NO_TTS_VOICE" 3
} finally {
  if ($synth) { $synth.Dispose() }
}

if (-not (Test-RiffWav $rawWav)) {
  "WAV: invalid (missing or not a RIFF container): $rawWav"
  Exit-Smoke "ASR_SMOKE_FAILED_WAV_INVALID" 12
}
"WAV: $rawWav"
"WAV_SIZE: $((Get-Item $rawWav).Length)"
"PHRASE: $Phrase"

"`n=== TRANSCODE (app two-file flow) ==="
$recognizeWav = $rawWav
$ffmpegCandidates = @((Join-Path $InstallDir "resources\bin\ffmpeg.exe"))
$ffmpegOnPath = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if ($ffmpegOnPath) { $ffmpegCandidates += $ffmpegOnPath }
$ffmpeg = $ffmpegCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($ffmpeg) {
  "FFMPEG: $ffmpeg"
  $transcodedWav = Join-Path $script:workDir "clip.wav"
  # Same argv the app uses in asr-ipc.ts.
  & $ffmpeg -y -i $rawWav -ar 16000 -ac 1 -f wav $transcodedWav 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0 -and (Test-RiffWav $transcodedWav)) {
    "TRANSCODE: ok -> $transcodedWav"
    $recognizeWav = $transcodedWav
  } else {
    # Mirror the app: a failed transcode falls back to the raw clip.
    "TRANSCODE: failed (exit $LASTEXITCODE); using raw clip (app behaviour: transcodeSkippedReason=ffmpeg-failed)"
  }
} else {
  "FFMPEG: missing"
  "TRANSCODE: skipped; using raw clip (app behaviour: transcodeSkippedReason=ffmpeg-not-found)"
}

"`n=== RECOGNIZE ==="
$stdoutFile = Join-Path $script:workDir "recognize.stdout.log"
$stderrFile = Join-Path $script:workDir "recognize.stderr.log"
$argumentLine = (@($recognizeWav, $Locale) | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
"ARGUMENT_LINE: $argumentLine"
$startParams = @{
  FilePath = $exe
  ArgumentList = $argumentLine
  RedirectStandardOutput = $stdoutFile
  RedirectStandardError = $stderrFile
  WindowStyle = "Hidden"
  PassThru = $true
}
try {
  $proc = Start-Process @startParams
  # Cache the handle so ExitCode is readable after exit (PS 5.1 quirk:
  # without this, ExitCode can come back null on -PassThru processes).
  $null = $proc.Handle
} catch {
  "START_ERROR: $($_.Exception.Message)"
  Exit-Smoke "ASR_SMOKE_FAILED_RECOGNIZER" 8
}

# The helper self-bounds recognition at 28s (Program.cs RecognizerTimeout);
# the outer wait covers cold .NET startup on top of that.
if (-not $proc.WaitForExit($RecognizeTimeoutSeconds * 1000)) {
  try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch {}
  "TIMEOUT: helper still running after ${RecognizeTimeoutSeconds}s"
  Exit-Smoke "ASR_SMOKE_FAILED_TIMEOUT" 5
}
$exitCode = $proc.ExitCode
"HELPER_EXIT: $exitCode"
$stderrText = ""
if (Test-Path $stderrFile) {
  $stderrText = [string](Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue)
}

if ($exitCode -ne 0) {
  if ($stderrText) {
    ($stderrText -split "`n") | Select-Object -Last 10 | ForEach-Object { "STDERR: $($_.TrimEnd())" }
  }
  if ($stderrText -match "No Windows desktop speech recognizer") {
    Exit-Smoke "ASR_SMOKE_BLOCKED_NO_RECOGNIZER" 4
  }
  # Exit-code contract from Program.cs.
  switch ($exitCode) {
    2 { Exit-Smoke "ASR_SMOKE_FAILED_PERMISSION" 6 }
    3 { Exit-Smoke "ASR_SMOKE_FAILED_AUDIO" 7 }
    default { Exit-Smoke "ASR_SMOKE_FAILED_RECOGNIZER" 8 }
  }
}

$stdoutText = ""
if (Test-Path $stdoutFile) {
  $stdoutText = ([string](Get-Content -LiteralPath $stdoutFile -Raw -ErrorAction SilentlyContinue)).Trim()
}
if (-not $stdoutText) {
  "STDOUT: empty (helper exited 0 but printed nothing)"
  Exit-Smoke "ASR_SMOKE_FAILED_BAD_JSON" 9
}

$parsed = $null
try {
  # -ErrorAction Stop: ConvertFrom-Json failures are otherwise non-terminating
  # in PS 5.1 and would slip past this catch.
  $parsed = $stdoutText | ConvertFrom-Json -ErrorAction Stop
} catch {
  "STDOUT_RAW: $($stdoutText.Substring(0, [Math]::Min(200, $stdoutText.Length)))"
  "JSON_ERROR: $($_.Exception.Message)"
  Exit-Smoke "ASR_SMOKE_FAILED_BAD_JSON" 9
}

$transcript = [string]$parsed.text
$language = [string]$parsed.language
# The phrase is our own synthetic sentence, so echoing the transcript is safe.
"TRANSCRIPT: $transcript"
"LANGUAGE: $language"

if (-not $transcript.Trim()) {
  "Recognizer returned an empty transcript (helper exit 0, no dictation match)."
  Exit-Smoke "ASR_SMOKE_FAILED_EMPTY_TRANSCRIPT" 10
}

"`n=== KEYWORD ASSERTION ==="
"KEYWORD_EXPECTED: $Keyword"
if ($transcript -notmatch [regex]::Escape($Keyword)) {
  "KEYWORD_FOUND: False"
  Exit-Smoke "ASR_SMOKE_FAILED_KEYWORD" 11
}
"KEYWORD_FOUND: True"

Exit-Smoke "ASR_SMOKE_OK" 0
