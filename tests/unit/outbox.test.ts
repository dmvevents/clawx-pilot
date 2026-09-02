/**
 * Acceptance tests for the store-and-forward outbox
 * (docs/OFFLINE_ARCHITECTURE.md §5.4): G-outbox-durable,
 * G-outbox-idempotent, G-outbox-drain — each with the negative control
 * §2.2 demands, because a queue test that cannot fail when the queue is
 * inert is not a test.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Outbox, type OutboxEntry, type OutboxFs } from '@electron/utils/outbox';

vi.mock('@electron/utils/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

let root: string;
let filePath: string;

/** Sender stub that records every entry it is handed and always acks. */
function recordingSender() {
  const sent: OutboxEntry[] = [];
  const sender = vi.fn(async (entry: OutboxEntry) => {
    sent.push(entry);
  });
  return { sender, sent };
}

const failingSender = () => vi.fn(async () => {
  throw new Error('connect ECONNREFUSED 10.0.0.1:443');
});

/** Backoff disabled so tests never wait; overridden where backoff is the subject. */
const instantOutbox = (overrides: ConstructorParameters<typeof Outbox>[0] = {}) =>
  new Outbox({ filePath, backoffMs: () => 0, ...overrides });

// The negative control for G-outbox-durable stubs persistence out: writes
// become no-ops so nothing ever lands on disk.
const noOpWriteFs: OutboxFs = {
  readFile,
  mkdir,
  unlink,
  writeFile: async () => undefined,
  rename: async () => undefined,
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clawx-outbox-'));
  filePath = join(root, 'outbox.json');
});

afterEach(() => {
  if (root && existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('outbox payload guard', () => {
  it('throws on payloads containing forbidden keys at any depth', async () => {
    const outbox = instantOutbox();

    // Top-level, nested, array-nested, and compound key names — the
    // pattern must catch all of them case-insensitively.
    const forbidden: Array<Record<string, unknown>> = [
      { body: 'dear parent...' },
      { Password: 'x' },
      { auth: { accessToken: 'x' } },
      { message: { recipients: ['a@moe.gov.tt'] } },
      { items: [{ clientSecret: 'x' }] },
    ];

    for (const payload of forbidden) {
      await expect(outbox.enqueue('audit', payload)).rejects.toThrow(/forbidden pattern/);
    }

    // Nothing was persisted for any rejected payload.
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('accepts a clean payload', async () => {
    const outbox = instantOutbox();
    const entry = await outbox.enqueue('form-submission', {
      formId: 'suspensions-daily',
      fieldCount: 32,
      subject: 'Suspension report submitted',
    });

    expect(entry.state).toBe('pending');
    expect(await outbox.pendingCount()).toBe(1);
  });
});

describe('G-outbox-durable', () => {
  it('an enqueued entry survives a crash (fresh instance over the same file)', async () => {
    const before = instantOutbox();
    const entry = await before.enqueue('audit', { action: 'draft-created' });

    // Simulate the crash: a brand-new instance with no in-memory carryover.
    const after = instantOutbox();
    const entries = await after.list();

    expect(await after.pendingCount()).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: entry.id, kind: 'audit', state: 'pending', attempts: 0 });
  });

  it('NEGATIVE CONTROL: with persistence stubbed out, the entry does NOT survive', async () => {
    // Proves the positive test can go red: if the outbox were only an
    // in-memory list, the assertion above would still pass on the same
    // instance — but not across a restart.
    const before = instantOutbox({ fs: noOpWriteFs });
    await before.enqueue('audit', { action: 'draft-created' });
    expect(existsSync(filePath)).toBe(false);

    const after = instantOutbox();

    expect(await after.pendingCount()).toBe(0);
    expect(await after.list()).toEqual([]);
  });
});

describe('G-outbox-idempotent', () => {
  it('replaying the same id yields one logical record and one send', async () => {
    const outbox = instantOutbox();
    const id = 'daily-report-2026-09-01';

    const first = await outbox.enqueue('form-submission', { formId: 'daily-report' }, id);
    const second = await outbox.enqueue('form-submission', { formId: 'daily-report' }, id);

    // Identical state: the replay returned the stored entry unchanged.
    expect(second).toEqual(first);
    expect(await outbox.list()).toHaveLength(1);

    const { sender, sent } = recordingSender();
    await outbox.drain(sender);
    // A second drain must not resend the acked entry either.
    await outbox.drain(sender);

    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe(id);
    expect((await outbox.list())[0].state).toBe('acked');
  });
});

describe('G-outbox-drain', () => {
  it('drains queued entries oldest-first to acked once the network returns', async () => {
    let clock = 1_000;
    const outbox = instantOutbox({ now: () => clock });
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      clock += 1; // distinct createdAt so oldest-first ordering is observable
      ids.push((await outbox.enqueue('audit', { action: `step-${n}` })).id);
    }

    // Network blocked: every entry fails but stays retryable.
    const blocked = failingSender();
    const blockedResult = await outbox.drain(blocked);
    expect(blockedResult).toMatchObject({ acked: 0, retried: 3, failedPermanent: 0 });
    expect(await outbox.pendingCount()).toBe(3);
    expect((await outbox.list()).every((e) => e.state === 'pending' && e.attempts === 1)).toBe(true);

    // Network back: swap to a succeeding sender.
    const { sender, sent } = recordingSender();
    const result = await outbox.drain(sender);

    expect(result).toMatchObject({ acked: 3, retried: 0, failedPermanent: 0 });
    expect(sent.map((e) => e.id)).toEqual(ids);
    expect((await outbox.list()).every((e) => e.state === 'acked')).toBe(true);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('bounded retry: a permanently failing entry lands in failed-permanent, not infinite retry', async () => {
    const outbox = instantOutbox({ maxAttempts: 3 });
    await outbox.enqueue('audit', { action: 'doomed' });

    const sender = failingSender();
    await outbox.drain(sender);
    await outbox.drain(sender);
    const third = await outbox.drain(sender);

    expect(third).toMatchObject({ acked: 0, failedPermanent: 1 });
    const [entry] = await outbox.list();
    expect(entry.state).toBe('failed-permanent');
    expect(entry.attempts).toBe(3);
    // The terminal entry is never retried — and never silently dropped.
    expect(sender).toHaveBeenCalledTimes(3);
    await outbox.drain(sender);
    expect(sender).toHaveBeenCalledTimes(3);
    expect(await outbox.list()).toHaveLength(1);
  });

  it('backoff defers a retry until its window elapses (injected clock, no sleeping)', async () => {
    let clock = 1_000;
    const outbox = new Outbox({ filePath, now: () => clock, backoffMs: () => 60_000 });
    await outbox.enqueue('audit', { action: 'retry-me' });

    await outbox.drain(failingSender());

    // Immediately after the failure the backoff window has not elapsed.
    const { sender, sent } = recordingSender();
    expect(await outbox.drain(sender)).toMatchObject({ deferred: 1, acked: 0 });
    expect(sent).toHaveLength(0);

    clock += 60_001;
    expect(await outbox.drain(sender)).toMatchObject({ deferred: 0, acked: 1 });
    expect(sent).toHaveLength(1);
  });

  it('two concurrent drains do not double-send', async () => {
    const outbox = instantOutbox();
    for (const n of [1, 2, 3]) {
      await outbox.enqueue('audit', { action: `step-${n}` });
    }

    const { sender, sent } = recordingSender();
    await Promise.all([outbox.drain(sender), outbox.drain(sender)]);

    expect(sent).toHaveLength(3);
    expect((await outbox.list()).every((e) => e.state === 'acked')).toBe(true);
  });
});
