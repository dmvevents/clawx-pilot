/**
 * CLWX-42 guards: NSCC knowledge-pack retrieval
 * (extensions/moe-principal-assistant/nscc-lookup.mjs).
 *
 * The K14 finding this closes: the moe.18 verify answered all five NSCC
 * prompts with ZERO raw errors but GENERIC content — the model had no pack
 * to cite. These tests pin, against the SHIPPED data file, that the five
 * K14 questions retrieve the actual NSCC passages (the substance bar), and
 * that the pure retrieval functions behave (falsifiable: absent topics
 * return no passages plus the honest note).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;
let nsccText: string;

const PLUGIN_ROOT = path.resolve(__dirname, '../../extensions/moe-principal-assistant');

async function load() {
  if (!mod) {
    mod = await import('../../extensions/moe-principal-assistant/nscc-lookup.mjs');
    nsccText = readFileSync(path.join(PLUGIN_ROOT, 'data', 'nscc-2026.txt'), 'utf8');
  }
  return mod;
}

describe('shipped NSCC data file', () => {
  it('is the content-verified 2026 edition (never the 2018 revision)', async () => {
    await load();
    expect(nsccText.length).toBeGreaterThan(100_000);
    expect(nsccText).toMatch(/national school code of conduct/i);
    expect(nsccText).toMatch(/2026/);
    expect(/revised may 25, 2018/i.test(nsccText)).toBe(false);
  });

  it('loadNsccText reads and caches the shipped file from the plugin root', async () => {
    const { loadNsccText } = await load();
    const text = loadNsccText(PLUGIN_ROOT);
    expect(text).toBe(loadNsccText(PLUGIN_ROOT)); // cached identity
    expect(text.length).toBe(nsccText.length);
  });
});

describe('searchNscc — the five K14 prompts retrieve the real passages (substance bar)', () => {
  const cases: Array<[string, RegExp]> = [
    ['What are the six core values of the National School Code of Conduct?', /core values[\s\S]*respect/i],
    ['Is corporal punishment allowed in schools?', /physical punishment|corporal punishment/i],
    ['What is the definition of irregular attendance?', /irregular attendance is defined|absent for more than five/i],
    ['What must a teacher do if they suspect a child is being abused?', /report a suspected|suspected sexual offense|report suspected/i],
    ['What is the difference between suspension and expulsion?', /suspension[\s\S]*expulsion|expulsion[\s\S]*suspension/i],
  ];

  for (const [question, expected] of cases) {
    it(`retrieves grounded passages for: ${question.slice(0, 60)}…`, async () => {
      const { searchNscc } = await load();
      const r = searchNscc(nsccText, question);
      expect(r.passages.length).toBeGreaterThan(0);
      const joined = r.passages.map((p: { excerpt: string }) => p.excerpt).join('\n\n');
      expect(joined).toMatch(expected);
      // Every result carries the citation instruction for the model.
      expect(r.note).toMatch(/cite the NSCC/i);
    });
  }

  it('returns a bounded payload — never the whole document (the KR6 token-floor design decision)', async () => {
    const { searchNscc } = await load();
    const r = searchNscc(nsccText, 'What are the six core values of the National School Code of Conduct?');
    expect(r.passages.length).toBeLessThanOrEqual(8);
    const totalChars = r.passages.reduce((n: number, p: { excerpt: string }) => n + p.excerpt.length, 0);
    expect(totalChars).toBeLessThan(14_000);
  });
});

describe('Codex-lane regressions (2026-09-06): truncation, page-break stitching, colloquial queries', () => {
  it('excerpts are NEVER truncated — the parent-notification requirement deep in its passage is returned (Codex HIGH)', async () => {
    const { searchNscc } = await load();
    const r = searchNscc(nsccText, 'Must parents be notified before teachers require social media for learning projects?');
    const joined = r.passages.map((p: { excerpt: string }) => p.excerpt).join('\n');
    expect(joined).toMatch(/notified beforehand|notified before/i);
    for (const p of r.passages) expect(p.excerpt.endsWith(' …')).toBe(false);
  });

  it('page-break continuations are stitched — all four Q03 suspension/expulsion safeguards retrieve together (Codex HIGH)', async () => {
    const { searchNscc } = await load();
    const r = searchNscc(nsccText, 'What principles must apply when the NSCC refers to suspension, expulsion, police referral, or zero tolerance?');
    const joined = r.passages.map((p: { excerpt: string }) => p.excerpt).join('\n');
    expect(joined).toMatch(/due process and procedural fairness/i);
    expect(joined).toMatch(/proportionate to the offence/i);
    expect(joined).toMatch(/best interests of the child/i);
    expect(joined).toMatch(/minister of education/i);
  });

  it('colloquial phrasing bridges to policy vocabulary — "is it okay to smack pupils?" retrieves the punishment passages (Codex MED)', async () => {
    const { searchNscc } = await load();
    const r = searchNscc(nsccText, 'Is it okay to smack pupils?');
    expect(r.passages.length).toBeGreaterThan(0);
    const joined = r.passages.map((p: { excerpt: string }) => p.excerpt).join('\n');
    expect(joined).toMatch(/physical punishment|corporal punishment/i);
  });

  it('startsAsContinuation: lowercase-opening blocks stitch, headings and bullets do not', async () => {
    const { startsAsContinuation } = await load();
    expect(startsAsContinuation('student;\n(c) consistent with the best interests')).toBe(true);
    expect(startsAsContinuation('(c) consistent with the best interests of the child')).toBe(true);
    expect(startsAsContinuation('Context: Triggers for Revision')).toBe(false);
    expect(startsAsContinuation('• The Imperative for Zero-Tolerance')).toBe(false);
    expect(startsAsContinuation('42')).toBe(false);
  });
});

describe('correctness-lens regressions (2026-09-06): load integrity + short-term boundaries', () => {
  it('a missing data file surfaces principal-readable prose — never ENOENT or a filesystem path (lens MAJOR 1)', async () => {
    const { loadNsccText } = await load();
    let message = '';
    try {
      loadNsccText('/tmp/no-such-plugin-root-clwx42');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/could not be loaded/i);
    expect(message).toMatch(/update or reinstall/i);
    expect(message).not.toMatch(/ENOENT/);
    expect(message).not.toMatch(/\//); // no filesystem paths
  });

  it('assertNsccIntegrity rejects empty, truncated, and 2018-edition text with the same readable message (lens MAJOR 1)', async () => {
    const { assertNsccIntegrity } = await load();
    for (const bad of [
      '',
      'National School Code of Conduct 2026', // truncated far below the length floor
      `${'x'.repeat(120_000)} National School Code of Conduct Revised May 25, 2018`, // wrong edition
      `${'x'.repeat(120_000)} National School Code of Conduct`, // no 2026 marker
    ]) {
      expect(() => assertNsccIntegrity(bad)).toThrow(/could not be loaded/i);
    }
    expect(() => assertNsccIntegrity(nsccText)).not.toThrow();
  });

  it('termHits: short terms match word-boundaries only — "pe" no longer matches people/operate/type (lens MAJOR 3)', async () => {
    const { termHits } = await load();
    expect(termHits('people operate this type of thing', 'pe')).toBe(0);
    expect(termHits('the pe class runs on friday; pe kits required', 'pe')).toBe(2);
    // longer terms keep substring semantics (plurals still match)
    expect(termHits('suspensions are recorded', 'suspension')).toBe(1);
  });

  it('TOC dot-leader lines are dropped from passages (lens minor 6)', async () => {
    const { splitNsccPassages } = await load();
    const passages = splitNsccPassages(nsccText);
    const withLeaders = passages.filter((p: string) => /\.{5,}\s*\d+\s*$/m.test(p));
    expect(withLeaders.length).toBe(0);
  });

  it('no passage is a sub-100-char fragment occupying a rank slot (lens minor 12)', async () => {
    const { splitNsccPassages } = await load();
    const passages = splitNsccPassages(nsccText);
    expect(passages.filter((p: string) => p.length < 100).length).toBe(0);
  });
});

describe('searchNscc — honesty and edge cases (falsifiability)', () => {
  it('an absent topic returns no passages plus the retry-then-report note — never a "Code lacks it" claim (Codex MED)', async () => {
    const { searchNscc } = await load();
    const r = searchNscc(nsccText, 'zorbulon quixotic frangipani blockchain');
    expect(r.passages.length).toBe(0);
    expect(r.note).toMatch(/search found nothing/i);
    expect(r.note).toMatch(/could not retrieve/i);
    expect(r.note).toMatch(/do not claim the Code does not cover/i);
  });

  it('a stopword-only query is refused readably, not crashed', async () => {
    const { searchNscc } = await load();
    const r = searchNscc(nsccText, 'what is the of and');
    expect(r.passages.length).toBe(0);
    expect(r.note).toMatch(/no searchable terms/i);
  });

  it('queryTerms drops stopwords but keeps NSCC vocabulary', async () => {
    const { queryTerms } = await load();
    const terms = queryTerms('What is the difference between suspension and expulsion?');
    expect(terms).toContain('suspension');
    expect(terms).toContain('expulsion');
    expect(terms).not.toContain('what');
    expect(terms).not.toContain('the');
  });

  it('splitNsccPassages produces bounded passages covering the whole text', async () => {
    const { splitNsccPassages } = await load();
    const passages = splitNsccPassages(nsccText);
    expect(passages.length).toBeGreaterThan(50);
    // Cap 1800 + up to 99 chars when a sub-100 trailing fragment folds back
    // into its predecessor (lens minor 12 fix) — still firmly bounded.
    for (const p of passages) expect(p.length).toBeLessThanOrEqual(1900);
    const total = passages.reduce((n: number, p: string) => n + p.length, 0);
    // Split loses only inter-block whitespace, page-number artifacts, and
    // TOC dot-leader lines (intended noise removal; measured ratio 0.897 on
    // the shipped file) — never body content.
    expect(total).toBeGreaterThan(nsccText.length * 0.85);
  });
});
