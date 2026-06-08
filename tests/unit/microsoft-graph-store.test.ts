// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readMicrosoftGraphConfigFromEnv } from '../../electron/services/microsoft-graph/store';

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
    });
  });
});
