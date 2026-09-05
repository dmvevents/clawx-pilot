# Artifact harness matrix — slice 1 (CLWX-77)

Staged plugin + gateway bundle outside the repo tree; each row ran in a
child process resolving deps ONLY from the staged bundle (CLAWX_APP_RESOURCES seam).

| Row | Status | Note | ms |
|---|---|---|---|
| pdf-text.read_pdf | PASS |  | 1411 |
| pdf-scanned-notext.read_pdf | PASS |  | 146 |
| pdf-corrupt.read_pdf | REFUSED-READABLY | Invalid PDF structure. | 145 |
| docx.read_docx | PASS |  | 125 |
| doc-legacy.read_docx | REFUSED-READABLY | Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html | 63 |
| rtf.read_docx | REFUSED-READABLY | Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html | 62 |
| odt.read_docx | REFUSED-READABLY | Could not find main document part. Are you sure this is a valid .docx file? | 59 |
| docx-out.write_docx | PASS |  | 58 |
| xlsx.read_xlsx | PASS |  | 139 |
| csv.read_xlsx | PASS |  | 79 |
| xlsx-out.write_xlsx | PASS |  | 79 |
| png.read_image | PASS |  | 790 |
| pptx.read | NO-TOOL | no document.* entrypoint for this type (persona carve-out, CLWX-80) | 0 |

Summary: 13 rows: 8 PASS, 4 REFUSED-READABLY, 0 FAIL, 1 NO-TOOL
## Negative control (isolation falsifiability)

Hid `mammoth` in the STAGED bundle only (repo node_modules untouched), reran
`--only docx.read_docx` → **FAIL** ("mammoth module not found — the packaged
runtime is missing this dep"). Restored → PASS. This proves the child
resolves deps exclusively from the staged artifact: a workspace-run test
would have masked the gap — the exact moe.9/moe.15/CLWX-72 class.

## Findings from run 1 (gaps per acceptance 4)

1. `readDocx` refusals for legacy `.doc` / `.rtf` surface jszip internals
   ("Can't find end of central directory : is this a zip file ? … see
   https://stuk.github.io/jszip/…") — passes the v1 no-stack-trace bar but is
   not principal-grade language for "this is not a Word .docx". Filed as its
   own card (see CLWX board).
2. Scanned/image-only pdf returns ok with `totalChars=0` and no explicit
   "no extractable text" signal — persona-layer wording question, recorded.

## Slice-1 boundaries (resumable trail for CLWX-77)

Not yet covered: packaged-node / Electron utility-env spawn parity (CLWX-92
check covers the pdfjs class meanwhile), password-protected + >10MB pdf rows,
outlook/forms tool-registration smoke, gateway-process transport (CLWX-71 MCP
adapter candidate), package:mac/win preflight wiring (fast subset), K-ledger
rows (K8 3x-repeat rule, K10 drag-PDF variants).
