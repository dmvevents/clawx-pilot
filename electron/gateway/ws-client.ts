import WebSocket from 'ws';
import type { DeviceIdentity } from '../utils/device-identity';
import type { PendingGatewayRequest } from './request-store';
import {
  buildDeviceAuthPayload,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from '../utils/device-identity';
import { logger } from '../utils/logger';

export const GATEWAY_CHALLENGE_TIMEOUT_MS = 10_000;
export const GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS = 20_000;

export async function probeGatewayReady(
  port: number,
  timeoutMs = 1500,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const testWs = new WebSocket(`ws://localhost:${port}/ws`);
    let settled = false;

    const resolveOnce = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        // Use terminate() (TCP RST) instead of close() (WS close handshake)
        // to avoid leaving TIME_WAIT connections on Windows. These probe
        // WebSockets are short-lived and don't need a graceful close.
        testWs.terminate();
      } catch {
        // ignore
      }
      resolve(value);
    };

    const timeout = setTimeout(() => {
      resolveOnce(false);
    }, timeoutMs);

    testWs.on('open', () => {
      // Do not resolve on plain socket open. The gateway can accept the TCP/WebSocket
      // connection before it is ready to issue protocol challenges, which previously
      // caused a false "ready" result and then a full connect() stall.
    });

    testWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as { type?: string; event?: string };
        if (message.type === 'event' && message.event === 'connect.challenge') {
          resolveOnce(true);
        }
      } catch {
        // ignore malformed probe payloads
      }
    });

    testWs.on('error', () => {
      resolveOnce(false);
    });

    testWs.on('close', () => {
      resolveOnce(false);
    });
  });
}

