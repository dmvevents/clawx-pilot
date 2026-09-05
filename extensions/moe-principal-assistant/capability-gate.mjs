/**
 * CLWX-86 — tool ↔ host-API capability handshake.
 *
 * The plugin runs inside the OpenClaw gateway process and reaches the
 * Electron app over the host-API on 127.0.0.1:$CLAWX_HOST_API_PORT. The
 * plugin source ships alongside the app but can be NEWER than the installed
 * binary (re-seeded extensions, dev plugin against an installed app), in
 * which case the tool catalog advertises routes the app does not serve —
 * observed live on moe.15, where `browser.diagnose` surfaced a raw
 * "No route for POST /api/browser/diagnose" to the agent.
 *
 * The gate probes the host-API ONCE at plugin registration and self-parks
 * any tool whose backing route is absent, answering with a principal-
 * readable "update the app" message instead of a raw HTTP error.
 *
 * Probe tiers (both side-effect-free):
 *  1. `GET /api/capabilities` — authoritative route inventory + per-family
 *     allowlist state + app version. Newer apps serve it.
 *  2. Older apps lack tier 1 by definition, so fall back to family-level
 *     GET probes against `/api/<family>/capability-probe`. The host-API
 *     route handlers claim their family by pathname prefix, so:
 *       405 "Method not allowed"        → family present (GET refused)
 *       404 "... capability disabled"   → family present, allowlist-off
 *       404 "No route for ..."          → family ABSENT (version skew)
 *
 * Failure policy: a probe that cannot reach the host-API (boot race,
 * timeout) is INDETERMINATE — the gate fails OPEN and re-probes on the
 * next tool call, so it can only ever park tools on definitive evidence.
 * Allowlist-disabled families are NOT parked here: the kill-switch
 * semantics (routes 404 with "capability disabled" at call time) are
 * load-bearing and stay unchanged.
 */

const FAMILY_LABELS = {
  browser: 'browser-automation diagnostics',
  outlook: 'Outlook email',
  forms: 'MoE forms',
};

const PROBED_FAMILIES = Object.keys(FAMILY_LABELS);

/**
 * Principal-readable reason used everywhere a version-skew park or a
 * skew-shaped HTTP 404 surfaces. Never includes raw HTTP or route text.
 */
export function hostApiSkewMessage(family) {
  const label = FAMILY_LABELS[family] ?? String(family ?? 'this');
  return (
    `The installed Ministry of Education app does not support ${label} ` +
    'actions yet — the app and its assistant are out of step. Please ' +
    'install the latest Ministry of Education app update, then try again.'
  );
}

/** True when an HTTP error body is the host-API's global unmatched-route 404. */
export function isNoRouteBody(text) {
  return /No route for/i.test(String(text ?? ''));
}

/**
 * Create the handshake gate. `probe()` is fired once at registration;
 * `check({ family, route })` is awaited by every gated facade call.
 *
 * @param {object} opts
 * @param {string|number} opts.port  host-API port (CLAWX_HOST_API_PORT)
 * @param {string} opts.token        host-API bearer token (never logged)
 * @param {object} [opts.log]        plugin logger ({ info?, warn? })
 * @param {Function} [opts.fetchImpl] injectable fetch for tests
 * @param {number} [opts.timeoutMs]  per-request probe timeout
 */
