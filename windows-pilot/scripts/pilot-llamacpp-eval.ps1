# pilot-llamacpp-eval.ps1
#
# Bounded evaluation of bundled llama.cpp as an alternative to native Ollama for
# the on-device agentic path (CLWX-126). Answers three questions with evidence:
#
#   1. Does llama-server start and become healthy, and how long is the cold load?
#   2. Does an ordinary completion work through the OpenAI-compatible route?
#   3. Does OPENAI-STYLE TOOL CALLING work? This is the agentic question - an
#      engine that cannot emit a parseable tool call is unusable here regardless
#      of its speed.
#
# Read-only with respect to the product: downloads into its own directory, runs a
# server on a spare port, stops it, and writes one JSON receipt. Installs nothing.
#
# Defaults pin the build and the weights by URL; both hashes are recorded, because
# CLWX-126's acceptance requires pinned server builds and identical quantisation.
#
# FAIRNESS: CLWX-126's Ollama baseline (27.396 s total, 23.331 s cold load at
# num_ctx=32768) was measured on 4 vCPU / 16 GiB. Run this on matched hardware
# before comparing latency; the receipt records cores and RAM so a mismatch is
# visible rather than assumed.
#
# Usage:
#   .\pilot-llamacpp-eval.ps1 -ServerZipUrl <url> -ModelUrl <url>

[CmdletBinding()]
param(
  [string] $ServerZipUrl = 'https://github.com/ggml-org/llama.cpp/releases/download/b10876/llama-b10876-bin-win-cpu-x64.zip',
  [string] $ModelUrl = 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
  [int] $ContextSize = 32768,
  [int] $Port = 18999
)

$ErrorActionPreference='Continue'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$root='C:\clawx-llamaeval'; New-Item -ItemType Directory -Force -Path $root | Out-Null
$o=[ordered]@{}
$o.at=(Get-Date).ToUniversalTime().ToString('o')
$o.host=$env:COMPUTERNAME
$o.cores=(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$o.ramGB=[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)
$o.baselineNote='CLWX-126 Ollama baseline ran on 4 vCPU / 16 GiB; latency here is NOT directly comparable.'

# --- pinned artifacts (CLWX-126 acceptance requires hashes) ------------------
$zip="$root\llama.zip"; $gguf="$root\qwen2.5-3b-instruct-q4_k_m.gguf"
if (-not (Test-Path "$root\bin\llama-server.exe")) {
  Invoke-WebRequest -Uri $ServerZipUrl -OutFile $zip -UseBasicParsing
  $o.llamaZipSha256=(Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
  $o.llamaZipBytes=(Get-Item $zip).Length
  Expand-Archive $zip -DestinationPath "$root\bin" -Force
}
$server=Get-ChildItem "$root\bin" -Recurse -Filter 'llama-server.exe' | Select-Object -First 1
$o.serverPresent=[bool]$server
if (-not (Test-Path $gguf)) {
  $sw=[Diagnostics.Stopwatch]::StartNew()
  Invoke-WebRequest -Uri $ModelUrl -OutFile $gguf -UseBasicParsing
  $o.ggufDownloadSeconds=[math]::Round($sw.Elapsed.TotalSeconds,1)
}
$o.ggufBytes=(Get-Item $gguf -EA SilentlyContinue).Length
$o.ggufSha256=(Get-FileHash -Algorithm SHA256 $gguf -EA SilentlyContinue).Hash.ToLower()
if (-not $server) { $o.result='BLOCKED_NO_SERVER'; $o|ConvertTo-Json -Compress; exit 1 }

# --- start llama-server with the SAME context Ollama consumed (32768) -------
$port=$Port
$sw=[Diagnostics.Stopwatch]::StartNew()
$p=Start-Process -FilePath $server.FullName -ArgumentList @(
    '-m',"`"$gguf`"",'-c',"$ContextSize",'--port',"$port",'--host','127.0.0.1','--jinja','-t',"$($o.cores)"
  ) -PassThru -WindowStyle Hidden -RedirectStandardError "$root\server.err" -RedirectStandardOutput "$root\server.out"
$ready=$null
while ($sw.Elapsed.TotalSeconds -lt 300) {
  try { $h=Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3 -UseBasicParsing
        if ($h.StatusCode -eq 200) { $ready=[int]$sw.Elapsed.TotalMilliseconds; break } } catch {}
  if ($p.HasExited) { break }
  Start-Sleep -Milliseconds 500
}
$o.coldLoadMs=$ready
$o.serverExitedEarly=$p.HasExited
if (-not $ready) { $o.result='FAIL_NO_HEALTH'; $o.serverErrTail=(Get-Content "$root\server.err" -Tail 12 -EA SilentlyContinue) -join ' | '; $o|ConvertTo-Json -Depth 4 -Compress; exit 1 }
$p.Refresh(); $o.serverWorkingSetMB=[math]::Round($p.WorkingSet64/1MB,0)

# --- 1. ordinary completion -------------------------------------------------
$body=@{ model='qwen2.5-3b-instruct'; messages=@(@{role='user';content='Reply with exactly one short sentence: what is the capital of Trinidad and Tobago?'}); max_tokens=64 } | ConvertTo-Json -Depth 5
$sw.Restart()
try {
  $r=Invoke-RestMethod -Uri "http://127.0.0.1:$port/v1/chat/completions" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 120
  $o.plainMs=[int]$sw.Elapsed.TotalMilliseconds
  $o.plainAnswer=$r.choices[0].message.content
} catch { $o.plainError=$_.Exception.Message }

# --- 2. THE agentic question: does OpenAI-style tool calling work? ----------
$tools=@(@{ type='function'; function=@{ name='read_document'; description='Read a document from the principal''s folder';
  parameters=@{ type='object'; properties=@{ filename=@{ type='string'; description='file to read' } }; required=@('filename') } } })
$body2=@{ model='qwen2.5-3b-instruct'; tools=$tools; tool_choice='auto';
  messages=@(@{role='user';content='Read the file suspensions-march.docx and tell me what it says. Use the tool.'}); max_tokens=256 } | ConvertTo-Json -Depth 8
$sw.Restart()
try {
  $r2=Invoke-RestMethod -Uri "http://127.0.0.1:$port/v1/chat/completions" -Method Post -ContentType 'application/json' -Body $body2 -TimeoutSec 120
  $o.toolMs=[int]$sw.Elapsed.TotalMilliseconds
  $tc=$r2.choices[0].message.tool_calls
  $o.toolCallEmitted=[bool]$tc
  if ($tc) {
    $o.toolName=$tc[0].function.name
    $o.toolArgs=$tc[0].function.arguments
    $o.toolArgsParseable=$true
    try { $null=$tc[0].function.arguments | ConvertFrom-Json } catch { $o.toolArgsParseable=$false }
  } else { $o.toolFallbackContent=$r2.choices[0].message.content }
} catch { $o.toolError=$_.Exception.Message }

try { Stop-Process -Id $p.Id -Force -EA SilentlyContinue } catch {}
$o.result = if ($o.toolCallEmitted -and $o.plainAnswer) { 'PASS_FUNCTIONAL' } else { 'PARTIAL' }
$o | ConvertTo-Json -Depth 5 -Compress
