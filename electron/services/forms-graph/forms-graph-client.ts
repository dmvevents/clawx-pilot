/**
 * forms-graph: Microsoft Graph + SharePoint List driver for MoE forms.
 *
 * Why this exists: forms-browser-v2 (Playwright + Chrome CDP) is fragile
 * for production because the Forms editor DOM rotates classes per tenant
 * theme update. The data backing every Microsoft Form is a SharePoint List
 * (or Excel workbook). Once IT registers our Entra app with
 * Sites.ReadWrite.All, we can POST straight to that list and bypass the
 * Forms UI entirely.
 *
 * Verified endpoint (Microsoft Graph v1.0, GA, Microsoft Learn 2025-07-23):
 *   POST https://graph.microsoft.com/v1.0/sites/{site-id}/lists/{list-id}/items
 *   Authorization: Bearer {token}
 *   Content-Type: application/json
 *   { "fields": { "ColumnName": value, ... } }
 *
 * Returns 201 Created with the new listItem on success.
 *
 * Token acquisition is OUT OF SCOPE for this file — token comes from the
 * Outlook auth flow we already have (delegated, on behalf of the principal,
 * via auth-code-PKCE against the @moe.gov.tt tenant). See
 * extensions/microsoft-graph for the auth flow.
 */
import { logger } from '../../utils/logger';

export interface GraphListItemArgs {
  /** Microsoft Graph site id (lookup once via /sites/{hostname}:/{path}) */
  siteId: string;
  /** SharePoint List id (lookup once via /sites/{site-id}/lists) */
  listId: string;
  /** Field name → value map. Field names are SharePoint internal names. */
  fields: Record<string, string | number | boolean | null>;
  /** Bearer token (delegated, with Sites.ReadWrite.All scope) */
  token: string;
}

export interface GraphListItemResult {
  status: 'created' | 'error';
  listItemId?: string;
  url?: string;
  errorCode?: string;
  errorMessage?: string;
  httpStatus?: number;
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Resolve a SharePoint site by hostname + path (one-time lookup we cache).
 * The MoE tenant typically lives at moegovtt.sharepoint.com or similar.
 *
 * Example call:
 *   resolveSiteId({
 *     token, hostname: 'moegovtt.sharepoint.com',
 *     sitePath: '/sites/SchoolReports'
 *   })
 *   → returns 'moegovtt.sharepoint.com,abc-123,def-456'
 */
export async function resolveSiteId(args: {
  token: string;
  hostname: string;
  sitePath: string;
}): Promise<{ status: 'ok'; siteId: string } | { status: 'error'; reason: string }> {
  const url = `${GRAPH_BASE}/sites/${encodeURIComponent(args.hostname)}:${args.sitePath}`;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${args.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { status: 'error', reason: `Graph site lookup ${resp.status}: ${txt.slice(0, 200)}` };
    }
    const json = (await resp.json()) as { id?: string };
    if (!json.id) return { status: 'error', reason: 'Graph site lookup: no id in response' };
    return { status: 'ok', siteId: json.id };
  } catch (err) {
    return { status: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resolve a list id by display name within a site. List names are
 * tenant-configured by IT (e.g. "Primary School Suspensions T3 25-26").
 */
export async function resolveListId(args: {
  token: string;
  siteId: string;
  listDisplayName: string;
}): Promise<{ status: 'ok'; listId: string } | { status: 'error'; reason: string }> {
  const url = `${GRAPH_BASE}/sites/${args.siteId}/lists?$filter=${encodeURIComponent(`displayName eq '${args.listDisplayName.replace(/'/g, "''")}'`)}`;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${args.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { status: 'error', reason: `Graph list lookup ${resp.status}: ${txt.slice(0, 200)}` };
    }
    const json = (await resp.json()) as { value?: Array<{ id: string }> };
    if (!json.value || json.value.length === 0) {
      return { status: 'error', reason: `No list found with displayName="${args.listDisplayName}"` };
    }
    return { status: 'ok', listId: json.value[0].id };
  } catch (err) {
    return { status: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Read column metadata so the agent can validate field names + types
 * before submission.
 */
export async function getListColumns(args: {
  token: string;
  siteId: string;
  listId: string;
}): Promise<{ status: 'ok'; columns: Array<{ name: string; displayName: string; type: string; required: boolean }> } | { status: 'error'; reason: string }> {
  const url = `${GRAPH_BASE}/sites/${args.siteId}/lists/${args.listId}/columns`;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${args.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return { status: 'error', reason: `Graph columns lookup ${resp.status}: ${txt.slice(0, 200)}` };
    }
    const json = (await resp.json()) as { value?: Array<Record<string, unknown>> };
    const columns = (json.value ?? []).map((c) => ({
      name: String(c.name ?? ''),
      displayName: String(c.displayName ?? ''),
      type:
        c.text ? 'text'
        : c.number ? 'number'
        : c.dateTime ? 'dateTime'
        : c.choice ? 'choice'
        : c.boolean ? 'boolean'
        : 'unknown',
      required: c.required === true,
    }));
    return { status: 'ok', columns };
  } catch (err) {
    return { status: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Create a new list item (the form submission).
 *
 * The HARD-CONFIRM gate matching forms-browser-v2 lives one layer up — this
 * is the raw transport. The manager / actions wrappers should refuse to
 * call this without confirm:true.
 */
export async function createListItem(args: GraphListItemArgs): Promise<GraphListItemResult> {
  const url = `${GRAPH_BASE}/sites/${args.siteId}/lists/${args.listId}/items`;
  const fieldCount = Object.keys(args.fields).length;
  logger.info(`[forms-graph] createListItem siteId=${args.siteId.slice(0, 16)}… listId=${args.listId.slice(0, 16)}… fields=${fieldCount}`);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ fields: args.fields }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      let errorCode = '';
      let errorMessage = txt.slice(0, 300);
      try {
        const json = JSON.parse(txt) as { error?: { code?: string; message?: string } };
        if (json.error) {
          errorCode = json.error.code ?? '';
          errorMessage = json.error.message ?? errorMessage;
        }
      } catch { /* keep raw */ }
      logger.warn(`[forms-graph] error ${resp.status} code=${errorCode} msg=${errorMessage.slice(0, 200)}`);
      return { status: 'error', errorCode, errorMessage, httpStatus: resp.status };
    }
    const json = (await resp.json()) as { id?: string; webUrl?: string };
    logger.info(`[forms-graph] created listItem id=${json.id} url=${json.webUrl}`);
    return { status: 'created', listItemId: json.id, url: json.webUrl };
  } catch (err) {
    return {
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
