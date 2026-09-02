/**
 * Store-and-forward outbox (docs/OFFLINE_ARCHITECTURE.md §5).
 *
 * A durable, append-only queue for records that must eventually reach the
 * app server (audit trail, form-submission records, preference mirrors).
 * Entries carry a client-generated idempotency key so the server can dedupe
 * replays; the queue itself never silently drops — every entry ends in an
 * explicit terminal state (`acked` or `failed-permanent`).
 *
 * Invariants (each maps to a §5.2 requirement / CLAUDE.md hard rule):
 *  - Writes are atomic (temp-file + rename, same pattern as
 *    channel-config.ts::writeOpenClawConfig) and idempotent.
 *  - Payloads must never contain email bodies, recipient lists, passwords,
 *    or tokens. enqueue() rejects them loudly — queue entries live on disk
 *    longer than log lines, so the bar is higher than the log rules.
 *  - Retry is bounded and backoff-gated; a permanently failing entry lands
 *    in `failed-permanent` instead of retrying forever.
 *  - Log lines carry id/kind/state only, never payload content.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import * as logger from './logger';

// ── Types ────────────────────────────────────────────────────────

export type OutboxEntryState = 'pending' | 'sent' | 'acked' | 'failed-permanent';

export interface OutboxEntry {
    /** Client-generated idempotency key. The server dedupes on this. */
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    state: OutboxEntryState;
    attempts: number;
    createdAt: number;
    updatedAt: number;
}

/**
 * Delivers one entry to the server. Resolving means the server acked;
 * throwing means the attempt failed and the entry stays retryable.
 */
export type OutboxSender = (entry: OutboxEntry) => Promise<void>;

/**
 * The subset of fs/promises the outbox touches. Injectable so the
 * G-outbox-durable negative control can stub persistence out and prove
 * the durability assertion goes red (§5.4).
 */
export interface OutboxFs {
    readFile(path: string, encoding: 'utf-8'): Promise<string>;
    writeFile(path: string, data: string, encoding: 'utf-8'): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    mkdir(path: string, options: { recursive: true }): Promise<unknown>;
    unlink(path: string): Promise<void>;
}

export interface OutboxOptions {
    /** Storage file. Defaults to ~/.openclaw/outbox.json. */
    filePath?: string;
    /** Attempts before an entry becomes failed-permanent. */
    maxAttempts?: number;
    /** Backoff gate: minimum ms since last attempt before retry N runs. */
    backoffMs?: (attempts: number) => number;
    /** Injectable clock so tests never sleep. */
    now?: () => number;
    /** Injectable persistence layer; defaults to fs/promises. */
    fs?: OutboxFs;
}

export interface DrainResult {
    acked: number;
    retried: number;
    failedPermanent: number;
    /** Entries skipped because their backoff window has not elapsed. */
    deferred: number;
}

interface OutboxFile {
    entries: OutboxEntry[];
}

// ── Defaults ─────────────────────────────────────────────────────

const DEFAULT_MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

function defaultBackoffMs(attempts: number): number {
    return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

function defaultFilePath(): string {
    return join(homedir(), '.openclaw', 'outbox.json');
}

const defaultFs: OutboxFs = { readFile, writeFile, rename, mkdir, unlink };

// ── Payload guard ────────────────────────────────────────────────

/**
 * Compliance floor from CLAUDE.md: no email bodies, recipient lists,
 * passwords, or tokens on disk. Matches any key at any depth.
 */
const FORBIDDEN_KEY_PATTERN = /body|password|token|secret|recipient/i;

function assertPayloadAllowed(value: unknown, path: string, seen: WeakSet<object>): void {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            assertPayloadAllowed(value[i], `${path}[${i}]`, seen);
        }
        return;
    }

    for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_KEY_PATTERN.test(key)) {
            // Name the key, never its value — the value is exactly what
            // must not leak into logs.
            throw new Error(
                `Outbox payload rejected: key "${path}.${key}" matches the forbidden pattern `
                + '(no bodies, recipients, passwords, tokens, or secrets in the queue)',
            );
        }
        assertPayloadAllowed(child, `${path}.${key}`, seen);
    }
}

// ── Outbox ───────────────────────────────────────────────────────

export class Outbox {
    private readonly filePath: string;
    private readonly maxAttempts: number;
    private readonly backoffMs: (attempts: number) => number;
    private readonly now: () => number;
    private readonly fs: OutboxFs;
    /**
     * In-process mutex: all read-modify-write cycles (enqueue and drain)
     * chain through this promise, so two concurrent drains cannot both
     * read the same pending entry and double-send it.
     */
    private queue: Promise<void> = Promise.resolve();

