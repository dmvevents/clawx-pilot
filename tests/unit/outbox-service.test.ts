/**
 * KR5 acceptance: a REAL app action's audit record flows through the durable
 * outbox and survives an app restart (OFFLINE_ARCHITECTURE §5.3/§5.4).
 *
 * The Outbox class internals are covered by outbox.test.ts. This suite covers
 * the app wiring layer: recordOutlookSendAudit/recordFormSubmitAudit produce
 * compliant payloads, the record survives a simulated restart (a NEW Outbox
 * instance over the same file — exactly what a process relaunch constructs),
 * and replay to a stub server is idempotent.
 */
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Outbox } from '@electron/utils/outbox';
import {
  recordFormSubmitAudit,
  recordOutlookSendAudit,
  pendingRecordCount,
  setAppOutboxForTest,
} from '@electron/services/outbox-service';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clawx-outbox-service-'));
  filePath = join(dir, 'outbox.json');
  setAppOutboxForTest(new Outbox({ filePath }));
});

afterEach(async () => {
  setAppOutboxForTest(undefined);
  await rm(dir, { recursive: true, force: true });
});

describe('outbox service — real app action wiring (KR5)', () => {
  it('records a confirmed Outlook send with counts-only, truncated-subject payload', async () => {
    const longSubject = 'S'.repeat(200);
    await recordOutlookSendAudit({
      subject: longSubject,
      to: ['principal@fac.edu.tt', 'clerk@fac.edu.tt'],
      cc: 'admin@fac.edu.tt',
      transport: 'browser',
      status: 'sent',
    });

    expect(await pendingRecordCount()).toBe(1);

    const restarted = new Outbox({ filePath });
    const entries = await restarted.list();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.kind).toBe('outlook.send.audit');
    // CLAUDE.md floor: subject truncated to 120 chars + ellipsis, counts only.
    expect((entry.payload.subject as string).length).toBe(121);
    expect(entry.payload.toCount).toBe(2);
    expect(entry.payload.ccCount).toBe(1);
    // Never addresses, bodies, or credentials in the payload.
    const serialized = JSON.stringify(entry.payload);
    expect(serialized).not.toContain('@fac.edu.tt');
  });

  it('audit record survives an app restart and drains to a stub server exactly once', async () => {
    await recordFormSubmitAudit({ form: 'daily-report', status: 'submitted' });

    // Simulated restart: a fresh Outbox instance over the same file is
    // literally what a relaunched process constructs.
    const afterRestart = new Outbox({ filePath });
    expect(await afterRestart.pendingCount()).toBe(1);

    // Stub app server dedupes on the idempotency key, like the real one must.
    const received = new Map<string, number>();
    const sender = async (entry: { id: string }): Promise<void> => {
      received.set(entry.id, (received.get(entry.id) ?? 0) + 1);
    };

    const first = await afterRestart.drain(sender);
    expect(first.acked).toBe(1);
    expect(await afterRestart.pendingCount()).toBe(0);

    // Replaying the whole queue again transmits nothing new: acked entries
    // are terminal, so the server sees exactly one logical record.
    const second = await afterRestart.drain(sender);
    expect(second.acked).toBe(0);
    expect(received.size).toBe(1);
    expect([...received.values()]).toEqual([1]);
  });

  it('a mid-send crash (sent, never acked) is retried after restart — no lost record', async () => {
    await recordFormSubmitAudit({ form: 'suspension', status: 'submitted' });

    // First process: transmit succeeds but the process dies before the ack
    // is persisted. Emulate by a sender that throws AFTER "transmitting".
    const preCrash = new Outbox({ filePath });
    await preCrash.drain(async () => {
      throw new Error('process killed mid-send');
    });

    // Restarted process: the entry is still retryable and reaches acked.
    const postCrash = new Outbox({ filePath, backoffMs: () => 0 });
    expect(await postCrash.pendingCount()).toBe(1);
    const result = await postCrash.drain(async () => undefined);
    expect(result.acked).toBe(1);
  });

  it('audit failure never breaks the user action', async () => {
    // Payload guard rejects forbidden keys loudly at the Outbox layer; the
    // service layer must swallow that so a successful send stays successful.
    const { recordAuditEvent } = await import('@electron/services/outbox-service');
    await expect(
      recordAuditEvent('bad.audit', { recipientList: ['leak@example.com'] }),
    ).resolves.toBeUndefined();
    expect(await pendingRecordCount()).toBe(0);
  });
});
