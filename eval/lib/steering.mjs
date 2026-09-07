/**
 * steering.mjs — deterministic model of which tool the agent will pick.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Ministry's 2026-07-21 prompt suite scored 0/5 (`incoming-tests/ClawX
 * Agent Tests/`). Every handler behind those prompts passes: the offline
 * harness (`harness/run.ts`) scores 5/5 and the replay scores 7/7. The
 * failure was never capability — it was TOOL SELECTION. `CHAT-001-6.png`
 * shows the agent reading `~/.openclaw/skills/pdf/SKILL.md`, then reaching
 * for pdfplumber, writing a Python script, and running `uv pip install`.
 *
 * `harness/run.ts` is structurally incapable of catching that: it reads
 * `expect_calls_tool` from the spec and calls that handler directly. It can
 * only ever answer "does the handler work", never "would the model call it".
 *
 * WHAT THIS IS
 * ------------
 * A BM25 retrieval model over the tool catalogue the agent is actually
 * handed at runtime, plus the persona's routing directives. It answers:
 * given this prompt and this catalogue, which candidate has the strongest
 * claim? Every input is a real on-disk artifact — tool descriptions come
 * from `register()` itself, skill descriptions from SKILL.md frontmatter,
 * the enabled set from `preinstalled-manifest.json`, and the directives
 * from `persona.mjs`.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is NOT the model. A retrieval proxy cannot prove what an LLM will do;
 * only lane F (`--live`) can, and it SKIPs loudly when no model is
 * reachable. What the proxy CAN do is fail when the catalogue is stacked
 * against us — and lane B proves it does exactly that by replaying the
 * pre-fix catalogue and showing the Python skill winning. A metric that
 * cannot reproduce the known failure is worthless, so we assert it can.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');

const EXT_DIR = path.join(REPO_ROOT, 'extensions/moe-principal-assistant');
export const INDEX_MJS = path.join(EXT_DIR, 'index.mjs');
export const PERSONA_MJS = path.join(EXT_DIR, 'persona.mjs');
export const MANIFEST_JSON = path.join(
  REPO_ROOT,
  'resources/skills/preinstalled-manifest.json',
);
export const SKILL_SNAPSHOT = path.join(
  __dirname,
  '../fixtures/skill-descriptions.json',
);

/** BM25 parameters. Standard defaults; exposed so a run can vary them. */
export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

/**
 * Weight of an explicit persona routing directive, expressed as a multiple
 * of the catalogue's maximum IDF. A directive in the system prompt outranks
 * a catalogue description — that is the whole reason the `outlook.*` rule
 * makes Outlook routing reliable — but it is a modelling assumption, not a
 * measurement. Lane B varies it to show what the score depends on.
 */
export const DIRECTIVE_WEIGHT = 3;

/** Weight of an explicit persona prohibition against a candidate. */
export const PROHIBITION_WEIGHT = 4;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but', 'by',
  'can', 'do', 'does', 'each', 'for', 'from', 'has', 'have', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'me', 'my', 'not', 'of', 'on', 'only',
  'or', 'other', 'over', 'so', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'to', 'use', 'used', 'using', 'was',
  'what', 'when', 'which', 'who', 'will', 'with', 'you', 'your',
]);

/**
 * Tokenize for retrieval. File extensions are meaningful signal here
 * (".docx" must not tokenize to "docx" alone and lose the dot context), so
 * a dotted extension is emitted BOTH as `.docx` and as `docx`.
 */
export function tokenize(text) {
  const out = [];
  const raw = String(text ?? '').toLowerCase();
  for (const m of raw.matchAll(/\.?[a-z][a-z0-9_]*/g)) {
    const tok = m[0];
    if (tok.startsWith('.')) {
      out.push(tok);
      const bare = tok.slice(1);
      if (!STOPWORDS.has(bare)) out.push(bare);
      continue;
    }
    if (STOPWORDS.has(tok) || tok.length < 2) continue;
    out.push(tok);
  }
  return out;
}

/**
 * Load the `document.*` tool catalogue by running the plugin's real
 * `register()` against a capturing stub. Parsing the source with a regex
 * would drift from what the gateway actually registers; this cannot.
 */
export async function loadToolCatalogue() {
  const mod = await import(pathToFileURL(INDEX_MJS).href);
  const tools = [];
  const api = {
    // Deliberately empty: the config gate then skips principal.* and we get
    // exactly the tools a laptop with no principal config would expose.
    pluginConfig: {},
    registerTool: (t) => {
      tools.push({ name: t.name, description: String(t.description ?? '') });
    },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    host: {},
  };
  mod.register(api);
  return tools;
}

/** Minimal SKILL.md frontmatter reader: `name` + `description`. */
export function parseSkillFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ''));
  if (!m) return null;
  const body = m[1];
  const field = (key) => {
    const re = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm');
    const hit = re.exec(body);
    if (!hit) return null;
    let v = hit[1].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return v.replace(/\\"/g, '"');
  };
  const name = field('name');
  const description = field('description');
  if (!name && !description) return null;
  return { name, description: description ?? '' };
}

