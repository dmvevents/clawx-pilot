# pilot-office-write-smoke.ps1 - prove the packaged Windows runtime can WRITE
# Word/Excel, not just import the libs.
#
# Companion to pilot-office-runtime-check.ps1 (which only proves the docx/xlsx
# deps `require.resolve`). This one actually exercises the write path the agent
# tools document.write_docx / document.write_xlsx use: it requires the bundled
# `docx` + `xlsx` deps from the packaged module roots, writes a real .docx and
# .xlsx into %USERPROFILE%\.openclaw\media\outbound (where write tools with a
# relative path land), validates each output is a real OpenXML (PK zip)
# container, and reads them back (mammoth for docx, xlsx for the workbook) to
# confirm the content round-trips. Read-mostly: it writes only into the app's
# own media/outbound dir and a temp JS probe under %TEMP% that is removed.
#
# STATE lines:
#   OFFICE_WRITE_OK            - docx+xlsx written, valid OpenXML, round-trip read OK
#   OFFICE_WRITE_PARTIAL       - one of docx/xlsx failed
#   OFFICE_WRITE_BLOCKED       - packaged node.exe or a required dep missing

$ErrorActionPreference = "Continue"

$resources = "$env:LOCALAPPDATA\Programs\Ministry of Education\resources"
$node = "$resources\bin\node.exe"
if (-not (Test-Path $node)) {
    "NODE: missing ($node)"
    "STATE: OFFICE_WRITE_BLOCKED"
    exit 2
}
"NODE: $node"

$modulePaths = @(
    "$resources\app.asar.unpacked\node_modules",
    "$resources\node_modules",
    "$resources\openclaw\node_modules"
)
$modulePaths | ForEach-Object { "NODE_PATH_ENTRY: $_ exists=$(Test-Path $_)" }

$outDir = "$env:USERPROFILE\.openclaw\media\outbound"
"OUT_DIR: $outDir"

$scriptPath = Join-Path $env:TEMP "clawx-office-write-smoke.js"
$pathsJson = $modulePaths | ConvertTo-Json -Compress
$outDirJson = $outDir | ConvertTo-Json -Compress
$js = @"
const Module = require("module");
const fs = require("fs");
const path = require("path");
process.env.NODE_PATH = ($pathsJson).join(";");
Module._initPaths();

const outDir = $outDirJson;
fs.mkdirSync(outDir, { recursive: true });
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const isZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b; // 'PK'

(async () => {
  // ---- DOCX ----
  try {
    const { Document, Packer, Paragraph, HeadingLevel } = require("docx");
    const docxPath = path.join(outDir, "clawx-write-smoke.docx");
    const doc = new Document({ sections: [{ properties: {}, children: [
      new Paragraph({ text: "Ministry of Education - Write Smoke", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "Attendance follow-up: transport delay affected two pupils." }),
    ] }] });
    const buf = await Packer.toBuffer(doc);
    fs.writeFileSync(docxPath, buf);
    const back = fs.readFileSync(docxPath);
    ok(isZip(back) && back.length > 0, "write_docx wrote valid OpenXML (" + back.length + " bytes) -> " + docxPath);
    const mammoth = require("mammoth");
    const r = await mammoth.extractRawText({ buffer: back });
    ok((r.value || "").includes("transport delay"), "read_docx round-trips the body text");
  } catch (e) { ok(false, "docx path threw: " + e.message); }

  // ---- XLSX ----
  try {
    const xlsx = require("xlsx");
    const xlsxPath = path.join(outDir, "clawx-write-smoke.xlsx");
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([
      ["Class", "Enrolled", "Present", "Absent"],
      ["Standard 4", 30, 28, 2],
    ]), "Attendance");
    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    fs.writeFileSync(xlsxPath, buf);
    const back = fs.readFileSync(xlsxPath);
    ok(isZip(back) && back.length > 0, "write_xlsx wrote valid OpenXML (" + back.length + " bytes) -> " + xlsxPath);
    const wb2 = xlsx.read(back, { type: "buffer" });
    const aoa = xlsx.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1, defval: "" });
    ok(JSON.stringify(aoa).includes("Standard 4"), "read_xlsx round-trips a data row");
  } catch (e) { ok(false, "xlsx path threw: " + e.message); }

  console.log("");
  if (fail === 0) console.log("JS_RESULT: OK");
  else console.log("JS_RESULT: FAIL " + fail);
  process.exitCode = fail === 0 ? 0 : 10;
})();
"@

# Write the probe as UTF-8 WITHOUT BOM. PS 5.1 Set-Content -Encoding UTF8 emits a
# BOM; a leading BOM in a Node entry file is stripped by Node, but the no-BOM
# writer is the project's Windows-safe standard (see the openclaw.json BOM
# regression) so we keep one path.
[System.IO.File]::WriteAllText($scriptPath, $js, (New-Object System.Text.UTF8Encoding($false)))

try {
    & $node $scriptPath
    $nodeExit = $LASTEXITCODE
} finally {
    Remove-Item $scriptPath -Force -ErrorAction SilentlyContinue
}

"`n=== STATE LINE ==="
if ($nodeExit -eq 0) {
    "STATE: OFFICE_WRITE_OK"
} elseif ($nodeExit -eq 10) {
    "STATE: OFFICE_WRITE_PARTIAL"
} else {
    "STATE: OFFICE_WRITE_BLOCKED"
}
