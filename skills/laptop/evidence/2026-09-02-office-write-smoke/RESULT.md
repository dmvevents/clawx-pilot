# Windows Office write-smoke — OFFICE_WRITE_OK

Date: 2026-09-02
VM: clawx-win-rc-20260609 (GCP, IAP localhost:12222), guest clawxtest
App: installed Ministry of Education (packaged node.exe present)
Script: windows-pilot/scripts/pilot-office-write-smoke.ps1 (scp'd + run via powershell -File)

Result (packaged runtime, resources\app.asar.unpacked + openclaw\node_modules):
  PASS  write_docx wrote valid OpenXML (8582 bytes) -> ...\.openclaw\media\outbound\clawx-write-smoke.docx
  PASS  read_docx round-trips the body text
  PASS  write_xlsx wrote valid OpenXML (16077 bytes) -> ...\.openclaw\media\outbound\clawx-write-smoke.xlsx
  PASS  read_xlsx round-trips a data row
  STATE: OFFICE_WRITE_OK

Interpretation: closes gap B leg b1 — the packaged Windows runtime executes
document.write_docx/write_xlsx (native docx/xlsx/mammoth, no Python) and reads
the output back. Remaining for full W6/W7: b2 = one live in-app chat turn
asserting the tool fired in the gateway log. Mac function-level round-trip:
/tmp/docwrite-roundtrip.mjs 8/8 PASS same day.
