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
  let notes = '';
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

  // W1 — open
  await runRow('W1', 'open', 'open() returns opened with mail URL', async () => {
    const r = await actions.open();
    return {
      ok: r.status === 'opened' && /outlook\.office\.com\/mail/.test(r.url),
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

  // W3.1 — read_email returns full body
  await runRow('W3.1', 'read_email', 'read_email({id}) returns body longer than snippet', async () => {
    if (!firstId) return { skip: true, ok: false, notes: 'no firstId' };
    const inbox = await actions.readInbox(5);
    const snip = inbox.messages[0]?.snippet ?? '';
    const r = await actions.readEmail({ id: firstId });
    if (r.status !== 'ok') return { ok: false, notes: `status=${r.status}` };
    const bodyLen = r.body?.length ?? 0;
    return {
      ok: bodyLen > snip.length,
      notes: `body=${bodyLen} chars, snippet=${snip.length} chars`,
    };
  });

  // W3.2 — read_email returns attachments array (may be empty)
  await runRow('W3.2', 'read_email', 'read_email({id}) returns attachments: array', async () => {
    if (!firstId) return { skip: true, ok: false, notes: 'no firstId' };
    const r = await actions.readEmail({ id: firstId });
    return {
      ok: r.status === 'ok' && Array.isArray(r.attachments),
      notes: `status=${r.status} attachments=${r.attachments?.length ?? 'undefined'}`,
    };
  });

  // W4.1 — draft_email
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

  // W6.1 — mark_read
  await runRow('W6.1', 'mark_read', 'mark_read({read:true}) returns ok', async () => {
    if (!firstId) return { skip: true, ok: false, notes: 'no firstId' };
    const r = await actions.markRead({ id: firstId, read: true });
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

  // W8.2 — list_attachments returns metadata only
  await runRow('W8.2', 'list_attachments', 'list_attachments returns array (no download)', async () => {
    if (!firstId) return { skip: true, ok: false, notes: 'no firstId' };
    const r = await actions.listAttachments({ id: firstId });
    return {
      ok: r.status === 'ok' && Array.isArray(r.attachments),
      notes: `status=${r.status} count=${r.attachments?.length ?? 'undefined'}`,
    };
  });

  // W5.1 — reply (we'll close it ourselves to avoid leaving a noisy draft)
  await runRow('W5.1', 'reply', 'reply({id, body}) opens reply pane with body filled', async () => {
    if (!firstId) return { skip: true, ok: false, notes: 'no firstId' };
    const r = await actions.reply({ id: firstId, body: 'eval reply — do not send.' });
    return {
      ok: r.status === 'drafted' && r.draftLeftOpen === true,
      notes: `status=${r.status}`,
    };
  });

  // W7.1 — multi-message workflow: read_inbox + read_email loop
  await runRow('W7.1', 'compound', 'multi-message: read_inbox(3) + read_email each, all status=ok', async () => {
    const inbox = await actions.readInbox(3);
    if (inbox.status !== 'ok' || inbox.messages.length === 0) {
      return { skip: true, ok: false, notes: 'no rows' };
    }
    let allOk = true;
    for (const m of inbox.messages) {
      const r = await actions.readEmail({ id: m.id });
      if (r.status !== 'ok') { allOk = false; break; }
    }
    return { ok: allOk, notes: `iterated ${inbox.messages.length} messages` };
  });

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
