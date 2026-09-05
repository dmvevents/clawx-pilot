# Artifact harness matrix — slice 1 (CLWX-77)

Staged plugin + gateway bundle outside the repo tree; each row ran in a
child process resolving deps ONLY from the staged bundle (CLAWX_APP_RESOURCES seam).

| Row | Status | Note | ms |
|---|---|---|---|
| pdf-text.read_pdf | PASS |  | 1650 |
| pdf-scanned-notext.read_pdf | PASS |  | 130 |
| pdf-corrupt.read_pdf | REFUSED-READABLY | Invalid PDF structure. | 129 |
| docx.read_docx | PASS |  | 113 |
| doc-legacy.read_docx | REFUSED-READABLY | "legacy.doc" looks like a legacy Word document (.doc, Word 97-2003), which this reader cannot open. Open it in Word and use Save As with the "Word Document (.do | 54 |
| rtf.read_docx | REFUSED-READABLY | "memo.rtf" looks like a Rich Text Format file (.rtf), which this reader cannot open. Open it in Word and use Save As with the "Word Document (.docx)" format, th | 58 |
| odt.read_docx | REFUSED-READABLY | "notes.odt" is not a Word document inside — it may be another format (for example OpenDocument .odt) saved under a .docx name. Open it in Word and use Save As w | 62 |
| docx-badxml.read_docx | REFUSED-READABLY | "mangled.docx" could not be opened as a Word document (.docx) — the file appears damaged or incomplete. Open it in Word and use Save As with the "Word Document  | 63 |
| docx-password.read_docx | REFUSED-READABLY | "protected.docx" appears to be password-protected, and this reader cannot open protected documents. Open it in Word with its password, save an unprotected copy  | 60 |
| docx-out.write_docx | PASS |  | 58 |
| xlsx.read_xlsx | PASS |  | 133 |
| csv.read_xlsx | PASS |  | 68 |
| xlsx-out.write_xlsx | PASS |  | 69 |
| png.read_image | PASS |  | 1161 |
| png-sharp-binding.read_image | PASS |  | 55 |
| pptx.read | NO-TOOL | no document.* entrypoint for this type (persona carve-out, CLWX-80) | 0 |

Summary: 16 rows: 9 PASS, 6 REFUSED-READABLY, 0 FAIL, 1 NO-TOOL
