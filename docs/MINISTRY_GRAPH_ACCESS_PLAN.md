# Ministry Graph API access — status, plan, and how any install uses it

*2026-09-02. Answers: "is the Ministry Outlook API available, and if the app
is installed on another system, how does it access Outlook?" Companion to
`docs/MINISTRY_INFRA_HANDOFF_2026-08-18.md` (raw handoff) and
`.claude/skills/outlook-lane-debug/SKILL.md` (the browser lane it replaces).*

## Definitive current status

**Not connectable yet.** The Ministry registered an Entra application
(2026-08-18 handoff) but every concrete value — tenant ID, client ID, client
secret, endpoints — is a `{{ PLACEHOLDER }}`. There is no hostname to probe
(verified; do not re-attempt). Nothing about this changed with the 2026-09-01
WhatsApp reply; the ball is with Raj (KR8 working session).

## What already exists on OUR side (bigger than the "stub" label)

| Piece | State |
|---|---|
| `electron/services/microsoft-graph/manager.ts` | Built — sign-in flow, token handling, Graph calls; throws `MicrosoftGraphNotConfigured` until `tenantId`+`clientId` exist |
| `electron/utils/microsoft-graph-oauth.ts` | Built — the OAuth flow the manager delegates to |
| `electron/services/microsoft-graph/outlook-adapter.ts` | Built — maps the SAME Host-API surface (read/search/draft/reply/dispatch) onto Graph; routes check `isGraphOutlookAvailable()` per call and fall back to browser automation |
| Host-API routes (`electron/api/routes/outlook.ts`) | Already dual-path: `graphAvailable ? withGraph : browserManager` on every endpoint |

**Consequence:** when real values arrive, enabling Graph is *configuration*,
not construction. The app flips path-by-path automatically.

## How an install on ANY system accesses Outlook (the two modes)

```
TODAY (browser lane)                    AFTER Entra values (Graph lane)
principal's Chrome + signed-in tab      principal signs in ONCE (Entra, PKCE)
CDP :18792, dedicated profile           app holds refresh token per user
DOM automation, per-vendor-rotation     stable REST API, no Chrome needed
fragile (3 DOM defects fixed 09-02)     survives Outlook UI/domain migrations
works only where Chrome session lives   works on every install, incl. fresh VMs
```

The browser lane's last three weeks of defects (subject-gate, verifier
false-positive, cloud.microsoft migration) are all *DOM-rotation class* —
the exact class Graph eliminates. Graph is not a nice-to-have; it is the
GA-durable Outlook path. The browser lane remains for visible-compose review
UX and as fallback.

## The four conflicts to resolve with Raj (unchanged since 08-18)

1. **Scopes are read-only.** Handoff grants read/classify mail. The
   assistant's send/draft features need `Mail.ReadWrite` + send permission —
   delegated (per-user), not application-wide.
2. **Client secret vs PKCE.** The registration assumes a confidential client
   (server) with a secret. A desktop app cannot hold a secret; it must be a
   PUBLIC client using authorization-code + PKCE. Ask: enable
   "Allow public client flows" / add a desktop platform.
3. **Redirect URI never registered.** Desktop needs a loopback redirect
   (`http://localhost:<port>` or `msal://` style). We already offered the
   dev-loopback URI (G7); it was never added.
4. **App-server assumption.** The handoff models an always-on backend; the
   product is a desktop app. Identity (KR7 UserId) can still be stamped
   per-user from the Entra token without any server in the middle.

## Plan (board cards)

| Step | Card | Class |
|---|---|---|
| A. Working-session agenda: the 4 conflicts above as decision items, plus scope list (read, ReadWrite, send-as-user) and loopback redirect registration | CLWX-31 annex | O (Raj) |
| B. Pull-forward: wire the existing oauth flow behind a flag (`CLAWX_GRAPH_AUTH=1`) against a dev tenant/loopback so Raj's values become a config swap; prove sign-in → token → one Graph read on a dev account | new card | P (agent-executable now) |
| C. Acceptance: on a clean install with NO Chrome session, sign in via Entra and run the 14-row eval against the Graph path (same suite, different transport) | new card | S (behind A+B) |
| D. KR7 tie-in: stamp the per-user UserId from the Entra token claims (oid) once B lands — collapses most of KR7's build | CLWX-30 | S (behind B) |

## Testing it without the Ministry (what B proves)

A personal/dev Entra tenant (free) can host an identical app registration:
public client + loopback + delegated scopes. Everything except the final
tenant-policy behaviors (CAE, Conditional Access) is provable there — the
same strategy that made KR1/KR2 evidence possible before real infrastructure.
