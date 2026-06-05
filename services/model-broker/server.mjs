#!/usr/bin/env node
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 120_000;
const BROKER_OWNER = 'clawx-model-broker';

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonObject(value, label) {
  if (!value || !String(value).trim()) {
    return {};
  }

  const parsed = JSON.parse(String(value));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function parseModelMap(value) {
  const raw = parseJsonObject(value, 'MODEL_BROKER_MODEL_MAP');
  const result = {};
  for (const [publicModel, upstreamModel] of Object.entries(raw)) {
    if (typeof upstreamModel !== 'string' || !upstreamModel.trim()) {
      throw new Error(`MODEL_BROKER_MODEL_MAP.${publicModel} must be a non-empty string`);
    }
    result[publicModel] = upstreamModel.trim();
  }
  return result;
}

export function buildConfig(env = process.env) {
  return {
    clientKeys: parseCsv(env.MODEL_BROKER_CLIENT_KEYS || env.MODEL_BROKER_PUBLIC_KEYS),
    upstreamBaseUrl: String(env.MODEL_BROKER_UPSTREAM_BASE_URL || '').replace(/\/+$/, ''),
    upstreamApiKey: String(env.MODEL_BROKER_UPSTREAM_API_KEY || ''),
    upstreamHeaders: parseJsonObject(env.MODEL_BROKER_UPSTREAM_HEADERS, 'MODEL_BROKER_UPSTREAM_HEADERS'),
    modelMap: parseModelMap(env.MODEL_BROKER_MODEL_MAP),
    defaultModel: String(env.MODEL_BROKER_DEFAULT_MODEL || '').trim(),
    timeoutMs: Number.parseInt(String(env.MODEL_BROKER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS,
  };
}

export function validateConfig(config) {
  const errors = [];
  if (!Array.isArray(config.clientKeys) || config.clientKeys.length === 0) {
    errors.push('MODEL_BROKER_CLIENT_KEYS is required');
  }
  if (!config.upstreamBaseUrl) {
    errors.push('MODEL_BROKER_UPSTREAM_BASE_URL is required');
  }
  if (!config.upstreamApiKey) {
    errors.push('MODEL_BROKER_UPSTREAM_API_KEY is required');
  }
  if (!config.modelMap || Object.keys(config.modelMap).length === 0) {
    errors.push('MODEL_BROKER_MODEL_MAP is required');
  }
  return errors;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function getBearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return '';
  }
  return header.slice('Bearer '.length).trim();
}

function isAuthorized(req, config) {
  const bearer = getBearer(req);
  return Boolean(bearer && config.clientKeys.includes(bearer));
}

function upstreamUrl(config, path) {
  const suffix = config.upstreamBaseUrl.endsWith('/v1') && path.startsWith('/v1/')
    ? path.slice('/v1'.length)
    : path;
  return `${config.upstreamBaseUrl}${suffix}`;
}

function publicModels(config) {
  return Object.keys(config.modelMap);
}

function resolveModel(body, config) {
  const requestedModel = typeof body.model === 'string' && body.model.trim()
    ? body.model.trim()
    : config.defaultModel || publicModels(config)[0];
  const upstreamModel = config.modelMap[requestedModel];
  if (!upstreamModel) {
    return {
      error: {
        code: 'MODEL_NOT_ALLOWED',
        message: `Model "${requestedModel}" is not enabled for this gateway.`,
      },
    };
  }
  return { requestedModel, upstreamModel };
}

async function readBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object');
  }
  return parsed;
}

async function pipeFetchResponse(upstreamResponse, res) {
  const headers = {
    'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  res.writeHead(upstreamResponse.status, headers);
  if (!upstreamResponse.body) {
    res.end(await upstreamResponse.text().catch(() => ''));
    return;
  }
  Readable.fromWeb(upstreamResponse.body).pipe(res);
}

async function proxyModelRequest(req, res, path, config) {
  const body = await readJsonBody(req);
  const resolved = resolveModel(body, config);
  if (resolved.error) {
    sendJson(res, 400, { error: resolved.error });
    return;
  }

  const upstreamBody = {
    ...body,
    model: resolved.upstreamModel,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const upstreamResponse = await fetch(upstreamUrl(config, path), {
      method: 'POST',
      headers: {
        ...config.upstreamHeaders,
        Authorization: `Bearer ${config.upstreamApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });
    await pipeFetchResponse(upstreamResponse, res);
  } finally {
    clearTimeout(timeout);
  }
}

export function createBrokerServer(config = buildConfig()) {
  const configErrors = validateConfig(config);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/healthz') {
        sendJson(res, configErrors.length === 0 ? 200 : 503, {
          ok: configErrors.length === 0,
          modelCount: publicModels(config).length,
          errors: configErrors,
        });
        return;
      }

      if (configErrors.length > 0) {
        sendJson(res, 503, { error: { code: 'BROKER_NOT_CONFIGURED', message: configErrors.join('; ') } });
        return;
      }

      if (!isAuthorized(req, config)) {
        sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token' } });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/models') {
        sendJson(res, 200, {
          object: 'list',
          data: publicModels(config).map((id) => ({
            id,
            object: 'model',
            created: 0,
            owned_by: BROKER_OWNER,
          })),
        });
        return;
      }

      if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/v1/responses')) {
        await proxyModelRequest(req, res, url.pathname, config);
        return;
      }

      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${url.pathname}` } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('too large') ? 413 : 500;
      sendJson(res, status, { error: { code: 'BROKER_ERROR', message } });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const config = buildConfig();
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error(`Model broker configuration error: ${errors.join('; ')}`);
    process.exit(1);
  }

  const port = Number.parseInt(process.env.PORT || process.env.MODEL_BROKER_PORT || '8787', 10);
  const host = process.env.MODEL_BROKER_HOST || '0.0.0.0';
  createBrokerServer(config).listen(port, host, () => {
    console.log(`ClawX model broker listening on http://${host}:${port}`);
  });
}
