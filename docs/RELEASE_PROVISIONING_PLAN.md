# Release Credential-Provisioning Plan

**Scope:** how cloud-model credentials and non-key config reach an installed Ministry of Education desktop app — for the external tester cohort now (Karunesh et al., moe.15/moe.16) and the ~200-school fleet later.

**Grounding:** the moe.15 artifact-credentials map (verified against the shipped NSIS exe) and the A–D provisioning-options analysis. Repo facts re-verified 2026-09-02 at HEAD `2bb785bd` on `fix/doc-tooling-steering`.

**Status:** draft for owner review. Not committed. No secrets appear in this document; the one live key is referenced by its 8-char prefix and hash prefix only.

---

## SECURITY FLOOR — read this first

> **A live cloud credential ships inside every moe.15 installer and is extractable in seconds.**
>
> The LiteLLM client key (`sk-clawx…`, 73 bytes, sha256 prefix `4e08c988fca1`) is present in `Ministry of Education-0.4.3-moe.15-win-x64.exe` as the plain file `resources/resources/cloud-gateway.key`, **outside app.asar** — 7-Zip alone extracts it; no asar tooling needed. It was verified byte-identical to the gitignored repo copy. The gateway it unlocks (`clawx-litellm-gateway-…run.app`) currently has **no per-key budgets, no per-user caps in its lane, and no spend controls** (no Cloud SQL; the README calls it a "temporary single-client key"). The same key family was shared over WhatsApp on 2026-06-05 and has **never been rotated** (CLWX-19, open ~3 months).
>
> **Immediate mitigation (before any new tester artifact ships):**
> 1. Rotate the key server-side (new LiteLLM client key; confirm the WhatsApp-shared value is dead; confirm the client key is NOT the LiteLLM master key).
> 2. Never attach a keyed artifact to a public GitHub Release. moe.15 tester delivery stays on the private expiring download link (current TESTER_QUICKSTART practice) until the artifact is key-less.
> 3. Treat every already-distributed moe.15 installer as having published the old key; rotation invalidates them all at once — KR4 degrade (commit `bde78d94`) turns that into on-device degradation, not silence, so rotation is safe to execute now for a cohort this small.

This item is first in the owner-decision list (section 5).

---

## 1. Current state — what moe.15 actually ships

Ground truth from extraction of the shipped exe (`$PLUGINSDIR/app-64.7z`), not from reading intentions.

### 1.1 Secret-class inventory and blast radius

| # | Item | In moe.15 artifact? | Where it lives after first boot | Extraction effort | Blast radius | Severity |
|---|---|---|---|---|---|---|
| 1 | LiteLLM client key `sk-clawx…` | **YES** — plain files `resources/resources/cloud-gateway.json` (416 B) + `cloud-gateway.key` (73 B), outside asar | Plaintext in `%APPDATA%/Ministry of Education/clawx-providers.json` **twice** (`apiKeys` + `providerSecrets`) and again in `~/.openclaw` runtime config | 7-Zip on the installer, or reading two JSON files on any installed machine | **Single shared fleet key.** No per-key budget, no rate DB at the gateway. One extracted key = unmetered spend/DoS against the Vertex project for everyone. Only remediation is server-side rotation, which cuts cloud for every install simultaneously (auto-update is off; re-keying is a per-machine touch) | **HIGH / CRITICAL** |
| 2 | "Secure storage" of that key | n/a | `ElectronStoreSecretStore` is a plain electron-store JSON file. **No safeStorage, no keytar, no OS keychain anywhere in the path** | Any local user, malware, backup sweep, or tail-and-paste diagnostic grab of userData | Fleet key exfiltration from any single machine | **HIGH** |
| 3 | Azure Speech key | NO — `azure-speech.example.json` only | n/a (ASR silently falls back to native/whisper) | n/a | Would be a shared speech quota if ever baked; CI has an inject path with an inline-secret guard | OK today |
| 4 | Microsoft Graph tenantId/clientId | NO — `microsoft-graph.json` absent; gateway plugin pinned `enabled=false` with `pending-entra-registration` placeholders | n/a | n/a | Non-secret by design (pure PKCE public client; no client secret exists anywhere in the desktop app) | OK — but note the one-file activation trap, 1.3 |
| 5 | test.fac test password (`Educatio…`, redacted) / `PILOT_TEST_PASSWORD` | NO — binary scan of app.asar: zero hits | n/a | n/a | n/a (but the same literal leaked via the public repo — CLWX-18) | OK in artifact |
| 6 | Host-API token (`:13210`) | NO — `randomBytes(32)` per launch, never baked | Memory only | n/a | Single machine, single run | OK |
| 7 | Upstream provider keys (Vertex/Bedrock) | NO — never in the client. LiteLLM gateway uses a Cloud Run service account (ADC); master key via Secret Manager | Server-side only | n/a | n/a | OK — this is the part of the architecture that is already right |
| 8 | test.fac Suspensions form URL | YES — `extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt` in the shipped extension tree | Same file on disk | Trivial | Capability URL, not a credential: anyone holding a response URL can submit. Couples the product artifact to the demo tenant; with the public repo (CLWX-18) assume all artifact internals readable | LOW |