export function createHostApiCapabilityGate({
  port,
  token,
  log = console,
  fetchImpl,
  timeoutMs = 5_000,
} = {}) {
  const baseUrl = `http://127.0.0.1:${port}`;

  /**
   * Definitive probe result:
   *   { families: { browser|outlook|forms: 'present'|'absent'|'disabled' },
   *     routes: Set<'POST /api/...'>|null, appVersion: string|null }
   * null while indeterminate (host-API unreachable / malformed answer).
   */
  let definitive = null;
  let inFlight = null;
  const loggedRouteSkews = new Set();

  async function probeGet(pathname) {
    const doFetch = fetchImpl ?? fetch;
    const resp = await doFetch(`${baseUrl}${pathname}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await resp.text().catch(() => '');
    return { status: resp.status, ok: resp.ok, text };
  }

  function classifyFamilyProbe({ status, text }) {
    if (status === 405) return 'present';
    if (status === 404) {
      if (/capability disabled/i.test(text)) return 'disabled';
      if (isNoRouteBody(text)) return 'absent';
      // e.g. 404 "Unknown browser endpoint" — the family handler claimed
      // the path, so the family exists.
      return 'present';
    }
    // 401/5xx/anything unexpected: never park on ambiguity.
    return 'present';
  }

  function interpretCapabilitiesPayload(payload) {
    const routes = Array.isArray(payload.routes)
      ? new Set(payload.routes.filter((r) => typeof r === 'string'))
      : null;
    const families = {};
    for (const family of PROBED_FAMILIES) {
      const declared = payload.families?.[family];
      if (declared && typeof declared === 'object') {
        families[family] =
          declared.present === false
            ? 'absent'
            : declared.enabled === false
              ? 'disabled'
              : 'present';
      } else if (routes) {
        // Family undeclared but the route inventory is authoritative.
        families[family] = [...routes].some((r) => r.includes(`/api/${family}/`))
          ? 'present'
          : 'absent';
      } else {
        families[family] = 'present'; // no evidence either way — fail open
      }
    }
    return {
      families,
      routes,
      appVersion: typeof payload.appVersion === 'string' ? payload.appVersion : null,
    };
  }

  async function probeOnce() {
    let caps;
    try {
      caps = await probeGet('/api/capabilities');
    } catch {
      return null; // unreachable — indeterminate, re-probed on next check
    }
    if (caps.ok) {
      let parsed = null;
      try {
        parsed = caps.text ? JSON.parse(caps.text) : null;
      } catch {
        /* fall through */
      }
      const payload = parsed && parsed.success === true ? parsed.data : null;
      if (payload && typeof payload === 'object') {
        return interpretCapabilitiesPayload(payload);
      }
      return null; // malformed — indeterminate
    }
    if (caps.status === 404 && isNoRouteBody(caps.text)) {
      // Legacy app without /api/capabilities: family-level probes.
      const families = {};
      for (const family of PROBED_FAMILIES) {
        try {
          families[family] = classifyFamilyProbe(
            await probeGet(`/api/${family}/capability-probe`),
          );
        } catch {
          return null; // network died mid-probe — indeterminate
        }
      }
      return { families, routes: null, appVersion: null };
    }
    return null; // 401/5xx — indeterminate
  }

  function logSkew(result) {
    const absent = PROBED_FAMILIES.filter((f) => result.families[f] === 'absent');
    if (absent.length) {
      log.warn?.(
        `moe-principal-assistant: host-API capability skew — absent families: ${absent.join(', ')} ` +
          `(installed app version: ${result.appVersion ?? 'unknown'}). ` +
          'Affected tools are self-parked and will ask for an app update.',
      );
    }
  }

  function probe() {
    if (definitive) return Promise.resolve(definitive);
    if (!inFlight) {
      inFlight = probeOnce()
        .then((result) => {
          if (result) {
            definitive = result;
            logSkew(result);
          }
          return result;
        })
        .catch(() => null)
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  }

  async function check({ family, route } = {}) {
    const snapshot = definitive ?? (await probe());
    if (!snapshot) return { ok: true, indeterminate: true };
    if (family && snapshot.families[family] === 'absent') {
      return { ok: false, reason: hostApiSkewMessage(family) };
    }
    if (route && snapshot.routes && !snapshot.routes.has(route)) {
      if (!loggedRouteSkews.has(route)) {
        loggedRouteSkews.add(route);
        log.warn?.(
          `moe-principal-assistant: host-API capability skew — route missing: ${route} ` +
            `(installed app version: ${snapshot.appVersion ?? 'unknown'}); tool self-parked.`,
        );
      }
      return { ok: false, reason: hostApiSkewMessage(family) };
    }
    return { ok: true };
  }

  return { probe, check };
}

/**
 * Wrap a host-API facade so every method awaits the capability gate first.
 * A parked method returns { status: 'unavailable', message } WITHOUT making
 * any HTTP call — hard gates upstream (send/download confirm) are untouched
 * because parking happens before, not instead of, their host-side checks.
 *
 * @param {object|null} facade          facade from createHostApi*Facade
 * @param {string} family               'browser' | 'outlook' | 'forms'
 * @param {Record<string,string>} routesByMethod  facade method → 'POST /api/...'
 * @param {{check: Function}|null} gate gate from createHostApiCapabilityGate
 */
export function gateHostApiFacade(facade, family, routesByMethod, gate) {
  if (!facade || !gate) return facade;
  const wrapped = {};
  for (const [method, fn] of Object.entries(facade)) {
    if (typeof fn !== 'function') {
      wrapped[method] = fn;
      continue;
    }
    const route = routesByMethod[method];
    wrapped[method] = async (...args) => {
      const verdict = await gate.check({ family, route });
      if (!verdict.ok) {
        return { status: 'unavailable', message: verdict.reason };
      }
      return fn(...args);
    };
  }
  return wrapped;
}
