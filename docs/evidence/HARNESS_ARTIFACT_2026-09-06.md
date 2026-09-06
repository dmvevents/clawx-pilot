# Artifact harness matrix (CLWX-77)

Staged plugin + gateway bundle outside the repo tree; each row ran in a
child process resolving deps ONLY from the staged bundle (CLAWX_APP_RESOURCES seam).
Registration rows call the staged plugin's register() with a mock gateway API;
fetch is stubbed in the child before the plugin loads, so the CLWX-86 probe is
deterministically unreachable (fail-open) and no socket is ever opened.

| Row | Status | Note | ms |
|---|---|---|---|
| pdf-text.read_pdf | PASS |  | 1917 |
| pdf-scanned-notext.read_pdf | PASS |  | 201 |
| pdf-corrupt.read_pdf | REFUSED-READABLY | "broken.pdf" could not be read as a PDF — it may be damaged, incomplete, or not actually a PDF file. Re-download it or re-export it as a PDF, then try again — o | 197 |
| pdf-password.read_pdf | REFUSED-READABLY | "protected.pdf" is password-protected, and this reader cannot open protected PDFs. Open it with its password in your PDF app, save an unprotected copy, then try | 200 |
| pdf-large.read_pdf | PASS |  | 312 |
| docx.read_docx | PASS |  | 167 |
| doc-legacy.read_docx | REFUSED-READABLY | "legacy.doc" looks like a legacy Word document (.doc, Word 97-2003), which this reader cannot open. Open it in Word and use Save As with the "Word Document (.do | 83 |
| rtf.read_docx | REFUSED-READABLY | "memo.rtf" looks like a Rich Text Format file (.rtf), which this reader cannot open. Open it in Word and use Save As with the "Word Document (.docx)" format, th | 85 |
| odt.read_docx | REFUSED-READABLY | "notes.odt" is not a Word document inside — it may be another format (for example OpenDocument .odt) saved under a .docx name. Open it in Word and use Save As w | 89 |
| docx-badxml.read_docx | REFUSED-READABLY | "mangled.docx" could not be opened as a Word document (.docx) — the file appears damaged or incomplete. Open it in Word and use Save As with the "Word Document  | 92 |
| docx-password.read_docx | REFUSED-READABLY | "protected.docx" appears to be password-protected, and this reader cannot open protected documents. Open it in Word with its password, save an unprotected copy  | 87 |
| docx-out.write_docx | PASS |  | 83 |
| xlsx.read_xlsx | PASS |  | 189 |
| csv.read_xlsx | PASS |  | 112 |
| xlsx-out.write_xlsx | PASS |  | 113 |
| png.read_image | PASS |  | 1295 |
| png-sharp-binding.read_image | PASS |  | 71 |
| pptx.read | NO-TOOL | no document.* entrypoint for this type (persona carve-out, CLWX-80) | 0 |
| plugin-registration.full | PASS |  | 45 |
| plugin-registration.killswitch | PASS |  | 44 |
| plugin-registration.no-hostapi | PASS |  | 43 |
| plugin-registration.no-config | PASS |  | 47 |

Summary: 22 rows: 14 PASS, 7 REFUSED-READABLY, 0 FAIL, 1 NO-TOOL
