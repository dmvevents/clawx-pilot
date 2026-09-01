import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The broker is a deployment-time Node ESM script, not part of the TS app bundle.
// @ts-expect-error no local declaration file for this ESM utility.
import { createBrokerServer } from '../../services/model-broker/server.mjs';
// @ts-expect-error no local declaration file for this ESM utility.
import { DEFAULT_FLEET_MONTHLY_BUDGET, DEFAULT_USER_DAILY_CAP, createUsageMeter, parseConsumedTokens, perUserCapsEnabled } from '../../services/model-broker/usage-meter.mjs';

const openServers: Server[] = [];

function listen(server: Server): Promise<{ url: string }> {
  openServers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
});

function tempStatePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'clawx-usage-meter-')), 'usage-state.json');
}

function meterAt(statePath: string, overrides: Record<string, unknown> = {}) {
  return createUsageMeter({
    statePath,
    userDailyCap: 1_000,
    fleetMonthlyBudget: 100_000,
    ...overrides,
  });
}

const DAY_1 = new Date('2026-09-01T12:00:00Z');
const DAY_1_LATER = new Date('2026-09-01T15:30:00Z');
const DAY_2 = new Date('2026-09-02T08:00:00Z');
const NEXT_MONTH = new Date('2026-10-01T08:00:00Z');

describe('usage meter accounting', () => {
  it('accumulates per-user totals across calls within a day', () => {
    const meter = meterAt(tempStatePath());
    meter.recordUsage('principal-a', 300, DAY_1);
    meter.recordUsage('principal-a', 400, DAY_1_LATER);
    meter.recordUsage('principal-b', 50, DAY_1_LATER);

    const snapshot = meter.snapshot();
    expect(snapshot.users['principal-a']).toBe(700);
    expect(snapshot.users['principal-b']).toBe(50);
    expect(snapshot.fleetMonthTokens).toBe(750);
  });

  it('day rollover resets user totals but keeps the fleet month total', () => {
    const meter = meterAt(tempStatePath());
    meter.recordUsage('principal-a', 1_000, DAY_1);
    expect(meter.checkCap('principal-a', DAY_1)).toEqual({ allowed: false, reason: 'user-cap' });

    expect(meter.checkCap('principal-a', DAY_2)).toEqual({ allowed: true, reason: 'ok' });
    meter.recordUsage('principal-a', 10, DAY_2);
    const snapshot = meter.snapshot();
    expect(snapshot.users['principal-a']).toBe(10);
    expect(snapshot.fleetMonthTokens).toBe(1_010);
  });

  it('month rollover resets the fleet total', () => {
    const meter = meterAt(tempStatePath());
    meter.recordUsage('principal-a', 90_000, DAY_1);
    expect(meter.checkCap('anyone', DAY_2)).toEqual({ allowed: false, reason: 'fleet-reserve' });

    expect(meter.checkCap('anyone', NEXT_MONTH)).toEqual({ allowed: true, reason: 'ok' });
    meter.recordUsage('principal-a', 5, NEXT_MONTH);
    expect(meter.snapshot().fleetMonthTokens).toBe(5);
  });

  it('a user at the soft cap is denied with user-cap; other users still allowed', () => {
    const meter = meterAt(tempStatePath());
    meter.recordUsage('heavy-user', 1_000, DAY_1);

    expect(meter.checkCap('heavy-user', DAY_1_LATER)).toEqual({ allowed: false, reason: 'user-cap' });
    expect(meter.checkCap('light-user', DAY_1_LATER)).toEqual({ allowed: true, reason: 'ok' });
  });

  it('fleet at 90% of the monthly budget denies everyone with fleet-reserve', () => {
    const meter = meterAt(tempStatePath(), { userDailyCap: 1_000_000 });
    meter.recordUsage('principal-a', 45_000, DAY_1);
    meter.recordUsage('principal-b', 45_000, DAY_1);

    expect(meter.checkCap('principal-a', DAY_1_LATER)).toEqual({ allowed: false, reason: 'fleet-reserve' });
    expect(meter.checkCap('never-seen-user', DAY_1_LATER)).toEqual({ allowed: false, reason: 'fleet-reserve' });
  });

  it('persists totals across meter instances over the same file', () => {
    const statePath = tempStatePath();
    const first = meterAt(statePath);
    first.recordUsage('principal-a', 600, DAY_1);
    first.recordUsage('principal-b', 250, DAY_1);

    const second = meterAt(statePath);
    const snapshot = second.snapshot();
    expect(snapshot.users['principal-a']).toBe(600);
    expect(snapshot.users['principal-b']).toBe(250);
    expect(snapshot.fleetMonthTokens).toBe(850);

    second.recordUsage('principal-a', 400, DAY_1_LATER);
    expect(second.checkCap('principal-a', DAY_1_LATER)).toEqual({ allowed: false, reason: 'user-cap' });
  });

  it('survives a corrupt state file by starting clean', () => {
    const statePath = tempStatePath();
    writeFileSync(statePath, 'not json {', 'utf8');
    const meter = meterAt(statePath);
    expect(meter.checkCap('principal-a', DAY_1)).toEqual({ allowed: true, reason: 'ok' });
  });
});

