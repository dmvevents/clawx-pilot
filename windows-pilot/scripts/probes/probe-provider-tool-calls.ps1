# CLWX-141 provider probe. Runs on the acceptance VM as the app user; reads the app's own
# cloud-gateway.json for endpoint + key and never prints the key. Splices the tool JSON
# verbatim (PowerShell 5.1 ConvertTo-Json wraps arrays of PSCustomObjects in {value,Count}).
# Stage tools-*.json next to it with collect-plugin-tools.mjs.
$ErrorActionPreference='Continue'
$cfgPath=Join-Path $env:APPDATA 'Ministry of Education\cloud-gateway.json'
$cfg=Get-Content $cfgPath -Raw | ConvertFrom-Json
$base=$cfg.baseUrl.TrimEnd('/')
$key=$cfg.apiKey
if (-not $key -and $cfg.apiKeyFile) { $kf=$cfg.apiKeyFile; if (-not [IO.Path]::IsPathRooted($kf)) { $kf=Join-Path (Split-Path $cfgPath) $kf }; $key=(Get-Content $kf -Raw).Trim() }
$q='What are the six core values of the National School Code of Conduct?'
function Probe($label,$model,$toolsFile){
  $tools=''
  if ($toolsFile) { $tools=',"tools":' + (Get-Content $toolsFile -Raw).Trim() + ',"tool_choice":"auto"' }
  $json='{"model":"' + $model + '","messages":[{"role":"user","content":"' + $q + '"}],"temperature":0' + $tools + '}'
  try {
    $r=Invoke-RestMethod -Method Post -Uri "$base/chat/completions" -Headers @{Authorization="Bearer $key"} -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 90
    $ch=$r.choices[0]; $tc=@(); if ($ch.message.tool_calls) { $tc=$ch.message.tool_calls | ForEach-Object { $_.function.name + '(' + $_.function.arguments + ')' } }
    $txt=''; if ($ch.message.content) { $txt=([string]$ch.message.content).Substring(0,[Math]::Min(120,([string]$ch.message.content).Length)) }
    "$label model=$model status=200 finish=$($ch.finish_reason) tool_calls=[$($tc -join ' | ')] text=[$txt]"
  } catch {
    $msg=''
    try { $stream=$_.Exception.Response.GetResponseStream(); $reader=New-Object IO.StreamReader($stream); $msg=$reader.ReadToEnd() } catch {}
    if (-not $msg) { $msg=$_.Exception.Message }
    $msg=$msg -replace '\s+',' '
    "$label model=$model ERROR $($msg.Substring(0,[Math]::Min(400,$msg.Length)))"
  }
}
$d='C:\clawx-driver\probe141'
Probe 'E1-nscc-only'      'gemini-2.5-flash' "$d\tools-141-nscc-only.json"
Probe 'A1-all-orig'       'gemini-2.5-flash' "$d\tools-141-original.json"
Probe 'A2-all-orig'       'gemini-2.5-flash' "$d\tools-141-original.json"
Probe 'A3-all-orig'       'gemini-2.5-flash' "$d\tools-141-original.json"
Probe 'B1-all-stripped'   'gemini-2.5-flash' "$d\tools-141-stripped.json"
Probe 'B2-all-stripped'   'gemini-2.5-flash' "$d\tools-141-stripped.json"
Probe 'C1-pro-orig'       'gemini-2.5-pro'   "$d\tools-141-original.json"
Probe 'C2-pro-orig'       'gemini-2.5-pro'   "$d\tools-141-original.json"
