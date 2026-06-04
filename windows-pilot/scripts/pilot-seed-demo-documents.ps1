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

function Try-WriteWordDocument($path, $text) {
  $word = $null
  $doc = $null
  try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $doc = $word.Documents.Add()
    $selection = $word.Selection
    $selection.TypeText($text)
    $formatDocx = 16
    $doc.SaveAs([ref] $path, [ref] $formatDocx)
    return $true
  } catch {
    Write-State "WORD_DOCX_SKIPPED" $_.Exception.Message
    return $false
  } finally {
    if ($doc) {
      try {
        $saveChanges = $false
        $doc.Close([ref] $saveChanges) | Out-Null
      } catch {
        Write-State "WORD_DOCX_CLOSE_WARNING" $_.Exception.Message
      }
    }
    if ($word) {
      try {
        $word.Quit() | Out-Null
      } catch {
        Write-State "WORD_QUIT_WARNING" $_.Exception.Message
      }
    }
  }
}

if (-not (Test-Path -LiteralPath $DownloadsPath)) {
  New-Item -ItemType Directory -Force -Path $DownloadsPath | Out-Null
}

$attendanceCsv = Join-Path $DownloadsPath "moe-demo-attendance-results.csv"
$dailySource = Join-Path $DownloadsPath "moe-demo-daily-report-source.txt"
$suspensionSource = Join-Path $DownloadsPath "moe-demo-suspension-source.txt"
$suspensionDocx = Join-Path $DownloadsPath "moe-demo-suspension-source.docx"

Write-Utf8File $attendanceCsv @(
  "School,Class,Enrolled,Present,Absent,Notes",
  "Demo Primary School,Infants 1,22,21,1,Routine day",
  "Demo Primary School,Standard 1,26,24,2,One medical absence",
  "Demo Primary School,Standard 2,24,23,1,Routine day",
  "Demo Primary School,Standard 3,25,24,1,Routine day",
  "Demo Primary School,Standard 4,23,21,2,Transport delay affected two pupils",
  "Demo Primary School,Standard 5,20,19,1,SEA practice completed"
)

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

$docxCreated = Try-WriteWordDocument $suspensionDocx ($suspensionLines -join "`r`n")

Write-State "DEMO_DOCUMENTS_SEEDED" "true"
Write-State "DOWNLOADS_PATH" $DownloadsPath
Write-State "ATTENDANCE_CSV" $attendanceCsv
Write-State "DAILY_SOURCE" $dailySource
Write-State "SUSPENSION_SOURCE" $suspensionSource
Write-State "SUSPENSION_DOCX" $(if ($docxCreated) { $suspensionDocx } else { "skipped" })
