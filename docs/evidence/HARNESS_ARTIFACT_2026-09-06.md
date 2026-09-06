# Artifact harness matrix (CLWX-77)

Staged plugin + FULL gateway (build/openclaw) outside the repo tree; each row
ran in a child process resolving deps ONLY from the staged copy
(CLAWX_APP_RESOURCES seam). Registration rows call the staged plugin's
register() with a mock gateway API; gateway-transport rows boot the STAGED
gateway CLI (plugins inspect --json) with a hermetic OPENCLAW_STATE_DIR — the
plugin loads through the real gateway plugin-host. fetch is stubbed before the
plugin loads in both modes, so the CLWX-86 probe is deterministically
unreachable (fail-open) and no socket is ever opened.

Env shapes: `@electronlike` rows ran under the faked Electron UtilityProcess
shape (process.versions.electron + process.type='utility') — the packaged
gateway's real env (utilityProcess.fork) and the CLWX-92/moe.16 failure shape.
Transport rows run plain-node only by design (a faked electron shape around
the real gateway dist would grade an untruthful combination); the true
utility-env gateway run is the Windows/VM lane.

K-ledger mapping: K8 rows repeat 3× per shape in fresh children (disagreement
= FAIL, intermittence named); K10 tags mark the pdf variants. K1/K2/K11/K12/
K13 live in the Outlook/VM lanes, K4 in the ASR lane (CLWX-87), K9/K14 are
in-app fixtures — this harness does not grade those.

| Row | Status | K | Note | ms |
|---|---|---|---|---|
| pdf-text.read_pdf | PASS | K8 | (3× consistent) | 2138 |
| pdf-text.read_pdf@electronlike | PASS | K8 | (3× consistent) | 317 |
| pdf-scanned-notext.read_pdf | PASS | K10 |  | 206 |
| pdf-scanned-notext.read_pdf@electronlike | PASS | K10 |  | 99 |
| pdf-corrupt.read_pdf | REFUSED-READABLY |  | "broken.pdf" could not be read as a PDF — it may be damaged, incomplete, or not actually a PDF file. Re-download it or re-export it as a PDF, then try again — o | 202 |
| pdf-corrupt.read_pdf@electronlike | REFUSED-READABLY |  | "broken.pdf" could not be read as a PDF — it may be damaged, incomplete, or not actually a PDF file. Re-download it or re-export it as a PDF, then try again — o | 93 |
| pdf-password.read_pdf | REFUSED-READABLY | K10 | "protected.pdf" is password-protected, and this reader cannot open protected PDFs. Open it with its password in your PDF app, save an unprotected copy, then try | 203 |
| pdf-password.read_pdf@electronlike | REFUSED-READABLY | K10 | "protected.pdf" is password-protected, and this reader cannot open protected PDFs. Open it with its password in your PDF app, save an unprotected copy, then try | 96 |
| pdf-large.read_pdf | PASS | K10 |  | 343 |
| pdf-large.read_pdf@electronlike | PASS | K10 |  | 215 |
| docx.read_docx | PASS | K8 | (3× consistent) | 387 |
| docx.read_docx@electronlike | PASS | K8 | (3× consistent) | 329 |
| doc-legacy.read_docx | REFUSED-READABLY |  | "legacy.doc" looks like a legacy Word document (.doc, Word 97-2003), which this reader cannot open. Open it in Word and use Save As with the "Word Document (.do | 84 |
| doc-legacy.read_docx@electronlike | REFUSED-READABLY |  | "legacy.doc" looks like a legacy Word document (.doc, Word 97-2003), which this reader cannot open. Open it in Word and use Save As with the "Word Document (.do | 84 |
| rtf.read_docx | REFUSED-READABLY |  | "memo.rtf" looks like a Rich Text Format file (.rtf), which this reader cannot open. Open it in Word and use Save As with the "Word Document (.docx)" format, th | 88 |
| rtf.read_docx@electronlike | REFUSED-READABLY |  | "memo.rtf" looks like a Rich Text Format file (.rtf), which this reader cannot open. Open it in Word and use Save As with the "Word Document (.docx)" format, th | 83 |
| odt.read_docx | REFUSED-READABLY |  | "notes.odt" is not a Word document inside — it may be another format (for example OpenDocument .odt) saved under a .docx name. Open it in Word and use Save As w | 86 |
| odt.read_docx@electronlike | REFUSED-READABLY |  | "notes.odt" is not a Word document inside — it may be another format (for example OpenDocument .odt) saved under a .docx name. Open it in Word and use Save As w | 88 |
| docx-badxml.read_docx | REFUSED-READABLY |  | "mangled.docx" could not be opened as a Word document (.docx) — the file appears damaged or incomplete. Open it in Word and use Save As with the "Word Document  | 108 |
| docx-badxml.read_docx@electronlike | REFUSED-READABLY |  | "mangled.docx" could not be opened as a Word document (.docx) — the file appears damaged or incomplete. Open it in Word and use Save As with the "Word Document  | 97 |
| docx-password.read_docx | REFUSED-READABLY |  | "protected.docx" appears to be password-protected, and this reader cannot open protected documents. Open it in Word with its password, save an unprotected copy  | 82 |
| docx-password.read_docx@electronlike | REFUSED-READABLY |  | "protected.docx" appears to be password-protected, and this reader cannot open protected documents. Open it in Word with its password, save an unprotected copy  | 83 |
| docx-out.write_docx | PASS | K8 | (3× consistent) | 231 |
| docx-out.write_docx@electronlike | PASS | K8 | (3× consistent) | 228 |
| xlsx.read_xlsx | PASS | K8 | (3× consistent) | 423 |
| xlsx.read_xlsx@electronlike | PASS | K8 | (3× consistent) | 339 |
| csv.read_xlsx | PASS |  |  | 110 |
| csv.read_xlsx@electronlike | PASS |  |  | 108 |
| xlsx-out.write_xlsx | PASS | K8 | (3× consistent) | 334 |
| xlsx-out.write_xlsx@electronlike | PASS | K8 | (3× consistent) | 334 |
| png.read_image | PASS |  |  | 1226 |
| png.read_image@electronlike | PASS |  |  | 67 |
| png-sharp-binding.read_image | PASS |  |  | 68 |
| png-sharp-binding.read_image@electronlike | PASS |  |  | 67 |
| pptx.read | NO-TOOL |  | no document.* entrypoint for this type (persona carve-out, CLWX-80) | 0 |
| plugin-registration.full | PASS |  |  | 44 |
| plugin-registration.full@electronlike | PASS |  |  | 42 |
| plugin-registration.killswitch | PASS |  |  | 43 |
| plugin-registration.killswitch@electronlike | PASS |  |  | 44 |
| plugin-registration.no-hostapi | PASS |  |  | 43 |
| plugin-registration.no-hostapi@electronlike | PASS |  |  | 42 |
| plugin-registration.no-config | PASS |  |  | 44 |
| plugin-registration.no-config@electronlike | PASS |  |  | 45 |
| gateway-transport.no-hostapi | PASS |  |  | 11045 |
| gateway-transport.full | PASS |  |  | 8257 |

Summary: 45 rows: 30 PASS, 14 REFUSED-READABLY, 0 FAIL, 1 NO-TOOL
