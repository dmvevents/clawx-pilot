// @vitest-environment node
// CLWX-84 guards: (a) the pilot CDP probe must never carry recipient/subject/body
// as process arguments (argv is visible to any local process listing); (b) the
// security-credential grep gate must detect credential shapes without ever
// printing the matched text.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

const ps1Path = 'windows-pilot/scripts/pilot-run-electron-cdp-probe.ps1';
const jsPath = 'windows-pilot/scripts/pilot-electron-cdp-probe.js';
const gatePath = 'scripts/security-credential-grep.sh';

describe('CLWX-84 probe payload contract', () => {
  it('ps1 wrapper never places recipient/subject/body on argv', () => {
    const ps1 = read(ps1Path);
    expect(ps1).not.toContain('--email-to');
    expect(ps1).not.toContain('--email-subject');
    expect(ps1).not.toContain('--email-body');
    expect(ps1).toContain('--email-payload-file');
  });

  it('ps1 wrapper writes the payload BOM-less and deletes it afterwards', () => {
    const ps1 = read(ps1Path);
    // PS 5.1 Set-Content -Encoding UTF8 writes a BOM that breaks JSON.parse.
    expect(ps1).toContain('UTF8Encoding($false)');
    expect(ps1).toMatch(/finally\s*\{[\s\S]*Remove-Item -Force \$payloadPath/);
  });

  it('js probe reads the payload file and no longer accepts email argv flags', () => {
    const js = read(jsPath);
    expect(js).toContain("'--email-payload-file'");
    expect(js).not.toContain("'--email-to'");
    expect(js).not.toContain("'--email-subject'");
    expect(js).not.toContain("'--email-body'");
    expect(js).toContain('EMAIL_PAYLOAD_FILE_UNREADABLE');
  });

  it('laptop knowledge-pack mirrors stay byte-identical to the canonical scripts', () => {
    expect(read('skills/laptop/scripts/pilot-run-electron-cdp-probe.ps1')).toBe(read(ps1Path));
    expect(read('skills/laptop/scripts/pilot-electron-cdp-probe.js')).toBe(read(jsPath));
  });

  it('js probe exits 6 on an unreadable payload file without echoing payload content', () => {
    const result = spawnSync(
      process.execPath,
      [join(root, jsPath), '--draft-email', '--email-payload-file', '/nonexistent-clwx84-guard.json'],
      { encoding: 'utf8', timeout: 15_000 },
    );
    expect(result.status).toBe(6);
    expect(`${result.stdout}${result.stderr}`).toContain('EMAIL_PAYLOAD_FILE_UNREADABLE');
  });

  it('js probe --help exits 0 and documents the payload file', () => {
    const result = spawnSync(process.execPath, [join(root, jsPath), '--help'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--email-payload-file');
  });
});

describe('CLWX-84 credential grep gate', () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'clwx84-gate-'));
  const cleanDir = mkdtempSync(join(tmpdir(), 'clwx84-gate-clean-'));

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(cleanDir, { recursive: true, force: true });
  });

  // Fixture literals are concatenated so this source file itself never
  // contains a credential-shaped string.
  const fixtureCred = 'XyzFixture@' + '1234';

  it('flags credential shapes with counts only, never the matched text', () => {
    writeFileSync(join(fixtureDir, 'chat.log'), `note the login ${fixtureCred} shared in chat\n`);
    const result = spawnSync('bash', [join(root, gatePath), fixtureDir], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('HIT:');
    expect(result.stdout).not.toContain(fixtureCred);
  });

  it('excuses env-indirection password assignments but not co-located plaintext values', () => {
    const envOnlyDir = mkdtempSync(join(tmpdir(), 'clwx84-gate-env-'));
    const mixedDir = mkdtempSync(join(tmpdir(), 'clwx84-gate-mixed-'));
    try {
      writeFileSync(
        join(envOnlyDir, 'code.js'),
        'const db = { password: process.env.PG_PASSWORD };\n// shell: password=$PILOT_TEST_PASSWORD\n',
      );
      const envOnly = spawnSync('bash', [join(root, gatePath), envOnlyDir], {
        encoding: 'utf8',
        timeout: 15_000,
      });
      expect(envOnly.status).toBe(0);

      // A resolved plaintext value on the same line as an env reference must
      // still count — the allowlist applies only to the password-kv pattern.
      writeFileSync(
        join(mixedDir, 'trace.log'),
        `resolved $PILOT_TEST_PASSWORD to ${fixtureCred} during setup\n`,
      );
      const mixed = spawnSync('bash', [join(root, gatePath), mixedDir], {
        encoding: 'utf8',
        timeout: 15_000,
      });
      expect(mixed.status).toBe(1);
      expect(mixed.stdout).not.toContain(fixtureCred);
    } finally {
      rmSync(envOnlyDir, { recursive: true, force: true });
      rmSync(mixedDir, { recursive: true, force: true });
    }
  });

  it('passes clean on a directory without credential shapes', () => {
    writeFileSync(join(cleanDir, 'chat.log'), 'meet at 3:45pm, up 100% done, ok raj@moe.gov.tt\n');
    const result = spawnSync('bash', [join(root, gatePath), cleanDir], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('RESULT: clean');
  });

  it('gate, guard, and board-exporter sources contain no credential-shaped literal', () => {
    // Generic shape assertions only — never a value-derived pattern, which
    // would itself re-leak the credential into committed source. The board
    // exporter is included because its REDACT_PATTERNS once embedded the
    // leaked test.fac password verbatim as its own redaction regex.
    const sources = [
      read(gatePath),
      read('tests/unit/clwx84-hygiene-guards.test.ts'),
      read('scripts/plane-board-export.mjs'),
    ];
    for (const content of sources) {
      expect(content).not.toMatch(/[A-Za-z][A-Za-z0-9]{2,}@[0-9]{4}([^0-9A-Za-z]|$)/);
      expect(content).not.toMatch(/[A-Z][a-z]+[A-Z][A-Za-z]+[0-9]{2,}%/);
    }
  });
});
