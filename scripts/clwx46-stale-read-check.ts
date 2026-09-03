/**
 * CLWX-46 stale-read acceptance check.
 *
 * The defect: readEmail could scrape the PREVIOUS message still sitting in
 * the reading pane (stale body/subject for the clicked row) — the trust-
 * killer class surfaced by the RAJ-2 fidelity run. The fix is TB-1 (settle-
 * on-expected-item guard after the row click) + TB-2 (pane-scoped subject
 * selector with rotation fallbacks; the old document-wide query latched the
 * screen-reader heading "Navigation pane").
 *
 * This check is the exact stale scenario: read the inbox, then open THREE
 * different messages back-to-back and assert every readEmail result's
 * subject belongs to its own row (mutual token overlap), never a neighbour's.
 * Read-only: no drafts, no sends, no confirm gates touched.
 *
 * Run (Chrome on :18792, test.fac signed in):
 *   pnpm exec tsx scripts/clwx46-stale-read-check.ts
 * Exit codes: 0 PASS / 1 FAIL (stale or mismatched read) / 2 lane not ready.
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

const normalize = (s: string) =>
  s.toLowerCase().replace(/^(?:re|fw|fwd)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
const overlaps = (a: string, b: string) => {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  if (short.length < 4) return long.startsWith(short);
  return long.includes(short);
};

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const grounder = new VlmGrounder();
  const actions = new OutlookActions(driver, grounder);

  const inbox = await actions.readInbox(5);
  if (inbox.status !== 'ok' || inbox.messages.length < 2) {
    console.log(`LANE NOT READY: read_inbox status=${inbox.status} rows=${inbox.messages?.length ?? 0}`);
    process.exit(2);
  }

  // Up to 3 distinct rows, preferring distinct subjects so a stale pane is
  // unambiguously detectable.
  const seen = new Set<string>();
  const targets = inbox.messages.filter((m) => {
    const key = normalize((m.subject || '').slice(0, 60));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
  if (targets.length < 2) {
    console.log('LANE NOT READY: fewer than 2 distinct-subject rows in the top 5');
    process.exit(2);
  }

  let failures = 0;
  let previousSubject = '';
  for (const row of targets) {
    const detail = await actions.readEmail({ id: row.id });
    const rowSubject = row.subject || '';
    const got = detail.status === 'ok' ? (detail.subject || '') : `<status=${detail.status}>`;
    const own = detail.status === 'ok' && overlaps(got, rowSubject);
    const stale = detail.status === 'ok' && previousSubject
      && !own && overlaps(got, previousSubject);
    const verdict = own ? 'OK' : stale ? 'STALE (previous message leaked!)' : 'MISMATCH';
    if (!own) failures += 1;
    console.log(`row="${rowSubject.slice(0, 60)}" -> read="${got.slice(0, 60)}" [${verdict}]`);
    previousSubject = rowSubject;
  }

  if (failures === 0) {
    console.log(`\nCLWX46 PASS — ${targets.length}/${targets.length} consecutive reads returned their own message`);
    process.exit(0);
  }
  console.log(`\nCLWX46 FAIL — ${failures}/${targets.length} reads did not match their row`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`INFRA: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
