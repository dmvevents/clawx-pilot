# MoE Windows RC 2026-06-10

Windows release candidate refresh for the Ministry of Education pilot.

Installer source commit:

```text
bbc4eb10c97cc21315eada3ce2d084f56d44dca0
```

## Download

Use the attached installer asset:

```text
Ministry.of.Education-0.4.3-moe.10-win-x64.exe
```

Do not use the GitHub source code zip or tar.gz files for app testing.

## Assets

- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`
  - SHA-256: `4663ad8a1d46729633132ddac47fc8bc40c1d5d14fd29da231b53941b22d1931`
- `Ministry.of.Education-0.4.3-moe.10-win-x64.exe.blockmap`
  - SHA-256: `e07e35d200f884066ba531c7e135c7b4a00211938c82b79df0e527412bace5c7`
- `MOE_WINDOWS_RC_2026-06-10_USER_INSTRUCTIONS.md`
  - Detailed tester instructions for install, first launch, Outlook, Forms,
    files, voice input, expected behavior, and support evidence.

## What Changed Since 2026-06-08

- The installer carries the managed online model gateway seed files.
- The packaged runtime check confirmed `playwright-core`, Office parser
  packages, Windows ASR helper, bundled Node, bundled uv, and cloud gateway
  seed files.
- Microsoft Graph bootstrap support was added so future packages can carry
  non-secret tenant/client defaults in `resources/microsoft-graph.json`.
- GitHub Actions can inject `CLAWX_MICROSOFT_GRAPH_CONFIG_JSON` and optionally
  require it for release builds.

## Validation

- `pnpm exec vitest run tests/unit/microsoft-graph-store.test.ts tests/unit/outlook-routes-graph.test.ts tests/unit/microsoft-graph-outlook-adapter.test.ts`
  - Result: 3 files / 14 tests passed.
- `pnpm run typecheck`
  - Passed.
- `pnpm run build:win`
  - Passed.
- Local package hash verified.
- Internal GCS mirror uploaded under
  `rc-local-20260610-m365-programmatic-bootstrap`.

## User Instructions

The user should:

1. Download `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`.
2. Run the normal GUI installer.
3. Open `Ministry of Education` from the desktop shortcut.
4. Wait up to 90 seconds for the app and gateway to start.
5. Sign in to Microsoft 365 if Outlook or Forms opens a Microsoft login page.
6. Test Downloads, email, Forms, and voice input with the prompts in
   `MOE_WINDOWS_RC_2026-06-10_USER_INSTRUCTIONS.md`.

The user should not install Chrome MCP, configure Chrome remote debugging,
open `chrome://flags`, run PowerShell Chrome commands, or paste model provider
API keys.

## Current Microsoft 365 Status

This package is Microsoft 365 bootstrap-capable, but not yet fully
Graph-configured.

The packaged runtime intentionally does not include
`resources/microsoft-graph.json` because MoE IT has not supplied the real Entra
public client ID yet. Outlook can use Graph once the Entra tenant/client config
is packaged and the user signs in. Until then, the controlled app/browser
fallback remains the demo path.

Forms are still gated for safety. The durable GA path is SharePoint List writes
through Microsoft Graph or IT-owned Power Automate/Logic Apps endpoints.
Browser Forms remains the controlled demo fallback and must not submit without
same-session confirmation.

## Known Gaps Before GA Green

- Need real MoE Entra public-client app registration and delegated Outlook
  consent.
- Need SharePoint/Power Automate destination mapping for production Forms.
- Need fresh Windows installed-app smoke proving model chat, Outlook, Forms
  preview, Office file analysis, and ASR on the target laptop/profile.
- Need final no-secrets audit before GA.
