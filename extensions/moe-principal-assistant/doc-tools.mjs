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

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sandbox roots the plugin will read from and write to. The user's home
 * covers everyday principal work; os.tmpdir() covers unit-test fixtures
 * plus renderer file:stage outputs that briefly land outside home on
 * some platforms.
 *
 * Each root is added both raw and realpath-resolved. On macOS os.tmpdir()
 * reports `/var/folders/…` (itself a symlink) and `/tmp` is a symlink to
 * `/private/tmp`; because candidates are realpath-resolved before the
 * check, comparing against unresolved roots refused paths the error
 * message claimed were allowed.
 */
function sandboxRoots() {
  const roots = [];
  for (const base of [os.homedir(), os.tmpdir(), '/tmp']) {
    if (!base) continue;
    const resolved = path.resolve(base);
    if (!existsSync(resolved)) continue;
    roots.push(resolved);
    try {
      const real = realpathSync(resolved);
      if (real !== resolved) roots.push(real);
    } catch {
      // unreadable root — the raw form above still applies
    }
  }
  return roots;
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

function canonicalRealpath(value) {
  const realpath = realpathSync.native ?? realpathSync;
  return realpath(value);
}

function isNetworkPath(value) {
  const input = String(value ?? '').trim();
  return input.startsWith('\\\\') || input.startsWith('//');
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

/**
 * Load a required parser dependency, throwing a TRUTHFUL error that keeps the
 * distinction loadDepDetailed exposes: "not bundled" (notFound) vs "present
 * but failed to evaluate" (loadError). The old masking wrapper (loadDep, now
 * removed) collapsed both into null, which is what shipped the misleading
 * "mammoth module not found" / "xlsx module not found" text for what were
 * actually broken platform-native transitive bindings — the same class as the
 * CLWX-72 pdf-parse/DOMMatrix incident. `nativeHint` names the likely native
 * binding so a loadError points triage at the real cause instead of a false
 * rebuild. Mirrors the readPdf pattern (see below). CLWX-76.
 */
export function requireDocDep(name, nativeHint) {
  const { mod, notFound, loadError } = loadDepDetailed(name);
  if (mod) return mod;
  if (notFound) {
    throw new Error(
      `${name} module not found — the packaged runtime is missing this dep. Rebuild with EXTRA_BUNDLED_PACKAGES including '${name}' and reinstall.`,
    );
  }
  const detail = loadError instanceof Error ? loadError.message : String(loadError);
  throw new Error(
    `${name} is present but failed to load: ${detail} — likely a missing platform-native transitive dep${nativeHint ? ` (${nativeHint})` : ''}. See CLWX-76/CLWX-72.`,
  );
}

/**
 * Like loadDep, but keeps the distinction between "the module is not on
 * disk" (MODULE_NOT_FOUND for the requested name) and "the module is present
 * but failed to evaluate" (e.g. a missing platform-native transitive binding
 * throwing at module scope). The moe.15 tester incident (CLWX-72) shipped a
 * misleading "pdf-parse module not found" for what was actually
 * "DOMMatrix is not defined" from pdfjs-dist's @napi-rs/canvas binding being
 * absent — masked by a catch-all here. Callers that report errors to users
 * must use this and surface loadError verbatim.
 */
export function loadDepDetailed(name) {
  const attempt = () => {
    try {
      return { mod: require_(name), notFound: false, loadError: null };
    } catch (err) {
      const notFound = err?.code === 'MODULE_NOT_FOUND'
        && typeof err?.message === 'string'
        && err.message.includes(`'${name}'`);
      return { mod: null, notFound, loadError: notFound ? null : err };
    }
  };
  const first = attempt();
  if (first.mod) return first;
  augmentModulePathsForPackagedApp();
  const second = attempt();
  if (second.mod) return second;
  // Prefer the more informative outcome: a load error beats not-found.
  return second.loadError ? second : (first.loadError ? first : second);
}

/**
 * Minimal 2D-affine DOMMatrix polyfill for the plain-Node gateway process.
 *
 * pdfjs-dist (pulled by pdf-parse v2) expects a DOMMatrix global and, when
 * missing, tries to take one from @napi-rs/canvas — whose platform-native
 * binding is an optionalDependency that pnpm only installs for the build
 * host's platform, so packaged Windows builds shipped without it and PDF
 * reads died with "DOMMatrix is not defined" (CLWX-72). Text extraction only
 * needs the affine ops below; rendering is never invoked by read_pdf.
 * Installed only when the global is absent.
 */
function ensureDomMatrixPolyfill() {
  if (typeof globalThis.DOMMatrix !== 'undefined') return;
  class DOMMatrixPolyfill {
    constructor(init) {
      // Identity; accepts [a,b,c,d,e,f] or a 16-element column-major array.
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      if (Array.isArray(init)) {
        if (init.length === 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init.map(Number);
        } else if (init.length === 16) {
          this.a = Number(init[0]); this.b = Number(init[1]);
          this.c = Number(init[4]); this.d = Number(init[5]);
          this.e = Number(init[12]); this.f = Number(init[13]);
        }
      } else if (init && typeof init === 'object') {
        this.a = Number(init.a ?? 1); this.b = Number(init.b ?? 0);
        this.c = Number(init.c ?? 0); this.d = Number(init.d ?? 1);
        this.e = Number(init.e ?? 0); this.f = Number(init.f ?? 0);
      }
    }
    get is2D() { return true; }
    get isIdentity() {
      return this.a === 1 && this.b === 0 && this.c === 0
        && this.d === 1 && this.e === 0 && this.f === 0;
    }
    // 4x4 aliases pdfjs occasionally reads.
    get m11() { return this.a; } get m12() { return this.b; }
    get m21() { return this.c; } get m22() { return this.d; }
    get m41() { return this.e; } get m42() { return this.f; }
    multiplySelf(o) {
      const { a, b, c, d, e, f } = this;
      this.a = o.a * a + o.b * c; this.b = o.a * b + o.b * d;
      this.c = o.c * a + o.d * c; this.d = o.c * b + o.d * d;
      this.e = o.e * a + o.f * c + e; this.f = o.e * b + o.f * d + f;
      return this;
    }
    multiply(o) { return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(o); }
    translateSelf(tx = 0, ty = 0) { return this.multiplySelf({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }); }
    translate(tx = 0, ty = 0) { return this.multiply({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }); }
    scaleSelf(sx = 1, sy = sx) { return this.multiplySelf({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }); }
    scale(sx = 1, sy = sx) { return this.multiply({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }); }
    invertSelf() {
      const { a, b, c, d, e, f } = this;
      const det = a * d - b * c;
      if (!det) { this.a = NaN; this.b = NaN; this.c = NaN; this.d = NaN; this.e = NaN; this.f = NaN; return this; }
      this.a = d / det; this.b = -b / det;
      this.c = -c / det; this.d = a / det;
      this.e = (c * f - d * e) / det; this.f = (b * e - a * f) / det;
      return this;
    }
    inverse() { return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).invertSelf(); }
    transformPoint(p = { x: 0, y: 0 }) {
      return {
        x: this.a * p.x + this.c * p.y + this.e,
        y: this.b * p.x + this.d * p.y + this.f,
        z: p.z ?? 0,
        w: p.w ?? 1,
      };
    }
    toFloat32Array() {
      return new Float32Array([
        this.a, this.b, 0, 0,
        this.c, this.d, 0, 0,
        0, 0, 1, 0,
        this.e, this.f, 0, 1,
      ]);
    }
  }
  globalThis.DOMMatrix = DOMMatrixPolyfill;
}

/**
 * Directories searched, in order, when the principal names a file without a
 * path ("the Staff Meeting Memo Draft"). Relative to the user's home.
 *
 * OneDrive entries are not optional. Under Windows OneDrive Known Folder
 * Move — the default on a managed Ministry laptop — the real Desktop and
 * Documents live at %USERPROFILE%\OneDrive\Desktop and
 * %USERPROFILE%\OneDrive\Documents, so probing only ~/Desktop misses every
 * file the principal can see. This produced the Ministry's 2026-07-21
 * "I couldn't find any files in that folder", which only resolved once the
 * tester pasted an absolute path.
 *
 * `OneDrive - <Tenant>` is the shape OneDrive uses for work/school accounts
 * (e.g. "OneDrive - Ministry of Education"); those are discovered at
 * runtime by oneDriveRoots() rather than hard-coded.
 */
const RELATIVE_SEARCH_DIRS = [
  ['.openclaw', 'media', 'outbound'],
  ['Downloads'],
  ['Documents'],
  ['Desktop'],
];

/**
 * OneDrive roots under the user's home: plain `OneDrive` (personal / single
 * tenant) plus any `OneDrive - <Tenant>` business folder.
 */
function oneDriveRoots(home) {
  const roots = [];
  const plain = path.join(home, 'OneDrive');
  if (existsSync(plain)) roots.push(plain);
  try {
    for (const entry of readdirSync(home, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'OneDrive') continue; // already added
      if (entry.name.startsWith('OneDrive - ')) {
        roots.push(path.join(home, entry.name));
      }
    }
  } catch {
    // unreadable home listing — the plain root above still applies
  }
  return roots;
}

/**
 * Every directory a bare filename is looked up in, in priority order.
 * Exported so the not-found error can report exactly what was searched and
 * so tests can assert the OneDrive coverage.
 */
export function relativeSearchDirs(home = os.homedir()) {
  const dirs = RELATIVE_SEARCH_DIRS.map((parts) => path.join(home, ...parts));
  // Mirror the user-facing folders inside each OneDrive root, then the root
  // itself (a principal may drop files straight into OneDrive).
  for (const root of oneDriveRoots(home)) {
    for (const folder of ['Desktop', 'Documents', 'Downloads']) {
      dirs.push(path.join(root, folder));
    }
    dirs.push(root);
  }
  return dirs;
}

/**
 * Depth-limited scan for `name` beneath `dir`. Principals keep files in
 * subfolders ("MoE Agent Testing Folder", "Output_Files"), so an exact-hit
 * probe is not enough — but an unbounded walk of a synced OneDrive tree is
 * far too slow, hence the depth and breadth caps.
 *
 * BREADTH-FIRST, deliberately. A depth-first walk spends its whole entry
 * budget diving into whichever subfolder happens to sort first, and never
 * reaches the sibling at depth 1. On a real ~/Documents (46 subfolders,
 * thousands of descendants) that means `Output_Files/report.docx` — where
 * the Ministry's P2 and P4 prompts write their output — is never found even
 * though it sits one level down. Breadth-first visits every depth-1 folder
 * before any depth-2 folder, so the shallowest match wins, which is also
 * the likeliest one.
 */
export function findWithinDir(dir, name, maxDepth = 3, maxEntries = 4000) {
  let budget = maxEntries;
  let queue = [dir];
  for (let depth = 0; depth <= maxDepth && queue.length; depth++) {
    const next = [];
    for (const current of queue) {
      // The direct-hit probe is one existsSync on a directory we already paid
      // to enumerate, so it runs regardless of the remaining budget. Skipping
      // it would mean a sibling that was already queued never gets checked
      // just because an earlier sibling had a large subtree — which is the
      // depth-first bug reintroduced one level up.
      const direct = path.join(current, name);
      try {
        if (existsSync(direct) && statSync(direct).isFile()) return direct;
      } catch {
        // fall through to the listing below
      }
      if (depth === maxDepth || budget <= 0) continue;
      let entries;
      try {
        entries = readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (budget-- <= 0) break;
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        next.push(path.join(current, entry.name));
      }
    }
    queue = next;
  }
  return null;
}

/**
 * The superseded depth-first walk, kept and exported ONLY so the eval
 * pipeline can demonstrate the traversal-order bug rather than assert it:
 * `eval/run.mjs` lane C runs both against the same tree and requires this
 * one to miss a depth-1 sibling that the breadth-first scan finds. Never
 * call this from a tool path.
 */
export function findWithinDirLegacyDepthFirst(dir, name, maxDepth = 3, maxEntries = 4000) {
  let budget = maxEntries;
  const walk = (current, depth) => {
    if (depth > maxDepth || budget <= 0) return null;
    const direct = path.join(current, name);
    try {
      if (existsSync(direct) && statSync(direct).isFile()) return direct;
    } catch {
      // fall through to the listing below
    }
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (budget-- <= 0) return null;
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const hit = walk(path.join(current, entry.name), depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(dir, 0);
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
  const searchDirs = relativeSearchDirs(home);
  const candidates = [];
  if (path.isAbsolute(candidate)) {
    candidates.push(candidate);
    // KFM gap (found live 2026-09-02, P6 run): models naturally say
    // "~/Desktop/<name>", which expands to the CLASSIC Desktop — but on
    // OneDrive Known-Folder-Move machines the real Desktop lives under
    // ~/OneDrive/Desktop, so the literal absolute path misses a file that
    // is exactly where the user says it is. For under-home absolute paths,
    // fall back to resolving the basename across the search roots (same
    // roots the bare-filename path uses; sandbox check below still applies).
    if (path.resolve(candidate).startsWith(path.resolve(home))) {
      const base = path.basename(candidate);
      for (const dir of searchDirs) candidates.push(path.join(dir, base));
      for (const dir of searchDirs) {
        if (!existsSync(dir)) continue;
        const hit = findWithinDir(dir, base);
        if (hit) candidates.push(hit);
      }
    }
  } else {
    // Exact hits first across every search dir (cheap), …
    for (const dir of searchDirs) candidates.push(path.join(dir, candidate));
    candidates.push(path.resolve(candidate));
    // … then a bounded subfolder scan, so "MoE Agent Testing Folder/…" works.
    for (const dir of searchDirs) {
      if (!existsSync(dir)) continue;
      const hit = findWithinDir(dir, candidate);
      if (hit) candidates.push(hit);
    }
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
  const searched = relativeSearchDirs(os.homedir())
    .map((d) => d.replace(os.homedir(), '~'))
    .join(', ');
  throw new Error(
    `file not found: ${input} (searched absolute path, then ${searched}, each including subfolders up to 3 deep).`,
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

// ── Document discovery ──────────────────────────────────────────────────

const DOCUMENT_FIND_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.xls',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.avif',
  '.tif',
  '.tiff',
];
const DOCUMENT_FIND_MAX_DEPTH = 3;
const DOCUMENT_FIND_MAX_ENTRIES = 4000;
const DOCUMENT_FIND_DEFAULT_RESULTS = 10;
const DOCUMENT_FIND_MAX_RESULTS = 50;
const DOCUMENT_FIND_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'file',
  'document',
  'docs',
  'local',
  'named',
  'open',
  'read',
  'find',
  'summarise',
  'summarize',
]);
const DOCUMENT_FIND_TYPE_WORDS = new Set([
  'pdf',
  'docx',
  'word',
  'xlsx',
  'xls',
  'excel',
  'spreadsheet',
  'workbook',
  'csv',
  'image',
  'picture',
  'photo',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
]);

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sanitizeExtensions(extensions) {
  const raw = Array.isArray(extensions) && extensions.length
    ? extensions
    : DOCUMENT_FIND_EXTENSIONS;
  const allowed = new Set(DOCUMENT_FIND_EXTENSIONS);
  const out = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const ext = value.trim().toLowerCase().replace(/^\*?\.?/, '.');
    if (allowed.has(ext)) out.push(ext);
  }
  return uniqueStrings(out);
}

function normalizeDocumentTokens(value, { keepTypeWords = false } = {}) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !DOCUMENT_FIND_STOPWORDS.has(token))
    .filter((token) => keepTypeWords || !DOCUMENT_FIND_TYPE_WORDS.has(token));
}

