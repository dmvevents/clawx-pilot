/**
 * Paired-device token resolver.
 *
 * After OpenClaw Gateway approves a device pairing, the device is recorded in
 * `~/.openclaw/devices/paired.json` with a per-device, per-role auth token. The
 * gateway then *requires* that device token on subsequent handshakes for that
 * device — the shared `gateway.auth.token` is no longer sufficient and the
 * server returns AUTH_TOKEN_MISMATCH (`canRetryWithDeviceToken: true`).
 *
 * This module reads the per-device token for our deviceId (if pairing exists)
 * so the connect frame can present `auth.deviceToken`. Falls back to null when
 * the device has not been paired yet — callers should send the shared token.
 */
import { join } from 'path';
import { homedir } from 'os';
import { readFile } from 'fs/promises';

const PAIRED_DEVICES_PATH = join(homedir(), '.openclaw', 'devices', 'paired.json');

export interface PairedDeviceToken {
  token: string;
  role: string;
  scopes: string[];
}

interface PairedDeviceEntry {
  deviceId?: string;
  tokens?: Record<string, { token?: unknown; role?: unknown; scopes?: unknown } | undefined>;
}

export async function readPairedDeviceToken(
  deviceId: string,
  role = 'operator',
): Promise<PairedDeviceToken | null> {
  if (!deviceId) return null;
  let raw: string;
  try {
    raw = await readFile(PAIRED_DEVICES_PATH, 'utf8');
  } catch {
    return null;
  }
  let parsed: Record<string, PairedDeviceEntry> | null;
  try {
    parsed = JSON.parse(raw) as Record<string, PairedDeviceEntry>;
  } catch {
    return null;
  }
  const entry = parsed?.[deviceId];
  const tokenEntry = entry?.tokens?.[role];
  if (!tokenEntry || typeof tokenEntry.token !== 'string' || tokenEntry.token.length === 0) {
    return null;
  }
  const scopes = Array.isArray(tokenEntry.scopes)
    ? tokenEntry.scopes.filter((s): s is string => typeof s === 'string')
    : [];
  return {
    token: tokenEntry.token,
    role: typeof tokenEntry.role === 'string' ? tokenEntry.role : role,
    scopes,
  };
}