### 1.2 How the key gets in, and what first boot does with it

- Build lane: gitignored `resources/cloud-gateway.{json,key}` are copied by the electron-builder `extraResources` glob plus a belt-and-braces `after-pack` copy (`copyReleaseGatewaySeed`) that throws only on a **partial** pair. CI materializes the pair from GitHub secrets `CLAWX_CLOUD_GATEWAY_CONFIG_JSON` + `CLAWX_CLOUD_GATEWAY_KEY`.
- Boot lane: `seedCloudGatewayProvider` (gated by `SEED_CLOUD_GATEWAY_PROVIDER` = `PILOT_MODE` = true) resolves config (env `CLAWX_CLOUD_GATEWAY_*` overrides file; search order env path → userData → resourcesPath → appPath → cwd), creates provider `moe-cloud-gateway`, writes the key plaintext into both secret maps, syncs it into `~/.openclaw`, sets it as **default provider**, and marks `setupComplete=true` (wizard skipped).
- Channel default stays **on-device** on a truly fresh install (the moe.13 force-flip regression is fixed): cloud is defaulted-provider-but-not-default-channel.
- The baked `baseUrl` points at the **litellm-gateway** Cloud Run service, **not** the model-broker. Consequence stated bluntly: **KR6 per-user caps and the structured 429 do not sit in the shipped lane at all.** The caps work protects nothing in moe.15 as shipped. `CLAWX_PER_USER_CAPS` also defaults OFF even where the broker is deployed.
- `UserId` metering header (KR7): stamped client-side from the Entra oid **only when Graph is signed in** — on moe.15 fresh installs Graph is unconfigured, so **all usage is anonymous**, and the header is client-stamped/spoofable in any case.

### 1.3 Adjacent facts that shape the plan

- **On-device is a dead lane out of the box:** no Ollama binary, no qwen weights, no downloader ship in moe.15. Default channel = on-device means a principal's literal first turn fails until an operator installs Ollama or the user switches to Online. The cloud→on-device degrade path can degrade into this same dead lane.
- **Build-provenance gap:** a build with *neither* seed file silently ships with no cloud config (seed skips as `missing-config`) — an installer whose online channel just never works. The CI `requireCloudGatewaySeed` guard is an opt-in workflow input, not a default gate.
- **Graph one-file activation trap:** `after-pack` copies `resources/microsoft-graph.json` unconditionally if present — a future build that includes that file silently activates the host Graph lane on all fresh installs. IDs are non-secret, but activation should be a gated decision, not a file-drop accident.
- **Auto-update is off three ways** (runtime flag, `publish: null`, in-person delivery) — good for control, bad for re-keying: there is no in-app credential-refresh path of any kind.
- **Kill-switch precedent that works:** `PRINCIPAL_SKILL_ALLOWLIST` (19 slugs incl. `outlook`, `forms`) disables tools and /api routes end-to-end by removing a slug, no code change.

---

## 2. Decision framework — options A–D with this project's real costs

Honest framing first: this repo is **not** at "provider keys baked in the release." Upstream credentials (Vertex) never leave the server (ADC/Secret Manager). What ships is a **shared broker-client key** — so the decision is about the client-key tier only, and every option below is a strict subset of the same end-state.

### Option A — shared key baked in the artifact (status quo)

