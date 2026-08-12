# Ministry Branding Audit - 2026-06-10

## Target

The shipped app should present as `Ministry of Education` for Trinidad and
Tobago principals. `ClawX` and `OpenClaw` should remain only in developer
diagnostics, internal implementation names, and support runbooks where they
are needed to debug the runtime.

GitHub issue: `dmvevents/clawx-pilot#7`.

2026-06-10 remediation pass:

- Patched high-impact user-facing release/app identity surfaces:
  `package.json`, `electron-builder.yml`, `index.html`,
  `electron/main/index.ts`, and Linux autostart naming.
- Patched menu/support links, OAuth completion pages, daily-report
  notification copy, Forms/Outlook diagnostics, OpenRouter attribution,
  Azure Speech client name, first-run setup copy, Settings About links, and
  bundled agent context snippets.
- Left internal runtime names, package identifiers, source filenames, and
  developer diagnostics in place where changing them would risk migration,
  plugin discovery, or support tooling before the demo.
- Verification: targeted grep against patched app-facing surfaces now leaves
  only internal runtime/developer identifiers and comments, not principal-facing
  labels or instructions.

## High-Priority User-Facing Leaks

### Release And App Identity

- `package.json`
  - package name is `clawx`;
  - description says `built on ClawX/OpenClaw`.
- `electron-builder.yml`
  - `appId` is `app.clawx.desktop`;
  - macOS permission prompts say `ClawX requires...`;
  - Linux maintainer/description mention `ClawX Team` and `ClawX/OpenClaw`.
- `electron/main/index.ts`
  - Windows AppUserModelId is `app.clawx.desktop`;
  - Linux desktop name is `clawx.desktop`.
- `index.html`
  - title is `ClawX`.
- `resources/icons`
  - icon README and current source artwork are still ClawX-oriented.

### Menus, Links, OAuth, Notifications

- `electron/main/menu.ts`
  - Help links point to `claw-x.com`, upstream issue tracker, and OpenClaw docs.
- `electron/utils/microsoft-graph-oauth.ts`
  - OAuth success page says to return to ClawX.
- `electron/utils/gemini-cli-oauth.ts`
  - OAuth pages and errors say to return to ClawX.
- `electron/main/moe-seed.ts`
  - desktop notification says `Open ClawX...`.
- `electron/services/forms-browser-v2/forms-driver.ts`
  - principal-facing diagnostics mention ClawX.
- `electron/services/outlook-browser/manager.ts`
  - principal-facing diagnostics mention ClawX.

### Provider And Telemetry Attribution

- `electron/utils/openrouter-headers-preload.cjs`
  - OpenRouter attribution uses `https://claw-x.com` and `X-OpenRouter-Title:
    ClawX`.
- `electron/gateway/process-launcher.ts`
  - duplicate OpenRouter attribution;
  - service name is `OpenClaw Gateway`.
- `electron/main/asr-azure.ts`
  - Azure Speech system name is `ClawX`.

### Agent Context And Tool Copy

- `resources/context/AGENTS.clawx.md`
  - agent identity says `You are ClawX... based on OpenClaw`.
- `resources/context/TOOLS.clawx.md`
  - tool notes say `uv is bundled with ClawX`.
- `electron/utils/openclaw-workspace.ts`
  - seeds default `IDENTITY.md - ClawX`.
- `extensions/moe-principal-assistant/persona.mjs`
  - mentions `ClawX-owned` browser diagnostics and `ClawX`.
- `extensions/moe-principal-assistant/index.mjs`
  - tool descriptions mention `ClawX Outlook tool path` and `MoE forms ClawX
    can fill`.

### Setup And Settings

- `src/pages/Setup/index.tsx`
  - first-run/runtime status messages expose `OpenClaw package`.
- `src/i18n/locales/en/settings.json`
  - visible developer labels include `openclaw doctor` and shell setup text.
- `src/pages/Settings/index.tsx`
  - About links point to `claw-x.com` and upstream GitHub.
- `src/pages/Settings/AzureSpeechSection.tsx`
  - visible settings copy says `ClawX can stream microphone audio...`.

### Public Docs And Package Metadata

- root README translations are still upstream ClawX/OpenClaw branded.
- `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-10_USER_INSTRUCTIONS.md`
  intentionally exposes internal support paths; keep those only in support
  instructions, not principal-facing quick-start cards.
- `extensions/moe-principal-assistant/package.json`
  - package name and description use `@clawx/...` and `ClawX plugin`.
- `extensions/microsoft-graph/package.json`
  - package name uses `@clawx/...`.

## Allowed Internal Names

These may remain until a larger internal rename is justified:

- file paths under `.openclaw`;
- log filenames such as `clawx-*.log`;
- developer-only runbooks;
- internal function names and runtime package identifiers;
- upstream dependency names.

## Acceptance Criteria

- Principal-facing screens, prompts, notifications, OAuth pages, release pages,
  and support instructions use Ministry wording.
- Technical ClawX/OpenClaw names are hidden behind Developer/Support context.
- Help links point to a Ministry support surface or release issue tracker that
  is safe for pilot users.
- A pre-GA grep checklist verifies no high-priority user-facing leaks remain.