function matchesDocumentQuery(name, query) {
  const queryTokens = normalizeDocumentTokens(query);
  if (!queryTokens.length) return true;
  const nameTokens = new Set(normalizeDocumentTokens(name, { keepTypeWords: true }));
  return queryTokens.every((token) => nameTokens.has(token));
}

function discoveryMatchScore(name, query) {
  const queryTokens = normalizeDocumentTokens(query);
  if (!queryTokens.length) return 0;
  const nameTokens = normalizeDocumentTokens(name, { keepTypeWords: true });
  let score = 0;
  for (const token of queryTokens) {
    if (nameTokens.includes(token)) score += 10;
  }
  const nameJoined = nameTokens.join(' ');
  const queryJoined = queryTokens.join(' ');
  if (nameJoined.includes(queryJoined)) score += 5;
  score -= Math.max(0, nameTokens.length - queryTokens.length);
  return score;
}

function asDisplayRoot(value) {
  const home = os.homedir();
  return String(value).startsWith(home + path.sep)
    ? `~${String(value).slice(home.length)}`
    : String(value);
}

function resolveDiscoveryRoot(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  if (isNetworkPath(candidate)) {
    throw new Error(`refused to search ${candidate}: network paths are not allowed.`);
  }
  const home = os.homedir();
  let root = candidate.trim();
  if (root === '~' || root.startsWith('~/')) {
    root = path.join(home, root.slice(1));
  }
  if (!path.isAbsolute(root)) {
    root = path.resolve(root);
  }
  if (!existsSync(root)) return null;
  const real = canonicalRealpath(root);
  if (!insideSandbox(real)) {
    throw new Error(
      `refused to search ${real}: only folders under the user's home or tmp directory are allowed.`,
    );
  }
  if (!statSync(real).isDirectory()) {
    throw new Error(`refused to search ${real}: folder must be a directory.`);
  }
  return real;
}

