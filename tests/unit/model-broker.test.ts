import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

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

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error('condition was not met before timeout');
}

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

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => closeServer(server)));
});

describe('model broker', () => {
  it('packages every relative server import in the broker Docker image', async () => {
    const [serverSource, dockerfile] = await Promise.all([
      readFile('services/model-broker/server.mjs', 'utf8'),
      readFile('services/model-broker/Dockerfile', 'utf8'),
    ]);
    const relativeImports = [...serverSource.matchAll(new RegExp("from ['\"]\\./([^'\"]+)['\"]", 'g'))]
      .map((match) => match[1])
      .sort();

    expect(relativeImports).toContain('usage-meter.mjs');
    for (const importedFile of relativeImports) {
      expect(dockerfile, importedFile).toContain(importedFile);
    }
  });

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

  it('rejects inherited or non-string model map values without calling upstream', async () => {
    let upstreamCalls = 0;
    const upstream = await listen(createServer((_req, res) => {
      upstreamCalls += 1;
      res.writeHead(200);
      res.end('{}');
    }));
    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstream.url}/v1`,
      modelMap: {
        'moe-demo': 'gemini-2.5-pro',
        bad: { nested: 'not-a-model' },
      },
    })));

    for (const model of ['toString', 'constructor', '__proto__', 'bad']) {
      const response = await fetch(`${broker.url}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer client-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hello' }] }),
      });

      expect(response.status, model).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'MODEL_NOT_ALLOWED' },
      });
    }
    expect(upstreamCalls).toBe(0);
  });

  it('uses Google ADC metadata tokens for Vertex upstream auth', async () => {
    let tokenCalls = 0;
    const metadata = await listen(createServer((req, res) => {
      tokenCalls += 1;
      expect(req.headers['metadata-flavor']).toBe('Google');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: 'google-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }));
    }));

    const upstreamRequests: Array<{
      url: string | undefined;
      authorization: string | undefined;
      body: Record<string, unknown>;
    }> = [];
    const upstream = await listen(createServer(async (req, res) => {
      upstreamRequests.push({
        url: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(await readBody(req)) as Record<string, unknown>,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'chatcmpl-vertex-test', choices: [] }));
    }));

    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstream.url}/v1/projects/test-project/locations/global/endpoints/openapi`,
      upstreamAuth: 'google-adc',
      upstreamApiKey: '',
      googleTokenUrl: `${metadata.url}/token`,
      modelMap: { 'moe-demo': 'google/gemini-2.5-flash' },
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
    expect(tokenCalls).toBe(1);
    expect(upstreamRequests).toHaveLength(1);
    expect(upstreamRequests[0]).toMatchObject({
      url: '/v1/projects/test-project/locations/global/endpoints/openapi/chat/completions',
      authorization: 'Bearer google-access-token',
      body: { model: 'google/gemini-2.5-flash' },
    });
  });

  it('keeps the upstream timeout active until a streaming response body finishes', async () => {
    let upstreamClosed = false;
    const upstream = await listen(createServer((_req, res) => {
      res.on('close', () => {
        upstreamClosed = true;
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"partial":true');
      setTimeout(() => {
        res.end(',"late":true}');
      }, 250);
    }));
    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstream.url}/v1`,
      timeoutMs: 50,
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

    await expect(response.text()).rejects.toThrow();
    await waitFor(() => upstreamClosed);
  });

  it('keeps serving after an upstream streaming response is interrupted', async () => {
    const upstream = await listen(createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      res.write('{"partial":true');
      setTimeout(() => {
        res.destroy(new Error('upstream interrupted'));
      }, 20);
    }));
    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstream.url}/v1`,
      timeoutMs: 5_000,
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
    await expect(response.text()).rejects.toThrow();

    const health = await fetch(`${broker.url}/healthz`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ ok: true });
  });

  it('aborts the upstream streaming response when the client disconnects', async () => {
    let upstreamClosed = false;
    const upstream = await listen(createServer((_req, res) => {
      res.on('close', () => {
        upstreamClosed = true;
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"partial":true');
    }));
    const broker = await listen(createBrokerServer(brokerConfig({
      upstreamBaseUrl: `${upstream.url}/v1`,
      timeoutMs: 5_000,
    })));

    const controller = new AbortController();
    const response = await fetch(`${broker.url}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: 'Bearer client-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moe-demo',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    controller.abort();
    await expect(response.text()).rejects.toThrow();
    await waitFor(() => upstreamClosed);
  });
});
