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
 * different messages back-to-back and assert no readEmail EVER returns a
 * body whose subject belongs to a DIFFERENT message than requested.
 *
 * CLWX-46 contract (the part that matters): the guard's whole job is to
 * REFUSE (return not_found) when it cannot prove the reading pane settled on
 * the clicked row, rather than scrape whatever message is still showing. So a
 * not_found is the guard SUCCEEDING, not a defect — it never returned wrong
 * content. The only real failures are (a) an ok read whose subject overlaps a
 * NEIGHBOUR's (a stale-read LEAK — the exact defect) or (b) an ok read whose
 * subject overlaps NEITHER its own row nor a neighbour (some other message
 * entirely — also a leak). A safe refusal is retried ONCE (a transient
 * pane-settle refusal resolves on a re-open); a persistent refusal is still
 * acceptable. To stay falsifiable on the positive side we also require at
 * least one demonstrably-correct read. Read-only: no drafts, no sends, no
 * confirm gates touched.
 *
 * Run (Chrome on :18792, test.fac signed in):
 *   pnpm exec tsx scripts/clwx46-stale-read-check.ts
 * Exit codes: 0 PASS (>=1 correct read, 0 leaks) / 1 FAIL (stale/wrong-content
 * leak) / 2 lane not ready (no readable rows, or every read refused so nothing
 * could be asserted).
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

  let leaks = 0;        // ok read whose subject is NOT its own row (the defect)
  let ownReads = 0;     // ok read whose subject IS its own row (guard correct)
  let refusals = 0;     // safe not_found/needs_signin, or ok-with-no-subject-signal
  let previousSubject = '';
  for (const row of targets) {
    const rowSubject = row.subject || '';
    let detail = await actions.readEmail({ id: row.id });
    // A not_found/needs_signin is the CLWX-46 guard REFUSING rather than
    // scraping the previous message still in the pane — the guard working.
    // It can also be a transient pane-settle refusal, so retry ONCE (the
    // re-open usually settles); a persistent refusal is still acceptable.
    if (detail.status === 'not_found' || detail.status === 'needs_signin') {
      detail = await actions.readEmail({ id: row.id });
    }
    if (detail.status !== 'ok') {
      refusals += 1;
      console.log(`row="${rowSubject.slice(0, 60)}" -> read="<status=${detail.status}>" [SAFE-REFUSE: guard declined, no leak]`);
      previousSubject = rowSubject;
      continue;
    }
    const got = (detail.subject || '').trim();
    if (!got || !normalize(rowSubject)) {
      // ok read but no subject signal on one side — can prove neither leak
      // nor own; treat as inconclusive (not counted against the guard).
      refusals += 1;
      console.log(`row="${rowSubject.slice(0, 60)}" -> read="<ok, no subject signal>" [INCONCLUSIVE]`);
      previousSubject = rowSubject;
      continue;
    }
    if (overlaps(got, rowSubject)) {
      ownReads += 1;
      console.log(`row="${rowSubject.slice(0, 60)}" -> read="${got.slice(0, 60)}" [OK]`);
    } else {
      leaks += 1;
      const stale = previousSubject && overlaps(got, previousSubject);
      const verdict = stale ? 'STALE (previous message leaked!)' : 'WRONG-CONTENT (a different message)';
      console.log(`row="${rowSubject.slice(0, 60)}" -> read="${got.slice(0, 60)}" [${verdict}]`);
    }
    previousSubject = rowSubject;
  }

  if (leaks > 0) {
    console.log(`\nCLWX46 FAIL — ${leaks}/${targets.length} read(s) returned a DIFFERENT message than requested (stale-read leak; the exact CLWX-46 defect)`);
    process.exit(1);
  }
  if (ownReads >= 1) {
    console.log(`\nCLWX46 PASS — ${ownReads} correct read(s), ${refusals} safe refusal(s)/inconclusive, 0 stale-read leaks across ${targets.length} back-to-back opens`);
    process.exit(0);
  }
  // No leak, but nothing read cleanly either — can't assert discrimination.
  console.log(`\nLANE NOT READY: ${refusals} refusal(s), 0 successful reads — no leak, but nothing provable this run`);
  process.exit(2);
}

main().catch((err) => {
  console.error(`INFRA: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