function findDirectoryWithinDir(dir, name, maxDepth = DOCUMENT_FIND_MAX_DEPTH, maxEntries = DOCUMENT_FIND_MAX_ENTRIES) {
  const target = String(name ?? '').trim();
  if (!target) return null;
  let budget = maxEntries;
  let queue = [dir];
  for (let depth = 0; depth <= maxDepth && queue.length; depth++) {
    const next = [];
    for (const current of queue) {
      const direct = path.join(current, target);
      try {
        if (existsSync(direct) && statSync(direct).isDirectory()) return direct;
      } catch {
        // fall through to bounded listing
      }
      if (depth === maxDepth || budget <= 0) continue;
      let entries;
      try {
        entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (budget-- <= 0) break;
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        next.push(path.join(current, entry.name));
      }
    }
    queue = next;
  }
  return null;
}

function discoveryRoots(folder) {
  if (typeof folder === 'string' && folder.trim()) {
    const direct = resolveDiscoveryRoot(folder);
    if (direct) return [direct];
    if (isNetworkPath(folder)) {
      throw new Error(`refused to search ${folder}: network paths are not allowed.`);
    }
    const hits = [];
    for (const base of relativeSearchDirs(os.homedir())) {
      if (!existsSync(base)) continue;
      const hit = findDirectoryWithinDir(base, folder);
      if (!hit) continue;
      hits.push(resolveDiscoveryRoot(hit));
    }
    const unique = uniqueStrings(hits.filter(Boolean));
    if (!unique.length) {
      throw new Error(`folder not found: ${folder}`);
    }
    return unique;
  }
  const roots = [];
  for (const dir of relativeSearchDirs(os.homedir())) {
    if (!existsSync(dir)) continue;
    const root = resolveDiscoveryRoot(dir);
    if (root) roots.push(root);
  }
  return uniqueStrings(roots);
}

