/**
 * App-level outbox wiring (docs/OFFLINE_ARCHITECTURE.md §5.3).
 *
 * The Outbox class in utils/outbox.ts is the durable queue; this module is
 * the app's single instance of it plus the two integration points the design
 * names: audit records are WRITTEN FIRST here at the moment an action
 * completes, and a background drain replays them to the Ministry app server
 * when one is configured.
 *
 * The app server does not exist yet (KR8 — Ministry infra values are
 * placeholders). Until MOE_APP_SERVER_URL is set, the drain loop does not
 * attempt delivery: entries accumulate durably in `pending` and the count is
 * surfaced through pendingRecordCount(). That is the designed behaviour, not
 * a stub — "written first, replayed" (§5.3) only promises replay once a
 * server exists.
 */
import { Outbox, type OutboxEntry } from '../utils/outbox';
import * as logger from '../utils/logger';

let appOutbox: Outbox | undefined;
let drainTimer: NodeJS.Timeout | undefined;

const DRAIN_INTERVAL_MS = 60_000;
const SUBJECT_MAX = 120; // CLAUDE.md log floor: subject truncated to 120 chars.

export function getAppOutbox(): Outbox {
    if (!appOutbox) {
        appOutbox = new Outbox();
    }
    return appOutbox;
}

/** Test hook: swap the singleton (e.g. for a temp file path). */
export function setAppOutboxForTest(outbox: Outbox | undefined): void {
    appOutbox = outbox;
}

function truncateSubject(subject: unknown): string | undefined {
    if (typeof subject !== 'string' || subject.length === 0) return undefined;
    return subject.length > SUBJECT_MAX ? `${subject.slice(0, SUBJECT_MAX)}…` : subject;
}

function countAddresses(value: unknown): number {
    if (typeof value === 'string') return value.trim() ? 1 : 0;
    if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.trim()).length;
    return 0;
}

/**
 * Enqueue an audit record for a completed assistant action. Payloads follow
 * the CLAUDE.md floor — subject truncated to 120 chars, address COUNTS only,
 * never bodies/recipients/credentials (the outbox payload guard enforces
 * this; `toCount` is deliberately named to pass it).
 *
 * Never throws: the user's action already succeeded, and a failed audit
 * write must not turn that success into an error. Failures are logged.
 */
export async function recordAuditEvent(
    kind: string,
    payload: Record<string, unknown>,
): Promise<void> {
    try {
        await getAppOutbox().enqueue(kind, payload);
    } catch (error) {
        logger.error('Audit record enqueue failed', {
            kind,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/** Audit record for a hard-confirm-gated Outlook send that reported 'sent'. */
export async function recordOutlookSendAudit(args: {
    subject?: string;
    to?: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    transport: 'graph' | 'browser';
    status: string;
}): Promise<void> {
    await recordAuditEvent('outlook.send.audit', {
        subject: truncateSubject(args.subject),
        toCount: countAddresses(args.to),
        ccCount: countAddresses(args.cc),
        bccCount: countAddresses(args.bcc),
        transport: args.transport,
        status: args.status,
        at: new Date().toISOString(),
    });
}

/** Audit record for a confirmed MoE form submission. */
export async function recordFormSubmitAudit(args: {
    form: 'daily-report' | 'suspension';
    status: string;
}): Promise<void> {
    await recordAuditEvent('forms.submit.audit', {
        form: args.form,
        status: args.status,
        at: new Date().toISOString(),
    });
}

/** Surfaced to the UI/diagnostics as "N items waiting to sync" (§5.2 req 4). */
export async function pendingRecordCount(): Promise<number> {
    return getAppOutbox().pendingCount();
}

function appServerUrl(): string | undefined {
    const url = process.env.MOE_APP_SERVER_URL?.trim();
    return url || undefined;
}

/**
 * Deliver one entry to the app server. The idempotency key travels in the
 * body AND a header so the server can dedupe before parsing.
 */
async function sendToAppServer(baseUrl: string, entry: OutboxEntry): Promise<void> {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/outbox`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': entry.id,
        },
        body: JSON.stringify({ id: entry.id, kind: entry.kind, payload: entry.payload }),
    });
    if (!response.ok) {
        throw new Error(`App server rejected outbox entry: HTTP ${response.status}`);
    }
}

/**
 * Start the background drain. Without a configured server this only logs the
 * pending count so accumulating records stay visible; with one it drains on
 * the interval. Idempotent: repeated calls keep a single timer.
 */
export function startOutboxDrain(intervalMs: number = DRAIN_INTERVAL_MS): void {
    if (drainTimer) return;
    const tick = async (): Promise<void> => {
        try {
            const baseUrl = appServerUrl();
            if (!baseUrl) {
                const pending = await pendingRecordCount();
                if (pending > 0) {
                    logger.info('Outbox holding records (no app server configured)', { pending });
                }
                return;
            }
            const result = await getAppOutbox().drain((entry) => sendToAppServer(baseUrl, entry));
            if (result.acked || result.retried || result.failedPermanent) {
                logger.info('Outbox drain', result);
            }
        } catch (error) {
            logger.warn('Outbox drain tick failed', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    };
    drainTimer = setInterval(() => { void tick(); }, intervalMs);
    // unref so an idle drain timer never holds the process open on quit.
    drainTimer.unref?.();
    void tick();
}

export function stopOutboxDrain(): void {
    if (drainTimer) {
        clearInterval(drainTimer);
        drainTimer = undefined;
    }
}