- **Cost to adopt:** zero — it is what moe.15 does.
- **Real exposure:** assume the key is public the moment an installer leaves our hands (plain file, no asar). Spend is the exposure: caps flag defaults off; even with caps ON, they key on the spoofable client `UserId` header, so an adversarial holder rotates `UserId` per request and is bounded only by the fleet reserve (0.9 × monthly budget). **KR6 caps protect against honest-but-heavy principals, not key theft.**
- **Revocation:** minutes server-side, but fleet-wide cloud loss with no in-app re-provision — every machine needs a hand-delivered `cloud-gateway.json` or a reinstall. KR4 degrade (landed, `bde78d94`) upgrades that from outage to degradation; it is the load-bearing mitigation that makes A tolerable at all.
- **Live proof of the risk model:** CLWX-19 (key WhatsApp-shared 2026-06-05, never rotated — demonstrated rotation cadence is "never") and CLWX-18 (public repo already leaked full source + a plaintext test password: the public/private boundary has failed once).
- **Acceptable only for:** a 1–5 known-tester cohort with a per-cohort (non-master) key, caps flag ON in the deployed broker, spend alerts, and one rotation drill actually executed. **Never** for an artifact attached to a public GitHub Release — that is publication of the key, and the GA gate's EXT-TESTER checkbox requires exactly such a public-Release run.
- **Ministry verdict:** fails their own written instruction ("no plaintext copies remain in code, config, or chat"); rejected outright at fleet scale.

### Option B — broker holds the key; per-install/per-cohort revocable client tokens

- **How close we are:** ~90% structurally. `services/model-broker` already has bearer client-key auth with a **CSV of multiple keys** (README example is literally `client-key-for-school-a,client-key-for-demo`), model allow-listing, KR6 metering/caps behind `CLAWX_PER_USER_CAPS` with a structured 429 `USAGE_CAP` that the KR4 degrade classifier maps to on-device, and KR7 sanitized `UserId` forwarding upstream.
- **Missing:** (1) a key-issuance/revocation surface (broker keys are static env; LiteLLM virtual keys + budgets need a Cloud SQL Postgres deploy that does not exist yet); (2) unspoofable identity for caps (that is Option D); (3) an in-app token re-provision path; (4) caps default-on in the deployment.
- **Real cost:** per-cohort keys today = env change, zero code. Per-school keys = deploy Cloud SQL + LiteLLM virtual-key issuance (~1 day) or a small key-registry module in the broker reusing its atomic-state pattern (~1–2 sittings).
- **Strategic fit:** the broker is the embryo of the Docker app-server the Ministry asked us to provision (handoff C11) — at fleet time it holds the single APIM subscription key (C4), fronts PostgreSQL behind the firewall (C5), and keeps token counters in Postgres. Nothing built here is throwaway.
- **Ministry verdict:** matches the architecture they built themselves (APIM holds the Foundry key; our broker holds theirs).

### Option C — first-run activation code

- Tester enters a short emailed code; the app exchanges it at the broker for a scoped per-install client key. The delivery half already exists (the seed reads `cloud-gateway.json` from userData; `provider-runtime-sync` writes provider + key at runtime). Needed: one broker endpoint (`POST /activate`, single-use codes with expiry + cohort tag, reusing the usage-meter atomic-state pattern), one first-run dialog, and glue. ~2–3 sittings including tests.
- **Payoff:** the public Release artifact carries **no key at all** — dissolves the EXT-TESTER-vs-baked-key conflict and the CLWX-18 exposure class; one extracted token burns one install, not the cohort; per-install revocation.
- **Softening nuance:** the KR2 first-turn GA criterion is an **on-device** turn, so a fully key-less public artifact already passes download→install→first-turn; cloud activation can be an optional labelled second step.
- **Real cost at 1–5 testers:** over-engineering versus an emailed per-tester `cloud-gateway.json` drop-in (near-zero cost). Build it when the tester count grows past a handful or the drop-in proves fiddly.
- **Ministry verdict:** fine for testers; not the fleet answer (human-distributed bearer codes, no identity binding).

### Option D — Entra-native (oid-gated broker) — the fleet answer

