/**
 * doc-tools.mjs — native document-reader/writer helpers for the principal
 * assistant plugin. All handlers use already-bundled JavaScript deps
 * (`pdf-parse`, `mammoth`, `xlsx`, Electron's built-in `sharp`) and do NOT
 * shell out to Python, poppler, LibreOffice, or any other external binary.
 *
 * Why this exists:
 *   The ClawX Windows agent was failing on docx/pdf/xlsx/image tasks
 *   because the shipped runtime had no doc-processing tooling — the
 *   Anthropic pdf/xlsx/docx skills invoke Python (pypdf, pdfplumber,
 *   openpyxl, python-docx) which is not present on the pilot laptop.
 *   These native readers give the agent a first-party path so it can
 *   handle the five demo prompts without ever calling a missing binary.
 *
 * Module resolution:
 *   In packaged Electron builds the gateway plugin runs OUTSIDE the app
 *   asar. It looks up node_modules against
 *   `resources/app.asar.unpacked/node_modules` and
 *   `resources/openclaw/node_modules`. `demo-office-analysis-e2e.mjs`
 *   already does this dance for xlsx; we generalise it here so every
 *   dep in EXTRA_BUNDLED_PACKAGES resolves the same way.
 *
 * Path resolution:
 *   Accepts:
 *     - absolute paths (`/Users/…/file.pdf`, `C:\Users\…\file.pdf`)
 *     - `~/…` — expand relative to os.homedir()
 *     - relative names — look in ~/.openclaw/media/outbound/ (where
 *       renderer-staged files land), then ~/Downloads/ (where Outlook
 *       attachment downloads and manual saves land).
 *   Refuses to read from anywhere outside the user's home directory.
 */

import { existsSync, statSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';

/**
 * Sandbox roots the plugin will read from and write to. The user's home
 * covers everyday principal work; os.tmpdir() covers unit-test fixtures
 * plus renderer file:stage outputs that briefly land outside home on
 * some platforms.
 */
function sandboxRoots() {
  return [os.homedir(), os.tmpdir()].map((r) => path.resolve(r));
}

function insideSandbox(resolved) {
  const roots = sandboxRoots();
  for (const root of roots) {
    if (process.platform === 'win32') {
      const rl = resolved.toLowerCase();
      const rootLc = root.toLowerCase();
      if (rl === rootLc || rl.startsWith(rootLc + path.sep)) return true;
    } else {
      if (resolved === root || resolved.startsWith(root + path.sep)) return true;
    }
  }
  return false;
}

const require_ = createRequire(import.meta.url);

/**
 * Best-effort module loader. Tries the plugin's own require() first, then
 * augments NODE_PATH with the packaged-Windows resource roots so bundled
 * deps under `resources/app.asar.unpacked/node_modules` and
 * `resources/openclaw/node_modules` resolve.
 */
let augmented = false;
function augmentModulePathsForPackagedApp() {
  if (augmented) return;
  augmented = true;
  const resources =
    process.env.CLAWX_APP_RESOURCES ??
    (process.platform === 'win32'
      ? path.join(
          process.env.LOCALAPPDATA ??
            path.join(os.homedir(), 'AppData', 'Local'),
          'Programs',
          'Ministry of Education',
          'resources',
        )
      : '');
  const roots = [
    resources && path.join(resources, 'app.asar.unpacked', 'node_modules'),
    resources && path.join(resources, 'node_modules'),
    resources && path.join(resources, 'openclaw', 'node_modules'),
  ].filter((dir) => dir && existsSync(dir));
  if (!roots.length) return;
  process.env.NODE_PATH = [process.env.NODE_PATH, ...roots]
    .filter(Boolean)
    .join(path.delimiter);
  Module._initPaths();
}

function loadDep(name) {
  try {
    return require_(name);
  } catch {
    augmentModulePathsForPackagedApp();
    try {
      return require_(name);
    } catch {
      return null;
    }
  }
}

/**
 * Resolve a user-supplied path spec to an absolute path we're willing to
 * read from. Throws with a helpful message if the file is missing or
 * outside the user's home directory.
 */
export function resolveReadablePath(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('path required (non-empty string).');
  }
  const home = os.homedir();
  let candidate = input.trim();
  if (candidate.startsWith('~/') || candidate === '~') {
    candidate = path.join(home, candidate.slice(1));
  }
  const candidates = [];
  if (path.isAbsolute(candidate)) {
    candidates.push(candidate);
  } else {
    candidates.push(path.join(home, '.openclaw', 'media', 'outbound', candidate));
    candidates.push(path.join(home, 'Downloads', candidate));
    candidates.push(path.join(home, 'Documents', candidate));
    candidates.push(path.join(home, 'Desktop', candidate));
    candidates.push(path.resolve(candidate));
  }
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) {
        const resolved = path.resolve(c);
        // Sandbox: the plugin only reads under the user's home or tmp dir.
        // This matches the file-preview sandbox in electron/main/ipc-handlers
        // and covers renderer file:stage outputs that briefly live in tmp.
        if (!insideSandbox(resolved)) {
          throw new Error(
            `refused to read ${resolved}: only files under the user's home or tmp directory are allowed.`,
          );
        }
        return resolved;
      }
    } catch (err) {
      // preserve refusal errors
      if (err instanceof Error && err.message.startsWith('refused to read')) {
        throw err;
      }
    }
  }
  throw new Error(
    `file not found: ${input} (searched absolute path, ~/.openclaw/media/outbound, ~/Downloads, ~/Documents, ~/Desktop).`,
  );
}

