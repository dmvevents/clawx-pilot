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
// 8 passages ≈ ≤15KB — measured against the stakeholder Q&A set: 5 left
// key passages below the cut on 3 rows; 8 reaches 17/20 rows fully covered
// deterministically (2026-09-06 sweep; 10 adds nothing).
const DEFAULT_MAX_PASSAGES = 8;
const MIN_PASSAGE_CHARS = 200;
// Excerpts are NEVER truncated below the passage cap: scoring sees the full
// passage text, so a shorter excerpt cap silently discarded scored tails —
// the parent-notification requirement at offset ~1720 of its passage could
// never be returned (Codex HIGH, 2026-09-06).
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

// A principal asks in everyday words; the Code answers in policy vocabulary.
// Without this bridge a colloquial query ("is it okay to smack pupils?")
// retrieved ZERO passages and the persona then mislabelled a retrieval miss
// as absent policy (Codex MED, 2026-09-06). Small and curated on purpose.
const SYNONYM_EXPANSIONS = {
  smack: ['corporal', 'punishment', 'physical'],
  smacking: ['corporal', 'punishment', 'physical'],
  hit: ['corporal', 'punishment', 'physical'],
  hitting: ['corporal', 'punishment', 'physical'],
  beat: ['corporal', 'punishment', 'physical'],
  beating: ['corporal', 'punishment', 'physical'],
  lash: ['corporal', 'punishment', 'physical'],
  lashes: ['corporal', 'punishment', 'physical'],
  licks: ['corporal', 'punishment', 'physical'],
  spank: ['corporal', 'punishment', 'physical'],
  spanking: ['corporal', 'punishment', 'physical'],
  skip: ['attendance', 'absent', 'truancy'],
  skipping: ['attendance', 'absent', 'truancy'],
  skulk: ['attendance', 'absent', 'truancy'],
  skulking: ['attendance', 'absent', 'truancy'],
  expel: ['expulsion'],
  expelled: ['expulsion'],
  suspend: ['suspension'],
  suspended: ['suspension'],
  bully: ['bullying'],
  bullied: ['bullying'],
  pupils: ['students'],
  pupil: ['student'],
};

/** Query → deduplicated content terms (stopwords dropped, 2+ chars),
 * expanded through the colloquial→policy synonym bridge. */
