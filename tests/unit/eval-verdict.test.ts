/**
 * Pins the live Outlook eval's verdict logic (CLWX-119).
 *
 * The module under test exists because `scripts/v2-eval.ts` cannot be imported
 * (CDP browser + `process.exit` at module scope), so until now the eval's exit
 * contract — the thing `scripts/ga-gate.mjs` trusts to tell a product failure
 * apart from an unusable lane — had no test at all. That is precisely how a
 * fail-open shipped inside ga-gate and survived two review lenses.
 *
 * These rows are written to FAIL if the substring inference ever comes back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  classifyLatency,
  evalArtifactPath,
  evalLatestPath,
  gradeAttachmentLocate,
  laneVerdict,
  latencyViolations,
  LATENCY_CEILING_MS,
  LATENCY_SLOW_MS,
  type VerdictRow,
} from '../../scripts/eval-verdict.ts';

const REPO = path.resolve(__dirname, '../..');

/**
 * Lines matching `re` that are NOT prose.
 *
 * Both files below deliberately QUOTE the defects they removed — the deleted
 * `/needs_signin/i.test(...)` and the wrong `outlook-eval 15-row` label are
 * named in comments so the next reader knows what not to reintroduce. A guard
 * that greps raw source would fire on that documentation and pressure someone
 * to delete the explanation. So: match on code lines only, and treat anything
 * that is not unambiguously a comment as code, so an ambiguous case fails LOUD
 * rather than passing quietly.
 */
function offendingCodeLines(src: string, re: RegExp): string[] {
  return src
    .split('\n')
    .filter((line) => re.test(line))
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    });
}

function row(over: Partial<VerdictRow> & Pick<VerdictRow, 'id' | 'status'>): VerdictRow {
  return { latencyMs: 1_000, ...over };
}

describe('laneVerdict — lane-not-ready must be declared, never inferred', () => {
  it('exits 0 when every row passes', () => {
    const v = laneVerdict([row({ id: 'W1', status: 'pass' }), row({ id: 'W2.1', status: 'pass' })]);
    expect(v.exitCode).toBe(0);
  });

  it('exits 2 only when EVERY failing row declared laneNotReady', () => {
    const v = laneVerdict([
      row({ id: 'W1', status: 'fail', laneNotReady: true }),
      row({ id: 'W2.1', status: 'fail', laneNotReady: true }),
      row({ id: 'W3.2', status: 'skip' }),
    ]);
    expect(v.exitCode).toBe(2);
    expect(v.reason).toMatch(/sign-in wall/i);
  });

  it('exits 1 when a real defect shares a run with a sign-in wall, and NAMES the unexplained row', () => {
    // The fail-open this module was extracted to kill: one healthy sign-in
    // refusal used to relabel a genuine product failure "lane blocked" -> exit 0.
    const v = laneVerdict([
      row({ id: 'W1', status: 'fail', laneNotReady: true }),
      row({ id: 'W8.3', status: 'fail', notes: 'attachments=undefined' }),
    ]);
    expect(v.exitCode).toBe(1);
    expect(v.reason).toContain('W8.3');
    expect(v.reason).not.toContain('W1');
  });

  it('is FAIL-CLOSED: a failing row that never declared laneNotReady is a product failure', () => {
    const v = laneVerdict([row({ id: 'W4.1', status: 'fail', notes: 'status=timeout' })]);
    expect(v.exitCode).toBe(1);
  });

  it('REGRESSION: the needs_signin token in free-text notes alone must NOT buy exit 2', () => {
    // Verbatim the shape the deleted `/needs_signin/i.test(r.notes)` would have
    // called a blocked lane. The token is present; the typed flag is not.
    const v = laneVerdict([
      row({
        id: 'W2.4',
        status: 'fail',
        notes: 'probe="term" got=0 status=needs_signin was NOT the reason; search returned nothing',
      }),
    ]);
    expect(v.exitCode).toBe(1);
    expect(v.reason).toContain('W2.4');
  });

  it('REGRESSION (the other direction): a real sign-in wall whose notes omit the token still exits 2', () => {
    const v = laneVerdict([
      row({ id: 'W3.1', status: 'fail', laneNotReady: true, notes: 'read_inbox count=0' }),
    ]);
    expect(v.exitCode).toBe(2);
  });

  it('a run with zero failures and zero rows is not a lane failure', () => {
    expect(laneVerdict([]).exitCode).toBe(0);
  });

  it('skipped rows never make a run exit 2 on their own', () => {
    const v = laneVerdict([row({ id: 'W3.2', status: 'skip' }), row({ id: 'W1', status: 'pass' })]);
    expect(v.exitCode).toBe(0);
  });
});