function scanDocumentRoot(root, { query, extensions, maxResults }) {
  let entriesScanned = 0;
  let incomplete = false;
  let refused = 0;
  const matches = [];
  const extSet = new Set(extensions);
  const seen = new Set();
  let queue = [{ dir: root, depth: 0 }];

  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      incomplete = true;
      continue;
    }
    for (const entry of entries) {
      if (entriesScanned >= DOCUMENT_FIND_MAX_ENTRIES) {
        incomplete = true;
        queue = [];
        break;
      }
      entriesScanned += 1;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        refused += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (depth < DOCUMENT_FIND_MAX_DEPTH) queue.push({ dir: fullPath, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!extSet.has(ext)) continue;
      if (!matchesDocumentQuery(entry.name, query)) continue;
      let real;
      let stat;
      try {
        real = canonicalRealpath(fullPath);
        stat = statSync(real);
        if (!insideSandbox(real)) {
          refused += 1;
          continue;
        }
      } catch {
        refused += 1;
        continue;
      }
      if (!stat.isFile()) continue;
      if (seen.has(real)) continue;
      seen.add(real);
      matches.push({
        path: real,
        name: path.basename(real),
        extension: ext.slice(1),
        bytes: stat.size,
        modifiedTime: stat.mtime.toISOString(),
        score: discoveryMatchScore(entry.name, query),
      });
      if (matches.length >= maxResults) {
        incomplete = true;
        queue = [];
        break;
      }
    }
  }

  return { matches, entriesScanned, incomplete, refused };
}