/**
 * Skill descriptions, preferring the live install at
 * `~/.openclaw/skills/<slug>/SKILL.md` and falling back to the checked-in
 * snapshot so the eval runs on a clean CI box. The snapshot's provenance is
 * recorded in the file itself.
 */
export function loadSkillCatalogue(home = process.env.HOME ?? '') {
  const snapshot = JSON.parse(readFileSync(SKILL_SNAPSHOT, 'utf8'));
  const out = [];
  for (const entry of snapshot.skills) {
    const live = path.join(home, '.openclaw/skills', entry.slug, 'SKILL.md');
    let description = entry.description;
    let source = 'snapshot';
    if (home && existsSync(live)) {
      const parsed = parseSkillFrontmatter(readFileSync(live, 'utf8'));
      if (parsed?.description) {
        description = parsed.description;
        source = 'installed';
      }
    }
    out.push({ name: entry.slug, description, source, kind: 'skill' });
  }
  return out;
}

/** Which skills the manifest auto-enables on a fresh install. */
export function autoEnabledSlugs() {
  const manifest = JSON.parse(readFileSync(MANIFEST_JSON, 'utf8'));
  return new Set(
    manifest.skills.filter((s) => s.autoEnable === true).map((s) => s.slug),
  );
}

export function loadPersona() {
  const src = readFileSync(PERSONA_MJS, 'utf8');
  const m = /SYSTEM_PROMPT = `([\s\S]*?)`\.trim\(\)/.exec(src);
  return m ? m[1] : src;
}

/**
 * Extract routing directives from the persona: `document.read_docx for
 * .docx`, `document.write_xlsx to produce an .xlsx`, and so on.
 *
 * The connecting verb carries the read/write mode, and that distinction is
 * load-bearing: "Open the gradebook and read the marks" and "Save the
 * updated copy as Marks_Updated.xlsx" name the same file kind but different
 * tools. A directive model that ignores the verb cannot tell them apart.
 *
 * Returns `[{ tool, mode, extensions }]` where mode is 'read' | 'write'.
 */
export function personaDirectives(persona) {
  const out = [];
  const re =
    /(document\.[a-z_]+)\s+(for|to produce)\s+(?:a |an |the )?((?:\.[a-z0-9]+(?:\s*\/\s*)?)+)/gi;
  for (const m of String(persona).matchAll(re)) {
    const extensions = [...m[3].matchAll(/\.[a-z0-9]+/gi)].map((x) =>
      x[0].toLowerCase(),
    );
    // Fall back to the tool's own name when the verb is ambiguous — the
    // naming convention (read_* / write_*) is itself a directive.
    const byVerb = /to produce/i.test(m[2]) ? 'write' : 'read';
    const byName = /\.write_/.test(m[1]) ? 'write' : 'read';
    out.push({ tool: m[1], mode: byVerb === byName ? byVerb : byName, extensions });
  }
  return out;
}

/**
 * Verbs that mean the principal wants a NEW file on disk rather than a read.
 * Derived from the Ministry prompts ("Save the edited copy as …", "Save the
 * updated copy as …") and the phrasing a principal actually uses.
 */
const WRITE_INTENT =
  /\b(save|saving|write|writing|create|creating|produce|producing|export|exporting|generate|generating|draft(?:ed|ing)?|rewrite|rewriting|updated copy|edited copy|new (?:file|copy|document|workbook))\b/i;

/**
 * Read verbs, needed because "Open X … and save as Y" contains both and the
 * write is the deliverable. Write intent therefore wins on a tie.
 */
const READ_INTENT =
  /\b(open|read|reading|summari[sz]e|summari[sz]ing|list|listing|extract|extracting|review|reviewing|show|find|search)\b/i;

/**
 * Strip document titles before intent classification.
 *
 * Principals name files in Title Case — "Staff Meeting Memo Draft", "Student
 * Marks Gradebook", "ICT Equipment Audit" — and those names contain words
 * that read as instructions. "Open the Staff Meeting Memo **Draft** and
 * summarize it" is a pure read, but a naive verb scan sees "Draft" and calls
 * it a write. Titles are therefore removed first: a run of two or more
 * capitalised words, or any token carrying a file extension.
 *
 * A single capitalised word is deliberately kept, because that is how a
 * sentence-initial verb looks ("Save the edited copy…", "Draft the report…").
 */
export function stripDocumentTitles(text) {
  return String(text ?? '')
    // Explicit filenames: Staff_Memo_Final.docx, Marks_Updated.xlsx
    .replace(/\S+\.(docx?|xlsx?|xls|csv|pdf|pptx?|png|jpe?g|gif|webp|bmp|tiff?)\b/gi, ' ')
    // Title-case runs of 2+ words: "Staff Meeting Memo Draft"
    .replace(/\b([A-Z][a-z0-9]+|[A-Z]{2,})(?:\s+([A-Z][a-z0-9]+|[A-Z]{2,}))+\b/g, ' ');
}

