# pilot-office-runtime-check.ps1 - verify Windows demo Office/Excel readiness.
#
# Read-only: yes, except for a temporary JS probe under %TEMP% that is removed.
# It checks the test Excel workbook and whether the packaged Node/OpenClaw
# runtime can import document-processing libraries.

param(
    [string]$ExcelPath = "",
    [string]$PowerPointPath = ""
)

$ErrorActionPreference = "Continue"

function Add-ZipAssembly {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
}

function Read-ZipEntryText {
    param(
        [System.IO.Compression.ZipArchive]$Zip,
        [string]$EntryName
    )

    $entry = $Zip.GetEntry($EntryName)
    if (-not $entry) {
        throw "missing OpenXML entry: $EntryName"
    }
    $stream = $entry.Open()
    try {
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        try {
            return $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function ConvertFrom-XmlText {
    param([string]$Text)

    return ($Text `
        -replace '&quot;', '"' `
        -replace '&apos;', "'" `
        -replace '&lt;', '<' `
        -replace '&gt;', '>' `
        -replace '&amp;', '&')
}

function Test-PowerPointOpenXml {
    param([string]$Path)

    $zip = $null
    try {
        Add-ZipAssembly
        $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
        $requiredEntries = @(
            "[Content_Types].xml",
            "_rels/.rels",
            "ppt/presentation.xml",
            "ppt/_rels/presentation.xml.rels",
            "ppt/theme/theme1.xml",
            "ppt/slideMasters/slideMaster1.xml",
            "ppt/slideLayouts/slideLayout1.xml",
            "ppt/slides/slide1.xml",
            "ppt/slides/slide2.xml",
            "ppt/slides/slide3.xml"
        )
        foreach ($entryName in $requiredEntries) {
            [void](Read-ZipEntryText -Zip $zip -EntryName $entryName)
        }

        $slideText = @()
        foreach ($slideName in @("ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml")) {
            $slideXml = Read-ZipEntryText -Zip $zip -EntryName $slideName
            foreach ($match in [regex]::Matches($slideXml, '<a:t>(.*?)</a:t>', [System.Text.RegularExpressions.RegexOptions]::Singleline)) {
                $slideText += ConvertFrom-XmlText $match.Groups[1].Value
            }
        }
        $joinedText = ($slideText -join "`n")
        $requiredText = @(
            "Demo Primary School",
            "Total enrolled: 140",
            "Total present: 132",
            "Total absent: 8",
            "Standard 4",
            "Transport delay affected two pupils"
        )
        foreach ($text in $requiredText) {
            if ($joinedText -notlike "*$text*") {
                throw "missing slide text: $text"
            }
        }

        "PPTX_OPENXML: valid"
        "PPTX_SLIDE_TEXT: data rows present"
        return $true
    } catch {
        "PPTX_OPENXML: invalid $($_.Exception.Message)"
        return $false
    } finally {
        if ($zip) {
            $zip.Dispose()
        }
    }
}

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

$pptxCandidates = @()
if ($PowerPointPath) {
    $pptxCandidates += $PowerPointPath
} else {
    $pptxCandidates += "$env:USERPROFILE\Downloads\moe-demo-attendance-summary.pptx"
}
$resolvedPptxPath = $pptxCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $resolvedPptxPath) {
    $resolvedPptxPath = $pptxCandidates | Select-Object -First 1
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

"`n=== POWERPOINT DEMO FILE ==="
$pptxReady = $false
if (Test-Path $resolvedPptxPath) {
    $item = Get-Item $resolvedPptxPath
    "POWERPOINT_FILE: present"
    "Path: $($item.FullName)"
    "SizeBytes: $($item.Length)"
    "Modified: $($item.LastWriteTime)"
    $pptxReady = Test-PowerPointOpenXml $resolvedPptxPath
} else {
    "POWERPOINT_FILE: missing"
    "Expected one of:"
    $pptxCandidates | ForEach-Object { "  $_" }
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
if ((Test-Path $resolvedExcelPath) -and $pptxReady -and $nodeExit -eq 0) {
    "STATE: OFFICE_RUNTIME_READY_WITH_POWERPOINT"
} elseif ((Test-Path $resolvedExcelPath) -and $nodeExit -eq 0) {
    "STATE: OFFICE_RUNTIME_READY"
} elseif ((Test-Path $resolvedExcelPath) -and $pythonExit -eq 0) {
    "STATE: OFFICE_RUNTIME_READY_PYTHON_ONLY"
} elseif (Test-Path $resolvedExcelPath) {
    "STATE: OFFICE_RUNTIME_PARTIAL"
} else {
    "STATE: OFFICE_RUNTIME_BLOCKED"
}
