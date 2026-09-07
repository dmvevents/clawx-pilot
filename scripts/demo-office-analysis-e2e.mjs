import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const xlsx = loadXlsx();

function loadXlsx() {
  const resources = process.env.CLAWX_APP_RESOURCES
    ?? (process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Ministry of Education', 'resources')
      : '');
  const moduleRoots = [
    resources && path.join(resources, 'app.asar.unpacked', 'node_modules'),
    resources && path.join(resources, 'node_modules'),
    resources && path.join(resources, 'openclaw', 'node_modules'),
  ].filter((dir) => dir && existsSync(dir));
  if (moduleRoots.length > 0) {
    process.env.NODE_PATH = [process.env.NODE_PATH, ...moduleRoots].filter(Boolean).join(path.delimiter);
    Module._initPaths();
  }
  try {
    return require('xlsx');
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function requireFile(label, filePath) {
  if (!filePath) throw new Error(`${label} path required`);
  if (!existsSync(filePath)) throw new Error(`${label} not found: ${filePath}`);
  return filePath;
}

function summarizeWorkbook(filePath) {
  if (!xlsx) return summarizeWorkbookFromOoxml(filePath);
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  return {
    fileName: path.basename(filePath),
    bytes: statSync(filePath).size,
    parser: 'xlsx',
    sheetCount: workbook.SheetNames.length,
    sheets: workbook.SheetNames.map((name) => summarizeSheet(name, workbook.Sheets[name])),
  };
}

function summarizeWorkbookFromOoxml(filePath) {
  const buffer = readFileSync(filePath);
  const workbookXml = extractZipEntry(buffer, 'xl/workbook.xml').toString('utf8');
  const relsXml = extractZipEntry(buffer, 'xl/_rels/workbook.xml.rels').toString('utf8');
  const rels = parseWorkbookRelationships(relsXml);
  const sharedStrings = parseSharedStrings(buffer);
  const sheets = parseWorkbookSheets(workbookXml, rels)
    .map((sheetInfo) => {
      const sheetXml = extractZipEntry(buffer, sheetInfo.path).toString('utf8');
      return summarizeRows(sheetInfo.name, parseWorksheetRows(sheetXml, sharedStrings));
    });
  return {
    fileName: path.basename(filePath),
    bytes: statSync(filePath).size,
    parser: 'ooxml-fallback',
    sheetCount: sheets.length,
    sheets,
  };
}

function summarizeSheet(name, sheet) {
  const ref = sheet['!ref'] ?? 'A1:A1';
  const range = xlsx.utils.decode_range(ref);
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: null,
  });
  const headerRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim()));
  const headers = headerRowIndex >= 0
    ? rows[headerRowIndex].map((cell) => String(cell ?? '').trim()).filter(Boolean)
    : [];
  return {
    name,
    rows: range.e.r - range.s.r + 1,
    columns: range.e.c - range.s.c + 1,
    headers: headers.slice(0, 20),
    sampleRows: rows.slice(Math.max(headerRowIndex + 1, 0), Math.max(headerRowIndex + 4, 3)),
    numericColumns: summarizeNumericColumns(rows, headerRowIndex),
  };
}

function summarizeRows(name, rows) {
  const headerRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim()));
  const headers = headerRowIndex >= 0
    ? rows[headerRowIndex].map((cell) => String(cell ?? '').trim()).filter(Boolean)
    : [];
  const maxColumns = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  return {
    name,
    rows: rows.length,
    columns: maxColumns,
    headers: headers.slice(0, 20),
    sampleRows: rows.slice(Math.max(headerRowIndex + 1, 0), Math.max(headerRowIndex + 4, 3)),
    numericColumns: summarizeNumericColumns(rows, headerRowIndex),
  };
}

function summarizeNumericColumns(rows, headerRowIndex) {
  if (headerRowIndex < 0) return [];
  const headers = rows[headerRowIndex] ?? [];
  const columns = [];
  for (let col = 0; col < headers.length; col += 1) {
    const values = rows
      .slice(headerRowIndex + 1)
      .map((row) => parseNumber(row?.[col]))
      .filter((value) => Number.isFinite(value));
    if (values.length === 0) continue;
    const sum = values.reduce((acc, value) => acc + value, 0);
    columns.push({
      header: String(headers[col] || `Column ${col + 1}`).trim(),
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      average: Number((sum / values.length).toFixed(2)),
      sum: Number(sum.toFixed(2)),
    });
  }
  return columns.slice(0, 12);
}

function parseNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const cleaned = value.replace(/[$,%\s,]/g, '');
  if (!cleaned) return Number.NaN;
  return Number(cleaned);
}

