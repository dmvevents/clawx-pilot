// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs probe script, no types by design (it must stay
// runnable as `node scripts/probe-outlook-tab.mjs` from the gate).
import { findOutlookTab, isOutlookTabTarget, OUTLOOK_HOSTS } from '../../scripts/probe-outlook-tab.mjs';
import { isOutlookUrl } from '../../electron/services/outlook-browser-v2/playwright-driver';

// Most rows here are fixtures the ORIGINAL grep-over-raw-JSON probe accepted
// (Codex adversarial review, 2026-09-07) — each one would have let the GA gate
// report a usable Outlook tab where none existed. The rest pin what a probe
// asserting a lane fact must never get wrong: agreement with the driver it is
// speaking for, and actually running when invoked.
describe('probe-outlook-tab target validation', () => {
  it('accepts a real Outlook page target on each supported host', () => {
    for (const host of ['outlook.office.com', 'outlook.office365.com', 'outlook.cloud.microsoft']) {
      expect(isOutlookTabTarget({ type: 'page', url: `https://${host}/mail/0/` })).toBe(true);
    }
  });

  // A probe that accepts a host the driver refuses claims a tab the driver will
  // never drive; the reverse hides a tab that is right there. Two lists, one truth.
  it('agrees with the driver on exactly which hosts are Outlook', () => {
    for (const host of OUTLOOK_HOSTS) {
      expect(isOutlookUrl(`https://${host}/mail/0/`)).toBe(true);
    }
    // Consumer Outlook is refused by BOTH: this product is tenant-only, and
    // adopting a personal mailbox would point read/draft/send at the wrong account.
    expect(isOutlookTabTarget({ type: 'page', url: 'https://outlook.live.com/mail/0/' })).toBe(false);
    expect(isOutlookUrl('https://outlook.live.com/mail/0/')).toBe(false);
  });

  it('rejects a service worker for Outlook — not a tab the driver can drive', () => {
    expect(isOutlookTabTarget({ type: 'service_worker', url: 'https://outlook.office.com/sw.js' })).toBe(false);
    expect(isOutlookTabTarget({ type: 'iframe', url: 'https://outlook.office.com/mail/0/' })).toBe(false);
  });

  it('rejects a look-alike host', () => {
    expect(isOutlookTabTarget({ type: 'page', url: 'https://outlook.office.example.com/mail/' })).toBe(false);
    expect(isOutlookTabTarget({ type: 'page', url: 'https://outlook.office.evil.tt/mail/' })).toBe(false);
    expect(isOutlookTabTarget({ type: 'page', url: 'https://notoutlook.office.com/mail/' })).toBe(false);
  });

  it('rejects an unrelated page that merely quotes an Outlook URL', () => {
    expect(isOutlookTabTarget({
      type: 'page',
      title: 'How to open https://outlook.office.com/mail/',
      url: 'https://help.example.com/article?next=https://outlook.office.com/mail/',
    })).toBe(false);
  });

  it('rejects http and malformed URLs', () => {
    expect(isOutlookTabTarget({ type: 'page', url: 'http://outlook.office.com/mail/' })).toBe(false);
    expect(isOutlookTabTarget({ type: 'page', url: 'not-a-url' })).toBe(false);
    expect(isOutlookTabTarget({ type: 'page' })).toBe(false);
    expect(isOutlookTabTarget(undefined)).toBe(false);
  });

  // The probe's whole value is that a caller can act on its answer, so "did it
  // run at all" needs pinning. Unreachable CDP is the cheapest proof: the network
  // leg must SAY no and exit 1, never exit 0 in silence (which a caller keying on
  // the exit code reads as "an Outlook tab is present").
  function runProbe(script: string) {
    return spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, CLAWX_CDP_ENDPOINT: 'http://127.0.0.1:1' },
    });
  }

  it('runs its network leg when invoked directly, and reports absence', () => {
    const r = runProbe(path.resolve('scripts/probe-outlook-tab.mjs'));
    expect(r.stdout).toMatch(/^no-outlook-tab:/);
    expect(r.status).toBe(1);
  });

  // The row above passes even with a `import.meta.url === \`file://${argv[1]}\``
  // guard, because that comparison happens to hold for a plain ASCII, symlink-free
  // POSIX path. It breaks where the two forms diverge — percent-encoded paths, and
  // Windows (`file://C:\…` vs `file:///C:/…`), which is the PILOT platform. A path
  // with a space reproduces that divergence on this machine, so the guard is pinned
  // by behaviour rather than by trusting the happy path.
  it('still runs from a path that needs percent-encoding (Windows/spaces class)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ga gate probe '));
    const copy = path.join(dir, 'probe-outlook-tab.mjs');
    try {
      copyFileSync(path.resolve('scripts/probe-outlook-tab.mjs'), copy);
      const r = runProbe(copy);
      expect(r.stdout).toMatch(/^no-outlook-tab:/);
      expect(r.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('findOutlookTab picks the tab out of a realistic target list', () => {
    const targets = [
      { type: 'service_worker', url: 'https://outlook.office.com/sw.js' },
      { type: 'page', url: 'https://www.youtube.com/watch?v=abc' },
      { type: 'page', url: 'https://outlook.cloud.microsoft/mail/0/' },
    ];
    expect(findOutlookTab(targets)?.url).toBe('https://outlook.cloud.microsoft/mail/0/');
    expect(findOutlookTab([targets[0], targets[1]])).toBeUndefined();
    expect(findOutlookTab(null)).toBeUndefined();
  });
});