describe('classifyLatency — thresholds are the product’s own commitments', () => {
  it('holds the two numbers the product already committed to', () => {
    expect(LATENCY_SLOW_MS).toBe(30_000); // CLWX-47/TB-3 "still working" notice
    expect(LATENCY_CEILING_MS).toBe(90_000); // CLWX-94 watchdog failover
  });

  it('treats the thresholds as inclusive lower bounds (the boundary is stated, not left to the reader)', () => {
    expect(classifyLatency(LATENCY_SLOW_MS - 1)).toBe('ok');
    expect(classifyLatency(LATENCY_SLOW_MS)).toBe('slow');
    expect(classifyLatency(LATENCY_CEILING_MS - 1)).toBe('slow');
    expect(classifyLatency(LATENCY_CEILING_MS)).toBe('over_ceiling');
  });

  it('never turns an unmeasured duration into a verdict', () => {
    expect(classifyLatency(Number.NaN)).toBe('ok');
    expect(classifyLatency(-1)).toBe('ok');
    expect(classifyLatency(Number.POSITIVE_INFINITY)).toBe('ok');
  });
});

describe('latencyViolations — only correctness-passing rows can be charged for time', () => {
  it('fails a run whose row returned correct data after the product would have failed over', () => {
    const v = laneVerdict([row({ id: 'W2.1', status: 'pass', latencyMs: 91_000 })]);
    expect(v.exitCode).toBe(1);
    expect(v.reason).toMatch(/W2\.1=91000ms/);
  });

  it('a SLOW-but-under-ceiling pass stays a pass', () => {
    const v = laneVerdict([row({ id: 'W2.1', status: 'pass', latencyMs: 45_000 })]);
    expect(v.exitCode).toBe(0);
  });

  it('does not manufacture a failure out of a skipped or already-failing slow row', () => {
    expect(
      latencyViolations([
        row({ id: 'W3.2', status: 'skip', latencyMs: 120_000 }),
        row({ id: 'W8.3', status: 'fail', latencyMs: 120_000, laneNotReady: true }),
      ]),
    ).toEqual([]);
  });

  it('a failing row takes priority over a slow pass, so the product failure is the reported reason', () => {
    const v = laneVerdict([
      row({ id: 'W2.1', status: 'pass', latencyMs: 120_000 }),
      row({ id: 'W8.3', status: 'fail' }),
    ]);
    expect(v.exitCode).toBe(1);
    expect(v.reason).toMatch(/PRODUCT FAILURE/);
  });
});

describe('gradeAttachmentLocate — a refusal is not an absence (CLWX-120)', () => {
  it('skips ONLY on positive evidence of the CLWX-46 stale-read refusal', () => {
    const g = gradeAttachmentLocate({ status: 'not_found', notFoundReason: 'stale_read_guard' });
    expect(g.kind).toBe('skip');
    if (g.kind === 'skip') expect(g.notes).toMatch(/UNEXERCISED/);
  });

  it('FAILs a genuine absence', () => {
    const g = gradeAttachmentLocate({ status: 'not_found', notFoundReason: 'not_in_list' });
    expect(g.kind).toBe('fail');
    if (g.kind === 'fail') expect(g.notes).toContain('not_in_list');
  });

  it('FAILs when the reason is absent — a transport that stops setting the field cannot buy a green', () => {
    expect(gradeAttachmentLocate({ status: 'not_found' }).kind).toBe('fail');
  });

  it('FAILs an ok read that returned no attachments array — data returned and WRONG is never a skip', () => {
    expect(gradeAttachmentLocate({ status: 'ok' }).kind).toBe('fail');
    // A transport that answers with a non-array (the shape TS cannot rule out at
    // a runtime boundary) must not reach the metadata leg.
    expect(gradeAttachmentLocate({ status: 'ok', attachments: 'nope' as unknown as [] }).kind).toBe('fail');
  });

  it('continues on a well-formed ok read and hands the validated array back', () => {
    // The array travels WITH the verdict so the row never re-checks what this
    // function already decided; a second copy of the rule is how two ends drift.
    const g = gradeAttachmentLocate({ status: 'ok', attachments: [{ filename: 'a.pdf' }] });
    expect(g.kind).toBe('continue');
    if (g.kind === 'continue') expect(g.attachments).toEqual([{ filename: 'a.pdf' }]);
  });

  it('does not let stale_read_guard excuse a non-not_found status', () => {
    // The guard reason is only meaningful alongside not_found; anywhere else it
    // is noise, and noise must not earn a skip.
    expect(
      gradeAttachmentLocate({ status: 'needs_signin', notFoundReason: 'stale_read_guard' }).kind,
    ).toBe('fail');
  });
});