export function findDocuments({ query = '', folder, extensions, maxResults = DOCUMENT_FIND_DEFAULT_RESULTS } = {}) {
  const extList = sanitizeExtensions(extensions);
  if (!extList.length) {
    throw new Error('extensions must include at least one supported document extension.');
  }
  const limit = Math.max(1, Math.min(DOCUMENT_FIND_MAX_RESULTS, Number(maxResults) || DOCUMENT_FIND_DEFAULT_RESULTS));
  const roots = discoveryRoots(folder);
  const allMatches = [];
  let entriesScanned = 0;
  let incomplete = false;
  let refused = 0;
  const seen = new Set();

  for (const root of roots) {
    const result = scanDocumentRoot(root, { query, extensions: extList, maxResults: limit });
    entriesScanned += result.entriesScanned;
    incomplete = incomplete || result.incomplete;
    refused += result.refused;
    for (const match of result.matches) {
      if (seen.has(match.path)) continue;
      seen.add(match.path);
      allMatches.push(match);
    }
    if (allMatches.length >= limit) {
      incomplete = true;
      break;
    }
  }

  allMatches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.path.localeCompare(right.path);
  });
  const matches = allMatches.slice(0, limit);
  const safeUnique = matches.length === 1 && !incomplete;
  const status = safeUnique
    ? 'found'
    : matches.length > 1
      ? (incomplete ? 'incomplete' : 'ambiguous')
      : incomplete
        ? 'incomplete'
        : 'not_found';

  return {
    status,
    query: String(query ?? ''),
    folder: folder ?? null,
    extensions: extList.map((ext) => ext.slice(1)),
    matches,
    safeUnique,
    uniquePath: safeUnique ? matches[0].path : null,
    incomplete,
    limits: {
      maxDepth: DOCUMENT_FIND_MAX_DEPTH,
      maxEntries: DOCUMENT_FIND_MAX_ENTRIES,
      maxResults: limit,
    },
    scanned: {
      roots: roots.map(asDisplayRoot),
      entries: entriesScanned,
      refused,
    },
  };
}

