// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readMicrosoftGraphConfigFromEnv,
  readMicrosoftGraphConfigFromFile,
} from '../../electron/services/microsoft-graph/store';
import { DEFAULT_GRAPH_SCOPES } from '../../electron/utils/microsoft-graph-oauth';

describe('Microsoft Graph default scopes', () => {
  it('defaults to the read-only baseline the Ministry admin consent covers', () => {
    // Richer sets (Mail.ReadWrite, Mail.Send, Calendars.Read) must come from
    // config.scopes; requesting them by default breaks in-app sign-in with a
    // consent failure.
    expect(DEFAULT_GRAPH_SCOPES).toEqual(['offline_access', 'User.Read', 'Mail.Read']);
  });
});

describe('Microsoft Graph config bootstrap', () => {
  it('returns null until tenant and client id are both present', () => {
    expect(readMicrosoftGraphConfigFromEnv({})).toBeNull();
    expect(readMicrosoftGraphConfigFromEnv({
      CLAWX_MICROSOFT_GRAPH_TENANT_ID: 'moe.gov.tt',
    })).toBeNull();
  });

  it('reads non-secret tenant defaults from release environment variables', () => {
    expect(readMicrosoftGraphConfigFromEnv({
      CLAWX_MICROSOFT_GRAPH_TENANT_ID: 'moe.gov.tt',
      CLAWX_MICROSOFT_GRAPH_CLIENT_ID: 'client-id',
      CLAWX_MICROSOFT_GRAPH_SCOPES: 'User.Read Mail.Read,Mail.Send',
      CLAWX_MICROSOFT_GRAPH_REDIRECT_URI: 'http://localhost:53682/callback',
    })).toEqual({
      tenantId: 'moe.gov.tt',
      clientId: 'client-id',
      scopes: ['User.Read', 'Mail.Read', 'Mail.Send'],
      redirectUri: 'http://localhost:53682/callback',
    });
  });

  it('supports short aliases for installer/policy bootstrap', () => {
    expect(readMicrosoftGraphConfigFromEnv({
      CLAWX_MS_GRAPH_TENANT_ID: 'tenant-id',
      CLAWX_MS_GRAPH_CLIENT_ID: 'client-id',
    })).toEqual({
      tenantId: 'tenant-id',
      clientId: 'client-id',
      scopes: undefined,
      redirectUri: undefined,
      graphOutlookRead: undefined,
      graphOutlookCompose: undefined,
    });
  });

  it('parses the optional Outlook transport toggles from the environment', () => {
    expect(readMicrosoftGraphConfigFromEnv({
      CLAWX_MICROSOFT_GRAPH_TENANT_ID: 'moe.gov.tt',
      CLAWX_MICROSOFT_GRAPH_CLIENT_ID: '00000000-0000-0000-0000-000000000001',
      CLAWX_MICROSOFT_GRAPH_OUTLOOK_READ: '1',
      CLAWX_MICROSOFT_GRAPH_OUTLOOK_COMPOSE: 'false',
    })).toMatchObject({
      graphOutlookRead: true,
      graphOutlookCompose: false,
    });

    // Short aliases work here too, and an omitted or unparseable toggle stays
    // undefined rather than silently defaulting.
    expect(readMicrosoftGraphConfigFromEnv({
      CLAWX_MS_GRAPH_TENANT_ID: 'moe.gov.tt',
      CLAWX_MS_GRAPH_CLIENT_ID: '00000000-0000-0000-0000-000000000001',
      CLAWX_MS_GRAPH_OUTLOOK_READ: 'yes',
      CLAWX_MS_GRAPH_OUTLOOK_COMPOSE: 'maybe',
    })).toMatchObject({
      graphOutlookRead: true,
      graphOutlookCompose: undefined,
    });
  });

  it('reads non-secret tenant defaults from a packaged config file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clawx-msgraph-seed-'));
    try {
      const path = join(dir, 'microsoft-graph.json');
      await writeFile(path, JSON.stringify({
        enabled: true,
        tenantId: 'moe.gov.tt',
        clientId: 'client-id',
        scopes: ['openid', 'profile', 'Mail.Read', 'Mail.Read'],
        redirectUri: 'http://localhost:53682/callback',
        graphOutlookRead: true,
        graphOutlookCompose: false,
      }), 'utf-8');

      await expect(readMicrosoftGraphConfigFromFile(path)).resolves.toEqual({
        tenantId: 'moe.gov.tt',
        clientId: 'client-id',
        scopes: ['openid', 'profile', 'Mail.Read'],
        redirectUri: 'http://localhost:53682/callback',
        graphOutlookRead: true,
        graphOutlookCompose: false,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('treats disabled or incomplete packaged configs as absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'clawx-msgraph-seed-'));
    try {
      const disabled = join(dir, 'disabled.json');
      const incomplete = join(dir, 'incomplete.json');
      await writeFile(disabled, JSON.stringify({
        enabled: false,
        tenantId: 'moe.gov.tt',
        clientId: 'client-id',
      }), 'utf-8');
      await writeFile(incomplete, JSON.stringify({
        enabled: true,
        tenantId: 'moe.gov.tt',
      }), 'utf-8');

      await expect(readMicrosoftGraphConfigFromFile(disabled)).resolves.toBeNull();
      await expect(readMicrosoftGraphConfigFromFile(incomplete)).resolves.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
