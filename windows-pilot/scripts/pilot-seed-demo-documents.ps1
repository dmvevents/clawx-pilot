# pilot-seed-demo-documents.ps1
# Creates sanitized local demo files in Windows Downloads for repeatable chat
# procedures. This script has no network side effects and does not send email,
# download attachments, or submit Microsoft Forms.

[CmdletBinding()]
param(
  [string] $DownloadsPath = "$env:USERPROFILE\Downloads"
)

$ErrorActionPreference = "Stop"

function Write-State($name, $value) {
  Write-Output ("STATE:{0}={1}" -f $name, $value)
}

function Write-Utf8File($path, $lines) {
  $content = ($lines -join "`r`n") + "`r`n"
  Set-Content -LiteralPath $path -Value $content -Encoding UTF8
}

function ConvertTo-XmlText($value) {
  return [System.Security.SecurityElement]::Escape([string] $value)
}

function Write-PackageText {
  param(
    [string] $Root,
    [string] $RelativePath,
    [string] $Content
  )

  $path = Join-Path $Root $RelativePath
  $dir = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $encoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
  [System.IO.File]::WriteAllText($path, $content, $encoding)
}

function New-OpenXmlPackage {
  param(
    [string] $PackagePath,
    [scriptblock] $WriteFiles
  )

  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("clawx-demo-openxml-" + [System.Guid]::NewGuid().ToString("N"))
  try {
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    & $WriteFiles $tempDir
    if (Test-Path -LiteralPath $PackagePath) {
      Remove-Item -LiteralPath $PackagePath -Force
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $PackagePath)
    return $true
  } catch {
    Write-State "OPENXML_PACKAGE_FAILED" $_.Exception.Message
    return $false
  } finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Write-DemoWordDocument($path, $lines) {
  return (New-OpenXmlPackage -PackagePath $path -WriteFiles {
    param($root)
    Write-PackageText -Root $root -RelativePath "[Content_Types].xml" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
'@
    Write-PackageText -Root $root -RelativePath "_rels\.rels" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
'@
    $paragraphs = @($lines | ForEach-Object {
      "<w:p><w:r><w:t>$(ConvertTo-XmlText $_)</w:t></w:r></w:p>"
    }) -join "`n"
    Write-PackageText -Root $root -RelativePath "word\document.xml" -Content @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
$paragraphs
    <w:sectPr/>
  </w:body>
</w:document>
"@
  })
}

function Get-ExcelColumnName([int] $index) {
  $name = ""
  while ($index -gt 0) {
    $index--
    $name = [char](65 + ($index % 26)) + $name
    $index = [math]::Floor($index / 26)
  }
  return $name
}

function Write-DemoWorkbook($path, $rows) {
  return (New-OpenXmlPackage -PackagePath $path -WriteFiles {
    param($root)
    Write-PackageText -Root $root -RelativePath "[Content_Types].xml" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>
'@
    Write-PackageText -Root $root -RelativePath "_rels\.rels" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
'@
    Write-PackageText -Root $root -RelativePath "xl\workbook.xml" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Attendance Results" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>
'@
    Write-PackageText -Root $root -RelativePath "xl\_rels\workbook.xml.rels" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
'@
    Write-PackageText -Root $root -RelativePath "xl\styles.xml" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>
'@
    $sheetRows = for ($rowIndex = 0; $rowIndex -lt $rows.Count; $rowIndex++) {
      $rowNumber = $rowIndex + 1
      $cells = for ($columnIndex = 0; $columnIndex -lt $rows[$rowIndex].Count; $columnIndex++) {
        $columnName = Get-ExcelColumnName ($columnIndex + 1)
        $cellRef = "$columnName$rowNumber"
        "<c r=""$cellRef"" t=""inlineStr""><is><t>$(ConvertTo-XmlText $rows[$rowIndex][$columnIndex])</t></is></c>"
      }
      "<row r=""$rowNumber"">$($cells -join '')</row>"
    }
    Write-PackageText -Root $root -RelativePath "xl\worksheets\sheet1.xml" -Content @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
$($sheetRows -join "`n")
  </sheetData>
</worksheet>
"@
  })
}

if (-not (Test-Path -LiteralPath $DownloadsPath)) {
  New-Item -ItemType Directory -Force -Path $DownloadsPath | Out-Null
}

$attendanceCsv = Join-Path $DownloadsPath "moe-demo-attendance-results.csv"
$attendanceXlsx = Join-Path $DownloadsPath "moe-demo-attendance-results.xlsx"
$dailySource = Join-Path $DownloadsPath "moe-demo-daily-report-source.txt"
$suspensionSource = Join-Path $DownloadsPath "moe-demo-suspension-source.txt"
$suspensionDocx = Join-Path $DownloadsPath "moe-demo-suspension-source.docx"

$attendanceRows = @(
  @("School", "Class", "Enrolled", "Present", "Absent", "Notes"),
  @("Demo Primary School", "Infants 1", "22", "21", "1", "Routine day"),
  @("Demo Primary School", "Standard 1", "26", "24", "2", "One medical absence"),
  @("Demo Primary School", "Standard 2", "24", "23", "1", "Routine day"),
  @("Demo Primary School", "Standard 3", "25", "24", "1", "Routine day"),
  @("Demo Primary School", "Standard 4", "23", "21", "2", "Transport delay affected two pupils"),
  @("Demo Primary School", "Standard 5", "20", "19", "1", "SEA practice completed")
)

$attendanceCsvLines = @($attendanceRows | ForEach-Object { ($_ -join ",") })
Write-Utf8File $attendanceCsv $attendanceCsvLines
$xlsxCreated = Write-DemoWorkbook $attendanceXlsx $attendanceRows

Write-Utf8File $dailySource @(
  "Daily Report Demo Source",
  "Form: Daily School Report",
  "School: Demo Primary School",
  "Education District: St. George East",
  "Date: Today",
  "School operated today: Yes",
  "Principal status: Present",
  "Vice Principal or Senior Teacher status: Present",
  "Teachers on staff: 14",
  "Teachers present: 13",
  "Teachers absent: 1",
  "Student attendance source: moe-demo-attendance-results.csv",
  "Meals branch: NSDSL meals received; no illness reported",
  "Transport branch: one route delayed; no missed return trip",
  "Discipline branch: no suspensions today",
  "Whole-term absentee branch: none to report"
)

$suspensionLines = @(
  "Student Suspension Demo Source",
  "Form: Student Suspension",
  "School: Demo Primary School",
  "Education District: St. George East",
  "Student placeholder: Student A.",
  "Sex: Female",
  "Class: Standard 4",
  "Age: 10",
  "Birth certificate PIN: DEMO-PIN-0001",
  "Incident date: Today",
  "Incident location: classroom during lunch transition",
  "Primary infraction: fighting or physical aggression",
  "Additional infraction: refusal to follow teacher direction",
  "Victim involvement: another pupil was pushed; no serious injury reported",
  "Suspension issue date: Today",
  "Suspension length: 2 school days",
  "Suspensions this term: 1",
  "Written reports: class teacher report and principal interview note available",
  "Parent or guardian: Demo Guardian",
  "Parent contact: 000-0000",
  "Address: 1 Demo Street, Demo Village",
  "Parent present: Yes",
  "Parent signed notice: Pending signature at pickup",
  "Discipline matrix followed: Yes",
  "Level of offence: Level 2",
  "SSSD referral: Not required at this time",
  "Extended suspension application: No",
  "Missing fields to confirm before submit: actual pupil identifiers and parent signature"
)
Write-Utf8File $suspensionSource $suspensionLines

$docxCreated = Write-DemoWordDocument $suspensionDocx $suspensionLines

Write-State "DEMO_DOCUMENTS_SEEDED" "true"
Write-State "DOWNLOADS_PATH" $DownloadsPath
Write-State "ATTENDANCE_CSV" $attendanceCsv
Write-State "ATTENDANCE_XLSX" $(if ($xlsxCreated) { $attendanceXlsx } else { "failed" })
Write-State "DAILY_SOURCE" $dailySource
Write-State "SUSPENSION_SOURCE" $suspensionSource
Write-State "SUSPENSION_DOCX" $(if ($docxCreated) { $suspensionDocx } else { "failed" })
