/**
 * Thin Microsoft Graph client used by the openclaw tools.
 *
 * Intentionally minimal: only the endpoints the prototype needs. No SDK
 * dependency — the Microsoft Graph SDK is large and ships a lot we won't use.
 * Endpoints:
 *   GET    /me
 *   GET    /me/messages?$top=N&$filter=...
 *   GET    /me/messages/{id}
 *   POST   /me/messages   (create draft)
 *   POST   /me/sendMail   (send immediately)
 *   GET    /me/calendar/events
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

export function createGraphClient({ getAccessToken }) {
  if (typeof getAccessToken !== 'function') {
    throw new Error('microsoft-graph: getAccessToken function is required');
  }

  async function call(method, path, body, query) {
    const token = await getAccessToken();
    if (!token) throw new Error('microsoft-graph: not signed in');
    const url = new URL(`${GRAPH}${path}`);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const resp = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (resp.status === 204) return null;
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(json?.error?.message || `Graph HTTP ${resp.status}`);
      err.status = resp.status;
      err.code = json?.error?.code;
      throw err;
    }
    return json;
  }

  return {
    me: () => call('GET', '/me'),
    listMessages: ({ top = 25, filter, search } = {}) =>
      call('GET', '/me/messages', undefined, {
        $top: top,
        ...(filter ? { $filter: filter } : {}),
        ...(search ? { $search: `"${search}"` } : {}),
        $select: 'id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,webLink',
      }),
    getMessage: (id) => call('GET', `/me/messages/${encodeURIComponent(id)}`),
    createDraft: ({ subject, body, to, cc, bcc }) =>
      call('POST', '/me/messages', {
        subject,
        body: { contentType: 'HTML', content: body ?? '' },
        toRecipients: toRecipients(to),
        ccRecipients: toRecipients(cc),
        bccRecipients: toRecipients(bcc),
      }),
    sendMail: ({ subject, body, to, cc, bcc, saveToSent = true }) =>
      call('POST', '/me/sendMail', {
        message: {
          subject,
          body: { contentType: 'HTML', content: body ?? '' },
          toRecipients: toRecipients(to),
          ccRecipients: toRecipients(cc),
          bccRecipients: toRecipients(bcc),
        },
        saveToSentItems: saveToSent,
      }),
    listEvents: ({ top = 25, startDateTime, endDateTime } = {}) =>
      call('GET', startDateTime && endDateTime ? '/me/calendarView' : '/me/calendar/events', undefined, {
        $top: top,
        ...(startDateTime ? { startDateTime } : {}),
        ...(endDateTime ? { endDateTime } : {}),
        $select: 'id,subject,start,end,location,attendees,bodyPreview,webLink',
      }),
  };
}

function toRecipients(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.filter(Boolean).map((address) => ({ emailAddress: { address } }));
}
