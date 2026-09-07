// Per-user token metering for the model broker (KR6).
//
// The Ministry APIM lane provisions one shared monthly token budget for the
// whole fleet; when it is exhausted APIM 429s fleet-wide. Every APIM response
// carries a per-request `consumed-tokens` header and authenticated requests
// carry a `UserId` header (per-principal identity — KR7). This module meters
// consumption locally so a heavy user is degraded to the on-device model
// BEFORE the fleet budget runs dry (docs/SCALE_ANALYSIS_2026-08-20.md §3.2).
//
// Design constraints:
//   - No Date.now() inside the accounting logic — callers inject `now` so
//     day/month rollover is deterministic under test.
//   - State persists via temp-file + rename (atomic) and reloads on boot, so
//     a broker restart never resets a user's daily total.
//   - This file stays dependency-free Node ESM, like server.mjs.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_USER_DAILY_CAP = 500_000;
export const DEFAULT_FLEET_MONTHLY_BUDGET = 100_000_000;
export const DEFAULT_FLEET_RESERVE_RATIO = 0.9;
const DEFAULT_STATE_FILENAME = 'usage-state.json';

/**
 * Feature flag: CLAWX_PER_USER_CAPS, default FALSE. Mirrors the semantics of
 * shared/feature-flags.ts::flagFromEnv, re-implemented here because the broker
 * is a standalone Node ESM script that cannot import the TS app bundle.
 */
export function perUserCapsEnabled(env = process.env) {
  const raw = env.CLAWX_PER_USER_CAPS;
  if (raw == null || raw === '') return false;
  return raw === '1' || String(raw).toLowerCase() === 'true';
}

function positiveIntFromEnv(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Meter configuration from env, with the KR6 defaults. */
export function usageMeterConfigFromEnv(env = process.env) {
  return {
    statePath: String(env.CLAWX_USAGE_STATE_PATH || '').trim()
      || join(dirname(fileURLToPath(import.meta.url)), DEFAULT_STATE_FILENAME),
    userDailyCap: positiveIntFromEnv(env.CLAWX_USER_DAILY_CAP, DEFAULT_USER_DAILY_CAP),
    fleetMonthlyBudget: positiveIntFromEnv(env.CLAWX_FLEET_MONTHLY_BUDGET, DEFAULT_FLEET_MONTHLY_BUDGET),
    fleetReserveRatio: DEFAULT_FLEET_RESERVE_RATIO,
  };
}

/**
 * Read the per-request cost from an upstream response's headers. Tolerant of
 * the header being absent or garbage — callers get `{ tokens: 0,
 * present: false }` and accounting simply records nothing for that turn.
 * Accepts a fetch Headers object or a plain header record.
 */
export function parseConsumedTokens(headers) {
  let raw;
  if (headers && typeof headers.get === 'function') {
    raw = headers.get('consumed-tokens');
  } else if (headers && typeof headers === 'object') {
    raw = headers['consumed-tokens'];
  }
  if (Array.isArray(raw)) raw = raw[0];
  if (raw == null || String(raw).trim() === '') {
    return { tokens: 0, present: false };
  }
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { tokens: 0, present: false };
  }
  return { tokens: parsed, present: true };
}

function dayKey(now) {
  return now.toISOString().slice(0, 10);
}

function monthKey(now) {
  return now.toISOString().slice(0, 7);
}

function emptyState(now) {
  return {
    day: dayKey(now),
    month: monthKey(now),
    users: {},
    fleetMonthTokens: 0,
  };
}

function loadState(statePath, now) {
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    if (
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && typeof parsed.day === 'string' && typeof parsed.month === 'string'
      && parsed.users && typeof parsed.users === 'object' && !Array.isArray(parsed.users)
      && Number.isFinite(parsed.fleetMonthTokens)
    ) {
      return {
        day: parsed.day,
        month: parsed.month,
        users: { ...parsed.users },
        fleetMonthTokens: parsed.fleetMonthTokens,
      };
    }
  } catch {
    // Missing or corrupt file — start clean rather than refusing to boot.
  }
  return emptyState(now);
}

/**
 * Create a usage meter over a JSON state file.
 *
 * recordUsage(userId, consumedTokens, now) — accumulate per-user per-day and
 *   fleet per-month totals; persists atomically after every record.
 * checkCap(userId, now) — {allowed, reason} where reason is 'ok', 'user-cap'
 *   (this user is at/over the daily soft cap) or 'fleet-reserve' (fleet
 *   month-to-date is at/over the reserve threshold — deny cloud for everyone;
 *   the KR4 client degrade path takes them to the on-device model).
 */
export function createUsageMeter(options = {}) {
  const {
    statePath,
    userDailyCap = DEFAULT_USER_DAILY_CAP,
    fleetMonthlyBudget = DEFAULT_FLEET_MONTHLY_BUDGET,
    fleetReserveRatio = DEFAULT_FLEET_RESERVE_RATIO,
  } = options;
  if (!statePath || !String(statePath).trim()) {
    throw new Error('createUsageMeter requires a statePath');
  }

  let state = loadState(statePath, new Date(0));

  function rollover(now) {
    if (state.month !== monthKey(now)) {
      state = emptyState(now);
      return;
    }
    if (state.day !== dayKey(now)) {
      state.day = dayKey(now);
      state.users = {};
    }
  }

  function persist() {
    const tmpPath = `${statePath}.tmp`;
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, statePath);
  }

  return {
    recordUsage(userId, consumedTokens, now) {
      rollover(now);
      const tokens = Number.isFinite(consumedTokens) && consumedTokens > 0
        ? Math.floor(consumedTokens)
        : 0;
      const id = String(userId || '').trim() || 'anonymous';
      state.users[id] = (state.users[id] || 0) + tokens;
      state.fleetMonthTokens += tokens;
      persist();
    },

    checkCap(userId, now) {
      rollover(now);
      if (state.fleetMonthTokens >= fleetMonthlyBudget * fleetReserveRatio) {
        return { allowed: false, reason: 'fleet-reserve' };
      }
      const id = String(userId || '').trim() || 'anonymous';
      if ((state.users[id] || 0) >= userDailyCap) {
        return { allowed: false, reason: 'user-cap' };
      }
      return { allowed: true, reason: 'ok' };
    },

    /** Read-only copy for diagnostics and tests. Token counts only. */
    snapshot() {
      return {
        day: state.day,
        month: state.month,
        users: { ...state.users },
        fleetMonthTokens: state.fleetMonthTokens,
      };
    },
  };
}
