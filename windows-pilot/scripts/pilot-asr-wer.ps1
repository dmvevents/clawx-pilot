# pilot-asr-wer.ps1 — CLWX-87 System.Speech WER leg (Windows VM/laptop).
#
# Synthesizes each clip from eval/fixtures/clwx87-asr-manifest.json with
# System.Speech TTS (same texts the Mac leg speaks via `say`), then runs the
# SHIPPED System.Speech recognition path over the wav and writes a
# transcripts JSON that scripts/clwx87-wer-bench.mjs grades with
# `--engine transcripts --file <out>` — grading stays in ONE place so the
# engines are compared on identical references.
#
# Usage (from the repo checkout on the Windows box):
#   powershell -NoProfile -ExecutionPolicy Bypass -File windows-pilot\scripts\pilot-asr-wer.ps1 `
#     -ManifestPath eval\fixtures\clwx87-asr-manifest.json -OutPath clwx87-sysspeech-transcripts.json
#
# STATE line contract (pilot script convention): last line is
#   STATE: WER_TRANSCRIPTS_OK clips=<n> out=<path>   on success
#   STATE: WER_TRANSCRIPTS_FAIL reason=<...>          on failure (exit 1)
#
# Read-only outside its temp dir + OutPath. No network. No secrets.
param(
  [string]$ManifestPath = "eval\fixtures\clwx87-asr-manifest.json",
  [string]$OutPath = "clwx87-sysspeech-transcripts.json"
)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech

  $manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
  $work = Join-Path ([System.IO.Path]::GetTempPath()) ("clwx87-" + [System.Guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $work | Out-Null

  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $transcripts = @{}
  foreach ($clip in $manifest.clips) {
    if ($clip.source -eq 'real') { continue } # real clips are graded from their audioPath on the Mac lane
    $wav = Join-Path $work ($clip.id + '.wav')
    # 16kHz mono PCM — the same format the Mac leg feeds whisper.
    $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $synth.SetOutputToWaveFile($wav, $fmt)
    $synth.Speak($clip.text)
    $synth.SetOutputToNull()

    # The SHIPPED recognition engine: in-process SpeechRecognitionEngine with
    # DictationGrammar — the same engine class the app's win-asr helper uses.
    $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $rec.SetInputToWaveFile($wav)
    $sb = New-Object System.Text.StringBuilder
    while ($true) {
      $result = $rec.Recognize()
      if ($null -eq $result) { break }
      [void]$sb.Append($result.Text + ' ')
    }
    $rec.Dispose()
    $transcripts[$clip.id] = $sb.ToString().Trim()
    Write-Host ("  sysspeech {0}: `"{1}`"" -f $clip.id, $transcripts[$clip.id])
  }
  $synth.Dispose()

  $json = @{ engine = 'system.speech'; generatedAt = (Get-Date -Format o); transcripts = $transcripts } | ConvertTo-Json -Depth 4
  # BOM-less UTF8 (PS 5.1 Set-Content -Encoding UTF8 emits a BOM that breaks
  # JSON.parse downstream — standing fleet rule).
  if ([System.IO.Path]::IsPathRooted($OutPath)) { $full = $OutPath } else { $full = Join-Path (Get-Location).Path $OutPath }
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($full), $json, (New-Object System.Text.UTF8Encoding($false)))

  Remove-Item -Recurse -Force $work
  Write-Host ("STATE: WER_TRANSCRIPTS_OK clips={0} out={1}" -f $transcripts.Count, $OutPath)
  exit 0
} catch {
  Write-Host ("STATE: WER_TRANSCRIPTS_FAIL reason=" + $_.Exception.Message)
  exit 1
}
