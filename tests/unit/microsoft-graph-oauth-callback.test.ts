// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  interpretOAuthCallback,
  loginMicrosoftGraphOAuth,
  MicrosoftGraphSignInDeclined,
  refreshMicrosoftGraphToken,
} from '../../electron/utils/microsoft-graph-oauth';

const STATE = 'expected-state';

describe('interpretOAuthCallback', () => {
  it('accepts a code with matching CSRF state', () => {
    expect(
      interpretOAuthCallback(`/callback?code=abc123&state=${STATE}`, STATE),
    ).toEqual({ kind: 'code', code: 'abc123' });
  });

  it('classifies an OAuth error redirect (user cancel) carrying our CSRF state', () => {
    // Entra sends error=access_denied when the user cancels or declines
    // consent on Microsoft's page, and echoes the request's `state` on the
    // error redirect (OAuth 2.0 §4.1.2.1 authorization error response).
    expect(
      interpretOAuthCallback(
        `/callback?error=access_denied&error_description=AADSTS65004%3A+User+declined&state=${STATE}`,
        STATE,
      ),
    ).toEqual({
      kind: 'error',
      error: 'access_denied',
      description: 'AADSTS65004: User declined',
    });
  });

  it('rejects an error redirect whose CSRF state is missing or wrong (foreign callback)', () => {
    // Regression (root review 2026-09-08): error used to be classified before
    // state, and lastError now terminates waitForCode — so any process able
    // to hit the loopback could cancel the real pending sign-in by sending
    // access_denied without our state. A callback that does not carry our
    // state belongs to no request of ours: neither its code nor its error
    // may affect the flow.
    expect(
      interpretOAuthCallback('/callback?error=access_denied', STATE),
    ).toEqual({ kind: 'state_mismatch' });
    expect(
      interpretOAuthCallback(
        '/callback?error=access_denied&error_description=forged&state=other',
        STATE,
      ),
    ).toEqual({ kind: 'state_mismatch' });
  });

  it('rejects a state mismatch (CSRF) even when a code is present', () => {
    expect(
      interpretOAuthCallback('/callback?code=abc123&state=other', STATE),
    ).toEqual({ kind: 'state_mismatch' });
  });

  it('flags a callback without code or error', () => {
    expect(interpretOAuthCallback(`/callback?state=${STATE}`, STATE)).toEqual({
      kind: 'missing_code',
    });
  });

  it('ignores non-callback paths', () => {
    expect(interpretOAuthCallback('/favicon.ico', STATE)).toEqual({ kind: 'not_callback' });
  });
});

describe('loginMicrosoftGraphOAuth cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects promptly with a typed declined error when the user cancels on the Microsoft page', async () => {
    // Reproduces the reported gap: before the fix the loopback ignored the
    // error redirect and the renderer spinner hung for the full 10-minute
    // window before falling back to the manual-code prompt.
    const login = loginMicrosoftGraphOAuth({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      openUrl: async (url) => {
        // Simulate the browser round-trip: Microsoft redirects the user's
        // browser back to the loopback with error=access_denied.
        const authorize = new URL(url);
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
        // Entra echoes the request's `state` on the error redirect.
        const state = authorize.searchParams.get('state');
        await fetch(
          `http://localhost:53682/callback?error=access_denied&error_description=AADSTS65004&state=${state}`,
        );
      },
      // If the loopback port were unavailable the flow would ask for a manual
      // code; fail fast instead of hanging so the test stays bounded.
      onManualCodeInput: () => Promise.reject(new Error('manual code path should not be used')),
    });

    const started = Date.now();
    await expect(login).rejects.toBeInstanceOf(MicrosoftGraphSignInDeclined);
    // Well under the legacy 10-minute wait: the error resolves the callback.
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 15_000);

  it('does not cancel the real sign-in when a foreign access_denied callback lacks our state', async () => {
    // Regression (root review 2026-09-08): with lastError terminating
    // waitForCode, a loopback hit carrying access_denied but a missing/wrong
    // state used to cancel the genuine pending auth flow. It must be answered
    // 400 (state mismatch) and ignored; the real code callback still wins.
    const realFetch = fetch;
    const fakeJwt = (claims: Record<string, unknown>) =>
      `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const href = String(input);
      if (href.includes('localhost:53682')) return realFetch(input, init);
      // Token endpoint: synthetic success so the flow can complete offline.
      expect(href).toContain('/oauth2/v2.0/token');
      return new Response(
        JSON.stringify({
          access_token: fakeJwt({ oid: 'oid-1', tid: 'tid-1' }),
          refresh_token: 'refresh-1',
          expires_in: 3600,
          scope: 'User.Read Mail.Read offline_access',
          id_token: fakeJwt({ oid: 'oid-1', tid: 'tid-1', preferred_username: 'p@moe.gov.tt' }),
        }),
        { status: 200 },
      );
    }));

    const credentials = await loginMicrosoftGraphOAuth({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      openUrl: async (url) => {
        const state = new URL(url).searchParams.get('state');
        // Foreign/forged callbacks: error without state, then wrong state.
        const forged1 = await realFetch(
          'http://localhost:53682/callback?error=access_denied&error_description=forged',
        );
        expect(forged1.status).toBe(400);
        const forged2 = await realFetch(
          'http://localhost:53682/callback?error=access_denied&state=not-ours',
        );
        expect(forged2.status).toBe(400);
        // The genuine redirect follows and must still complete the flow.
        const genuine = await realFetch(
          `http://localhost:53682/callback?code=real-code&state=${state}`,
        );
        expect(genuine.status).toBe(200);
      },
      onManualCodeInput: () => Promise.reject(new Error('manual code path should not be used')),
    });

    expect(credentials.accountId).toBe('oid-1');
    expect(credentials.tenantId).toBe('tid-1');
  }, 15_000);
});

describe('refreshMicrosoftGraphToken error classification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('attaches the OAuth error code from a rejected refresh (invalid_grant)', async () => {
    // Microsoft identity platform returns HTTP 400 with a JSON body
    // { "error": "invalid_grant", ... } when the refresh token is expired or
    // revoked; only a fresh interactive sign-in can repair it.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS70008: expired' }),
      { status: 400 },
    )));

    const attempt = refreshMicrosoftGraphToken({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      refreshToken: 'stale-refresh-token',
    });
    await expect(attempt).rejects.toMatchObject({ oauthError: 'invalid_grant' });
  });

  it('leaves the code unset for non-JSON transport failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    const attempt = refreshMicrosoftGraphToken({
      tenantId: 'tenant-1',
      clientId: 'client-1',
      refreshToken: 'token',
    });
    await expect(attempt).rejects.toMatchObject({ oauthError: undefined });
  });
});
