/**
 * CLWX-115 recurring gate row — RAJ-2 association/negation fidelity fixture.
 *
 * The fidelity check for the RAJ-2 misinterpretation class ("meal preferences
 * read back as shirt sizes") lived only in scripts/raj2-reply-fidelity-check.ts,
 * a standalone live n=1 probe whose word-coverage / entity-membership
 * assertions cannot see a SWAPPED association or a dropped negation. This
 * runner is the deterministic recurring counterpart: it evaluates the
 * synthetic fixture eval/fixtures/raj2-association-fidelity.json with the
 * pure checker in eval/lib/raj2-association-fidelity.mjs, INCLUDING the
 * mutation controls — the swap, attribute-swap and negation-drop outputs must
 * FAIL, or this runner exits nonzero. A checker weakened until mutations pass
 * therefore reds the gate, not just the fixture.
 *
 * Fail-closed by construction:
 *   - missing/unreadable/unparseable fixture       → exit 1
 *   - structurally hollow fixture (controls absent) → exit 1
 *   - any case verdict != authored expectation      → exit 1
 * There is no BLOCKED/skip path: this row needs no lane, so every non-zero is
 * a product-gate failure (no laneContract in the ga-gate row).
 *
 * Evidence class: SOURCE FIXTURE ONLY. Everything here is synthetic and
 * offline — no model, no tenant, no email. A green run does NOT establish
 * installed-agent fidelity and does not close CLWX-115; the installed-app
 * rerun on the accepted candidate remains a separate required proof.
 *
 *   node scripts/raj2-association-fidelity-gate.mjs
 *   RAJ2_FIXTURE=<path> node scripts/raj2-association-fidelity-gate.mjs   # tests only
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { evaluateFixture } from '../eval/lib/raj2-association-fidelity.mjs';

const DEFAULT_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../eval/fixtures/raj2-association-fidelity.json',
);
const fixturePath = process.env.RAJ2_FIXTURE || DEFAULT_FIXTURE;

console.log('=== CLWX-115 association/negation fidelity fixture (source-fixture evidence only) ===');
console.log(`fixture: ${fixturePath}`);

let fixture;
try {
  fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
} catch (error) {
  console.error(`FAIL (fail-closed): fixture unreadable or unparseable — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const { ok, problems, results } = evaluateFixture(fixture);
for (const problem of problems) console.error(`FIXTURE-CONTRACT FAIL: ${problem}`);
for (const r of results) {
  const mark = r.matched ? 'ok  ' : 'MISMATCH';
  const kind = r.mutationClass ? `control:${r.mutationClass}` : 'faithful';
  console.log(`  ${mark} ${r.id} [${kind}] expected=${r.expected} computed=${r.computed}${r.failureTypes.length ? ` (${r.failureTypes.join(', ')})` : ''}`);
  if (!r.matched && r.expected === 'FAIL') {
    console.log('         ^ this mutation control PASSED the checker — the checker or fixture has been weakened; that is the defect.');
  }
}

console.log(ok
  ? '\nVERDICT: PASS — faithful case green and every mutation control failed as required.'
  : '\nVERDICT: FAIL — see rows above.');
console.log('Evidence class: synthetic source fixture. NOT installed-agent fidelity; does not close CLWX-115.');
process.exit(ok ? 0 : 1);