/**
 * Resolve a writable path. Creates the parent directory. Refuses anywhere
 * outside the user's home. Relative names go to
 * ~/.openclaw/media/outbound/ so the renderer's file-preview + attach
 * flows pick them up automatically.
 */
export async function resolveWritablePath(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('path required (non-empty string).');
  }
  const home = os.homedir();
  let candidate = input.trim();
  if (candidate.startsWith('~/') || candidate === '~') {
    candidate = path.join(home, candidate.slice(1));
  }
  let resolved;
  if (path.isAbsolute(candidate)) {
    resolved = path.resolve(candidate);
  } else {
    resolved = path.resolve(
      path.join(home, '.openclaw', 'media', 'outbound', candidate),
    );
  }
  if (!insideSandbox(resolved)) {
    throw new Error(
      `refused to write ${resolved}: only files under the user's home or tmp directory are allowed.`,
    );
  }
  await mkdir(path.dirname(resolved), { recursive: true });
  return resolved;
}

// ── PDF ──────────────────────────────────────────────────────────────────

export async function readPdf({ path: inputPath, maxChars = 200_000 } = {}) {
  const filePath = resolveReadablePath(inputPath);
  const mod = loadDep('pdf-parse');
  if (!mod) {
    throw new Error(
      "pdf-parse module not found — the packaged Windows runtime is missing this dep. Rebuild with EXTRA_BUNDLED_PACKAGES including 'pdf-parse' and reinstall.",
    );
  }
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse ?? null;
  const buf = await readFile(filePath);
  let text = '';
  let numPages = 0;
  let info = {};
  if (PDFParse) {
    // pdf-parse v2 class API
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    text = String(result?.text ?? '');
    numPages = Number(result?.numpages ?? result?.pages?.length ?? 0);
    info = result?.info ?? {};
    if (typeof parser.destroy === 'function') {
      try { await parser.destroy(); } catch { /* ignore */ }
    }
  } else if (typeof mod === 'function' || typeof mod.default === 'function') {
    // pdf-parse v1 callable API (kept for forward-compat if we ever downgrade)
    const fn = typeof mod === 'function' ? mod : mod.default;
    const result = await fn(buf);
    text = String(result?.text ?? '');
    numPages = Number(result?.numpages ?? 0);
    info = result?.info ?? {};
  } else {
    throw new Error('pdf-parse: unknown module shape (neither PDFParse class nor callable).');
  }
  const truncated = text.length > maxChars;
  return {
    path: filePath,
    bytes: buf.length,
    pages: numPages,
    info,
    text: truncated ? text.slice(0, maxChars) : text,
    truncated,
    totalChars: text.length,
  };
}

// ── DOCX ─────────────────────────────────────────────────────────────────

export async function readDocx({ path: inputPath, format = 'markdown' } = {}) {
  const filePath = resolveReadablePath(inputPath);
  const mammoth = loadDep('mammoth');
  if (!mammoth) {
    throw new Error(
      "mammoth module not found — the packaged Windows runtime is missing this dep. Rebuild with EXTRA_BUNDLED_PACKAGES including 'mammoth' and reinstall.",
    );
  }
  const buf = await readFile(filePath);
  const options = { buffer: buf };
  let result;
  if (format === 'html') {
    result = await mammoth.convertToHtml(options);
    return {
      path: filePath,
      bytes: buf.length,
      format: 'html',
      html: String(result?.value ?? ''),
      messages: (result?.messages ?? []).map((m) => ({
        type: m.type,
        message: m.message,
      })),
    };
  }
  if (format === 'text' || format === 'plain') {
    result = await mammoth.extractRawText(options);
    return {
      path: filePath,
      bytes: buf.length,
      format: 'text',
      text: String(result?.value ?? ''),
      messages: (result?.messages ?? []).map((m) => ({
        type: m.type,
        message: m.message,
      })),
    };
  }
  result = await mammoth.convertToMarkdown(options);
  return {
    path: filePath,
    bytes: buf.length,
    format: 'markdown',
    markdown: String(result?.value ?? ''),
    messages: (result?.messages ?? []).map((m) => ({
      type: m.type,
      message: m.message,
    })),
  };
}

