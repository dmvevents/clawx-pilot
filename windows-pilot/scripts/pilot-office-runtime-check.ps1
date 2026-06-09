# pilot-office-runtime-check.ps1 - verify Windows demo Office/Excel readiness.
#
# Read-only: yes, except for a temporary JS probe under %TEMP% that is removed.
# It checks the test Excel workbook and whether the packaged Node/OpenClaw
# runtime can import document-processing libraries.

param(
    [string]$ExcelPath = ""
)

$ErrorActionPreference = "Continue"

$excelCandidates = @()
if ($ExcelPath) {
    $excelCandidates += $ExcelPath
} else {
    $excelCandidates += "$env:USERPROFILE\Downloads\moe-demo-attendance-results.xlsx"
    $excelCandidates += "$env:USERPROFILE\Downloads\SEA Typical School Results_2024 (1).xlsx"
}
$resolvedExcelPath = $excelCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $resolvedExcelPath) {
    $resolvedExcelPath = $excelCandidates | Select-Object -First 1
}

"=== EXCEL TEST FILE ==="
if (Test-Path $resolvedExcelPath) {
    $item = Get-Item $resolvedExcelPath
    "EXCEL_FILE: present"
    "Path: $($item.FullName)"
    "SizeBytes: $($item.Length)"
    "Modified: $($item.LastWriteTime)"
} else {
    "EXCEL_FILE: missing"
    "Expected one of:"
    $excelCandidates | ForEach-Object { "  $_" }
}

"`n=== PACKAGED NODE MODULES ==="
$resources = "$env:LOCALAPPDATA\Programs\Ministry of Education\resources"
$node = "$resources\bin\node.exe"
if (-not (Test-Path $node)) {
    "NODE: missing ($node)"
    "STATE: OFFICE_RUNTIME_BLOCKED"
    exit 2
}
"NODE: $node"

$modulePaths = @(
    "$resources\app.asar.unpacked\node_modules",
    "$resources\openclaw\node_modules"
)
$modulePaths | ForEach-Object { "NODE_PATH_ENTRY: $_ exists=$(Test-Path $_)" }

$scriptPath = Join-Path $env:TEMP "clawx-office-runtime-check.js"
$pathsJson = $modulePaths | ConvertTo-Json -Compress
$modsJson = @("playwright-core", "xlsx", "docx", "mammoth", "pdf-parse") | ConvertTo-Json -Compress
$js = @"
const Module = require("module");
const paths = $pathsJson;
const mods = $modsJson;
process.env.NODE_PATH = paths.join(";");
Module._initPaths();
let missing = 0;
for (const name of mods) {
  try {
    console.log(name + "=OK " + require.resolve(name));
  } catch (err) {
    missing += 1;
    console.log(name + "=MISSING " + err.code);
  }
}
process.exitCode = missing === 0 ? 0 : 10;
"@

try {
    Set-Content -Path $scriptPath -Value $js -Encoding UTF8
    & $node $scriptPath
    $nodeExit = $LASTEXITCODE
} finally {
    Remove-Item $scriptPath -Force -ErrorAction SilentlyContinue
}

"`n=== PYTHON DOCUMENT PACKAGES ==="
$python = Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
$pythonExit = 1
if ($python) {
    "PYTHON: $python"
    $pyPath = Join-Path $env:TEMP "clawx-python-doc-runtime-check.py"
    $py = @"
import importlib
mods = ["openpyxl", "docx", "pypdf", "pdfplumber", "reportlab"]
missing = 0
for mod in mods:
    try:
        m = importlib.import_module(mod)
        version = getattr(m, "__version__", "")
        print(mod + "=OK " + str(version))
    except Exception as exc:
        missing += 1
        print(mod + "=MISSING " + str(exc))
raise SystemExit(0 if missing == 0 else 10)
"@
    try {
        Set-Content -Path $pyPath -Value $py -Encoding UTF8
        & $python $pyPath
        $pythonExit = $LASTEXITCODE
    } finally {
        Remove-Item $pyPath -Force -ErrorAction SilentlyContinue
    }
} else {
    "PYTHON: missing"
}

"`n=== STATE LINE ==="
if ((Test-Path $resolvedExcelPath) -and $nodeExit -eq 0) {
    "STATE: OFFICE_RUNTIME_READY"
} elseif ((Test-Path $resolvedExcelPath) -and $pythonExit -eq 0) {
    "STATE: OFFICE_RUNTIME_READY_PYTHON_ONLY"
} elseif (Test-Path $resolvedExcelPath) {
    "STATE: OFFICE_RUNTIME_PARTIAL"
} else {
    "STATE: OFFICE_RUNTIME_BLOCKED"
}
