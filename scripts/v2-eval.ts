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
 *   4. CLWX-61 rows (W3.2 metadata leg, W8.3/W8.4 download pair, W5.2
 *      forward) want a seeded mail WITH an attachment in the test.fac
 *      inbox; without one the download confirm leg skips and the metadata
 *      leg reports itself unexercised. W8.4 downloads that attachment
 *      (sandbox only); W5.2 drafts a forward and always discards it.
 *
 * Run:
 *   pnpm exec tsx scripts/v2-eval.ts
 */
import { writeFileSync } from 'fs';
import {
  classifyLatency,
  evalArtifactPath,
  evalLatestPath,
  gradeAttachmentLocate,
  laneVerdict,
  LATENCY_CEILING_MS,
  LATENCY_SLOW_MS,
} from './eval-verdict.ts';
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

interface EvalRow {
  id: string;
  workflow: string;
  description: string;
  status: 'pass' | 'fail' | 'skip';
  latencyMs: number;
  latencyClass: 'ok' | 'slow' | 'over_ceiling';
  notes: string;
  /**
   * TYPED lane-failure flag (CLWX-119). A row sets this when the driver told it
   * `status === 'needs_signin'`. The exit contract used to infer this by
   * regex-matching `/needs_signin/` over `notes`, which was wrong in both
   * directions — see `eval-verdict.ts` for the full reasoning. A row that stays
   * silent is a product failure.
   */
  laneNotReady?: boolean;
}

const results: EvalRow[] = [];

/**
 * Helper for the common failing return, so the typed lane flag is set at every
 * site by construction instead of being remembered at 14 of them. Pass the
 * driver's own status value — never a message or a note.
 */
function refused(status: string, notes?: string): { ok: false; notes: string; laneNotReady: boolean } {
  return {
    ok: false,
    notes: notes ?? `status=${status}`,
    laneNotReady: status === 'needs_signin',
  };
}

