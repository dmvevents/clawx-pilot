/**
 * Plugin entry. Registers the openclaw tools that the agent can call once the
 * plugin is configured (tenantId + clientId) and the user has signed in.
 *
 * This module is *passive* until the host calls register() with a runtime
 * context that provides:
 *   - config()        → resolved openclaw.json plugin config (tenantId, clientId, ...)
 *   - getAccessToken()→ returns a fresh access token (refresh handled by host)
 *   - registerTool()  → host's tool-registration hook
 *
 * No tools are reachable until the plugin manifest is enabled in
 * openclaw.json (`plugins.entries.microsoft-graph.enabled = true`) AND the
 * required config is present. This avoids any chance of the agent attempting
 * Graph calls before tenant onboarding is complete.
 */

import { createGraphClient } from './graph-client.mjs';

export function register(api) {
  // Gateway register-API: api.pluginConfig is THIS plugin's config block.
  // api.config is the whole openclaw.json — not what we want. See the
  // detailed write-up at /tmp/plugin-config-api.md and the matching fix
  // in moe-principal-assistant/index.mjs.
  const { pluginConfig, config, registerTool, log = console } = api;
  const cfg =
    (pluginConfig && typeof pluginConfig === 'object' ? pluginConfig : null) ??
    (typeof config === 'function' ? config() : config) ??
    {};
  // getAccessToken was never part of the gateway's register API — pull it
  // from api.runtime (where the gateway threads runtime services) or
  // api.host (where a custom in-process host can inject one). Until MoE IT
  // returns the Entra app registration, this whole path is a no-op anyway:
  // the cfg.tenantId / cfg.clientId check below will fail first.
  const getAccessToken = api.runtime?.getAccessToken ?? api.host?.getAccessToken;
  if (!cfg.tenantId || !cfg.clientId) {
    log.warn?.('microsoft-graph: tenantId and clientId not configured — tools will not be registered.');
    return { registered: false };
  }
  const graph = createGraphClient({ getAccessToken });

  registerTool({
    name: 'outlook.profile',
    description: 'Return the signed-in user profile (display name, email).',
    handler: async () => {
      const me = await graph.me();
      return {
        displayName: me.displayName,
        email: me.userPrincipalName ?? me.mail,
        jobTitle: me.jobTitle ?? null,
      };
    },
  });

  registerTool({
    name: 'outlook.list_messages',
    description: 'List recent inbox messages. Args: { top?: number, filter?: string, search?: string }.',
    handler: async (args = {}) => {
      const data = await graph.listMessages(args);
      return { messages: data?.value ?? [] };
    },
  });

  registerTool({
    name: 'outlook.get_message',
    description: 'Read a single message by id. Args: { id: string }.',
    handler: async ({ id }) => await graph.getMessage(id),
  });

  registerTool({
    name: 'outlook.draft_reply',
    description: 'Create a draft message. Args: { subject, body, to, cc?, bcc? }.',
    handler: async (args) => await graph.createDraft(args),
  });

  registerTool({
    name: 'outlook.send_mail',
    description: 'Send a message. Args: { subject, body, to, cc?, bcc?, saveToSent? }.',
    handler: async (args) => {
      await graph.sendMail(args);
      return { ok: true };
    },
  });

  registerTool({
    name: 'outlook.list_events',
    description: 'List calendar events. Args: { top?: number, startDateTime?: string, endDateTime?: string }.',
    handler: async (args = {}) => {
      const data = await graph.listEvents(args);
      return { events: data?.value ?? [] };
    },
  });

  log.info?.(`microsoft-graph: registered (tenant=${cfg.tenantId})`);
  return { registered: true };
}
