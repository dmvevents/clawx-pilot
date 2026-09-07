import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'eval', 'fixtures', 'clwx92-public-pdf-fixture.pdf');
const WORKER_CHECK = path.join(ROOT, 'scripts', 'clwx92-workerenv-check.mjs');
const BUNDLE_VERIFY = path.join(ROOT, 'scripts', 'verify-openclaw-bundle.mjs');

describe('CLWX-92 public PDF bundle fixture', () => {
  it('ships a public fixture and points the worker-env check at it', () => {
    expect(fs.existsSync(FIXTURE)).toBe(true);
    expect(fs.statSync(FIXTURE).size).toBeGreaterThan(1_000);

    const worker = fs.readFileSync(WORKER_CHECK, 'utf8');
    expect(worker).toContain('../eval/fixtures/clwx92-public-pdf-fixture.pdf');
    expect(worker).toContain('CLWX92_SYNTHETIC_PUBLIC_FIXTURE_TEXT');
    expect(worker).not.toContain('skills/laptop/evidence');
    expect(worker).not.toContain('01_Ministry_Circular_ICT_Equipment_Audit.pdf');
  });

  it('makes the bundle gate fail if the public fixture is missing instead of skipping CLWX-92', () => {
    const source = fs.readFileSync(BUNDLE_VERIFY, 'utf8');
    expect(source).toContain("path.join(ROOT, 'eval', 'fixtures', 'clwx92-public-pdf-fixture.pdf')");
    expect(source).toContain('public fixture missing');
    expect(source).not.toContain('utility-env pdf check skipped');
    expect(source).not.toContain('01_Ministry_Circular_ICT_Equipment_Audit.pdf');
  });
});
