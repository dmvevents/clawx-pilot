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

function Add-ZipAssembly {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
}

function Assert-OpenXmlPackage {
  param(
    [string] $PackagePath,
    [string[]] $RequiredEntries
  )

  $zip = $null
  try {
    Add-ZipAssembly
    $zip = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
    foreach ($requiredEntry in $RequiredEntries) {
      $normalizedRequired = $requiredEntry -replace "\\", "/"
      $found = $false
      foreach ($entry in $zip.Entries) {
        $normalizedEntry = $entry.FullName -replace "\\", "/"
        if ($normalizedEntry -eq $normalizedRequired) {
          $found = $true
          break
        }
      }
      if (-not $found) {
        throw ("missing OpenXML entry: {0}" -f $normalizedRequired)
      }
    }
    return $true
  } catch {
    Write-State "OPENXML_PACKAGE_INVALID" ("{0}: {1}" -f $PackagePath, $_.Exception.Message)
    return $false
  } finally {
    if ($zip) {
      $zip.Dispose()
    }
  }
}

function New-OpenXmlPackage {
  param(
    [string] $PackagePath,
    [string[]] $RequiredEntries,
    [scriptblock] $WriteFiles
  )

  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("clawx-demo-openxml-" + [System.Guid]::NewGuid().ToString("N"))
  $destinationDir = Split-Path -Parent $PackagePath
  $tempPackage = Join-Path $destinationDir (".{0}.{1}.tmp" -f [System.IO.Path]::GetFileName($PackagePath), [System.Guid]::NewGuid().ToString("N"))
  try {
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    & $WriteFiles $tempDir
    Add-ZipAssembly
    [System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $tempPackage)
    if (-not (Assert-OpenXmlPackage -PackagePath $tempPackage -RequiredEntries $RequiredEntries)) {
      return $false
    }
    if (Test-Path -LiteralPath $PackagePath) {
      [System.IO.File]::Replace($tempPackage, $PackagePath, $null, $true)
    } else {
      [System.IO.File]::Move($tempPackage, $PackagePath)
    }
    return (Assert-OpenXmlPackage -PackagePath $PackagePath -RequiredEntries $RequiredEntries)
  } catch {
    Write-State "OPENXML_PACKAGE_FAILED" $_.Exception.Message
    return $false
  } finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tempPackage -Force -ErrorAction SilentlyContinue
  }
}