- User signs into M365 via the PKCE flow now **proven live on the real Ministry tenant** (GRAPH_TEST_PLAN L1–L3 PASS; pure public client, no client secret anywhere client-side, loopback redirect, stable `oid`). The app presents an Entra access token to the broker; the broker validates it (JWKS, tid, aud, exp) and derives `oid` **server-side** — exactly SCALE_ANALYSIS §4: "UserId stamped from the authenticated session, never from a client-supplied value."
- **Exists today:** flag-gated sign-in (`CLAWX_GRAPH_AUTH`), `UserId=oid` stamped at seed and re-stamped on sign-in/out, broker forwards it sanitized.
- **Missing:** broker JWT validation (~1 sitting, one small JWKS dependency); a broker API scope/audience on the Entra app registration (minutes-level Ansari portal ask); app-side token acquisition for the broker resource + refresh (~1–2 sittings, reusing the hand-rolled PKCE code); cold-start policy (cloud gated on sign-in; KR4 covers signed-out/expired → on-device, which is already the app's behavior model).
- **Payoff:** nothing to extract — no long-lived secret ships; stolen access tokens die in ~1h and this tenant demonstrably enforces CAE/Conditional Access. Revocation = the Ministry's own Entra account lifecycle, per-principal. KR6 caps become adversarially sound (verified oid). Per-user App-Insights attribution the Ministry trusts.
- **Gating:** *verification* (not construction) is KR8-gated on the Ministry working session and real APIM/Entra values. Build behind a flag now; declaring it done before App-Insights shows per-user attribution would be a false completion.
- **Ministry verdict:** the design their own handoff implies; the only shape that passes a 200-school review.

### Staged recommendation

| Stage | Population | Model | Key facts |
|---|---|---|---|
| **NOW** | 1–5 known testers (Karunesh cohort) | A, hardened at its edges | Rotated per-cohort key; caps ON server-side; **key-less public artifact** if/when a public Release ships (cloud via emailed per-tester config drop-in); one executed revocation drill |
| **Pilot fleet** | tens of schools | B | Per-school keys (LiteLLM virtual keys on Cloud SQL, or broker key registry) with per-key budgets; caps default-on; `UserId=oid` from the flag-gated sign-in; written rotation runbook; accept trust-limited client-stamped UserId for a known population |
| **GA fleet** | ~200 schools | D | Entra sign-in mandatory for the cloud channel; broker validates tokens and derives oid server-side; per-oid caps in PostgreSQL; broker delivered as the Ministry's Docker app-server holding the single APIM key; desktop artifact contains zero secrets |

The through-line: every stage is a strict subset of D, which is already designed in SCALE_ANALYSIS and half-built in `services/model-broker`. No stage's work is thrown away.

---

## 3. The NOW plan — Karunesh-cohort handoff

Ordered. Items 1–3 are prerequisites for shipping any further tester artifact.

### 3.1 Rotate first (CLWX-19 closure)

1. **Rotate the `sk-clawx…` client key** at the LiteLLM gateway. Confirm: (a) the WhatsApp-shared value no longer authenticates; (b) the value baked into moe.15 (`4e08c988fca1` sha256-prefix) no longer authenticates; (c) the client key in circulation is **not** the LiteLLM master key and cannot mint keys.
2. **Issue a per-cohort key** for the tester cohort — the broker's `MODEL_BROKER_CLIENT_KEYS` CSV supports this with zero code. One key for the Karunesh cohort, distinct from any demo/dev key, revocable without touching other lanes.
3. **Execute one revocation drill end-to-end** on a scratch install: revoke → observe KR4 degrade to on-device (not silence) → re-provision via userData `cloud-gateway.json` drop-in → cloud restored. Record timings. This turns the rotation cadence from aspirational to demonstrated.

### 3.2 What to bake in the tester artifact

- **Public Release lane (if used for EXT-TESTER):** key-less artifact. No `cloud-gateway.{json,key}` in the build. First turn is on-device (satisfies KR2/EXT-TESTER) — which makes the **on-device dead-lane fix a hard dependency of the key-less path**: either bundle/auto-provision Ollama + qwen or gate the claim on the runbook install. Cloud arrives per-tester as an emailed `cloud-gateway.json` + key-file drop-in to userData (the seed already reads userData first).
- **Private-link lane (current TESTER_QUICKSTART practice):** a keyed artifact is tolerable for this cohort **only after rotation**, with the new per-cohort key, delivered via the expiring private link, never attached to a public Release.
- Either lane: `PILOT_MODE` on; auto-update off (already three-way enforced); no `microsoft-graph.json`, no `azure-speech.json` unless explicitly decided.

### 3.3 Caps and kill-switches that must be ON

- **Server-side:** `CLAWX_PER_USER_CAPS=1` in the deployed broker; low fleet monthly budget for the tester cohort; spend alert wired to the owner. Note the honest limit: caps bound honest-heavy use, not an adversarial key holder — that is why rotation + per-cohort key come first, and why the tester lane should route through the **broker** baseUrl (where caps live), not the raw litellm-gateway baseUrl currently baked (see owner decision 5.6).
- **Artifact-side:** `PRINCIPAL_SKILL_ALLOWLIST` ships as-is (19 slugs) — `outlook` and `forms` slugs are the end-to-end kill switches; confirm both present-and-intended for the tester build. `FILTER_SKILLS_TO_ALLOWLIST` on (PILOT_MODE default). `HIDE_COST_IN_UI` on.

### 3.4 Pre-release checklist additions for docs/PRODUCTION_CHECKLIST.md

To be added under section 4 (Security and secrets) as new rows — listed here, not edited into that file:

- **4.6 Key rotation freshness** — the LiteLLM/broker client key in the build seed was issued after the last known exposure event (currently CLWX-19, 2026-06-05); verify by sha256 of `resources/cloud-gateway.key` against the rotation log. RED if the `4e08c988fca1` key (or any WhatsApp-era key) is still live.
- **4.7 No key in public-Release artifacts** — any artifact attached to a public GitHub Release contains no `cloud-gateway.key` / `cloud-gateway.json`: extract the NSIS exe (`7zz l` on `$PLUGINSDIR/app-64.7z`) and grep the listing. Private-link artifacts: key present only if this release's provisioning decision says so.
- **4.8 Key-not-master proof** — the shipped/emailed client key cannot call LiteLLM key-management endpoints (attempt key-mint with it → expect 401/403).
- **4.9 Broker caps live in the shipped lane** — the baked `baseUrl` (or the emailed drop-in config) points at a service where `CLAWX_PER_USER_CAPS` is ON; verify with a structured-429 probe or a config read on the deployed service. RED if the artifact lane bypasses caps entirely (moe.15 state).
- **4.10 Seed-pair provenance gate** — the build either intentionally ships the seed pair (both files, hash-logged) or intentionally ships none; `requireCloudGatewaySeed` (or its inverse for key-less builds) is asserted in CI rather than left as an opt-in input. RED on an accidental no-config artifact whose online channel silently never works.
- **4.11 Graph seed absence** — `resources/microsoft-graph.json` is absent from the artifact unless this release explicitly activates the Graph host lane (the after-pack copy is unconditional; treat file presence as an activation decision).
- **4.12 Revocation drill recency** — a revoke → degrade → re-provision drill has been executed on the current key mechanism within the last 90 days, with the runbook path it exercised linked.
- **4.13 Plaintext-at-rest acknowledged or fixed** — release notes state that the client key rests in plaintext in `clawx-providers.json` + `~/.openclaw` (no OS keychain), or the safeStorage migration has landed; either way the state is declared, not implicit.
- **4.14 Capability-URL hygiene** — no real MoE form response URLs in the artifact or public repo; test.fac URLs flagged as demo-tenant coupling (currently baked: `suspensions-test-fac-url.txt`).

### 3.5 Explicitly not doing now

- No activation-code endpoint yet (Option C) — over-engineering at 1–5 testers; trigger is cohort growth or drop-in friction.
- No safeStorage/keytar migration this week — acknowledged in 4.13, scheduled as pilot-fleet hardening.
- No caps-evasion fix (spoofable UserId) — that is Option D's broker-side validation; pilot accepts trust-limited identity for a known population.

---

## 4. The moe.16 delta — what this week's landed work enables

Landed since moe.15 (verified in git log):

| Commit | What landed | Provisioning consequence |
|---|---|---|
| `2baa9589` | Ministry Graph sign-in L1–L3 proven live on the real tenant (pure PKCE, stable oid) | The identity primitive for Option D exists and is proven against the production tenant — no client secret needed, ever, on the desktop |
| `847cd616` | In-app Graph Outlook lane complete behind config toggles (read-only scopes) | A tester with Graph configured gets Outlook without any credential in the artifact — the session IS the credential; also gives the sign-in a user-visible reason to exist before cloud-gating rides on it |
| `e51362b9` | Broker stamps `UserId=oid` on cloud calls and forwards it upstream (KR7) | Per-user attribution reaches the metering plane end-to-end the moment a user signs in; anonymous-by-default ends when sign-in is configured |
| `deff5c7d` (KR6, prior) + this week's broker work | Per-user caps behind `CLAWX_PER_USER_CAPS`, structured 429 `USAGE_CAP`, atomic usage state | Flip-a-flag spend containment on any lane routed through the broker; the 429 is already understood by the KR4 degrade classifier |

Net: **moe.16 can ship a tester build where a signed-in user's cloud usage is attributed and capped per-user** — provided the lane routes through the broker (not the raw litellm-gateway) and the caps flag is on. That is the whole gap between "KR6/KR7 exist" and "KR6/KR7 protect the artifact."

### The one-sitting A→B move

If the owner agrees B is next (the analysis says it is), one sitting closes the distance for the tester cohort:

1. **Re-point the baked/drop-in `baseUrl` at the model-broker** service instead of the litellm-gateway (config-only; the broker already speaks the same OpenAI-completions surface and holds the upstream credential server-side).
2. **Populate `MODEL_BROKER_CLIENT_KEYS`** with per-cohort keys (env change: one rotated cohort key now; add per-tester keys if desired — the CSV already supports it).
3. **Set `CLAWX_PER_USER_CAPS=1`** on the deployed broker with a tester-sized fleet budget.
4. Regenerate per-tester `cloud-gateway.json` drop-ins (or the moe.16 seed pair for the private-link lane) with the new baseUrl + cohort key.

That is Option B's tester-scale form with zero new code. The remaining B hardening (LiteLLM virtual keys / broker key registry with per-key budgets, in-app re-provision path) stays on the pilot-fleet milestone; Option D's remaining halves (broker JWT validation ~1 sitting, Entra broker scope = minutes-level portal ask, app-side broker-token acquisition ~1–2 sittings) are the sitting-sized follow-ons already scoped in section 2.

---

## 5. Owner / Ministry decision list

One line each; nothing here can be decided by the engineering side alone.

1. **SECURITY FLOOR — authorize immediate rotation of the `sk-clawx…` client key (CLWX-19)**, accepting simultaneous cloud loss (degrade-to-on-device) on all existing moe.15 installs until re-provisioned.
2. Confirm whether the WhatsApp-shared key is the LiteLLM **master** key; if yes, rotate the master key too (key-minting exposure), which is a bigger operation.
3. Choose the tester artifact lane: key-less public-Release artifact + emailed per-tester config drop-in, vs keyed private-link artifact with the rotated cohort key (or both).
4. Approve the monthly spend budget and alert threshold for the tester cohort broker deployment.
5. Approve flipping `CLAWX_PER_USER_CAPS` on in the deployed broker (changes tester-visible behavior: structured 429 → on-device degrade at the cap).
6. Approve re-pointing the shipped `baseUrl` from the litellm-gateway to the model-broker (the one-sitting A→B move; changes the production request path).
7. Decide the on-device dead-lane remedy for key-less installs: bundle/auto-provision Ollama + qwen, or accept a documented manual step (this gates the key-less EXT-TESTER claim).
8. Approve the B milestone shape for pilot fleet: deploy Cloud SQL for LiteLLM virtual keys vs build the broker key registry (~1 day vs ~1–2 sittings; per-school keys either way).
9. Approve pull-forward of Option D construction behind flags now (broker JWT validation + app-side broker-token acquisition), with verification deferred to the KR8 Ministry working session.
10. Ministry (Ansari): add a broker API scope/audience to the Entra app registration (minutes-level portal action; prerequisite for D).
11. Ministry: confirm the fleet endstate — broker delivered as their Docker app-server holding the single APIM subscription key (handoff C4/C11), caps keyed on validated oid in their PostgreSQL.
12. Decide the CLWX-18 remediation (public repo history scrub + source/releases split) before any public-Release tester run is scheduled — the public/private boundary must hold for the key-less-artifact plan to mean anything.
13. Decide timing of the plaintext-at-rest fix (safeStorage/keytar migration for `clawx-providers.json`) — recommended as a pilot-fleet gate, not a tester-cohort blocker.
14. Approve making the seed-pair provenance check (`requireCloudGatewaySeed` or its key-less inverse) a default CI gate rather than an opt-in input.

---

*Sources: moe.15 artifact-credentials map (verified against `release/Ministry of Education-0.4.3-moe.15-win-x64.exe`); provisioning-options analysis (A–D); repo re-verification at `2bb785bd`: `shared/feature-flags.ts` (PRINCIPAL_SKILL_ALLOWLIST, PILOT_MODE cascade), `docs/DEFECT_REGISTER_2026-09-02.md` (CLWX-18/19, KR6 row), `docs/TESTER_QUICKSTART.md` (private-link delivery), git log (`2baa9589`, `847cd616`, `e51362b9`), `docs/PRODUCTION_CHECKLIST.md` (section 4 numbering for proposed rows). Not committed; no plaintext secrets herein.*