function summarizeDocx(filePath) {
  const xml = extractZipEntry(readFileSync(filePath), 'word/document.xml').toString('utf8');
  const paragraphs = extractParagraphs(xml);
  const text = paragraphs.join('\n');
  const words = text.match(/[A-Za-z0-9']+/g) ?? [];
  return {
    fileName: path.basename(filePath),
    bytes: statSync(filePath).size,
    paragraphCount: paragraphs.length,
    wordCount: words.length,
    firstParagraphs: paragraphs.slice(0, 8),
  };
}

function summarizePptx(filePath) {
  const buffer = readFileSync(filePath);
  const slideEntries = readCentralDirectory(buffer)
    .map((entry) => entry.fileName)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumberFromEntry(a) - slideNumberFromEntry(b));
  const slides = slideEntries.map((entryName, index) => {
    const xml = extractZipEntry(buffer, entryName).toString('utf8');
    const paragraphs = extractPresentationParagraphs(xml);
    return {
      index: index + 1,
      entry: entryName,
      paragraphCount: paragraphs.length,
      firstParagraphs: paragraphs.slice(0, 10),
    };
  });
  return {
    fileName: path.basename(filePath),
    bytes: statSync(filePath).size,
    parser: 'pptx-ooxml',
    slideCount: slides.length,
    slides,
  };
}

function parseWorkbookRelationships(xml) {
  const rels = new Map();
  for (const attrs of matchTags(xml, 'Relationship')) {
    const id = attrs.Id;
    const target = attrs.Target;
    if (!id || !target) continue;
    rels.set(id, target.startsWith('/') ? target.replace(/^\/+/, '') : path.posix.join('xl', target));
  }
  return rels;
}

function parseWorkbookSheets(xml, rels) {
  return matchTags(xml, 'sheet')
    .map((attrs) => {
      const relId = attrs['r:id'] ?? attrs.id;
      const target = relId ? rels.get(relId) : null;
      return target ? { name: decodeXml(attrs.name ?? 'Sheet'), path: target } : null;
    })
    .filter(Boolean);
}

function parseSharedStrings(buffer) {
  const entry = tryExtractZipEntry(buffer, 'xl/sharedStrings.xml');
  if (!entry) return [];
  const xml = entry.toString('utf8');
  return Array.from(xml.matchAll(/<si\b[\s\S]*?<\/si>/g)).map((match) => extractTextRuns(match[0]));
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttributes(cellMatch[1]);
      const colIndex = cellReferenceToColumnIndex(attrs.r);
      row[colIndex] = parseCellValue(cellMatch[2], attrs.t, sharedStrings);
    }
    rows.push(trimTrailingEmpty(row));
  }
  return rows;
}

function parseCellValue(cellXml, type, sharedStrings) {
  if (type === 'inlineStr') return extractTextRuns(cellXml);
  const value = textBetween(cellXml, 'v');
  if (value === null) return '';
  if (type === 's') return sharedStrings[Number(value)] ?? '';
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
  if (type === 'str') return decodeXml(value);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : decodeXml(value);
}

