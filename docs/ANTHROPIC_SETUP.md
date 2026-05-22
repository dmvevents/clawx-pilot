# Configuring Anthropic (Claude) in ClawX

> Audience: an operator (not the principal) wiring up cloud failover on a test laptop. Five minutes start to finish.
>
> Last reviewed: **2026-05-21**.

ClawX uses on-device chat (Hermes 3 via Ollama) by default; cloud providers are the failover lane. Anthropic Claude is a first-class supported provider.

## 1 · Get an API key

1. Visit https://console.anthropic.com/settings/keys
2. Click **Create Key** → name it (e.g. `clawx-pilot-laptop-1`) → copy the `sk-ant-api03-...` value.
3. **Important**: you won't be able to view this key again. Paste it somewhere safe right now.

> **Cost guardrail** — set a monthly cap in https://console.anthropic.com/settings/limits before handing the laptop to a principal. Pilot laptops should not be able to burn the org budget.

## 2 · Add the provider in ClawX

1. Open ClawX. Click the **gear icon** in the sidebar to open Settings.
2. Choose the **Providers** tab.
3. Click **Add provider**.
4. From the picker, select **Anthropic**.
5. Auth mode: **API key**.
6. **API key**: paste your `sk-ant-api03-...`.
7. **Base URL**: leave as the default (`https://api.anthropic.com`).
8. **Model**: leave as the default. (Hidden from the principal UI; you'll see it in dev mode only.)
9. Click **Save**.

The provider card should switch from red ("API key missing") to a green status dot.

## 3 · Verify the wire-up

Open a new chat and toggle the composer channel to **Online**. Type:

> Draft a one-paragraph daily report email to the District Superintendent saying everything is normal at school.

If a draft comes back within ~10 seconds, Anthropic is wired correctly.

## What the principal sees

Anonymisation rule: **the principal never sees vendor names.**

- Composer pill: **Online** (when cloud is routing) or **On this device** (when local is routing).
- Status bar: green dot (reachable) or zinc (unreachable). Never "Anthropic" or "Claude".
- Cost: hidden. Logged to `~/.openclaw/logs/` for telemetry only.
- Settings → Providers: the only surface in the app that shows "Anthropic". Operator-only, not part of the principal flow.

## Routing through a local proxy (advanced)

If you're routing all Claude calls through a local tracker (e.g. `claude-code-router` on `:8080`):

| Field | Value |
|---|---|
| Base URL | `http://127.0.0.1:8080` |
| API key | upstream key (or router-side dummy if `LLM_API_KEY` is set in your router env) |
| API protocol | `anthropic-messages` |

The router log at `~/.claude-code-router/logs/latest.log` should show the request after you send a chat.

## Where the key is stored

| Platform | Backing store |
|---|---|
| macOS | Keychain (via electron-store) |
| Windows | DPAPI-encrypted file under `%APPDATA%\Ministry of Education\` |

The key never leaves the machine. It's not synced to the OSS update channel, GitHub Releases, or any cloud telemetry pipeline.

## Rotation / removal

- **Rotate**: paste a new value into Settings → Providers → Anthropic → API key → Save. The old key is overwritten.
- **Remove**: Settings → Providers → Anthropic → ⋯ menu → Remove provider.
- **Revoke at the source**: https://console.anthropic.com/settings/keys → ⋯ → Revoke. Do this if a laptop is lost or repurposed.

## Cross-references

- [`FIRST_RUN_GUIDE.md`](./FIRST_RUN_GUIDE.md) — principal pre-flight (Ollama + hermes3:8b)
- [`WINDOWS_DEPLOY.md`](./WINDOWS_DEPLOY.md) — installer + distribution
- [`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md) — production gates (cost guardrail row 4.3)