export function queryTerms(query) {
  const norm = normalize(query).replace(/[^a-z0-9' -]/g, ' ');
  const terms = norm.split(/[\s-]+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  const expanded = terms.flatMap((t) => [t, ...(SYNONYM_EXPANSIONS[t] ?? [])]);
  return [...new Set(expanded)];
}

/**
 * Adjacent content-term pairs from the ORIGINAL query order ("corporal
 * punishment", "irregular attendance", "zero tolerance"). A passage holding
 * the concept as a phrase must outrank passages with the same words
 * scattered — frequency noise put the literal corporal-punishment passage
 * at rank 10 behind generic NSCC prose (Q05 regression, 2026-09-06).
 */
export function queryBigrams(query) {
  const norm = normalize(query).replace(/[^a-z0-9' -]/g, ' ');
  const seq = norm.split(/[\s-]+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  const bigrams = [];
  for (let i = 0; i < seq.length - 1; i += 1) bigrams.push(`${seq[i]} ${seq[i + 1]}`);
  return [...new Set(bigrams)];
}

/**
 * A block that starts mid-sentence (first alphabetic character lowercase)
 * is a page-break continuation of the previous block, not a new passage —
 * the NSCC's four-part suspension/expulsion safeguards list breaks across
 * a page between clauses (b) and (c), and splitting there returned
 * incomplete guidance on serious disciplinary measures (Codex HIGH,
 * 2026-09-06). Pure; unit-tested.
 */
export function startsAsContinuation(block) {
  const firstAlpha = String(block ?? '').match(/[a-zA-Z]/);
  return firstAlpha !== null && firstAlpha[0] === firstAlpha[0].toLowerCase();
}

/**
 * Split the NSCC text into scoreable passages: bare page-number artifact
 * lines dropped, blank-line blocks with page-break continuations stitched
 * back to their opener, merged forward until each passage reaches
 * MIN_PASSAGE_CHARS (headings ride with their body text), split when they
 * exceed MAX_PASSAGE_CHARS. Pure; unit-tested.
 */
export function splitNsccPassages(text) {
  // Page artifacts (a line holding only a page number) sit INSIDE logical
  // paragraphs at every page break; they carry no content and their blank
  // lines caused the mid-list splits above.
  const cleaned = String(text ?? '').replace(/^[ \t]*\d{1,3}[ \t]*$/gm, '');
  const rawBlocks = cleaned
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const blocks = [];
  for (const block of rawBlocks) {
    if (blocks.length && startsAsContinuation(block)) {
      blocks[blocks.length - 1] = `${blocks[blocks.length - 1]}\n${block}`;
    } else {
      blocks.push(block);
    }
  }
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
export function scorePassage(normPassage, firstLine, terms, normQuery, bigrams = [], weights = {}) {
  let score = 0;
  for (const bigram of bigrams) {
    if (normPassage.includes(bigram)) score += 1.5;
    // Heading match: a passage whose FIRST LINE carries an informative query
    // bigram is the section ABOUT that concept — the "Core Values" section
    // must outrank prose that merely name-drops the values (K14 six-core-
    // values case: the enumeration sat at rank 9 behind generic passages,
    // 2026-09-06).
    if (firstLine.includes(bigram)) score += 2;
  }
  for (const term of terms) {
    let idx = normPassage.indexOf(term);
    if (idx === -1) continue;
    // Corpus-frequent terms carry a reduced weight (searchNscc computes
    // document frequencies): in THIS corpus "national/school/code/conduct"
    // appear in nearly every passage, and at full weight any generic
    // passage naming the document outranked the actual core-values list
    // (rank 9, 2026-09-06).
    const weight = weights[term] ?? 1;
    let hits = 0;
    while (idx !== -1 && hits < 5) {
      hits += 1;
      idx = normPassage.indexOf(term, idx + term.length);
    }
    score += (1 + (hits - 1) * 0.25) * weight;
    if (firstLine.includes(term)) score += 0.5 * weight;
    // Definition nudge: "<term> is defined as …" / "definition of <term>" is
    // almost always THE passage a "what is <term>" question wants, but it
    // has no term-frequency advantage over consequence-matrix rows that
    // repeat the term (the NSCC-Q13 bullying case: definition ranked 14th
    // on frequency alone, 2026-09-06).
    if (normPassage.includes(`${term} is defined`) || normPassage.includes(`definition of ${term}`)) {
      score += 2 * weight;
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
  const prepared = passages.map((p, i) => {
    const norm = normalize(p);
    const start = offset;
    offset += p.length;
    return { index: i, norm, firstLine: normalize(p.split('\n', 1)[0]), passage: p, start };
  });
  // Only INFORMATIVE bigrams score: a phrase bonus for "national school" or
  // "code conduct" rewards every passage that names the document and buried
  // the core-values list at rank 9 (2026-09-06). Document-frequency cut:
  // a bigram present in >5% of passages (min 3) carries no signal.
  const dfCut = Math.max(3, Math.ceil(prepared.length * 0.05));
  const bigrams = queryBigrams(query).filter((b) => {
    const df = prepared.reduce((n, p) => n + (p.norm.includes(b) ? 1 : 0), 0);
    return df > 0 && df <= dfCut;
  });
  // Same principle for single terms: a term in >25% of passages (the
  // document naming itself) keeps only a tie-break weight.
  const termDfCut = prepared.length * 0.25;
  const weights = {};
  for (const term of terms) {
    const df = prepared.reduce((n, p) => n + (p.norm.includes(term) ? 1 : 0), 0);
    weights[term] = df > termDfCut ? 0.25 : 1;
  }
  const scored = prepared.map((p) => ({
    index: p.index,
    score: scorePassage(p.norm, p.firstLine, terms, normQuery, bigrams, weights),
    passage: p.passage,
    start: p.start,
  }));
  const totalChars = offset || 1;
  const top = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxPassages)
    .map((s, rank) => ({
      rank: rank + 1,
      score: Number(s.score.toFixed(2)),
      approxPositionPct: Math.round((s.start / totalChars) * 100),
      // Full passage, never truncated — passages are already capped at
      // MAX_PASSAGE_CHARS by the splitter (Codex HIGH, 2026-09-06).
      excerpt: s.passage,
    }));
  return {
    passages: top,
    totalPassages: passages.length,
    terms,
    // A retrieval miss is NOT evidence of absent policy (Codex MED,
    // 2026-09-06): the note tells the model to retry with policy wording
    // and, failing that, to report a retrieval failure — never to claim
    // the Code lacks a policy.
    note: top.length
      ? 'Passages from the National School Code of Conduct (NSCC), Revised Edition (2026). Ground the answer in these passages and cite the NSCC.'
      : 'No NSCC passage matched these search terms. This means the SEARCH found nothing — not that the Code lacks a policy. Retry principal.nscc_lookup once with formal policy wording (e.g. "corporal punishment" for smacking or beating, "irregular attendance" for skipping school, "expulsion" for being expelled). If a retry also returns nothing, tell the principal you could not retrieve a relevant section of the Code — do not claim the Code does not cover it.',
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
