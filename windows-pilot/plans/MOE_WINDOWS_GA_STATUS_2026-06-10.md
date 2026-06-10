# MoE Windows GA Status - 2026-06-10

## Verdict

**YELLOW - release-candidate ready, not GA green.**

The current branch has fresh validation and two successful Windows rebuilds,
including a Windows-native manual GitHub Actions package. It is suitable for
controlled RC testing. It is not yet GA because the remaining release-critical
proof still depends on a clean installed-app run with signed-in Microsoft Forms,
Office file matrix evidence, ASR smoke, and final external evidence capture.

## Fresh Rebuild Evidence

### Manual GitHub Actions Rebuild

- Workflow: `package-win-manual.yml`
- Run ID: `27299469846`
- Run URL: `https://github.com/dmvevents/clawx-pilot/actions/runs/27299469846`
- Branch: `release/moe10-windows-laptop-ready-20260529`
- Commit: `832aaf3d70baa9bc377bfaaffeb984cd9986334b`
- Created: `2026-06-10T19:05:00Z`
- Completed: `2026-06-10T19:14:05Z`
- Conclusion: `success`
- Inputs used:
  - `requireCloudGatewaySeed=true`
  - `requireMicrosoftGraphSeed=false`

Downloaded artifacts:

```text
/tmp/moe-ga-27299469846/windows-installer-x64/Ministry of Education-0.4.3-moe.10-win-x64.exe
SHA-256: fe8d7af9fe2db1054ec7ee2bfdd22d05f932ba486644b7d15b6153bb5f8f9219
Size: 287 MB

/tmp/moe-ga-27299469846/windows-blockmap/Ministry of Education-0.4.3-moe.10-win-x64.exe.blockmap
SHA-256: a563185c8e68aa328fe7d09c0654430b98d1624dc1d0611d1e2b02a87a141220
Size: 286 KB
```

The manual workflow passed dependency install, Windows uv download, cloud
gateway seed preparation, optional Microsoft Graph seed handling, Windows
packaging, x64 installer upload, blockmap upload, and post-job cleanup.

### Local Cross-Build Rebuild

Command:

```bash
PATH="$HOME/.dotnet:$PATH" pnpm run build:win
```

Result: `success`.

Generated artifacts:

```text
release/Ministry of Education-0.4.3-moe.10-win-x64.exe
SHA-256: 4342b4e8bd849f27db769393e57129c5352631e7bd7aa40b7bdc7940960262c3
Size: 372 MB

release/Ministry of Education-0.4.3-moe.10-win-x64.exe.blockmap
SHA-256: bb3706cae31960b1dbafee16fa404a86f0dbe9f8a5a8d396595e8af42e302e45
Size: 301 KB
```

Local build note: the first local attempt failed because `dotnet` was not on
`PATH`; the rerun with `~/.dotnet` on `PATH` built `WinSpeechRecognize.exe`
instead of skipping ASR.

## Local Validation Evidence

Passed:

- `pnpm run typecheck`
- `pnpm exec vitest run tests/unit/channel-router.test.ts tests/unit/provider-runtime-sync.test.ts tests/unit/forms-browser-driver-cdp.test.ts tests/unit/forms-browser-submit-gate.test.ts tests/unit/asr-ipc-provider-selection.test.ts tests/unit/asr-feature-flags.test.ts tests/unit/moe-principal-setup-section.test.ts`
  - 7 files, 57 tests passed.
- `pnpm run harness:ci`
  - harness specs valid, dry-run report at `artifacts/harness/latest.md`, 2
    harness unit files / 12 tests passed.
- `pnpm run build:win`
  - passed after the `PATH="$HOME/.dotnet:$PATH"` rerun.

Dependency/package checks:

- `playwright-core` is in `dependencies` at version `1.59.1`.
- `playwright-core` is not in `devDependencies`.
- Packaged runtime contains:
  - `playwright-core`
  - `xlsx`
  - `docx`
  - `mammoth`
  - `pdf-parse`
  - `WinSpeechRecognize.exe`
  - Windows `node.exe`
  - Windows `uv.exe`
  - `ffmpeg.exe`
  - `cloud-gateway.json`
  - `cloud-gateway.key`
  - Microsoft Graph example config
  - `microsoft-graph` extension
  - `moe-principal-assistant` extension

Packaged cloud gateway summary:

```text
providerId=moe-cloud-gateway
model=moe-demo-pro
baseUrlPresent=true
apiKeyFile=cloud-gateway.key
```

Microsoft Graph status:

```text
resources/microsoft-graph.json: missing by design
resources/microsoft-graph.example.json: present
```

This means the rebuilt installer is online-model ready, but not
Graph-preconfigured until MoE IT supplies `CLAWX_MICROSOFT_GRAPH_CONFIG_JSON`.

## Current Gate Status

| Gate | Status | Evidence / blocker |
|---|---|---|
| Manual Windows rebuild | GREEN | GitHub Actions run `27299469846` succeeded and artifacts were downloaded/hash-checked. |
| Local Windows rebuild | GREEN | `PATH="$HOME/.dotnet:$PATH" pnpm run build:win` succeeded. |
| Online model packaging | GREEN for RC | Cloud gateway seed present in packaged runtime; no upstream provider key is exposed in UI. |
| Playwright runtime dependency | GREEN | `playwright-core` is in runtime dependencies and packaged under OpenClaw node_modules. |
| Office parser packaging | GREEN for package | `xlsx`, `docx`, `mammoth`, and `pdf-parse` are present in packaged runtime. |
| ASR helper packaging | GREEN for package | `WinSpeechRecognize.exe` built and packaged. |
| Outlook Graph default | YELLOW | Graph bootstrap code exists, but real tenant/client config is not packaged yet. |
| Forms setup | YELLOW | Principal setup UI now stores Daily Report and Suspension links; signed-in Forms preview/prefill still needs installed-app proof. |
| Clean install | YELLOW | Prior VM/tester evidence exists; this rebuilt artifact still needs fresh install proof. |
| Office file matrix | YELLOW | Parser packages are present; Excel/Word/PDF installed-app matrix still needs fresh proof. |
| ASR runtime quality | YELLOW | Helper is packaged; microphone/file transcription smoke still needs fresh proof. |
| Branding/security | YELLOW | Recent cleanup exists; final full release grep and evidence packet still needed. |

## Blockers To GA Green

1. Install the manual workflow artifact on a clean Windows profile or pilot
   laptop and capture desktop shortcut, Host API, Gateway, and chat readiness.
2. Complete one online model chat through the installed app and confirm provider
   coherence in `.openclaw/openclaw.json` and latest transcript.
3. Sign in to Microsoft and capture Outlook read/draft/send-confirmation
   evidence without exposing private email content.
4. Save Daily Report and Suspension Forms links in Settings > Principal setup,
   then capture Forms preview/prefill and no-submit safety evidence.
5. Run Excel, Word, and PDF file-analysis prompts from Downloads.
6. Run one ASR smoke or explicitly mark ASR best-effort for GA.
7. Package real Microsoft Graph tenant/client defaults after MoE IT provides the
   Entra public client ID, or document browser fallback as the RC-only path.
8. Publish/attach the final evidence packet to the GA board issue.

## Next Release Action

Use the manual GitHub Actions artifact from run `27299469846` as the next clean
install candidate. Do not call the release GA until the installed-app gates
above are completed against that artifact or an explicitly newer rebuild.
