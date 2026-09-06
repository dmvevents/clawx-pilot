# Artifact harness matrix — slice 1 (CLWX-77)

Staged plugin + gateway bundle outside the repo tree; each row ran in a
child process resolving deps ONLY from the staged bundle (CLAWX_APP_RESOURCES seam).

| Row | Status | Note | ms |
|---|---|---|---|
| pdf-text.read_pdf | PASS |  | 1308 |
| pdf-scanned-notext.read_pdf | PASS |  | 198 |
| pdf-corrupt.read_pdf | REFUSED-READABLY | "broken.pdf" could not be read as a PDF — it may be damaged, incomplete, or not actually a PDF file. Re-download it or re-export it as a PDF, then try again — o | 197 |
| pdf-password.read_pdf | REFUSED-READABLY | "protected.pdf" is password-protected, and this reader cannot open protected PDFs. Open it with its password in your PDF app, save an unprotected copy, then try | 204 |
| pdf-large.read_pdf | PASS |  | 325 |
| docx.read_docx | PASS |  | 160 |
| doc-legacy.read_docx | REFUSED-READABLY | "legacy.doc" looks like a legacy Word document (.doc, Word 97-2003), which this reader cannot open. Open it in Word and use Save As with the "Word Document (.do | 85 |
| rtf.read_docx | REFUSED-READABLY | "memo.rtf" looks like a Rich Text Format file (.rtf), which this reader cannot open. Open it in Word and use Save As with the "Word Document (.docx)" format, th | 82 |
| odt.read_docx | REFUSED-READABLY | "notes.odt" is not a Word document inside — it may be another format (for example OpenDocument .odt) saved under a .docx name. Open it in Word and use Save As w | 85 |
| docx-badxml.read_docx | REFUSED-READABLY | "mangled.docx" could not be opened as a Word document (.docx) — the file appears damaged or incomplete. Open it in Word and use Save As with the "Word Document  | 90 |
| docx-password.read_docx | REFUSED-READABLY | "protected.docx" appears to be password-protected, and this reader cannot open protected documents. Open it in Word with its password, save an unprotected copy  | 83 |
| docx-out.write_docx | PASS |  | 77 |
| xlsx.read_xlsx | PASS |  | 179 |
| csv.read_xlsx | PASS |  | 106 |
| xlsx-out.write_xlsx | PASS |  | 110 |
| png.read_image | PASS |  | 915 |
| png-sharp-binding.read_image | PASS |  | 67 |
| pptx.read | NO-TOOL | no document.* entrypoint for this type (persona carve-out, CLWX-80) | 0 |

Summary: 18 rows: 10 PASS, 7 REFUSED-READABLY, 0 FAIL, 1 NO-TOOL