    constructor(options: OutboxOptions = {}) {
        this.filePath = options.filePath ?? defaultFilePath();
        this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.backoffMs = options.backoffMs ?? defaultBackoffMs;
        this.now = options.now ?? Date.now;
        this.fs = options.fs ?? defaultFs;
    }

    /**
     * Append an entry. Idempotent: enqueueing an id that already exists
     * returns the stored entry unchanged and performs no write.
     */
    async enqueue(kind: string, payload: Record<string, unknown>, id: string = randomUUID()): Promise<OutboxEntry> {
        assertPayloadAllowed(payload, 'payload', new WeakSet());

        return this.runExclusive(async () => {
            const entries = await this.load();
            const existing = entries.find((entry) => entry.id === id);
            if (existing) {
                return existing;
            }

            const timestamp = this.now();
            const entry: OutboxEntry = {
                id,
                kind,
                payload,
                state: 'pending',
                attempts: 0,
                createdAt: timestamp,
                updatedAt: timestamp,
            };
            entries.push(entry);
            await this.persist(entries);
            logger.info('Outbox entry enqueued', { id, kind });
            return entry;
        });
    }

    /**
     * Walk retryable entries oldest-first and hand each to `sender`.
     * A `sent` entry that never reached `acked` (crash between transmit
     * and ack) is retried too — the idempotency key makes that safe.
     */
    async drain(sender: OutboxSender): Promise<DrainResult> {
        return this.runExclusive(async () => {
            const entries = await this.load();
            const result: DrainResult = { acked: 0, retried: 0, failedPermanent: 0, deferred: 0 };

            const retryable = entries
                .filter((entry) => entry.state === 'pending' || entry.state === 'sent')
                .sort((a, b) => a.createdAt - b.createdAt);

            for (const entry of retryable) {
                if (entry.attempts > 0 && this.now() < entry.updatedAt + this.backoffMs(entry.attempts)) {
                    result.deferred += 1;
                    continue;
                }

                // Record the attempt durably BEFORE transmitting. A crash
                // mid-send leaves a `sent` entry that the next drain
                // retries; the server dedupes on the id.
                entry.state = 'sent';
                entry.attempts += 1;
                entry.updatedAt = this.now();
                await this.persist(entries);

                try {
                    await sender(entry);
                    entry.state = 'acked';
                    entry.updatedAt = this.now();
                    await this.persist(entries);
                    result.acked += 1;
                } catch (error) {
                    entry.updatedAt = this.now();
                    if (entry.attempts >= this.maxAttempts) {
                        entry.state = 'failed-permanent';
                        result.failedPermanent += 1;
                        logger.error('Outbox entry failed permanently', {
                            id: entry.id,
                            kind: entry.kind,
                            attempts: entry.attempts,
                        });
                    } else {
                        entry.state = 'pending';
                        result.retried += 1;
                        logger.warn('Outbox send attempt failed, will retry', {
                            id: entry.id,
                            kind: entry.kind,
                            attempts: entry.attempts,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                    await this.persist(entries);
                }
            }

            return result;
        });
    }

    /** Count surfaced to the UI as "N items waiting to sync". */
    async pendingCount(): Promise<number> {
        const entries = await this.runExclusive(() => this.load());
        return entries.filter((entry) => entry.state === 'pending' || entry.state === 'sent').length;
    }

    /** All entries, including terminal ones. For the UI and diagnostics. */
    async list(): Promise<OutboxEntry[]> {
        return this.runExclusive(() => this.load());
    }

    // ── Internals ────────────────────────────────────────────────

    private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.queue.then(fn);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }

    private async load(): Promise<OutboxEntry[]> {
        let content: string;
        try {
            content = await this.fs.readFile(this.filePath, 'utf-8');
        } catch {
            // Missing file = empty outbox (first run).
            return [];
        }

        try {
            const parsed = JSON.parse(content) as OutboxFile;
            return Array.isArray(parsed.entries) ? parsed.entries : [];
        } catch (error) {
            // Never silently drop: a corrupt queue is a loud failure, not
            // an empty one — an empty one would manufacture false
            // confidence that everything synced.
            logger.error('Outbox file is corrupt', { filePath: this.filePath, error });
            throw new Error(`Outbox file is corrupt: ${this.filePath}`, { cause: error });
        }
    }

    private async persist(entries: OutboxEntry[]): Promise<void> {
        // Atomic write: serialize first, write to a temp file in the same
        // directory, then rename over the target (same pattern as
        // channel-config.ts::writeOpenClawConfig).
        const serialized = JSON.stringify({ entries } satisfies OutboxFile, null, 2);
        await this.fs.mkdir(dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
        try {
            await this.fs.writeFile(tempPath, serialized, 'utf-8');
            await this.fs.rename(tempPath, this.filePath);
        } catch (writeErr) {
            await this.fs.unlink(tempPath).catch(() => undefined);
            throw writeErr;
        }
    }
}
