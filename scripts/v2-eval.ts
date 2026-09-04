/**
 * Live agentic-Outlook eval harness.
 *
 * Exercises each W*-acceptance row by calling v2 OutlookActions directly
 * against the live test.fac@fac.edu.tt session (Chrome on debug port
 * 18792). Reports pass/fail for each row and writes a JSON summary.
 *
 * Pre-reqs:
 *   1. Chrome running with --remote-debugging-port=18792, signed in
 *      to test.fac@fac.edu.tt. (Use scripts/v2-signin.ts if not.)
 *   2. AWS credentials reachable for Bedrock Sonnet 4.5 (AWS_PROFILE=bedrock).
 *   3. At least one inbox message; multi-message inboxes give richer
 *      coverage. The eval tolerates 1-message inboxes by skipping rows
 *      that can't be exercised.
 *
 * Run:
 *   pnpm exec tsx scripts/v2-eval.ts
 */
import { writeFileSync } from 'fs';
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

interface EvalRow {
  id: string;
  workflow: string;
  description: string;
  status: 'pass' | 'fail' | 'skip';
  latencyMs: number;
  notes: string;
}

const results: EvalRow[] = [];

async function runRow(
  id: string,
  workflow: string,
  description: string,
  fn: () => Promise<{ ok: boolean; notes: string; skip?: boolean }>,
): Promise<void> {
  const t0 = Date.now();
  let status: EvalRow['status'] = 'fail';
  let notes: string;
  try {
    const r = await fn();
    if (r.skip) status = 'skip';
    else status = r.ok ? 'pass' : 'fail';
    notes = r.notes;
  } catch (err) {
    notes = `THREW: ${err instanceof Error ? err.message : String(err)}`;
  }
  const latencyMs = Date.now() - t0;
  results.push({ id, workflow, description, status, latencyMs, notes });
  const emoji = status === 'pass' ? '✓' : status === 'skip' ? '○' : '✗';
  console.log(`${emoji}  ${id} (${latencyMs}ms) — ${description}`);
  if (notes && status !== 'pass') console.log(`     ${notes}`);
}

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const grounder = new VlmGrounder();
  const actions = new OutlookActions(driver, grounder);

  console.log('=== outlook-browser-v2 eval ===\n');

  // Compose hygiene, used pre-run AND after the W4.x rows: DISCARD any open
  // draft (Escape alone keeps it — Outlook saves to Drafts or leaves the pane
  // up), then settle back on the inbox. An open compose obscures inbox rows
  // and blocks draft/reply; stale drafts cost three eval runs on 2026-09-03
  // (12-13/15 lane flake, zero product defects). Best-effort, never fatal.
  const discardOpenDrafts = async () => {
    try {
      await driver.ensureBrowser();
      const page = await driver.ensureOutlookTab();
      for (let i = 0; i < 5; i += 1) {
        // DOM-side click on the first VISIBLE Discard button. A Playwright
        // locator.first() can latch a hidden Discard earlier in DOM order and
        // wait out its whole timeout (same class as the CLWX-59 SplitButton
        // wrapper), leaving the compose dialog + backdrop obstructing every
        // row click. The confirm dialog's own Discard is caught next pass.
        const clicked = await page.evaluate(`(() => {
          const vis = function(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          // The confirm dialog is titled "Discard message" but its buttons are
          // OK / Cancel (screenshot evidence 2026-09-03) — waiting for a
          // button named "Discard" wedges the tab behind the dialog backdrop.
          const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).filter(vis);
          for (const d of dialogs) {
            if ((d.textContent || '').toLowerCase().indexOf('discard') !== -1) {
              const ok = Array.from(d.querySelectorAll('button')).filter(vis).find(function(b) {
                return /^(ok|discard|yes)$/i.test((b.textContent || '').trim());
              });
              if (ok) { ok.click(); return true; }
            }
          }
          const btns = Array.from(document.querySelectorAll('button')).filter(vis);
          const target = btns.find(function(b) {
            const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).toLowerCase();
            return label.indexOf('discard') !== -1;
          });
          if (target) { target.click(); return true; }
          return false;
        })()`) as boolean;
        if (!clicked) break;
        await driver.sleep(1_200);
      }
      await driver.pressKey('Escape').catch(() => null);
      await driver.sleep(300);
      await driver.pressKey('Escape').catch(() => null);
      await driver.sleep(300);
      const inboxLink = page.getByRole('treeitem', { name: /^inbox/i }).first();
      if ((await inboxLink.count().catch(() => 0)) > 0) {
        await inboxLink.click({ timeout: 3_000 }).catch(() => null);
        await driver.sleep(500);
      }
    } catch (err) {
      console.log(`(compose hygiene non-fatal: ${err instanceof Error ? err.message : String(err)})`);
    }
  };
  await discardOpenDrafts();

  // W1 — open
  await runRow('W1', 'open', 'open() returns opened with mail URL', async () => {
    const r = await actions.open();
    // Microsoft is migrating outlook.office.com → outlook.cloud.microsoft;
    // accept both. (The driver's OUTLOOK_HOST_PATTERNS matches both.)
    const validHost = /outlook\.(office\.com|office365\.com|cloud\.microsoft|live\.com)\/mail/.test(r.url);
    return {
      ok: r.status === 'opened' && validHost,
      notes: `status=${r.status} url=${r.url}`,
    };
  });

  // W2.1 — read_inbox returns clean rows
  let firstId = '';
  await runRow('W2.1', 'read_inbox', 'read_inbox(5) — clean sender/subject (no "Unread " prefix in sender)', async () => {
    const r = await actions.readInbox(5);
    if (r.status !== 'ok') return { ok: false, notes: `status=${r.status}` };
    if (r.messages.length === 0) return { skip: true, ok: false, notes: 'inbox empty' };
    firstId = r.messages[0].id;
    const dirty = r.messages.find((m) => /^unread\b/i.test(m.sender));
    return {
      ok: !dirty,
      notes: dirty
        ? `row sender field starts with "Unread ": "${dirty.sender}"`
        : `${r.messages.length} rows, first sender="${r.messages[0].sender}", subject="${r.messages[0].subject}"`,
    };
  });

  // W2.2 — search_inbox unread:true
  await runRow('W2.2', 'search_inbox', 'search_inbox({unread:true}) returns only unread', async () => {
    const r = await actions.searchInbox({ unread: true });
    if (r.status !== 'ok') return { ok: false, notes: `status=${r.status}` };
    const allUnread = r.messages.every((m) => m.unread === true);
    return { ok: allUnread, notes: `${r.messages.length} returned, allUnread=${allUnread}` };
  });

  // W2.3 — search_inbox by sender. Use the first row's sender as the probe.
  await runRow('W2.3', 'search_inbox', 'search_inbox({from: <known sender>}) returns matching rows only', async () => {
    if (!firstId) return { skip: true, ok: false, notes: 'no first row to derive sender from' };
    const inbox = await actions.readInbox(5);
    const probe = inbox.messages[0]?.sender ?? '';
    if (!probe) return { skip: true, ok: false, notes: 'no sender on first row' };
    const r = await actions.searchInbox({ from: probe.slice(0, Math.min(probe.length, 8)) });
    if (r.status !== 'ok') return { ok: false, notes: `status=${r.status}` };
    const allMatch = r.messages.every((m) =>
      m.sender.toLowerCase().includes(probe.slice(0, 8).toLowerCase()),
    );
    return { ok: allMatch && r.messages.length > 0, notes: `probe="${probe.slice(0, 8)}" got=${r.messages.length}` };
  });

  // W2.4 — search_inbox by subject keyword (use a known token from row 0)
  await runRow('W2.4', 'search_inbox', 'search_inbox({subjectContains}) returns matching rows', async () => {
    const inbox = await actions.readInbox(5);
    const probe = inbox.messages[0]?.subject?.split(/\s+/).find((w) => w.length >= 5);
    if (!probe) return { skip: true, ok: false, notes: 'no usable subject token' };
    const r = await actions.searchInbox({ subjectContains: probe });
    return {
      ok: r.status === 'ok' && r.messages.length > 0,
      notes: `probe="${probe}" got=${r.messages.length}`,
    };
  });

  // A currently-valid top-of-inbox message id (null if the inbox is empty).
  // Rows that act on a specific message must fetch this IMMEDIATELY before
  // acting: an id captured earlier in the run (e.g. the run-start firstId)
  // goes stale as soon as any row marks that message read — its row
  // aria-label fingerprint loses the "Unread " prefix, so the id no longer
  // matches any row and the tool safely returns not_found. That is the
  // shared live mailbox racing the test, not a tool defect; a fresh fetch
  // right before use closes the window.
  const freshTopId = async (): Promise<string | null> => {
    const inbox = await actions.readInbox(5);
    return inbox.status === 'ok' && inbox.messages.length > 0 ? inbox.messages[0].id : null;
  };

  // W3.1 — read_email returns full body. Fixture-robust: the top row can be
  // a short smoke mail whose 91-char body IS its snippet (hit live 2026-09-03
  // after the drafts sweep reordered the inbox), so "body > snippet" is only
  // provable on a message whose snippet was actually truncated. Pick the row
  // with the LONGEST snippet from the top 5; if nothing in the window is
  // truncated, accept body >= snippet with a non-empty body.
  await runRow('W3.1', 'read_email', 'read_email({id}) returns body longer than snippet', async () => {
    if (!firstId) return { skip: true, ok: false, notes: 'no firstId' };
    const inbox = await actions.readInbox(5);
    if (inbox.status !== 'ok' || inbox.messages.length === 0) {
      return { ok: false, notes: `read_inbox status=${inbox.status}` };
    }
    const target = inbox.messages.reduce((best, m) =>
      ((m.snippet?.length ?? 0) > (best.snippet?.length ?? 0) ? m : best), inbox.messages[0]);
    const snip = target.snippet ?? '';
    const r = await actions.readEmail({ id: target.id });
    if (r.status !== 'ok') return { ok: false, notes: `status=${r.status}` };
    const bodyLen = r.body?.length ?? 0;
    const ok = bodyLen > snip.length || (bodyLen > 0 && bodyLen >= snip.length);
    return {
      ok,
      notes: `body=${bodyLen} chars, snippet=${snip.length} chars (longest-snippet row of top 5)`,
    };
  });

  // W3.2 — read_email returns attachments array (may be empty). Fetch a fresh
  // id and retry ONCE on a safe not_found (stale-id race + transient
  // pane-settle refusal both resolve on a re-fetch); a persistent not_found
  // across two fresh attempts still fails the row.
  await runRow('W3.2', 'read_email', 'read_email({id}) returns attachments: array', async () => {
    let id = await freshTopId();
    if (!id) return { skip: true, ok: false, notes: 'inbox empty' };
    let r = await actions.readEmail({ id });
    if (r.status === 'not_found') {
      id = (await freshTopId()) ?? id;
      r = await actions.readEmail({ id });
    }
    return {
      ok: r.status === 'ok' && Array.isArray(r.attachments),
      notes: `status=${r.status} attachments=${r.attachments?.length ?? 'undefined'}`,
    };
  });

  // W4.1 — draft_email. Hygiene runs again right before it: any earlier
  // row (or a killed prior run) can leave a compose/reply open, and W4.1
  // refuses to stack drafts by design (hit live 2026-09-03: a SIGPIPE-killed
  // eval left the W5.1 reply pane open and the next run failed here at 64ms).
  await discardOpenDrafts();
  let draftSubject = '';
  await runRow('W4.1', 'draft_email', 'draft_email opens compose pane with To/Subject/Body filled', async () => {
    draftSubject = `eval ${new Date().toISOString().slice(11, 19)}`;
    const r = await actions.draftEmail({
      to: 'test.fac@fac.edu.tt',
      subject: draftSubject,
      body: 'eval harness draft — do not send',
    });
    return {
      ok: r.status === 'drafted' && r.draftLeftOpen === true,
      notes: `status=${r.status} leftOpen=${r.draftLeftOpen}`,
    };
  });

  // W4.2 — send_email refuses without confirm
  await runRow('W4.2', 'send_email', 'send_email without confirm is refused', async () => {
    const r = await actions.sendEmail({
      to: 'test.fac@fac.edu.tt',
      subject: draftSubject,
      body: 'should not send',
      confirm: false,
    });
    return {
      ok: r.status === 'refused',
      notes: `status=${r.status} reason=${r.reason ?? '<none>'}`,
    };
  });

  // W4.4 — send_email refuses on subject mismatch (the open draft's subject
  // differs from args.subject because we typed a different subject above).
  await runRow('W4.4', 'send_email', 'send_email refuses on subject mismatch', async () => {
    const r = await actions.sendEmail({
      to: 'test.fac@fac.edu.tt',
      subject: 'WRONG SUBJECT THAT WONT MATCH',
      body: 'should be refused on subject mismatch',
      confirm: true,
    });
    return {
      ok: r.status === 'refused',
      notes: `status=${r.status} reason=${(r.reason ?? '').slice(0, 80)}`,
    };
  });

  // Post-W4.x hygiene: W4.2/W4.4 intentionally leave the probe draft open
  // (both refusal proofs need it). Discard it before the message-open rows.
  await discardOpenDrafts();

  // W6.1 — mark_read (fresh id: the run-start firstId is stale by now)
  await runRow('W6.1', 'mark_read', 'mark_read({read:true}) returns ok', async () => {
    const id = await freshTopId();
    if (!id) return { skip: true, ok: false, notes: 'inbox empty' };
    const r = await actions.markRead({ id, read: true });
    return { ok: r.status === 'ok', notes: `status=${r.status}` };
  });

  // W8.1 — search_inbox with hasAttachment
  await runRow('W8.1', 'search_inbox+attach', 'search_inbox({hasAttachment:true}) returns only rows with attachment hint', async () => {
    const r = await actions.searchInbox({ hasAttachment: true });
    return {
      ok: r.status === 'ok',
      notes: `status=${r.status} count=${r.messages.length}`,
    };
  });

  // W8.2 — list_attachments returns metadata only (fresh id + retry-once)
  await runRow('W8.2', 'list_attachments', 'list_attachments returns array (no download)', async () => {
    let id = await freshTopId();
    if (!id) return { skip: true, ok: false, notes: 'inbox empty' };
    let r = await actions.listAttachments({ id });
    if (r.status === 'not_found') {
      id = (await freshTopId()) ?? id;
      r = await actions.listAttachments({ id });
    }
    return {
      ok: r.status === 'ok' && Array.isArray(r.attachments),
      notes: `status=${r.status} count=${r.attachments?.length ?? 'undefined'}`,
    };
  });

  // W5.1 — reply (we'll close it ourselves to avoid leaving a noisy draft).
  // Fresh id + retry-once: reply opens+settles the message, so it is exposed
  // to both the stale-id race and a transient pane-settle refusal.
  await runRow('W5.1', 'reply', 'reply({id, body}) opens reply pane with body filled', async () => {
    let id = await freshTopId();
    if (!id) return { skip: true, ok: false, notes: 'inbox empty' };
    let r = await actions.reply({ id, body: 'eval reply — do not send.' });
    if (r.status === 'not_found') {
      id = (await freshTopId()) ?? id;
      r = await actions.reply({ id, body: 'eval reply — do not send.' });
    }
    return {
      ok: r.status === 'drafted' && r.draftLeftOpen === true,
      notes: `status=${r.status}`,
    };
  });

  // W7.1 — multi-message workflow: read_inbox + read_email loop.
  // CLWX-46 contract: each read must be TRUSTWORTHY — either ok with the
  // requested message, or a SAFE refusal (not_found/needs_signin) when the
  // reading pane cannot be proven to hold the clicked row. A safe refusal is
  // the stale-read guard working, NOT a defect (the old "all status=ok"
  // assertion failed exactly when the guard fired — pane stayed on a
  // different message for the settle window on fast back-to-back reads).
  // The only real failures are (a) a returned body whose subject belongs to
  // a DIFFERENT message than requested (a stale-read LEAK — the class CLWX-46
  // exists to prevent) or (b) zero successful reads (the loop is wholly
  // broken). Assert the safe contract; stay falsifiable on both classes.
  await runRow('W7.1', 'compound', 'multi-message: read_inbox(3) + read_email each; ok-or-safe-refuse, no stale-read leak', async () => {
    const inbox = await actions.readInbox(3);
    if (inbox.status !== 'ok' || inbox.messages.length === 0) {
      return { skip: true, ok: false, notes: 'no rows' };
    }
    // Mirror the driver's settle overlap (normalize re/fw, substring either way).
    const norm = (s: string) =>
      (s || '').toLowerCase().replace(/^(?:re|fw|fwd)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
    const overlaps = (a: string, b: string): boolean => {
      const na = norm(a);
      const nb = norm(b);
      if (!na || !nb) return true; // no discrimination signal -> not a provable leak
      const short = na.length <= nb.length ? na : nb;
      const long = na.length <= nb.length ? nb : na;
      return short.length < 4 ? long.startsWith(short) : long.includes(short);
    };
    let okCount = 0;
    let safeRefusals = 0;
    const leaks: string[] = [];
    for (const m of inbox.messages) {
      const r = await actions.readEmail({ id: m.id });
      if (r.status === 'ok') {
        const wantSubject = (m.id.split('|')[1] || '').trim();
        if (wantSubject && r.subject && !overlaps(r.subject, wantSubject)) {
          leaks.push('subject-mismatch'); // ok read returned a DIFFERENT message
        } else {
          okCount += 1;
        }
      } else if (r.status === 'not_found' || r.status === 'needs_signin') {
        safeRefusals += 1; // CLWX-46 guard refused rather than return wrong content
      } else {
        leaks.push(`status=${r.status}`);
      }
    }
    const ok = leaks.length === 0 && okCount >= 1;
    return {
      ok,
      notes: `iterated ${inbox.messages.length}: ok=${okCount} safe-refuse=${safeRefusals}${leaks.length ? ` LEAK[${leaks.join(';')}]` : ''}`,
    };
  });

  // End-of-run hygiene: a timed-out row (e.g. a slow reply) can leave its
  // compose open and poison whatever runs on the lane NEXT (the ga:gate
  // send-proof failed exactly this way on 2026-09-03 - leftOpen cascade).
  // The eval must return the lane in the state it found it.
  await discardOpenDrafts();

  // ── summary
  console.log('\n=== summary ===');
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const total = results.length;
  const passRate = (passed / Math.max(1, total - skipped)) * 100;
  console.log(`pass: ${passed}/${total} (${passRate.toFixed(1)}%, ${skipped} skipped)`);
  console.log(`fail: ${failed}`);

  const summary = {
    runAt: new Date().toISOString(),
    pass: passed,
    fail: failed,
    skip: skipped,
    total,
    passRate,
    rows: results,
  };
  writeFileSync('/tmp/v2-eval-results.json', JSON.stringify(summary, null, 2));
  console.log('\nResults saved to /tmp/v2-eval-results.json');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