describe('parseConsumedTokens', () => {
  it('reads an integer header from a fetch Headers object', () => {
    expect(parseConsumedTokens(new Headers({ 'consumed-tokens': '1234' }))).toEqual({
      tokens: 1234,
      present: true,
    });
  });

  it('reads from a plain header record', () => {
    expect(parseConsumedTokens({ 'consumed-tokens': '42' })).toEqual({ tokens: 42, present: true });
  });

  it('tolerates an absent header', () => {
    expect(parseConsumedTokens(new Headers())).toEqual({ tokens: 0, present: false });
    expect(parseConsumedTokens({})).toEqual({ tokens: 0, present: false });
    expect(parseConsumedTokens(undefined)).toEqual({ tokens: 0, present: false });
  });

  it('tolerates garbage values', () => {
    expect(parseConsumedTokens({ 'consumed-tokens': 'banana' })).toEqual({ tokens: 0, present: false });
    expect(parseConsumedTokens({ 'consumed-tokens': '-50' })).toEqual({ tokens: 0, present: false });
    expect(parseConsumedTokens({ 'consumed-tokens': '   ' })).toEqual({ tokens: 0, present: false });
  });
});

describe('CLAWX_PER_USER_CAPS flag helper', () => {
  it('defaults to false', () => {
    expect(perUserCapsEnabled({})).toBe(false);
    expect(perUserCapsEnabled({ CLAWX_PER_USER_CAPS: '' })).toBe(false);
  });

  it('honours 1/true and rejects everything else', () => {
    expect(perUserCapsEnabled({ CLAWX_PER_USER_CAPS: '1' })).toBe(true);
    expect(perUserCapsEnabled({ CLAWX_PER_USER_CAPS: 'true' })).toBe(true);
    expect(perUserCapsEnabled({ CLAWX_PER_USER_CAPS: '0' })).toBe(false);
    expect(perUserCapsEnabled({ CLAWX_PER_USER_CAPS: 'yes' })).toBe(false);
  });

  it('exposes the documented defaults', () => {
    expect(DEFAULT_USER_DAILY_CAP).toBe(500_000);
    expect(DEFAULT_FLEET_MONTHLY_BUDGET).toBe(100_000_000);
  });
});

// ── Broker wiring ────────────────────────────────────────────────────

function brokerConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    clientKeys: ['client-key'],
    upstreamBaseUrl: 'http://127.0.0.1:1/v1',
    upstreamAuth: 'bearer-key',
    upstreamApiKey: 'provider-key',
    upstreamHeaders: {},
    googleTokenUrl: 'http://127.0.0.1:1/token',
    modelMap: { 'moe-demo': 'gemini-2.5-pro' },
    defaultModel: 'moe-demo',
    timeoutMs: 5_000,
    ...overrides,
  };
}

