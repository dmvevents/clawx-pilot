// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { OutlookActions } from '@electron/services/outlook-browser-v2/outlook-actions';
import { INBOX_ROW_PARSER_BROWSER_SOURCE } from '@electron/services/outlook-browser-v2/inbox-row-parser';

/**
 * CLWX-143 write guard: reply and forward must refuse when every visible row
 * carrying the requested id is a draft-marked row with no preview, because the
 * marker shifts the field split and the target is then uncertain (it can be the
 * row Outlook renders for an OPEN compose, whose "subject" is the draft body).
 * Reads are unaffected — the row is still listed.
 *
 * The fake page runs the REAL injected payload against fake row elements, so
 * these cases exercise the same parser the browser would.
 */
type TestActions = OutlookActions & {
  looksLikeSignin: () => Promise<boolean>;
  dismissBlockingDialog: (page: unknown) => Promise<void>;
  openMessageByIdInCurrentViewOrInbox: (page: unknown, id: string) => Promise<{ outcome: string; reason?: string }>;
  reply: (args: { id: string; body: string }) => Promise<{ status: string; notFoundReason?: string; message?: string; draftLeftOpen?: boolean }>;
  forward: (args: { id: string; to: string[]; body?: string }) => Promise<{ status: string; notFoundReason?: string; message?: string }>;
};

function fakeRowElement(texts: string[], ariaLabel: string) {
  return {
    getAttribute: (name: string) => (name === 'aria-label' ? ariaLabel : null),
    nodeType: 1,
    childNodes: texts.map((t) => ({ nodeType: 3, textContent: t, childNodes: [] })),
  };
}

/** Runs the injected payload for real; `rows` are the fake list elements. */
function createActions(rows: Array<{ texts: string[]; ariaLabel: string }>, opts: { evaluateMissing?: boolean } = {}) {
  const elements = rows.map((r) => fakeRowElement(r.texts, r.ariaLabel));
  const page: Record<string, unknown> = {
    url: () => 'https://outlook.office.com/mail/inbox',
    waitForSelector: vi.fn(async () => undefined),
    keyboard: { press: vi.fn(async () => undefined) },
  };
  if (!opts.evaluateMissing) {
    page.evaluate = vi.fn(async (script: string) => {
      if (typeof script !== 'string' || !script.includes('inboxRowFingerprintDetail')) return null;
      const run = new Function(
        'els',
        `${INBOX_ROW_PARSER_BROWSER_SOURCE}
         const wantedId = ${JSON.stringify('Karunesh Ramdass Meeting|Sure, how about 3pm|Mon 10:08 PM')};
         let matches = 0, ambiguous = 0;
         for (const el of els) {
           const d = inboxRowFingerprintDetail(el);
           if (d.fp !== wantedId) continue;
           matches += 1;
           if (d.ambiguousDraftRow) ambiguous += 1;
         }
         return { matches, ambiguous };`,
      ) as (els: unknown[]) => { matches: number; ambiguous: number };
      return run(elements);
    });
  }
  const driver = { ensureOutlookTab: vi.fn(async () => page) };
  const actions = new OutlookActions(driver as never, { ground: vi.fn() } as never) as unknown as TestActions;
  actions.looksLikeSignin = vi.fn(async () => false);
  actions.dismissBlockingDialog = vi.fn(async () => undefined);
  // Any attempt to reach the message would be a failure of the guard.
  actions.openMessageByIdInCurrentViewOrInbox = vi.fn(async () => ({ outcome: 'opened' }));
  return { actions, page };
}

const WANTED = 'Karunesh Ramdass Meeting|Sure, how about 3pm|Mon 10:08 PM';
const AMBIGUOUS_ROW = { texts: ['[Draft]', 'Karunesh Ramdass Meeting', 'Sure, how about 3pm', 'Mon 10:08 PM'], ariaLabel: '[Draft] Karunesh Ramdass Meeting' };
const SAME_ID_WITH_PREVIEW = { texts: ['Karunesh Ramdass Meeting', 'Sure, how about 3pm', 'Mon 10:08 PM', 'preview text'], ariaLabel: 'Karunesh Ramdass Meeting' };

describe('reply/forward refuse an ambiguous draft-row target (CLWX-143)', () => {
  it('reply refuses without ever trying to open the message', async () => {
    const { actions } = createActions([AMBIGUOUS_ROW]);
    const r = await actions.reply({ id: WANTED, body: 'Acknowledged.' });
    expect(r.status).toBe('not_found');
    expect(r.notFoundReason).toBe('ambiguous_draft_row');
    expect(r.message).toMatch(/saved draft and no message preview/i);
    expect(r.draftLeftOpen).toBe(false);
    expect(actions.openMessageByIdInCurrentViewOrInbox).not.toHaveBeenCalled();
  });

  it('forward refuses the same way', async () => {
    const { actions } = createActions([AMBIGUOUS_ROW]);
    const r = await actions.forward({ id: WANTED, to: ['someone@example.invalid'], body: 'FYI' });
    expect(r.status).toBe('not_found');
    expect(r.notFoundReason).toBe('ambiguous_draft_row');
    expect(actions.openMessageByIdInCurrentViewOrInbox).not.toHaveBeenCalled();
  });

  it('proceeds when an unambiguous row with the same id also exists', async () => {
    const { actions } = createActions([AMBIGUOUS_ROW, SAME_ID_WITH_PREVIEW]);
    const r = await actions.reply({ id: WANTED, body: 'Acknowledged.' });
    expect(r.notFoundReason).not.toBe('ambiguous_draft_row');
    expect(actions.openMessageByIdInCurrentViewOrInbox).toHaveBeenCalled();
  });

  it('proceeds when the id is not among the visible rows (the locator reports honestly instead)', async () => {
    const { actions } = createActions([{ texts: ['Someone Else', 'Another subject', 'Mon 7 Sep', 'preview'], ariaLabel: 'Someone Else' }]);
    const r = await actions.reply({ id: WANTED, body: 'Acknowledged.' });
    expect(r.notFoundReason).not.toBe('ambiguous_draft_row');
    expect(actions.openMessageByIdInCurrentViewOrInbox).toHaveBeenCalled();
  });

  it('never refuses when the probe cannot run at all', async () => {
    // A surface without `evaluate` gives the guard no signal, so it must not
    // manufacture a refusal. Reply then proceeds and fails later for its own
    // reason (a deeper step also needs `evaluate`) — what matters here is that
    // the guard let it past rather than returning ambiguous_draft_row.
    const { actions } = createActions([AMBIGUOUS_ROW], { evaluateMissing: true });
    await expect(actions.reply({ id: WANTED, body: 'Acknowledged.' })).rejects.toThrow(/evaluate is not a function/);
    expect(actions.openMessageByIdInCurrentViewOrInbox).toHaveBeenCalled();
  });
});
