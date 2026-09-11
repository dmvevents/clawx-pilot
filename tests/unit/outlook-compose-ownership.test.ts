// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { OutlookActions } from '@electron/services/outlook-browser-v2/outlook-actions';

/**
 * CLWX-143 / review lane B: `recoverComposeState` treats an untitled EMPTY
 * compose as its own and discards it. That is only safe while the ownership
 * flag describes the operation in progress — the first cut set it when a
 * compose opened and cleared it only after a successful dispatch or discard, so
 * an aborted compose-open left it true and a LATER unrelated empty compose
 * could be discarded. Every compose-opening operation now clears it first.
 *
 * A draft whose subject is an automation subject still recovers automatically:
 * that branch never consults the flag.
 */
type TestActions = OutlookActions & {
  recoverComposeState: (page: unknown) => Promise<{ cleared: boolean; note: string }>;
  evaluateComposeStateProbe: (page: unknown) => Promise<unknown>;
  clickVisibleDiscard: (page: unknown) => Promise<boolean>;
  clickDiscardConfirmOk: (page: unknown) => Promise<boolean>;
  beginComposeOwnedOperation: () => void;
  waitForComposePane: (page: unknown, timeoutMs?: number) => Promise<void>;
  composeOpenedByThisProcess: boolean;
};

function createActions(probe: { dialog?: boolean; hasCompose: boolean; subject: string; bodyEmpty: boolean; hasDiscard: boolean }) {
  const discarded = { count: 0 };
  const actions = new OutlookActions(
    { sleep: vi.fn(async () => undefined) } as never,
    { ground: vi.fn() } as never,
  ) as unknown as TestActions;
  actions.evaluateComposeStateProbe = vi.fn(async () => ({ dialog: false, ...probe }));
  actions.clickVisibleDiscard = vi.fn(async () => {
    discarded.count += 1;
    // After a discard the compose is gone; the loop re-probes.
    actions.evaluateComposeStateProbe = vi.fn(async () => ({ dialog: false, hasCompose: false, subject: '', bodyEmpty: true, hasDiscard: false }));
    return true;
  });
  actions.clickDiscardConfirmOk = vi.fn(async () => true);
  return { actions, discarded };
}

const EMPTY_UNTITLED = { hasCompose: true, subject: '', bodyEmpty: true, hasDiscard: true };

describe('compose ownership before an automatic discard (CLWX-143)', () => {
  it('does NOT discard an untitled empty compose this operation did not open', async () => {
    const { actions, discarded } = createActions(EMPTY_UNTITLED);
    actions.beginComposeOwnedOperation(); // what every compose-opening operation now does first
    const result = await actions.recoverComposeState({} as never);
    expect(result.cleared).toBe(false);
    expect(result.note).toMatch(/not written by the assistant|left untouched/i);
    expect(discarded.count).toBe(0);
  });

  it('discards an untitled empty compose that THIS operation opened', async () => {
    const { actions, discarded } = createActions(EMPTY_UNTITLED);
    actions.beginComposeOwnedOperation();
    actions.composeOpenedByThisProcess = true; // set by waitForComposePane on a real open
    const result = await actions.recoverComposeState({} as never);
    expect(result.cleared).toBe(true);
    expect(discarded.count).toBe(1);
  });

  it('a stale flag from an earlier operation cannot authorise a discard', async () => {
    const { actions, discarded } = createActions(EMPTY_UNTITLED);
    actions.composeOpenedByThisProcess = true; // left over from an aborted earlier operation
    actions.beginComposeOwnedOperation(); // the new operation resets ownership
    const result = await actions.recoverComposeState({} as never);
    expect(result.cleared).toBe(false);
    expect(discarded.count).toBe(0);
  });

  it('still refuses a compose that carries content, whoever opened it', async () => {
    const { actions, discarded } = createActions({ hasCompose: true, subject: 'Parent meeting Friday', bodyEmpty: false, hasDiscard: true });
    actions.beginComposeOwnedOperation();
    actions.composeOpenedByThisProcess = true;
    const result = await actions.recoverComposeState({} as never);
    expect(result.cleared).toBe(false);
    expect(discarded.count).toBe(0);
  });

  it('waitForComposePane marks the compose as opened by this operation', async () => {
    const { actions } = createActions(EMPTY_UNTITLED);
    actions.beginComposeOwnedOperation();
    expect(actions.composeOpenedByThisProcess).toBe(false);
    // waitForComposePane sets the flag before it starts waiting; the wait itself
    // needs a page and is not exercised here.
    await actions.waitForComposePane({ waitForSelector: vi.fn(async () => undefined) } as never, 1).catch(() => undefined);
    expect(actions.composeOpenedByThisProcess).toBe(true);
  });
});