// ── PDF ──────────────────────────────────────────────────────────────────

/**
 * CLWX-92: pdfjs's environment detection treats an Electron UtilityProcess
 * (process.versions.electron present with process.type !== 'browser') as
 * browser-like and demands GlobalWorkerOptions.workerSrc instead of running
 * workerless as it does under plain Node. The gateway runs doc-tools in
 * exactly that environment, so in-app PDF reads died with "No
 * GlobalWorkerOptions.workerSrc specified" while the identical code passed
 * under packaged node (moe.16 VM differential repro). Point workerSrc at the
 * bundled worker file of the SAME pdfjs instance pdf-parse links against
 * (pdf-parse imports 'pdfjs-dist/legacy/build/pdf.mjs' — dynamic import here
 * hits the module cache, so we configure the live instance). Idempotent;
 * best-effort — on failure the parse surfaces its own truthful error.
 */
function ensurePdfjsWorkerConfigured(mod) {
  const PDFParse = mod?.PDFParse ?? mod?.default?.PDFParse ?? null;
  if (!PDFParse || typeof PDFParse.setWorker !== 'function') return;
  try {
    const current = PDFParse.setWorker(undefined);
    if (current) return; // already configured (idempotent)
    // Resolve the worker inside pdf-parse's OWN pdfjs copy: with pnpm's
    // symlinked layout the workspace-level pdfjs-dist can be a DIFFERENT
    // module instance than the one pdf-parse imported, so configuring via a
    // fresh import silently misses (proved locally). setWorker writes to the
    // live instance; the paths option makes the file come from the same copy.
    const entryPath = require_.resolve('pdf-parse');
    const pdfParseDir = path.dirname(entryPath);
    let workerPath = null;
    // Prefer pdf-parse's own vendored worker (version-matched to the pdfjs it
    // embeds; the flat gateway bundle's pdfjs-dist ships no legacy/ build).
    const distIdx = entryPath.lastIndexOf(`${path.sep}dist${path.sep}`);
    if (distIdx > 0) {
      const vendored = path.join(entryPath.slice(0, distIdx), 'dist', 'worker', 'pdf.worker.mjs');
      if (existsSync(vendored)) workerPath = vendored;
    }
    if (!workerPath) {
      for (const spec of ['pdfjs-dist/legacy/build/pdf.worker.mjs', 'pdfjs-dist/build/pdf.worker.mjs']) {
        try {
          workerPath = require_.resolve(spec, { paths: [pdfParseDir] });
          break;
        } catch {
          // try the next candidate
        }
      }
    }
    if (!workerPath) return;
    PDFParse.setWorker(pathToFileURL(workerPath).href);
  } catch {
    // Leave unset: plain-Node environments run workerless without it.
  }
}

/**
 * CLWX-77 (password/large-pdf rows; mirrors the CLWX-101 docx approach):
 * pdfjs exception NAMES are stable API (PasswordException,
 * InvalidPDFException) but their MESSAGES are parser language — "No password
 * given", "Invalid PDF structure." — which reached the harness bar only by
 * accident of being URL-free. Map them to principal language that names the
 * cause and the way out; anything else the parser throws falls back to the
 * damaged wording, never a rethrow.
 */
const PDF_REEXPORT_HINT =
  'Re-download it or re-export it as a PDF, then try again — or ask the sender to re-send it.';