function chatRequest(brokerUrl: string, userId?: string) {
  return fetch(`${brokerUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer client-key',
      'Content-Type': 'application/json',
      ...(userId ? { UserId: userId } : {}),
    },
    body: JSON.stringify({
      model: 'moe-demo',
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });
}

function stubUpstream(consumedTokensHeader?: string) {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls += 1;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(consumedTokensHeader != null ? { 'consumed-tokens': consumedTokensHeader } : {}),
    });
    res.end(JSON.stringify({ id: 'chatcmpl-test', choices: [] }));
  });
  return { server, callCount: () => calls };
}

describe('model broker cap wiring', () => {
  it('flag off: proxies without consulting the meter even when state says over-cap', async () => {
    const statePath = tempStatePath();
    // Pre-saturate the state file: were the meter consulted, this denies everyone.
    meterAt(statePath).recordUsage('principal-a', 1_000_000, new Date());

    const upstream = stubUpstream('10');
    const { url: upstreamUrl } = await listen(upstream.server);
    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstreamUrl}/v1`,
      perUserCaps: false,
      usage: { statePath, userDailyCap: 1_000 },
    })));

    const response = await chatRequest(broker.url, 'principal-a');
    expect(response.status).toBe(200);
    expect(upstream.callCount()).toBe(1);

    // And the meter never recorded the turn: state on disk is unchanged.
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state.fleetMonthTokens).toBe(1_000_000);
  });

  it('flag on: records consumed-tokens per UserId after a successful proxy', async () => {
    const statePath = tempStatePath();
    const upstream = stubUpstream('700');
    const { url: upstreamUrl } = await listen(upstream.server);
    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstreamUrl}/v1`,
      perUserCaps: true,
      usage: { statePath, userDailyCap: 1_000, fleetMonthlyBudget: 100_000 },
    })));

    const first = await chatRequest(broker.url, 'principal-a');
    expect(first.status).toBe(200);

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state.users['principal-a']).toBe(700);
    expect(state.fleetMonthTokens).toBe(700);

    // Second turn pushes principal-a to 1400 >= 1000; the third is denied
    // with the structured user-cap 429, without reaching upstream.
    const second = await chatRequest(broker.url, 'principal-a');
    expect(second.status).toBe(200);
    const third = await chatRequest(broker.url, 'principal-a');
    expect(third.status).toBe(429);
    await expect(third.json()).resolves.toMatchObject({
      reason: 'user-cap',
      error: { code: 'USAGE_CAP' },
    });
    expect(upstream.callCount()).toBe(2);

    // A different principal is still allowed through.
    const other = await chatRequest(broker.url, 'principal-b');
    expect(other.status).toBe(200);
  });

  it('flag on: missing UserId meters as anonymous', async () => {
    const statePath = tempStatePath();
    const upstream = stubUpstream('55');
    const { url: upstreamUrl } = await listen(upstream.server);
    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstreamUrl}/v1`,
      perUserCaps: true,
      usage: { statePath, userDailyCap: 1_000, fleetMonthlyBudget: 100_000 },
    })));

    const response = await chatRequest(broker.url);
    expect(response.status).toBe(200);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state.users.anonymous).toBe(55);
  });

  it('flag on: fleet reserve denies every user with a structured 429', async () => {
    const statePath = tempStatePath();
    // Seed the fleet month-to-date to the 90% reserve threshold.
    meterAt(statePath, { fleetMonthlyBudget: 100_000 }).recordUsage('someone-else', 90_000, new Date());

    const upstream = stubUpstream('10');
    const { url: upstreamUrl } = await listen(upstream.server);
    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstreamUrl}/v1`,
      perUserCaps: true,
      usage: { statePath, userDailyCap: 1_000, fleetMonthlyBudget: 100_000 },
    })));

    const response = await chatRequest(broker.url, 'fresh-user');
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      reason: 'fleet-reserve',
      error: { code: 'USAGE_CAP' },
    });
    expect(upstream.callCount()).toBe(0);
  });

  it('flag on: an upstream response without consumed-tokens records nothing', async () => {
    const statePath = tempStatePath();
    const upstream = stubUpstream();
    const { url: upstreamUrl } = await listen(upstream.server);
    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstreamUrl}/v1`,
      perUserCaps: true,
      usage: { statePath, userDailyCap: 1_000, fleetMonthlyBudget: 100_000 },
    })));

    const response = await chatRequest(broker.url, 'principal-a');
    expect(response.status).toBe(200);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state.users['principal-a']).toBe(0);
    expect(state.fleetMonthTokens).toBe(0);
  });
});
