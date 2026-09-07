/**
 * Is there a real, driveable Outlook TAB in the attached Chrome session?
 *
 * Used by the GA gate (scripts/ga-gate.mjs) to decide whether the email rows can
 * run at all, so a wrong answer is expensive in both directions: a false yes
 * turns a lane condition into product FAILs, a false no hides missing coverage.
 *
 * The first version of this probe was `curl … /json/list | grep -qiE 'https://outlook[.](office|cloud|…)[.]'`
 * over the raw JSON, which the Codex adversarial review (2026-09-07) broke three
 * ways: it matched non-page targets (a service worker for Outlook is not a tab
 * the driver can use), it matched ANY field (an unrelated page whose title or
 * query string quoted an Outlook URL), and the unanchored host pattern matched
 * look-alikes like `outlook.office.example`. So: parse the JSON, require
 * `type === 'page'`, and compare the parsed hostname against an exact allowlist —
 * the same hosts the driver itself accepts (playwright-driver.ts
 * OUTLOOK_HOST_PATTERNS).
 *
 * Exit 0 = an Outlook tab is present. Exit 1 = not present (or CDP unreachable).
 * Prints one line either way; never prints mailbox content or URLs beyond host.
 * Callers must key on the printed `outlook-tab: present` token, not on exit 0
 * alone — see the main-module guard at the bottom for why that mattered.
 */
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CDP = process.env.CLAWX_CDP_ENDPOINT || 'http://127.0.0.1:18792';

/**
 * Exact hosts, not substrings. Mirrors the driver's accepted Outlook entrypoints
 * (playwright-driver.ts OUTLOOK_HOST_PATTERNS) — tests/unit/probe-outlook-tab
 * .test.ts asserts the two lists agree, because a probe that accepts a host the
 * driver refuses reports a usable tab the driver will never use.
 * Work accounts only: consumer `outlook.live.com` is deliberately absent.
 */
export const OUTLOOK_HOSTS = new Set([
  'outlook.office.com',
  'outlook.office365.com',
  'outlook.cloud.microsoft',
]);

export function isOutlookTabTarget(target) {
  if (!target || target.type !== 'page') return false;
  let url;
  try {
    url = new URL(String(target.url ?? ''));
  } catch {
    return false;
  }
  // https only: an http:// look-alike is not the tenant's Outlook.
  if (url.protocol !== 'https:') return false;
  return OUTLOOK_HOSTS.has(url.hostname.toLowerCase());
}

export function findOutlookTab(targets) {
  return Array.isArray(targets) ? targets.find(isOutlookTabTarget) : undefined;
}

// Only run the network leg when executed directly, so the predicates above stay
// unit-testable without touching CDP.
//
// This guard was `import.meta.url === \`file://${process.argv[1]}\``, which is
// right only by accident of the path it happens to run from. It holds for a plain
// ASCII, symlink-free POSIX path (this repo's), and silently fails to fire for:
//   - Windows          — `file://C:\…\probe.mjs` is not `file:///C:/…/probe.mjs`,
//                        and Windows is the pilot platform;
//   - any path needing percent-encoding (a space, an accent) — import.meta.url
//                        encodes, argv[1] does not;
//   - a symlinked checkout — import.meta.url is realpath'd, argv[1] is not.
// In every one of those the script does nothing at all and exits 0, and a caller
// keying on the exit code alone reads that as "an Outlook tab is present" — the
// fix for one false-green quietly shipping another. Hence the positive-token
// contract above, and the same idiom the sibling scripts already use
// (pathToFileURL + realpathSync, e.g. scripts/harness-artifact.mjs).
function invokedDirectly() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(path.resolve(argv1))).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5_000);
  try {
    const res = await fetch(`${CDP}/json/list`, { signal: ac.signal });
    if (!res.ok) {
      console.log(`no-outlook-tab: CDP /json/list returned HTTP ${res.status}`);
      process.exit(1);
    }
    const hit = findOutlookTab(await res.json());
    if (hit) {
      console.log(`outlook-tab: present (${new URL(hit.url).hostname})`);
      process.exit(0);
    }
    console.log('no-outlook-tab: CDP is up but no page-type target on an Outlook host');
    process.exit(1);
  } catch (err) {
    console.log(`no-outlook-tab: CDP probe failed (${err instanceof Error ? err.message : String(err)})`);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}
