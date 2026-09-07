/**
 * CLWX-87 guards: the WER math and fixture manifest for the ASR quality
 * bench (scripts/clwx87-wer-bench.mjs). The bench spawns TTS + engines —
 * too heavy for the unit lane — so these pin the pure grading logic: WER
 * must be standard word-level Levenshtein / ref-length, and the manifest
 * must stay well-formed (grading integrity depends on reference texts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

async function load() {
  if (!mod) mod = await import('../../scripts/clwx87-wer-bench.mjs');
  return mod;
}

describe('computeWer (standard WER semantics)', () => {
  it('identical transcripts score 0', async () => {
    const { computeWer } = await load();
    expect(computeWer('the daily report is due', 'the daily report is due').wer).toBe(0);
  });

  it('is case- and punctuation-insensitive (normalization, not accuracy theater)', async () => {
    const { computeWer } = await load();
    expect(computeWer('Good afternoon, principals!', 'good afternoon principals').wer).toBe(0);
  });

  it('counts substitutions, insertions, and deletions as errors over REF length', async () => {
    const { computeWer } = await load();
    // 1 substitution in 4 ref words
    expect(computeWer('send the daily report', 'send the weekly report').wer).toBe(0.25);
    // 1 deletion
    expect(computeWer('send the daily report', 'send the report')).toMatchObject({ errors: 1, refWords: 4 });
    // 1 insertion
    expect(computeWer('send the report', 'send the daily report')).toMatchObject({ errors: 1, refWords: 3 });
  });

  it('garbage hypotheses can exceed 100% WER (standard semantics, never clamped)', async () => {
    const { computeWer } = await load();
    const r = computeWer('yes', 'completely unrelated words here');
    expect(r.wer).toBeGreaterThan(1);
  });

  it('empty hypothesis = 100% WER; empty reference is Infinity against any hypothesis', async () => {
    const { computeWer } = await load();
    expect(computeWer('three words here', '').wer).toBe(1);
    expect(computeWer('', 'anything').wer).toBe(Infinity);
    expect(computeWer('', '').wer).toBe(0);
  });

  it('werTokens keeps digits, drops apostrophes without splitting the word', async () => {
    const { werTokens } = await load();
    expect(werTokens("the school's 5 forms")).toEqual(['the', 'schools', '5', 'forms']);
  });
});

describe('CLWX-87 fixture manifest shape', () => {
  const manifest = JSON.parse(
    readFileSync(path.resolve(__dirname, '../../eval/fixtures/clwx87-asr-manifest.json'), 'utf8'),
  );

  it('every clip has a unique id, a source the bench understands, and a non-trivial reference text', () => {
    const ids = manifest.clips.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const clip of manifest.clips) {
      expect(['synthetic-say', 'real']).toContain(clip.source);
      expect(String(clip.text).split(/\s+/).length).toBeGreaterThanOrEqual(8);
      if (clip.source === 'synthetic-say') {
        expect(typeof clip.voice).toBe('string');
        expect(clip.rate).toBeGreaterThan(100);
      }
    }
  });

  it('carries the MoE/Trinidad domain vocabulary the owner complaint is about', () => {
    const joined = manifest.clips.map((c: { text: string }) => c.text).join(' ');
    for (const term of ['daily report', 'suspend', 'Ministry of Education', 'Couva', 'San Fernando', 'Tunapuna', 'Code of Conduct']) {
      expect(joined).toContain(term);
    }
  });
});