export async function writeDocx({ path: outputPath, title, paragraphs = [] } = {}) {
  if (!Array.isArray(paragraphs) || !paragraphs.length) {
    throw new Error('paragraphs array required (at least one non-empty string).');
  }
  const docxMod = loadDep('docx');
  if (!docxMod) {
    throw new Error(
      "docx module not found — the packaged Windows runtime is missing this dep. Rebuild with EXTRA_BUNDLED_PACKAGES including 'docx' and reinstall.",
    );
  }
  const { Document, Packer, Paragraph, HeadingLevel } = docxMod;
  const children = [];
  if (title) {
    children.push(
      new Paragraph({ text: String(title), heading: HeadingLevel.HEADING_1 }),
    );
  }
  for (const p of paragraphs) {
    children.push(new Paragraph({ text: String(p) }));
  }
  const doc = new Document({ sections: [{ properties: {}, children }] });
  const buffer = await Packer.toBuffer(doc);
  const filePath = await resolveWritablePath(outputPath);
  await writeFile(filePath, buffer);
  return { path: filePath, bytes: buffer.length, paragraphs: paragraphs.length };
}

// ── XLSX ─────────────────────────────────────────────────────────────────

export async function readXlsx({ path: inputPath, sheet, maxRows = 500 } = {}) {
  const filePath = resolveReadablePath(inputPath);
  const xlsx = loadDep('xlsx');
  if (!xlsx) {
    throw new Error(
      "xlsx module not found — the packaged Windows runtime is missing this dep. Rebuild with EXTRA_BUNDLED_PACKAGES including 'xlsx' and reinstall.",
    );
  }
  const buf = await readFile(filePath);
  const wb = xlsx.read(buf, { type: 'buffer', cellDates: true });
  const sheetNames = Array.isArray(wb?.SheetNames) ? wb.SheetNames : [];
  if (!sheetNames.length) {
    return { path: filePath, bytes: buf.length, sheets: [], sheet: null };
  }
  const target =
    typeof sheet === 'string' && sheetNames.includes(sheet)
      ? sheet
      : typeof sheet === 'number' && sheetNames[sheet]
      ? sheetNames[sheet]
      : sheetNames[0];
  const ws = wb.Sheets[target];
  const aoa = xlsx.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    dateNF: 'yyyy-mm-dd',
    defval: '',
  });
  const truncated = aoa.length > maxRows;
  const rows = truncated ? aoa.slice(0, maxRows) : aoa;
  return {
    path: filePath,
    bytes: buf.length,
    sheets: sheetNames,
    sheet: target,
    rows,
    totalRows: aoa.length,
    truncated,
  };
}

export async function writeXlsx({ path: outputPath, sheets } = {}) {
  const xlsx = loadDep('xlsx');
  if (!xlsx) {
    throw new Error(
      "xlsx module not found — the packaged Windows runtime is missing this dep. Rebuild with EXTRA_BUNDLED_PACKAGES including 'xlsx' and reinstall.",
    );
  }
  const list = Array.isArray(sheets) ? sheets : sheets ? [sheets] : [];
  if (!list.length) {
    throw new Error('sheets required — array of { name, rows: 2D array } objects.');
  }
  const wb = xlsx.utils.book_new();
  for (const s of list) {
    if (!Array.isArray(s?.rows)) {
      throw new Error(`sheet "${s?.name ?? 'unnamed'}" must have a rows 2D array.`);
    }
    const ws = xlsx.utils.aoa_to_sheet(s.rows);
    xlsx.utils.book_append_sheet(wb, ws, String(s.name || 'Sheet1').slice(0, 31));
  }
  const filePath = await resolveWritablePath(outputPath);
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  await writeFile(filePath, buf);
  return { path: filePath, bytes: buf.length, sheets: list.length };
}

// ── Images ───────────────────────────────────────────────────────────────

const IMAGE_EXT_RX = /\.(png|jpe?g|gif|webp|bmp|avif|tiff?)$/i;

export async function readImage({ path: inputPath, maxDim = 768 } = {}) {
  const filePath = resolveReadablePath(inputPath);
  if (!IMAGE_EXT_RX.test(filePath)) {
    throw new Error(
      `not an image extension: ${path.basename(filePath)} (expected png/jpg/gif/webp/bmp/avif/tiff).`,
    );
  }
  const buf = await readFile(filePath);
  const sharp = loadDep('sharp');
  let width;
  let height;
  let format;
  let dataUrlBuffer = buf;
  let mimeType = mimeForExt(path.extname(filePath));
  if (sharp) {
    try {
      const img = sharp(buf, { failOnError: false });
      const meta = await img.metadata();
      width = meta.width;
      height = meta.height;
      format = meta.format;
      if (
        (width && width > maxDim) ||
        (height && height > maxDim) ||
        format === 'tiff' ||
        format === 'avif'
      ) {
        // Downscale (and normalise unusual formats to PNG) so the payload
        // is small enough to hand to a VLM. Preserve aspect ratio.
        dataUrlBuffer = await img
          .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();
        mimeType = 'image/png';
      }
    } catch {
      // fall through with the raw bytes; agent will still get metadata
    }
  }
  return {
    path: filePath,
    bytes: buf.length,
    width: width ?? null,
    height: height ?? null,
    format: format ?? null,
    mimeType,
    dataUrl: `data:${mimeType};base64,${dataUrlBuffer.toString('base64')}`,
    resized: dataUrlBuffer !== buf,
  };
}

function mimeForExt(ext) {
  const e = String(ext || '').toLowerCase();
  switch (e) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.avif':
      return 'image/avif';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}
