import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { getChangedFiles } from '../../harness/src/git.mjs';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

// Best-effort cleanup that tolerates Windows holding pack/idx handles open
// briefly after `git` exits. We never let temp-dir cleanup fail the test;
// the assertion above is the contract under test, the temp dir is housekeeping.
async function cleanupRepo(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`harness-git test: temp dir cleanup failed (non-fatal): ${dir}`, err);
  }
}

describe('harness git changed files', () => {
  it('includes staged tracked files when collecting changed paths', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'clawx-harness-git-'));
    const harnessDir = path.join(repo, 'harness', 'src');

    try {
      await mkdir(harnessDir, { recursive: true });
      await writeFile(path.join(repo, 'tracked.txt'), 'before\n');
      await git(repo, ['init']);
      await git(repo, ['config', 'user.email', 'test@example.com']);
      await git(repo, ['config', 'user.name', 'Test']);
      await git(repo, ['add', 'tracked.txt']);
      await git(repo, ['commit', '-m', 'init']);

      await writeFile(path.join(repo, 'tracked.txt'), 'after\n');
      await git(repo, ['add', 'tracked.txt']);

      const changed = await getChangedFiles('HEAD', repo);

      expect(changed).toContain('tracked.txt');
    } finally {
      await cleanupRepo(repo);
    }
  }, 30_000);
});