function cellReferenceToColumnIndex(reference = '') {
  const letters = /^[A-Z]+/i.exec(reference)?.[0]?.toUpperCase() ?? 'A';
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function trimTrailingEmpty(row) {
  let last = row.length - 1;
  while (last >= 0 && (row[last] === undefined || row[last] === '')) last -= 1;
  return row.slice(0, last + 1).map((value) => value ?? null);
}

function matchTags(xml, tagName) {
  return Array.from(xml.matchAll(new RegExp(`<${tagName}\\b([^>]*)\\/?>(?:<\\/${tagName}>)?`, 'g')))
    .map((match) => parseAttributes(match[1]));
}

function parseAttributes(source) {
  const attrs = {};
  for (const match of source.matchAll(/([:\w-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function textBetween(xml, tagName) {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`).exec(xml);
  return match ? decodeXml(match[1]) : null;
}

function extractTextRuns(xml) {
  return Array.from(xml.matchAll(/<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t>/g))
    .map((match) => decodeXml(match[1]))
    .join('');
}

function extractParagraphs(xml) {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .split(/<\/w:p>/g)
    .map((chunk) => decodeXml(chunk.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()))
    .filter(Boolean);
}

function extractPresentationParagraphs(xml) {
  return xml
    .split(/<\/a:p>/g)
    .map((chunk) => extractTextRuns(chunk).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function slideNumberFromEntry(entryName) {
  const match = /slide(\d+)\.xml$/i.exec(entryName);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function extractZipEntry(buffer, entryName) {
  const directory = readCentralDirectory(buffer);
  const entry = directory.find((candidate) => candidate.fileName === entryName);
  if (!entry) throw new Error(`ZIP entry not found: ${entryName}`);
  const localHeaderOffset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error(`Invalid local header for ${entryName}`);
  }
  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entryName}`);
}

function tryExtractZipEntry(buffer, entryName) {
  try {
    return extractZipEntry(buffer, entryName);
  } catch {
    return null;
  }
}

function readCentralDirectory(buffer) {
  const maxSearch = Math.max(0, buffer.length - 0xffff - 22);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= maxSearch; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory record not found');
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let offset = directoryOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central-directory header at ${offset}`);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8').replace(/\\/g, '/');
    entries.push({ fileName, method, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Write-path assertions (CLWX-65): exercise the SAME implementations the
 * agent's document.write_docx / document.write_xlsx tools call
 * (extensions/moe-principal-assistant/doc-tools.mjs), then parse both
 * artifacts back with this script's own read-side summarizers. The
 * doc-tools module is imported lazily so the read-only modes keep working
 * when this script is run standalone against an installed app (where the
 * repo extensions tree is not on disk).
 */
async function runWriteCheck() {
  const docTools = await import(new URL('../extensions/moe-principal-assistant/doc-tools.mjs', import.meta.url));
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'clawx-office-write-check-'));

  const docxParagraphs = [
    'Dear Parents and Guardians,',
    'Our annual Sports Day takes place on Friday at the school grounds.',
    'Please ensure your child wears their house colours and brings a water bottle.',
    'Yours sincerely,',
    'The Principal',
  ];
  const docxWrite = await docTools.writeDocx({
    path: path.join(outDir, 'write-check-letter.docx'),
    title: 'Sports Day Letter',
    paragraphs: docxParagraphs,
  });
  const docxSummary = summarizeDocx(docxWrite.path);
  const docxText = docxSummary.firstParagraphs.join('\n').toLowerCase();
  const docxChecks = {
    bytesWritten: docxWrite.bytes > 0 && statSync(docxWrite.path).size === docxWrite.bytes,
    // Title heading + the 5 body paragraphs must round-trip.
    paragraphCount: docxSummary.paragraphCount >= docxParagraphs.length + 1,
    titlePresent: docxText.includes('sports day letter'),
    bodyPresent: docxText.includes('dear parents') && docxText.includes('house colours'),
  };

  const xlsxRows = [
    ['Class', 'Present', 'Absent'],
    ['Standard 1', 24, 2],
    ['Standard 2', 22, 4],
  ];
  const xlsxWrite = await docTools.writeXlsx({
    path: path.join(outDir, 'write-check-register.xlsx'),
    sheets: [{ name: 'Attendance', rows: xlsxRows }],
  });
  const xlsxSummary = summarizeWorkbook(xlsxWrite.path);
  const sheet = xlsxSummary.sheets[0] ?? {};
  const presentColumn = (sheet.numericColumns ?? []).find((c) => c.header === 'Present');
  const absentColumn = (sheet.numericColumns ?? []).find((c) => c.header === 'Absent');
  const xlsxChecks = {
    bytesWritten: xlsxWrite.bytes > 0 && statSync(xlsxWrite.path).size === xlsxWrite.bytes,
    sheetName: xlsxSummary.sheetCount === 1 && sheet.name === 'Attendance',
    headersMatch: JSON.stringify(sheet.headers) === JSON.stringify(['Class', 'Present', 'Absent']),
    sumsMatch: presentColumn?.sum === 46 && absentColumn?.sum === 6,
  };

  const ok = Object.values(docxChecks).every(Boolean) && Object.values(xlsxChecks).every(Boolean);
  return {
    ok,
    docx: { path: docxWrite.path, bytes: docxWrite.bytes, checks: docxChecks, summary: docxSummary },
    xlsx: { path: xlsxWrite.path, bytes: xlsxWrite.bytes, checks: xlsxChecks, summary: xlsxSummary },
  };
}

const args = parseArgs(process.argv.slice(2));
const excelPath = args.excel ? requireFile('Excel', args.excel) : null;
const wordPath = args.word ? requireFile('Word', args.word) : null;
const powerpointPath = args.pptx || args.powerpoint
  ? requireFile('PowerPoint', args.pptx || args.powerpoint)
  : null;
const writeCheck = Boolean(args['write-check']);
if (!excelPath && !wordPath && !powerpointPath && !writeCheck) {
  throw new Error('At least one --excel, --word, --pptx, or --powerpoint path (or --write-check) is required');
}
const result = {
  ok: true,
  generatedAt: new Date().toISOString(),
};
if (excelPath) result.excel = summarizeWorkbook(excelPath);
if (wordPath) result.word = summarizeDocx(wordPath);
if (powerpointPath) result.powerpoint = summarizePptx(powerpointPath);
if (writeCheck) {
  result.writeCheck = await runWriteCheck();
  if (!result.writeCheck.ok) result.ok = false;
}

if (args['json-out']) {
  writeFileSync(args['json-out'], `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