function mapPdfParseError(err, filePath) {
  const name = displayName(filePath);
  if (err?.name === 'PasswordException') {
    return new Error(
      `"${name}" is password-protected, and this reader cannot open protected PDFs. Open it with its password in your PDF app, save an unprotected copy, then try again.`,
    );
  }
  // InvalidPDFException and everything else past the empty-file sniff is
  // some flavour of unreadable file. Only the error CLASS is logged — parser
  // messages can quote document content, and content never goes to logs.
  console.warn(
    `readPdf: unreadable pdf mapped to damaged-file refusal (${err?.name ?? err?.constructor?.name ?? typeof err})`,
  );
  return new Error(
    `"${name}" could not be read as a PDF — it may be damaged, incomplete, or not actually a PDF file. ${PDF_REEXPORT_HINT}`,
  );
}

export async function readPdf({ path: inputPath, maxChars = 200_000 } = {}) {
  const filePath = resolveReadablePath(inputPath);
  // Must precede the pdf-parse load: pdfjs-dist references DOMMatrix at
  // module scope when @napi-rs/canvas has no platform binding (CLWX-72).
  ensureDomMatrixPolyfill();
  const { mod, notFound, loadError } = loadDepDetailed('pdf-parse');
  ensurePdfjsWorkerConfigured(mod);
  if (!mod) {
    if (notFound) {
      throw new Error(
        "pdf-parse module not found — the packaged runtime is missing this dep. Rebuild with EXTRA_BUNDLED_PACKAGES including 'pdf-parse' and reinstall.",
      );
    }
    throw new Error(
      `pdf-parse is present but failed to load: ${loadError instanceof Error ? loadError.message : String(loadError)} — likely a missing platform-native transitive dep (e.g. @napi-rs/canvas binding). See CLWX-72.`,
    );
  }
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse ?? null;
  const buf = await readFile(filePath);
  // Sniffed before the parser sees it: pdfjs's own zero-byte message is
  // library phrasing, and the failed-download cause is ours to name.
  if (buf.length === 0) {
    throw new Error(
      `"${displayName(filePath)}" is empty (0 bytes) — the download or sync may not have completed. Re-download or re-sync the file and try again.`,
    );
  }
  let text = '';
  let numPages = 0;
  let info = {};
  if (PDFParse) {
    // pdf-parse v2 class API
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    let result;
    try {
      result = await parser.getText();
    } catch (err) {
      throw mapPdfParseError(err, filePath);
    } finally {
      // destroy() in finally: a throwing parse must not leak the worker.
      if (typeof parser.destroy === 'function') {
        try { await parser.destroy(); } catch { /* ignore */ }
      }
    }
    text = String(result?.text ?? '');
    numPages = Number(result?.numpages ?? result?.pages?.length ?? 0);
    info = result?.info ?? {};
  } else if (typeof mod === 'function' || typeof mod.default === 'function') {
    // pdf-parse v1 callable API (kept for forward-compat if we ever downgrade)
    const fn = typeof mod === 'function' ? mod : mod.default;
    let result;
    try {
      result = await fn(buf);
    } catch (err) {
      throw mapPdfParseError(err, filePath);
    }
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

/**
 * CLWX-101: mammoth's underlying jszip error for non-zip input ("Can't find
 * end of central directory : is this a zip file ? If it is, see
 * https://stuk.github.io/jszip/…") passes the no-stack bar but is library
 * language, not principal language. Sniff the container up front and name
 * the likely format plus the way out; anything jszip/mammoth still rejects
 * maps to the damaged-or-renamed wording in mapDocxParseError below.
 */
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
// CFB directory entries are UTF-16LE; an EncryptedPackage stream marks a
// password-protected OOXML document (MS-OFFCRYPTO), which shares the OLE2
// magic with legacy .doc — without this sniff a protected modern .docx gets
// a confidently WRONG "legacy Word" cause (review finding, 2026-09-05).
const ENCRYPTED_PACKAGE_UTF16 = Buffer.from('EncryptedPackage', 'utf16le');
const DOCX_RESAVE_HINT =
  'Open it in Word and use Save As with the "Word Document (.docx)" format, then try again — or ask the sender to re-send it as .docx.';

/**
 * Filenames may legally contain control characters on macOS; embedded raw in
 * a refusal they can fake stack frames in chat or trip readable-refusal
 * checks (review finding, 2026-09-05).
 */
function displayName(filePath) {
  return path.basename(filePath).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80);
}

function refuseNonDocxContainer(buf, filePath) {
  const name = displayName(filePath);
  if (buf.length === 0) {
    throw new Error(
      `"${name}" is empty (0 bytes) — the download or sync may not have completed. Re-download or re-sync the file and try again.`,
    );
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(OLE2_MAGIC)) {
    if (buf.includes(ENCRYPTED_PACKAGE_UTF16)) {
      throw new Error(
        `"${name}" appears to be password-protected, and this reader cannot open protected documents. Open it in Word with its password, save an unprotected copy as "Word Document (.docx)", then try again.`,
      );
    }
    throw new Error(
      `"${name}" looks like a legacy Word document (.doc, Word 97-2003), which this reader cannot open. ${DOCX_RESAVE_HINT}`,
    );
  }
  if (buf.subarray(0, 5).toString('latin1') === '{\\rtf') {
    throw new Error(
      `"${name}" looks like a Rich Text Format file (.rtf), which this reader cannot open. ${DOCX_RESAVE_HINT}`,
    );
  }
  if (buf.subarray(0, 2).toString('latin1') !== 'PK') {
    throw new Error(
      `"${name}" is not a modern Word document (.docx) — it appears to be a different file type. ${DOCX_RESAVE_HINT}`,
    );
  }
}

function mapDocxParseError(err, filePath) {
  const name = displayName(filePath);
  const detail = err instanceof Error ? err.message : String(err);
  // Valid zip, but not a docx inside (e.g. an OpenDocument .odt renamed).
  if (/main document part|body element/i.test(detail)) {
    return new Error(
      `"${name}" is not a Word document inside — it may be another format (for example OpenDocument .odt) saved under a .docx name. ${DOCX_RESAVE_HINT}`,
    );
  }
  // Everything else mammoth throws past the container sniff is some flavour
  // of unreadable file — jszip zip-level text, xmldom parse errors for
  // mangled XML, null-deref TypeErrors on garbage markup. None of it is
  // principal language, so the fallback is the damaged wording, never a
  // rethrow: the rethrow path is exactly how "[xmldom error] …" reached a
  // principal verbatim (review finding, 2026-09-05). Only the error CLASS is
  // logged — parser messages can quote document content, and content never
  // goes to logs.
  console.warn(
    `readDocx: unreadable docx mapped to damaged-file refusal (${err?.constructor?.name ?? typeof err})`,
  );
  return new Error(
    `"${name}" could not be opened as a Word document (.docx) — the file appears damaged or incomplete. ${DOCX_RESAVE_HINT}`,
  );
}

export async function readDocx({ path: inputPath, format = 'markdown' } = {}) {
  const filePath = resolveReadablePath(inputPath);
  const mammoth = requireDocDep('mammoth');
  const buf = await readFile(filePath);
  refuseNonDocxContainer(buf, filePath);
  const options = { buffer: buf };
  const convert = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      throw mapDocxParseError(err, filePath);
    }
  };
  let result;
  if (format === 'html') {
    result = await convert(() => mammoth.convertToHtml(options));
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
    result = await convert(() => mammoth.extractRawText(options));
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
  result = await convert(() => mammoth.convertToMarkdown(options));
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
  const docxMod = requireDocDep('docx');
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
  const xlsx = requireDocDep('xlsx');
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
  const xlsx = requireDocDep('xlsx');
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
  // sharp is an OPTIONAL enhancer here: absent, we still return the raw bytes
  // and let the VLM read them. But keep loadDepDetailed's distinction so a
  // present-but-broken native binding is surfaced (non-fatal) rather than
  // masked as "not installed" — the CLWX-76 truthfulness rule, applied to a
  // soft dep. sharpUnavailable is only set on a genuine load *error*.
  const { mod: sharp, loadError: sharpLoadError } = loadDepDetailed('sharp');
  let width;
  let height;
  let format;
  let imageBuffer = buf;
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
        imageBuffer = await img
          .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();
        mimeType = 'image/png';
      }
    } catch {
      // fall through with the raw bytes; agent will still get metadata
    }
  }
  const metadata = {
    path: filePath,
    bytes: buf.length,
    width: width ?? null,
    height: height ?? null,
    format: format ?? null,
    mimeType,
    imageBytes: imageBuffer.length,
    resized: imageBuffer !== buf,
    ...(sharpLoadError
      ? {
          sharpUnavailable:
            sharpLoadError instanceof Error
              ? sharpLoadError.message
              : String(sharpLoadError),
        }
      : {}),
  };
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(metadata, null, 2),
      },
      {
        type: 'image',
        data: imageBuffer.toString('base64'),
        mimeType,
      },
    ],
    details: metadata,
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
