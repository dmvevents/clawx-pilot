/**
 * nscc-lookup.mjs — deterministic passage retrieval over the National School
 * Code of Conduct (NSCC) 2026 text (CLWX-42).
 *
 * Raj's clearest explicit feature ask (2026-06-27): the Code of Conduct in
 * the AI's memory instead of file lookups. Design decision (recorded on the
 * card): NOT a workspace bootstrap doc — the full text is ~55k tokens per
 * turn against the KR6 token floor. Instead the persona steers any
 * Code-of-Conduct question to `principal.nscc_lookup`, which returns the
 * top-scoring passages (a few KB) for the model to ground and cite.
 *
 * Pure functions + a cached loader; no model, no network, no host-API. The
 * data file ships inside the plugin dir (electron-builder copies
 * extensions/ verbatim), so the packaged app carries it — the moe.18 VM
 * probe that found NO *nscc* files in the installed tree is the gap this
 * closes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const NSCC_DATA_RELPATH = path.join('data', 'nscc-2026.txt');
// 8 passages ≈ ≤13KB — measured against the stakeholder Q&A set: 5 left
// key passages below the cut on 3 rows; 8 reaches 17/20 rows fully covered
// deterministically (2026-09-06 sweep; 10 adds nothing).
const DEFAULT_MAX_PASSAGES = 8;
const MAX_EXCERPT_CHARS = 1600;
const MIN_PASSAGE_CHARS = 200;
const MAX_PASSAGE_CHARS = 1800;

// Common English words that would otherwise dominate scoring. Deliberately
// small: NSCC vocabulary ("suspension", "corporal", "attendance") must never
// land here.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'do', 'does', 'did', 'can', 'could', 'shall', 'should', 'will', 'would',
  'may', 'might', 'must', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by',
  'with', 'about', 'as', 'into', 'and', 'or', 'not', 'no', 'if', 'it', 'its',
  'this', 'that', 'these', 'those', 'there', 'their', 'they', 'them', 'you',
  'your', 'i', 'we', 'our', 'us', 'he', 'she', 'his', 'her', 'have', 'has',
  'had', 'me', 'my', 'per', 'vs', 'versus', 'between', 'difference',
]);

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Query → deduplicated content terms (stopwords dropped, 2+ chars). */
export function queryTerms(query) {
  const norm = normalize(query).replace(/[^a-z0-9' -]/g, ' ');
  const terms = norm.split(/[\s-]+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(terms)];
}

/**
 * Split the NSCC text into scoreable passages: blank-line blocks, merged
 * forward until each passage reaches MIN_PASSAGE_CHARS (headings and page
 * artifacts ride with their body text), split when they exceed
 * MAX_PASSAGE_CHARS. Pure; unit-tested.
 */
export function splitNsccPassages(text) {
  const blocks = String(text ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const passages = [];
  let current = '';
  for (const block of blocks) {
    current = current ? `${current}\n\n${block}` : block;
    if (current.length >= MIN_PASSAGE_CHARS) {
      while (current.length > MAX_PASSAGE_CHARS) {
        // Hard-split oversized runs at a sentence-ish boundary when one
        // exists in range, else mid-run — a passage must stay excerptable.
        const window = current.slice(0, MAX_PASSAGE_CHARS);
        const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'));
        const at = cut > MIN_PASSAGE_CHARS ? cut + 1 : MAX_PASSAGE_CHARS;
        passages.push(current.slice(0, at).trim());
        current = current.slice(at).trim();
      }
      if (current) passages.push(current);
      current = '';
    }
  }
  if (current) passages.push(current);
  return passages;
}

/**
 * Score one passage against the query terms (pure). Term hits are counted
 * with diminishing returns; an exact-phrase hit is a strong bonus; a hit in
 * the passage's first line (usually the section heading) gets a nudge.
 */
export function scorePassage(normPassage, firstLine, terms, normQuery) {
  let score = 0;
  for (const term of terms) {
    let idx = normPassage.indexOf(term);
    if (idx === -1) continue;
    let hits = 0;
    while (idx !== -1 && hits < 5) {
      hits += 1;
      idx = normPassage.indexOf(term, idx + term.length);
    }
    score += 1 + (hits - 1) * 0.25;
    if (firstLine.includes(term)) score += 0.5;
    // Definition nudge: "<term> is defined as …" / "definition of <term>" is
    // almost always THE passage a "what is <term>" question wants, but it
    // has no term-frequency advantage over consequence-matrix rows that
    // repeat the term (the NSCC-Q13 bullying case: definition ranked 14th
    // on frequency alone, 2026-09-06).
    if (normPassage.includes(`${term} is defined`) || normPassage.includes(`definition of ${term}`)) {
      score += 2;
    }
  }
  if (normQuery && terms.length >= 2 && normPassage.includes(normQuery)) score += 2;
  return score;
}

/**
 * Search the NSCC text for a query; returns the top passages with scores
 * and approximate position (percent through the document — the text
 * extraction carries no reliable page boundaries, stated honestly). Pure;
 * unit-tested.
 */
export function searchNscc(text, query, { maxPassages = DEFAULT_MAX_PASSAGES } = {}) {
  const terms = queryTerms(query);
  const passages = splitNsccPassages(text);
  if (!terms.length) {
    return { passages: [], totalPassages: passages.length, terms, note: 'query had no searchable terms' };
  }
  const normQuery = normalize(query).replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
  let offset = 0;
  const scored = passages.map((p, i) => {
    const norm = normalize(p);
    const firstLine = normalize(p.split('\n', 1)[0]);
    const start = offset;
    offset += p.length;
    return { index: i, score: scorePassage(norm, firstLine, terms, normQuery), passage: p, start };
  });
  const totalChars = offset || 1;
  const top = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxPassages)
    .map((s, rank) => ({
      rank: rank + 1,
      score: Number(s.score.toFixed(2)),
      approxPositionPct: Math.round((s.start / totalChars) * 100),
      excerpt: s.passage.length > MAX_EXCERPT_CHARS ? `${s.passage.slice(0, MAX_EXCERPT_CHARS)} …` : s.passage,
    }));
  return {
    passages: top,
    totalPassages: passages.length,
    terms,
    note: top.length
      ? 'Passages from the National School Code of Conduct (NSCC), Revised Edition (2026). Ground the answer in these passages and cite the NSCC.'
      : 'No NSCC passage matched the query terms — say plainly that the Code of Conduct text does not appear to cover it.',
  };
}

let cachedText = null;
let cachedFrom = null;

/** Load (and cache) the shipped NSCC text from the plugin package root. */
export function loadNsccText(pkgRoot) {
  const p = path.join(pkgRoot, NSCC_DATA_RELPATH);
  if (cachedText === null || cachedFrom !== p) {
    cachedText = readFileSync(p, 'utf8');
    cachedFrom = p;
  }
  return cachedText;
}
