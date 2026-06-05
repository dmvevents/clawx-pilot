import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The broker is a deployment-time Node ESM script, not part of the TS app bundle.
// @ts-expect-error no local declaration file for this ESM utility.
import { createBrokerServer } from '../../services/model-broker/server.mjs';

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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function brokerConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    clientKeys: ['client-key'],
    upstreamBaseUrl: 'http://127.0.0.1:1/v1',
    upstreamApiKey: 'provider-key',
    upstreamHeaders: {},
    modelMap: { 'moe-demo': 'gemini-2.5-pro' },
    defaultModel: 'moe-demo',
    timeoutMs: 5_000,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
});

describe('model broker', () => {
  it('requires a client bearer token before listing models', async () => {
    const broker = await listen(createBrokerServer(brokerConfig()));

    const response = await fetch(`${broker.url}/v1/models`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('lists only public broker model ids', async () => {
    const broker = await listen(createBrokerServer(brokerConfig()));

    const response = await fetch(`${broker.url}/v1/models`, {
      headers: { Authorization: 'Bearer client-key' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      object: 'list',
      data: [
        {
          id: 'moe-demo',
          object: 'model',
          created: 0,
          owned_by: 'clawx-model-broker',
        },
      ],
    });
  });

  it('maps public model ids before proxying chat completions upstream', async () => {
    const upstreamRequests: Array<{
      url: string | undefined;
      authorization: string | undefined;
      extraHeader: string | undefined;
      body: Record<string, unknown>;
    }> = [];
    const upstream = await listen(createServer(async (req, res) => {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      upstreamRequests.push({
        url: req.url,
        authorization: req.headers.authorization,
        extraHeader: req.headers['x-broker-test'] as string | undefined,
        body,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'chatcmpl-test', model: body.model, choices: [] }));
    }));
    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstream.url}/v1`,
      upstreamHeaders: { 'X-Broker-Test': 'enabled' },
    })));

    const response = await fetch(`${broker.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer client-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moe-demo',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ model: 'gemini-2.5-pro' });
    expect(upstreamRequests).toHaveLength(1);
    expect(upstreamRequests[0]).toMatchObject({
      url: '/v1/chat/completions',
      authorization: 'Bearer provider-key',
      extraHeader: 'enabled',
      body: { model: 'gemini-2.5-pro' },
    });
  });

  it('rejects models outside the broker allowlist without calling upstream', async () => {
    let upstreamCalls = 0;
    const upstream = await listen(createServer((_req, res) => {
      upstreamCalls += 1;
      res.writeHead(200);
      res.end('{}');
    }));
    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstream.url}/v1`,
    })));

    const response = await fetch(`${broker.url}/v1/responses`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer client-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'not-enabled', input: 'hello' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'MODEL_NOT_ALLOWED' },
    });
    expect(upstreamCalls).toBe(0);
  });
});