/**
 * Classify a prompt as read- or write-intent. Deterministic and documented
 * because the eval must not hand-hold this: putting the intent in the case
 * file would stop the pipeline from testing whether read and write are
 * distinguishable from the prompt at all.
 */
export function promptIntent(prompt) {
  const text = stripDocumentTitles(prompt);
  if (WRITE_INTENT.test(text)) return 'write'; // the deliverable outranks the preparatory read
  if (READ_INTENT.test(text)) return 'read';
  return null;
}

/**
 * Extract prohibitions: `Do not use the pdf, docx, xlsx, pptx, or nano-pdf
 * skills for reading or writing these files`. Returns a Set of slugs.
 */
export function personaProhibitions(persona) {
  const out = new Set();
  const re = /(?:do not|don't|never) use (?:the )?([^.]{0,160}?)\s+skills?\b/gi;
  for (const m of String(persona).matchAll(re)) {
    for (const slug of m[1].split(/,|\bor\b|\band\b/)) {
      const s = slug.trim().replace(/^the\s+/i, '');
      if (/^[a-z0-9][a-z0-9-]*$/i.test(s)) out.add(s.toLowerCase());
    }
  }
  return out;
}

/** IDF + average length over a candidate set. */
function buildIndex(candidates) {
  const docs = candidates.map((c) => tokenize(`${c.name} ${c.description}`));
  const N = docs.length;
  const df = new Map();
  for (const d of docs) {
    for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map();
  for (const [t, n] of df) {
    // BM25 probabilistic IDF, floored so a term in every doc scores 0 not
    // negative — a term the whole catalogue shares carries no signal.
    idf.set(t, Math.max(0, Math.log((N - n + 0.5) / (n + 0.5) + 1)));
  }
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, N);
  return { docs, idf, avgLen, maxIdf: Math.max(0, ...idf.values()) };
}

/**
 * Score every candidate for a prompt and return them ranked.
 *
 * @param {object} opts
 * @param {string} opts.prompt            the principal's request
 * @param {string} [opts.fileExt]         file kind in play, e.g. ".docx"
 * @param {Array}  opts.candidates        [{ name, description, kind }]
 * @param {string} [opts.persona]         persona text; '' disables directives
 * @param {number} [opts.directiveWeight]
 */
export function rank({
  prompt,
  fileExt,
  candidates,
  persona = '',
  directiveWeight = DIRECTIVE_WEIGHT,
  prohibitionWeight = PROHIBITION_WEIGHT,
}) {
  const { docs, idf, avgLen, maxIdf } = buildIndex(candidates);
  const query = tokenize(prompt);
  const directives = persona ? personaDirectives(persona) : [];
  const prohibited = persona ? personaProhibitions(persona) : new Set();
  const intent = promptIntent(prompt);

  const scored = candidates.map((cand, i) => {
    const doc = docs[i];
    const len = doc.length;
    const tf = new Map();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);

    let bm25 = 0;
    for (const t of new Set(query)) {
      const f = tf.get(t);
      if (!f) continue;
      const w = idf.get(t) ?? 0;
      bm25 +=
        (w * (f * (BM25_K1 + 1))) /
        (f + BM25_K1 * (1 - BM25_B + BM25_B * (len / avgLen)));
    }

    // A persona directive that names this tool for this file kind AND this
    // read/write mode. Matching the file kind alone cannot separate
    // read_xlsx from write_xlsx, which is the distinction the Ministry's P4
    // turns on.
    let directive = 0;
    const named = directives.find((d) => d.tool === cand.name);
    if (named) {
      const extMatch = fileExt
        ? named.extensions.includes(String(fileExt).toLowerCase())
        : named.extensions.length > 0;
      if (extMatch) {
        directive = directiveWeight * maxIdf;
        // Mode agreement is worth as much as the file-kind match: without it
        // "save the updated copy" and "read the marks" score identically.
        if (intent && named.mode === intent) directive += directiveWeight * maxIdf;
        else if (intent && named.mode !== intent) directive = 0;
      }
    }

    // A persona prohibition against this skill.
    const penalty =
      cand.kind === 'skill' && prohibited.has(cand.name)
        ? prohibitionWeight * maxIdf
        : 0;

    return {
      name: cand.name,
      kind: cand.kind,
      bm25: round(bm25),
      directive: round(directive),
      penalty: round(penalty),
      score: round(bm25 + directive - penalty),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  scored.intent = intent;
  return scored;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Build the candidate catalogue the agent sees.
 *
 * @param {object} opts
 * @param {Array}  opts.tools        document.* tools from register()
 * @param {Array}  opts.skills       every known skill
 * @param {Set}    opts.enabled      slugs actually offered to the model
 */
export function buildCatalogue({ tools, skills, enabled }) {
  return [
    ...tools.map((t) => ({ ...t, kind: 'tool' })),
    ...skills.filter((s) => enabled.has(s.name)),
  ];
}
