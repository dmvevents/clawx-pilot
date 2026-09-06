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

describe('searchNscc — honesty and edge cases (falsifiability)', () => {
  it('an absent topic returns no passages plus the honest not-covered note', async () => {
    const { searchNscc } = await load();
    const r = searchNscc(nsccText, 'zorbulon quixotic frangipani blockchain');
    expect(r.passages.length).toBe(0);
    expect(r.note).toMatch(/does not appear to cover/i);
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
    for (const p of passages) expect(p.length).toBeLessThanOrEqual(1800);
    const total = passages.reduce((n: number, p: string) => n + p.length, 0);
    // Split loses only inter-block whitespace, never content.
    expect(total).toBeGreaterThan(nsccText.length * 0.9);
  });
});
