# microsoft-graph (ClawX plugin stub)

Read, draft, and send Outlook mail and read calendar via Microsoft Graph,
scoped to the host's Entra ID tenant.

> **Naming note.** The bundled OpenClaw runtime ships an extension named
> `microsoft` at `node_modules/openclaw/dist/extensions/microsoft/` — that one
> is **Azure Cognitive Services TTS** (text-to-speech), *not* Microsoft Graph.
> It registers a speech provider via `speech-core` and has nothing to do with
> Outlook, Teams, Forms, or SharePoint. This extension (`microsoft-graph`) is
> the Graph/Outlook integration. The names collide; the capabilities do not
> overlap. If you're looking for TTS configuration, look at the bundled
> `microsoft` plugin instead.

## Status

**Stub.** Auth flows, Graph client, and tool definitions are in place but the
plugin is **disabled by default** (`enabledByDefault: false`) and refuses to
register any tools until both `tenantId` and `clientId` are configured.

## Required onboarding (per tenant)

A tenant administrator must:

1. Create an **App registration** in the Entra admin portal.
2. Choose **Mobile and desktop applications** as the platform; add redirect
   URI `http://localhost:53682/callback` (or whatever the host configures).
3. Under **API permissions**, add Microsoft Graph delegated permissions
   the host needs — minimally:
   - `User.Read`
   - `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`
   - `Calendars.Read`
   - `offline_access` (for refresh tokens)
4. **Grant admin consent** if the tenant is configured to require it.
5. Provide the `tenantId` (GUID or domain, e.g. `moe.gov.tt`) and `clientId` to
   the ClawX deployment.

The stub will not work without these; that's intentional — the plugin must
not attempt sign-in against an unregistered app.

## Auth flow

`auth-code-pkce` is the default (best for the desktop app). `device-code` is
available for headless/server hosts.

## What's NOT in the stub

- Token persistence: `bindToProviderStore()` is left as a wiring point. The host
  should plug into the existing OAuth persistence layer
  (`electron/services/providers/provider-runtime-sync.ts`) so refresh tokens
  land in the OS keychain like other providers.
- Conditional Access / MFA pre-flight checks.
- Webhook subscriptions (push notifications) — not needed for the prototype.
- Attachments — add when needed.

## Optional: Azure Speech-to-Text (cloud fallback ASR)

Tenants who use this Microsoft Graph integration can also opt into Azure
Speech-to-Text as a streaming-quality fallback for the on-device speech
recognisers (Apple Speech.framework on macOS, Windows.Media.SpeechRecognition
on Windows). Azure Speech is billed against the same Azure subscription that
backs the Entra/Microsoft 365 tenant, so procurement is straightforward for
tenants already on Microsoft 365.

**Provisioning steps (one time, by an Azure subscription owner):**

1. In the Azure portal, create a **Speech** resource (Cognitive Services →
   Speech). Choose the same subscription/tenant that owns Microsoft 365.
2. Pick a region. For Trinidad &amp; Tobago and Caribbean deployments,
   `eastus` or `southcentralus` give the lowest latency in our testing —
   pick whichever one is closer to your existing Azure footprint.
3. Once the resource is deployed, open **Keys and Endpoint** in the resource
   blade. Copy either `Key 1` or `Key 2` and the region short name.
4. In ClawX, open **Settings → Azure Speech (optional)** and paste the region
   and key. Locale defaults to `en-TT` (Trinidad &amp; Tobago English, Azure
   has supported this since 2022). Click **Test connection** to verify.

**Permissions / scopes:** none beyond the Speech resource API key. Azure
Speech uses simple resource-key auth (no Entra app registration, no
`Mail.Read`-style scopes). If you also want to use the Outlook integration
above, that needs its own Entra app registration separately.

**Defaults / opt-in:** Azure Speech is **off** until a region+key are saved.
After saving, Azure is invoked only for the streaming dictation channel
(`asr:transcribe-stream`) by default. To make Azure the primary recogniser
for the existing single-shot transcription path, set the build-time env var
`CLAWX_PREFER_AZURE_SPEECH=1` (defaults to `0`). Native on-device recognition
remains the fallback whenever Azure is unconfigured or unreachable.

**Pricing (informational, May 2026):** Azure Speech Standard tier is roughly
**USD $1 per audio-hour** for both real-time / streaming and batch
transcription. See the authoritative pricing page:
<https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/>.

## Tools registered

| Name | Purpose |
|---|---|
| `outlook.profile` | Verify sign-in; return display name + UPN |
| `outlook.list_messages` | List inbox (top, $filter, $search) |
| `outlook.get_message` | Fetch one message by id |
| `outlook.draft_reply` | Create draft (subject, body, to/cc/bcc) |
| `outlook.send_mail` | Send mail immediately |
| `outlook.list_events` | List calendar events / calendarView |