describe('eval artifacts — two runs must leave two comparable files (CLWX-119)', () => {
  it('gives distinct paths to distinct runs', () => {
    const a = evalArtifactPath('2026-09-07T12:00:00.000Z');
    const b = evalArtifactPath('2026-09-07T12:10:00.000Z');
    expect(a).not.toBe(b);
  });

  it('sanitises the stamp so it cannot escape the directory or break the shell', () => {
    const p = evalArtifactPath('2026-09-07T12:00:00.000Z');
    expect(p).toBe('/tmp/v2-eval-results-2026-09-07T12-00-00-000Z.json');
    expect(evalArtifactPath('../../etc/pa$$wd')).not.toContain('..');
    expect(evalArtifactPath('../../etc/pa$$wd')).not.toContain('/etc/');
  });

  it('keeps artifacts out of the repo, because row notes can carry message subjects', () => {
    // The hard rule caps subjects at 120 chars and keeps them out of committed
    // files. Promoting these to docs/evidence/ needs a redaction pass first.
    expect(evalArtifactPath('2026-09-07T12:00:00.000Z').startsWith('/tmp/')).toBe(true);
    expect(evalLatestPath()).toBe('/tmp/v2-eval-results.json');
  });
});

describe('v2-eval.ts imports the shipped verdict rather than re-deriving it', () => {
  const src = readFileSync(path.join(REPO, 'scripts/v2-eval.ts'), 'utf8');

  it('calls laneVerdict and has no second exit path of its own', () => {
    expect(src).toContain("from './eval-verdict.ts'");
    expect(src).toContain('laneVerdict(results)');
    // Exactly two process.exit sites: the verdict, and the top-level catch.
    expect((src.match(/process\.exit\(/g) ?? []).length).toBe(2);
  });

  it('has no substring inference of the lane verdict left anywhere in the suite', () => {
    // Guards the whole family, not just the one call that was removed: a
    // verdict must never be read out of free text again.
    expect(offendingCodeLines(src, /\/needs_signin\/[a-z]*\.test\(|\.test\([^)]*needs_signin/)).toEqual([]);
    expect(offendingCodeLines(src, /includes\(\s*['"`]needs_signin/)).toEqual([]);
  });

  it('grades W3.2 through the pinned function instead of inline', () => {
    expect(src).toContain('gradeAttachmentLocate(r)');
  });
});

describe('ga-gate derives the eval row count instead of authoring it', () => {
  const gate = readFileSync(path.join(REPO, 'scripts/ga-gate.mjs'), 'utf8');
  const evalSrc = readFileSync(path.join(REPO, 'scripts/v2-eval.ts'), 'utf8');

  it('no longer hardcodes a row count in the label', () => {
    expect(offendingCodeLines(gate, /outlook-eval \d+-row/)).toEqual([]);
    expect(gate).toMatch(/outlook-eval \$\{evalRowCount\(\)\}/);
  });

  it('the derivation the gate uses actually finds the suite’s rows', () => {
    // If this ever returns 0 the label degrades to "(row count unknown)" rather
    // than inventing one — but a silently-0 derivation would still be a lie by
    // omission, so it is asserted here against the real suite.
    const n = (evalSrc.match(/await runRow\(/g) ?? []).length;
    expect(n).toBeGreaterThan(15);
  });
});