export async function waitForGatewayReady(options: {
  port: number;
  getProcessExitCode: () => number | null;
  retries?: number;
  intervalMs?: number;
}): Promise<void> {
  const retries = options.retries ?? 2400;
  const intervalMs = options.intervalMs ?? 200;

  for (let i = 0; i < retries; i++) {
    const exitCode = options.getProcessExitCode();
    if (exitCode !== null) {
      logger.error(`Gateway process exited before ready (code=${exitCode})`);
      throw new Error(`Gateway process exited before becoming ready (code=${exitCode})`);
    }

    try {
      const ready = await probeGatewayReady(options.port, 1500);
      if (ready) {
        logger.debug(`Gateway ready after ${i + 1} attempt(s)`);
        return;
      }
    } catch {
      // Gateway not ready yet.
    }

    if (i > 0 && i % 10 === 0) {
      logger.debug(`Still waiting for Gateway... (attempt ${i + 1}/${retries})`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  logger.error(`Gateway failed to become ready after ${retries} attempts on port ${options.port}`);
  throw new Error(`Gateway failed to start after ${retries} retries (port ${options.port})`);
}

export function buildGatewayConnectFrame(options: {
  challengeNonce: string;
  token: string;
  deviceIdentity: DeviceIdentity | null;
  platform: string;
  /**
   * Per-device token issued by the gateway after pairing. When present, the
   * gateway requires it on the connect frame; the shared `auth.token` will be
   * rejected with AUTH_TOKEN_MISMATCH for any paired device.
   */
  deviceToken?: string | null;
}): { connectId: string; frame: Record<string, unknown> } {
  const connectId = `connect-${Date.now()}`;
  const role = 'operator';
  const scopes = ['operator.admin'];
  const signedAtMs = Date.now();
  const clientId = 'gateway-client';
  const clientMode = 'ui';

  // The signed payload's `token` field MUST equal whichever credential we
  // present in `auth.*`, otherwise the server's signature check fails even
  // though the token itself is correct.
  const useDeviceToken = typeof options.deviceToken === 'string' && options.deviceToken.length > 0;
  const signatureToken = useDeviceToken ? options.deviceToken! : options.token;

  const device = (() => {
    if (!options.deviceIdentity) return undefined;

    const payload = buildDeviceAuthPayload({
      deviceId: options.deviceIdentity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: signatureToken ?? null,
      nonce: options.challengeNonce,
    });
    const signature = signDevicePayload(options.deviceIdentity.privateKeyPem, payload);
    return {
      id: options.deviceIdentity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(options.deviceIdentity.publicKeyPem),
      signature,
      signedAt: signedAtMs,
      nonce: options.challengeNonce,
    };
  })();

  const auth: Record<string, unknown> = useDeviceToken
    ? { deviceToken: options.deviceToken }
    : { token: options.token };

  return {
    connectId,
    frame: {
      type: 'req',
      id: connectId,
      method: 'connect',
      params: {
        // The bundled gateway (openclaw 2026.9.2) requires protocol 4 for a real
        // connect and logs `expected=4` when refusing; only its liveness PROBE
        // still accepts 3 (`probeMin=3`), which is why a port check and a
        // readiness probe both pass while every actual connect is rejected with
        // close 1002 "protocol mismatch" and the composer stays disabled forever.
        //
        // Offer a RANGE rather than a pin: 3 keeps older gateways working, 4
        // satisfies the bundled one, and the gateway selects the highest mutually
        // supported version. Pinning min === max was the defect - it made a
        // gateway upgrade a hard break instead of a negotiation. See CLWX-138 and
        // docs/VERSION_COMPATIBILITY_MATRIX.md.
        minProtocol: 3,
        maxProtocol: 4,
        client: {
          id: clientId,
          displayName: 'ClawX',
          version: '0.1.0',
          platform: options.platform,
          mode: clientMode,
        },
        auth,
        caps: [],
        role,
        scopes,
        device,
      },
    },
  };
}

export async function connectGatewaySocket(options: {
  port: number;
  deviceIdentity: DeviceIdentity | null;
  platform: string;
  pendingRequests: Map<string, PendingGatewayRequest>;
  getToken: () => Promise<string>;
  /**
   * Optional resolver for the per-device token issued by the gateway after
   * pairing (`~/.openclaw/devices/paired.json`). When this returns a non-empty
   * string, the connect frame uses `auth.deviceToken` instead of the shared
   * `auth.token` — required for paired devices.
   */
  getDeviceToken?: () => Promise<string | null>;
  onHandshakeComplete: (ws: WebSocket) => void;
  onMessage: (message: unknown) => void;
  onCloseAfterHandshake: (code: number) => void;
  challengeTimeoutMs?: number;
  connectTimeoutMs?: number;
}): Promise<WebSocket> {
  logger.debug(`Connecting Gateway WebSocket (ws://localhost:${options.port}/ws)`);
  const challengeTimeoutMs = options.challengeTimeoutMs ?? GATEWAY_CHALLENGE_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS;

  return await new Promise<WebSocket>((resolve, reject) => {
    const wsUrl = `ws://localhost:${options.port}/ws`;
    const ws = new WebSocket(wsUrl);
    let handshakeComplete = false;
    let connectId: string | null = null;
    let handshakeTimeout: NodeJS.Timeout | null = null;
    let challengeTimer: NodeJS.Timeout | null = null;
    let challengeReceived = false;
    let settled = false;

    const cleanupHandshakeRequest = () => {
      if (challengeTimer) {
        clearTimeout(challengeTimer);
        challengeTimer = null;
      }
      if (handshakeTimeout) {
        clearTimeout(handshakeTimeout);
        handshakeTimeout = null;
      }
      if (connectId && options.pendingRequests.has(connectId)) {
        const request = options.pendingRequests.get(connectId);
        if (request) {
          clearTimeout(request.timeout);
        }
        options.pendingRequests.delete(connectId);
      }
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanupHandshakeRequest();
      resolve(ws);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanupHandshakeRequest();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const sendConnectHandshake = async (challengeNonce: string) => {
      logger.debug('Sending connect handshake with challenge nonce');

      const currentToken = await options.getToken();
      const deviceToken = options.getDeviceToken ? await options.getDeviceToken() : null;
      if (deviceToken) {
        logger.debug('Using paired device token for connect handshake');
      }
      const connectPayload = buildGatewayConnectFrame({
        challengeNonce,
        token: currentToken,
        deviceIdentity: options.deviceIdentity,
        platform: options.platform,
        deviceToken,
      });
      connectId = connectPayload.connectId;

      ws.send(JSON.stringify(connectPayload.frame));

      const requestTimeout = setTimeout(() => {
        if (!handshakeComplete) {
          logger.error('Gateway connect handshake timed out');
          ws.close();
          rejectOnce(new Error('Connect handshake timeout'));
        }
      }, connectTimeoutMs);
      handshakeTimeout = requestTimeout;

      options.pendingRequests.set(connectId, {
        resolve: () => {
          handshakeComplete = true;
          logger.debug('Gateway connect handshake completed');
          options.onHandshakeComplete(ws);
          resolveOnce();
        },
        reject: (error) => {
          logger.error('Gateway connect handshake failed:', error);
          rejectOnce(error);
        },
        timeout: requestTimeout,
      });
    };

    challengeTimer = setTimeout(() => {
      if (!challengeReceived && !settled) {
        logger.error('Gateway connect.challenge not received within timeout');
        ws.close();
        rejectOnce(new Error('Timed out waiting for connect.challenge from Gateway'));
      }
    }, challengeTimeoutMs);

    ws.on('open', () => {
      logger.debug('Gateway WebSocket opened, waiting for connect.challenge...');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (
          !challengeReceived &&
          typeof message === 'object' && message !== null &&
          message.type === 'event' && message.event === 'connect.challenge'
        ) {
          challengeReceived = true;
          if (challengeTimer) {
            clearTimeout(challengeTimer);
            challengeTimer = null;
          }
          const nonce = message.payload?.nonce as string | undefined;
          if (!nonce) {
            rejectOnce(new Error('Gateway connect.challenge missing nonce'));
            return;
          }
          logger.debug('Received connect.challenge, sending handshake');
          void sendConnectHandshake(nonce);
          return;
        }

        options.onMessage(message);
      } catch (error) {
        logger.debug('Failed to parse Gateway WebSocket message:', error);
      }
    });

    ws.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || 'unknown';
      logger.warn(`Gateway WebSocket closed (code=${code}, reason=${reasonStr}, handshake=${handshakeComplete ? 'ok' : 'pending'})`);
      if (!handshakeComplete) {
        rejectOnce(new Error(`WebSocket closed before handshake: ${reasonStr}`));
        return;
      }
      cleanupHandshakeRequest();
      options.onCloseAfterHandshake(code);
    });

    ws.on('error', (error) => {
      if (error.message?.includes('closed before handshake') || (error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        logger.debug(`Gateway WebSocket connection error (transient): ${error.message}`);
      } else {
        logger.error('Gateway WebSocket error:', error);
      }
      if (!handshakeComplete) {
        rejectOnce(error);
      }
    });
  });
}