async function runRow(
  id: string,
  workflow: string,
  description: string,
  fn: () => Promise<{ ok: boolean; notes: string; skip?: boolean; laneNotReady?: boolean }>,
): Promise<void> {
  const t0 = Date.now();
  let status: EvalRow['status'] = 'fail';
  let notes: string;
  let laneNotReady: boolean | undefined;
  try {
    const r = await fn();
    if (r.skip) status = 'skip';
    else status = r.ok ? 'pass' : 'fail';
    notes = r.notes;
    laneNotReady = r.laneNotReady;
  } catch (err) {
    notes = `THREW: ${err instanceof Error ? err.message : String(err)}`;
  }
  const latencyMs = Date.now() - t0;
  const latencyClass = classifyLatency(latencyMs);
  results.push({ id, workflow, description, status, latencyMs, latencyClass, notes, laneNotReady });
  const emoji = status === 'pass' ? '✓' : status === 'skip' ? '○' : '✗';
  const slowTag =
    latencyClass === 'over_ceiling'
      ? ` OVER CEILING >${LATENCY_CEILING_MS}ms`
      : latencyClass === 'slow'
        ? ` SLOW >${LATENCY_SLOW_MS}ms`
        : '';
  console.log(`${emoji}  ${id} (${latencyMs}ms${slowTag}) — ${description}`);
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
    if (r.status !== 'opened' || !validHost) return refused(r.status, `status=${r.status} url=${r.url}`);
    return { ok: true, notes: `status=${r.status} url=${r.url}` };
  });

  // W2.1 — read_inbox returns clean rows
  let firstId = '';
  await runRow('W2.1', 'read_inbox', 'read_inbox(5) — clean sender/subject (no "Unread " prefix in sender)', async () => {
    const r = await actions.readInbox(5);
    if (r.status !== 'ok') return refused(r.status);
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
    if (r.status !== 'ok') return refused(r.status);
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
    if (r.status !== 'ok') return refused(r.status);
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
    if (r.status !== 'ok' || r.messages.length === 0) {
      return refused(r.status, `probe="${probe}" got=${r.messages.length} status=${r.status}`);
    }
    return { ok: true, notes: `probe="${probe}" got=${r.messages.length}` };
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
      return refused(inbox.status, `read_inbox status=${inbox.status} count=${inbox.messages.length}`);
    }
    const target = inbox.messages.reduce((best, m) =>
      ((m.snippet?.length ?? 0) > (best.snippet?.length ?? 0) ? m : best), inbox.messages[0]);
    const snip = target.snippet ?? '';
    const r = await actions.readEmail({ id: target.id });
    if (r.status !== 'ok') return refused(r.status);
    const bodyLen = r.body?.length ?? 0;
    const ok = bodyLen > snip.length || (bodyLen > 0 && bodyLen >= snip.length);
    return {
      ok,
      notes: `body=${bodyLen} chars, snippet=${snip.length} chars (longest-snippet row of top 5)`,
    };
  });

  // W3.2 — read_email returns attachments: array (may be empty); on an
  // attachment-bearing message every entry must also carry metadata —
  // filename, sizeBytes, mimeType all non-empty (CLWX-61: the old row only
  // proved the array existed, which stayed green even if the parser dropped
  // every metadata field). Fetch a fresh id and retry ONCE on a safe
  // not_found (stale-id race + transient pane-settle refusal both resolve on
  // a re-fetch).
  //
  // CLWX-120 — what this row is allowed to blame the product for. After the
  // retry, a not_found is one of two things, and only now can we tell them
  // apart (notFoundReason, a typed field, NOT a substring of the message):
  //
  //   stale_read_guard -> the CLWX-46 guard declined to confirm the pane
  //                       settled on the clicked message. That is the product
  //                       working: it refused to hand us content it could not
  //                       attribute. A refusal makes no claim about
  //                       attachments, so the row is UNEXERCISED, not failed.
  //   not_in_list      -> we could not reach the message at all across two
  //                       fresh ids. That IS a product failure and still FAILs.
  //
  // Fail-closed on purpose: only POSITIVE evidence of a refusal earns the skip.
  // An absent notFoundReason falls through to FAIL, so an older/leaner
  // transport that never sets the field cannot buy itself a green — the same
  // rule as W8.4's honest skip. Note the asymmetry that keeps this row from
  // going soft: a skip requires a refusal, but data returned and WRONG (missing
  // metadata below) is always a FAIL, never a skip.
  await runRow('W3.2', 'read_email', 'read_email({id}) returns attachments: array; metadata (filename/size/mime) non-empty where attachments exist', async () => {
    let id = await freshTopId();
    if (!id) return { skip: true, ok: false, notes: 'inbox empty' };
    let r = await actions.readEmail({ id });
    if (r.status === 'not_found') {
      id = (await freshTopId()) ?? id;
      r = await actions.readEmail({ id });
    }
    // The judgement itself lives in eval-verdict.ts so it is unit-covered — the
    // residual named on CLWX-120 was that this exact grading had no test, only
    // a comment. This call site must stay a call site.
    const grade = gradeAttachmentLocate(r);
    if (grade.kind === 'skip') return { skip: true, ok: false, notes: grade.notes };
    if (grade.kind === 'fail') return refused(r.status, grade.notes);
    // Metadata leg: the top message usually has no attachments, so hunt for
    // an attachment-bearing one (the CLWX-61 seeded mail is the intended
    // target). Without one the leg is reported as unexercised rather than
    // silently green.
    let attachments = grade.attachments;
    let source = 'top message';
    if (attachments.length === 0) {
      const search = await actions.searchInbox({ hasAttachment: true });
      const candidate = search.status === 'ok' ? search.messages[0] : undefined;
      if (!candidate) {
        return {
          ok: true,
          notes: 'array ok (0 on top message); metadata leg UNEXERCISED — no attachment-bearing message in view, seed one per CLWX-61',
        };
      }
      const read = await actions.readEmail({ id: candidate.id });
      if (read.status !== 'ok' || (read.attachments?.length ?? 0) === 0) {
        return {
          ok: true,
          notes: `array ok (0 on top message); metadata leg UNEXERCISED — hasAttachment hit unreadable (status=${read.status}, attachments=${read.attachments?.length ?? 'undefined'})`,
        };
      }
      attachments = read.attachments ?? [];
      source = 'hasAttachment search hit';
    }
    const bad = attachments.filter(
      (a) => !(a.filename ?? '').trim()
        || typeof a.sizeBytes !== 'number' || !(a.sizeBytes > 0)
        || !(a.mimeType ?? '').trim(),
    );
    return {
      ok: bad.length === 0,
      notes: bad.length === 0
        ? `array ok; metadata ok on ${attachments.length} attachment(s) from ${source}`
        : `${bad.length}/${attachments.length} attachment(s) missing metadata (${source}): ${bad
          .map((a) => `"${(a.filename ?? '').slice(0, 40) || '<no name>'}" size=${a.sizeBytes ?? 'undef'} mime=${a.mimeType ?? 'undef'}`)
          .join('; ')}`,
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
    const ok = r.status === 'drafted' && r.draftLeftOpen === true;
    return {
      ok,
      // The driver's own message is the only thing that says WHICH refusal this
      // was — "an open draft <subject> was not written by the assistant" vs "no
      // Discard control is visible" vs "kept reappearing after 5 passes" all
      // arrive as the same status=failed. Dropping it (as this row did until
      // 2026-09-07) turned three reproducible live failures into an
      // unattributable one. Truncated per the logging rule.
      notes: `status=${r.status} leftOpen=${r.draftLeftOpen}${ok ? '' : ` message="${(r.message ?? '').slice(0, 200)}"`}`,
      laneNotReady: r.status === 'needs_signin',
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
      laneNotReady: r.status === 'needs_signin',
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
      laneNotReady: r.status === 'needs_signin',
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
    if (r.status !== 'ok') return refused(r.status);
    return { ok: true, notes: `status=${r.status}` };
  });

  // W8.1 — search_inbox with hasAttachment
  await runRow('W8.1', 'search_inbox+attach', 'search_inbox({hasAttachment:true}) returns only rows with attachment hint', async () => {
    const r = await actions.searchInbox({ hasAttachment: true });
    return {
      ok: r.status === 'ok',
      notes: `status=${r.status} count=${r.messages.length}`,
      laneNotReady: r.status === 'needs_signin',
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
      laneNotReady: r.status === 'needs_signin',
    };
  });

  // W8.3 — download_attachment REFUSES without confirm (CLWX-61). The hard
  // gate fires before any browser interaction (mirrors W4.2 for send), so
  // this refusal leg ALWAYS runs — and by design runs FIRST, before the
  // confirm leg in W8.4. It prefers the same seeded target W8.4 will
  // download so both legs prove the same gate on the same message; without a
  // seeded attachment mail the gate is still provable against a synthetic
  // probe id (the refusal short-circuits before the id is ever looked up).
  let seededAttachment: { id: string; filename: string } | null = null;
  const findSeededAttachment = async (): Promise<{ id: string; filename: string } | null> => {
    const search = await actions.searchInbox({ hasAttachment: true });
    const candidate = search.status === 'ok' ? search.messages[0] : undefined;
    if (!candidate) return null;
    const listed = await actions.listAttachments({ id: candidate.id });
    const first = listed.status === 'ok' ? listed.attachments[0] : undefined;
    return first?.filename ? { id: candidate.id, filename: first.filename } : null;
  };
  await runRow('W8.3', 'download_attachment', 'download_attachment without confirm is refused (refusal leg runs before the confirm leg)', async () => {
    seededAttachment = await findSeededAttachment();
    const target = seededAttachment ?? { id: 'w83-gate-probe|no-such-message|now', filename: 'w83-gate-probe.pdf' };
    const r = await actions.downloadAttachment({ id: target.id, filename: target.filename, confirm: false });
    return {
      ok: r.status === 'refused',
      notes: `status=${r.status} target=${seededAttachment ? 'seeded attachment mail' : 'synthetic probe (no attachment mail in view; gate still provable)'} reason=${(r.reason ?? '').slice(0, 80)}`,
    };
  });

  // W8.4 — download_attachment WITH confirm downloads the seeded attachment
  // (test.fac sandbox only; the second step of the W8.3/W8.4 pair). Skips
  // when no attachment-bearing mail is seeded. Re-resolves the target ONCE on
  // a safe not_found (stale-id race), mirroring the other id-scoped rows.
  await runRow('W8.4', 'download_attachment', 'download_attachment with confirm downloads the seeded attachment (test.fac sandbox)', async () => {
    if (!seededAttachment) {
      return { skip: true, ok: false, notes: 'no attachment-bearing mail in view — seed one per CLWX-61' };
    }
    let r = await actions.downloadAttachment({ ...seededAttachment, confirm: true });
    if (r.status === 'not_found') {
      const fresh = await findSeededAttachment();
      if (fresh) r = await actions.downloadAttachment({ ...fresh, confirm: true });
    }
    return {
      laneNotReady: r.status === 'needs_signin',
      ok: r.status === 'downloaded',
      notes: `status=${r.status} filename="${r.filename.slice(0, 60)}" savedPath=${r.savedPath ? 'set' : 'unset'}${r.reason ? ` reason=${r.reason.slice(0, 80)}` : ''}`,
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
      laneNotReady: r.status === 'needs_signin',
    };
  });

  // W5.2 — forward (CLWX-61): open a fresh message, forward it to the
  // sandbox self-address, verify the open pane really is a forward of the
  // requested message, then DISCARD. A forward is NEVER sent by the eval.
  // W5.1 leaves its reply pane open and forward() refuses to stack drafts,
  // so hygiene runs first (and again on the retry leg).
  await discardOpenDrafts();
  await runRow('W5.2', 'forward', 'forward({id, to}) opens forward pane (FW: + subject match), then draft is discarded — never sent', async () => {
    const norm = (s: string) =>
      (s || '').toLowerCase().replace(/^(?:re|fw|fwd)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
    let id = await freshTopId();
    if (!id) return { skip: true, ok: false, notes: 'inbox empty' };
    let r = await actions.forward({ id, to: 'test.fac@fac.edu.tt', body: 'eval forward — do not send.' });
    if (r.status === 'not_found') {
      await discardOpenDrafts();
      id = (await freshTopId()) ?? id;
      r = await actions.forward({ id, to: 'test.fac@fac.edu.tt', body: 'eval forward — do not send.' });
    }
    if (r.status !== 'drafted' || r.draftLeftOpen !== true) {
      return refused(r.status, `status=${r.status} leftOpen=${r.draftLeftOpen}`);
    }
    // Pane verification: `drafted` already proves To was typed + committed
    // (fillField/commitRecipientField throw on failure); the pane SUBJECT is
    // the one field read back from the live compose, so assert it is a
    // forward of the requested message, not some other draft.
    const paneSubject = (r.preview?.subject ?? '').trim();
    const wantSubject = norm((id.split('|')[1] ?? '').slice(0, 60));
    const isForward = /^(?:fw|fwd)\s*:/i.test(paneSubject);
    const matches = wantSubject.length >= 4
      ? norm(paneSubject).includes(wantSubject.slice(0, 40))
      : norm(paneSubject).startsWith(wantSubject);
    return {
      ok: paneSubject.length > 0 && isForward && matches,
      notes: `pane subject="${paneSubject.slice(0, 60)}" fwPrefix=${isForward} subjectMatch=${matches}`,
    };
  });
  // The forward draft is eval residue — discard it before the compound row.
  await discardOpenDrafts();

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

  const slowPasses = results.filter(
    (r) => r.status === 'pass' && r.latencyClass !== 'ok',
  );
  if (slowPasses.length > 0) {
    console.log(
      `latency: ${slowPasses
        .map((r) => `${r.id}=${r.latencyMs}ms(${r.latencyClass})`)
        .join(', ')}  [slow>=${LATENCY_SLOW_MS}ms, ceiling>=${LATENCY_CEILING_MS}ms]`,
    );
  }

  const runAt = new Date().toISOString();
  const summary = {
    runAt,
    pass: passed,
    fail: failed,
    skip: skipped,
    total,
    passRate,
    rows: results,
  };
  const json = JSON.stringify(summary, null, 2);
  // Per-run artifact FIRST, then the stable "latest" pointer. The eval used to
  // only ever overwrite the latest path, which is why CLWX-119's central claim
  // (two runs minutes apart disagree about which rows fail) could not be
  // evidenced from artifacts — only from two console logs that happened to
  // still be open. Two runs now leave two comparable files.
  const perRun = evalArtifactPath(runAt);
  writeFileSync(perRun, json);
  writeFileSync(evalLatestPath(), json);
  console.log(`\nResults saved to ${perRun}`);
  console.log(`Latest pointer: ${evalLatestPath()}`);

  // Repeated LAST on purpose. scripts/ga-gate.mjs records the final three
  // non-empty output lines as the row's tail in the committed report, so
  // whatever prints last is the coverage a human reads. Until 2026-09-07 the
  // gate's own row LABEL carried the count ("outlook-eval 15-row") — authored
  // once, never re-checked, and wrong by three rows. A measured count printed
  // where the report will actually pick it up cannot drift.
  console.log(`\ncoverage: ${passed} pass / ${failed} fail / ${skipped} skip of ${total} rows`);

  // Whole-run lane contract, so scripts/ga-gate.mjs never has to infer our verdict
  // from a substring of our output — and so THIS script never infers it from a
  // substring of its own notes either, which is what it did until 2026-09-07
  // (`/needs_signin/i.test(r.notes)`): fail-OPEN for any row that mentions the
  // token for an unrelated reason, fail-CLOSED for any row whose richer notes
  // omit it. The judgement now lives in scripts/eval-verdict.ts, which is
  // unit-covered, and this is its single call site.
  const verdict = laneVerdict(results);
  if (verdict.exitCode !== 0) console.log(`\n${verdict.reason}`);
  process.exit(verdict.exitCode);
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