function Write-DemoWordDocument($path, $lines) {
  return (New-OpenXmlPackage -PackagePath $path -RequiredEntries @(
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml"
  ) -WriteFiles {
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
  return (New-OpenXmlPackage -PackagePath $path -RequiredEntries @(
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml"
  ) -WriteFiles {
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

function New-PptGroupShapeXml {
  return @'
    <p:nvGrpSpPr>
      <p:cNvPr id="1" name=""/>
      <p:cNvGrpSpPr/>
      <p:nvPr/>
    </p:nvGrpSpPr>
    <p:grpSpPr>
      <a:xfrm>
        <a:off x="0" y="0"/>
        <a:ext cx="0" cy="0"/>
        <a:chOff x="0" y="0"/>
        <a:chExt cx="0" cy="0"/>
      </a:xfrm>
    </p:grpSpPr>
'@
}

function New-PptParagraphXml {
  param(
    [string] $Text,
    [int] $FontSize = 2000,
    [bool] $Bold = $false
  )

  $boldAttr = $(if ($Bold) { ' b="1"' } else { '' })
  return @"
        <a:p>
          <a:r>
            <a:rPr lang="en-US" sz="$FontSize"$boldAttr/>
            <a:t>$(ConvertTo-XmlText $Text)</a:t>
          </a:r>
          <a:endParaRPr lang="en-US" sz="$FontSize"/>
        </a:p>
"@
}

function New-PptTextBoxXml {
  param(
    [int] $Id,
    [string] $Name,
    [int64] $X,
    [int64] $Y,
    [int64] $Cx,
    [int64] $Cy,
    [string[]] $Lines,
    [int] $FontSize = 2000,
    [bool] $Bold = $false
  )

  $paragraphs = @($Lines | ForEach-Object { New-PptParagraphXml -Text $_ -FontSize $FontSize -Bold $Bold }) -join "`n"
  return @"
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="$Id" name="$(ConvertTo-XmlText $Name)"/>
        <p:cNvSpPr txBox="1"/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="$X" y="$Y"/>
          <a:ext cx="$Cx" cy="$Cy"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
        <a:ln><a:noFill/></a:ln>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="square" rtlCol="0"/>
        <a:lstStyle/>
$paragraphs
      </p:txBody>
    </p:sp>
"@
}

function New-PptSlideXml {
  param(
    [string] $Title,
    [string[]] $Lines,
    [int] $SlideNumber
  )

  $groupShape = New-PptGroupShapeXml
  $titleBox = New-PptTextBoxXml -Id 2 -Name "Title $SlideNumber" -X 685800 -Y 380000 -Cx 10500000 -Cy 760000 -Lines @($Title) -FontSize 3400 -Bold $true
  $bodyBox = New-PptTextBoxXml -Id 3 -Name "Content $SlideNumber" -X 850000 -Y 1400000 -Cx 10300000 -Cy 4700000 -Lines $Lines -FontSize 1900
  return @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
$groupShape
$titleBox
$bodyBox
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>
"@
}

function New-PptThemeXml {
  return @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="ClawX Demo Theme">
  <a:themeElements>
    <a:clrScheme name="ClawX Demo">
      <a:dk1><a:srgbClr val="1F2937"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="374151"/></a:dk2>
      <a:lt2><a:srgbClr val="F8FAFC"/></a:lt2>
      <a:accent1><a:srgbClr val="0F766E"/></a:accent1>
      <a:accent2><a:srgbClr val="B45309"/></a:accent2>
      <a:accent3><a:srgbClr val="2563EB"/></a:accent3>
      <a:accent4><a:srgbClr val="7C3AED"/></a:accent4>
      <a:accent5><a:srgbClr val="16A34A"/></a:accent5>
      <a:accent6><a:srgbClr val="DC2626"/></a:accent6>
      <a:hlink><a:srgbClr val="2563EB"/></a:hlink>
      <a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="ClawX Demo">
      <a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="ClawX Demo">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>
'@
}

function Write-DemoPowerPointPresentation($path, $rows) {
  $dataRows = @($rows | Select-Object -Skip 1)
  $totalEnrolled = 0
  $totalPresent = 0
  $totalAbsent = 0
  foreach ($row in $dataRows) {
    $totalEnrolled += [int] $row[2]
    $totalPresent += [int] $row[3]
    $totalAbsent += [int] $row[4]
  }
  $highestAbsence = $dataRows | Sort-Object { [int] $_[4] } -Descending | Select-Object -First 1
  $breakdownLines = @($dataRows | ForEach-Object {
    "{0}: {1}/{2} present, {3} absent. {4}" -f $_[1], $_[3], $_[2], $_[4], $_[5]
  })

  $slides = @(
    @{
      Title = "Attendance Summary"
      Lines = @(
        "Demo Primary School",
        "Generated from moe-demo-attendance-results.csv",
        "Purpose: provide a PowerPoint artifact that proves generated slides contain attendance data."
      )
    },
    @{
      Title = "Whole School Totals"
      Lines = @(
        "Total enrolled: $totalEnrolled",
        "Total present: $totalPresent",
        "Total absent: $totalAbsent",
        "Highest absence class: $($highestAbsence[1]) with $($highestAbsence[4]) absent"
      )
    },
    @{
      Title = "Class Breakdown"
      Lines = $breakdownLines
    }
  )

  $requiredEntries = @(
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/core.xml",
    "docProps/app.xml",
    "ppt/presentation.xml",
    "ppt/_rels/presentation.xml.rels",
    "ppt/theme/theme1.xml",
    "ppt/slideMasters/slideMaster1.xml",
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    "ppt/slideLayouts/slideLayout1.xml",
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    "ppt/slides/slide1.xml",
    "ppt/slides/slide2.xml",
    "ppt/slides/slide3.xml",
    "ppt/slides/_rels/slide1.xml.rels",
    "ppt/slides/_rels/slide2.xml.rels",
    "ppt/slides/_rels/slide3.xml.rels"
  )

  return (New-OpenXmlPackage -PackagePath $path -RequiredEntries $requiredEntries -WriteFiles {
    param($root)
    Write-PackageText -Root $root -RelativePath "[Content_Types].xml" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>
'@
    Write-PackageText -Root $root -RelativePath "_rels\.rels" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
'@
    Write-PackageText -Root $root -RelativePath "docProps\core.xml" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>MOE Demo Attendance Summary</dc:title>
  <dc:creator>Ministry of Education Principal Assistant</dc:creator>
  <cp:lastModifiedBy>Ministry of Education Principal Assistant</cp:lastModifiedBy>
</cp:coreProperties>
'@
    Write-PackageText -Root $root -RelativePath "docProps\app.xml" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Ministry of Education Principal Assistant</Application>
  <PresentationFormat>On-screen Show (16:9)</PresentationFormat>
  <Slides>3</Slides>
  <Company>Ministry of Education</Company>
</Properties>
'@
    Write-PackageText -Root $root -RelativePath "ppt\presentation.xml" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
    <p:sldId id="258" r:id="rId4"/>
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle>
    <a:defPPr><a:defRPr lang="en-US"/></a:defPPr>
  </p:defaultTextStyle>
</p:presentation>
'@
    Write-PackageText -Root $root -RelativePath "ppt\_rels\presentation.xml.rels" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>
'@
    Write-PackageText -Root $root -RelativePath "ppt\theme\theme1.xml" -Content (New-PptThemeXml)
    $groupShape = New-PptGroupShapeXml
    Write-PackageText -Root $root -RelativePath "ppt\slideMasters\slideMaster1.xml" -Content @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
$groupShape
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle/>
    <p:bodyStyle/>
    <p:otherStyle/>
  </p:txStyles>
</p:sldMaster>
"@
    Write-PackageText -Root $root -RelativePath "ppt\slideMasters\_rels\slideMaster1.xml.rels" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>
'@
    Write-PackageText -Root $root -RelativePath "ppt\slideLayouts\slideLayout1.xml" -Content @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
$groupShape
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>
"@
    Write-PackageText -Root $root -RelativePath "ppt\slideLayouts\_rels\slideLayout1.xml.rels" -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>
'@
    for ($i = 0; $i -lt $slides.Count; $i++) {
      $slideNumber = $i + 1
      $slide = $slides[$i]
      Write-PackageText -Root $root -RelativePath ("ppt\slides\slide{0}.xml" -f $slideNumber) -Content (New-PptSlideXml -Title $slide.Title -Lines $slide.Lines -SlideNumber $slideNumber)
      Write-PackageText -Root $root -RelativePath ("ppt\slides\_rels\slide{0}.xml.rels" -f $slideNumber) -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>
'@
    }
  })
}

if (-not (Test-Path -LiteralPath $DownloadsPath)) {
  New-Item -ItemType Directory -Force -Path $DownloadsPath | Out-Null
}

$attendanceCsv = Join-Path $DownloadsPath "moe-demo-attendance-results.csv"
$attendanceXlsx = Join-Path $DownloadsPath "moe-demo-attendance-results.xlsx"
$attendancePptx = Join-Path $DownloadsPath "moe-demo-attendance-summary.pptx"
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
$pptxCreated = Write-DemoPowerPointPresentation $attendancePptx $attendanceRows

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

$requiredPlainFilesReady = $true
foreach ($requiredPlainFile in @($attendanceCsv, $dailySource, $suspensionSource)) {
  if (-not (Test-Path -LiteralPath $requiredPlainFile)) {
    $requiredPlainFilesReady = $false
    Write-State "REQUIRED_DEMO_FILE_MISSING" $requiredPlainFile
  }
}

Write-State "DOWNLOADS_PATH" $DownloadsPath
Write-State "ATTENDANCE_CSV" $attendanceCsv
Write-State "ATTENDANCE_XLSX" $(if ($xlsxCreated) { $attendanceXlsx } else { "failed" })
Write-State "ATTENDANCE_PPTX" $(if ($pptxCreated) { $attendancePptx } else { "failed" })
Write-State "DAILY_SOURCE" $dailySource
Write-State "SUSPENSION_SOURCE" $suspensionSource
Write-State "SUSPENSION_DOCX" $(if ($docxCreated) { $suspensionDocx } else { "failed" })

if (-not ($requiredPlainFilesReady -and $xlsxCreated -and $docxCreated -and $pptxCreated)) {
  Write-State "DEMO_DOCUMENTS_SEEDED" "false"
  exit 6
}

Write-State "DEMO_DOCUMENTS_SEEDED" "true"
