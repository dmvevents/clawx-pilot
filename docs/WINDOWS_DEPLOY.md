# ClawX Windows Deployment

> Target: a single principal's Windows 11 laptop in Trinidad & Tobago. Pilot scope is one machine; fleet scope is one principal per school across the seven MoE districts.
>
> Last reviewed: **2026-05-20**.

## Build host requirements

The Windows installer is built **on macOS** via electron-builder cross-platform compile. Anton's Mac is the canonical build host.

- Node.js (matches `package.json` `engines` if pinned)
- pnpm via corepack: `corepack enable && corepack prepare`
- Wine **not required** (we ship NSIS through electron-builder's bundled binaries; native rebuilds are off).
- Disk: ~6 GB free for `release/` + `build/`.

## One-time setup on the build host

```bash
cd ~/Github/moe-tt/ClawX
pnpm run init                   # installs deps + downloads bundled uv
pnpm run prep:win-binaries      # downloads Windows-native uv + node into resources/bin/win32-x64
```

Verify Windows binaries landed:

```bash
ls resources/bin/win32-x64/     # should contain uv.exe and node.exe (or similar)
```

## Build the Windows installer

```bash
pnpm run build:vite
zx scripts/bundle-openclaw.mjs
zx scripts/bundle-openclaw-plugins.mjs
zx scripts/bundle-preinstalled-skills.mjs
node scripts/run-electron-builder.mjs --win nsis --x64
```

Or the bundled one-liner:

```bash
pnpm run build:win
```

> NOTE: `pnpm run build -- --win nsis --x64` does **not** work. The `--` flag is consumed by the first script in the `&&` chain (`generate-ext-bridge.mjs`), not by electron-builder. Use `build:win` (or `package:win`) instead.

Output: `release/Ministry of Education-<version>-win-x64.exe` (NSIS installer, perMachine: false).

### Installer characteristics (already configured in `electron-builder.yml`)

| Knob | Value | Why |
|---|---|---|
| `target` | `nsis` | Single .exe installer, no MSIX or AppX overhead |
| `arch` | `x64` | Target school laptops are x64 Windows 11 |
| `oneClick` | `false` | Principal can choose install dir; reduces silent-failure ambiguity |
| `perMachine` | `false` | Per-user install — no admin elevation needed |
| `allowToChangeInstallationDirectory` | `true` | Some schools image with locked C:\Program Files |
| `createDesktopShortcut` / `createStartMenuShortcut` | `true` | Discoverability |
| `differentialPackage` | `true` | Cheaper auto-updates over Trinidad & Tobago broadband |
| `verifyUpdateCodeSignature` | `false` | We do not yet have a code-signing cert |
| `installerIcon` / `uninstallerIcon` | `resources/icons/icon.ico` | MoE-branded |

### Custom installer hooks (`scripts/installer.nsh`)

- Enables Windows long-path support (some skill bundles have deep paths)
- Adds `<installdir>\resources\cli\win32` to the user `PATH` so `openclaw` CLI is callable
- On uninstall: removes the PATH entry; preserves user data in `%USERPROFILE%\.openclaw\` unless user opts in to wipe
- Graceful shutdown handshake for in-flight gateway processes (8 s timeout, then `taskkill /F /IM openclaw-gateway.exe`)

## Pre-flight on the target laptop

> Until the in-app first-run wizard ships (#69), hand the principal the [First-Run Guide](./FIRST_RUN_GUIDE.md) §1 alongside the .exe. The engineering plan to retire the pre-flight is in §2 of the same doc.

Before installing ClawX, the principal's laptop must have:

1. **Ollama** — https://ollama.com/download/windows. After install, run once to spawn the service.
2. **`hermes3:8b`** model — `ollama pull hermes3:8b` from PowerShell. ~4.7 GB download.
3. **Microsoft Edge or Chrome** — browser-automation rides the user's existing profile (Conditional Access blocks managed Chromium; we never use it).
4. **Internet access** for cloud failover (Anthropic, OpenAI, Google) — optional; on-device works without.

## Install the .exe

Double-click `Ministry of Education-<version>-win-x64.exe`, accept defaults, finish. The first launch:

1. Spawns the gateway on `:18789`.
2. The in-process seeder writes valid placeholder config for `microsoft-graph` (disabled) and `moe-principal-assistant` (enabled, "Unconfigured" placeholders).
3. Pre-installed skills materialize in `%USERPROFILE%\.openclaw\skills\`.
4. Ollama is detected on `:11434`; on-device chat is ready.

## Smoke test

Hand off to the `windows-smoke` sub-agent (see `.claude/agents/windows-smoke.md`). Summary:

- All four ports reachable: 18789, 18791, 11434.
- `/healthz` 200, browser plugin 401, ollama tags 200.
- 10 non-platform-gated skills present in `%USERPROFILE%\.openclaw\skills\`.
- Hermes 3 canaries: 3/3 (create_file, send_email, refusal).
- No vendor names in UI; no cost shown; connection dot lit.

## Known caveats on Windows

- **Antivirus first-extraction stall**: NSIS may pause for minutes on slow disks while AV scans. The installer prints a "Extracting ClawX runtime files" hint (`installer.nsh`).
- **Long paths**: Long-path support is enabled by the installer. If any bundled skill still hits a path-length error, file an issue and we'll add the offender to the per-skill copy filter.
- **`profile=user` browser**: All browser-automation skills must launch the principal's signed-in Edge/Chrome profile. The skill loader rejects managed Chromium calls. Conditional Access on `*.moe.gov.tt` blocks the latter; this is a feature, not a bug.
- **MS Forms automation cannot use basic auth or token replay**: integration is best-effort against test accounts only. Production Outlook/Forms access waits on the Entra app-registration packet (see `/tmp/moe-entra-app-registration-request.md`).

## Auto-update channel

Primary: `https://oss.intelli-spectrum.com/latest` (Alibaba OSS). Fallback: GitHub Releases (`ValueCell-ai/ClawX`). Both are configured in `electron-builder.yml`. Code-sig verification is off until we acquire a cert.

## Rollback

Each install retains the previous version's user data in `%USERPROFILE%\.openclaw\`. To roll back:

1. Uninstall via Settings → Apps → ClawX (does not wipe `~/.openclaw\`).
2. Install the previous `.exe` from `release/` or GitHub Releases.
3. The seeder will re-validate config on next boot.

## Pilot distribution (current release)

Public empty repo `dmvevents/clawx-pilot` carries the downloadable .exe. Source stays in the private repo; only release artifacts are public.

- **Download**: https://github.com/dmvevents/clawx-pilot/releases/download/v0.4.3-moe.1/Ministry.of.Education-0.4.3-win-x64.exe
- **Release page**: https://github.com/dmvevents/clawx-pilot/releases/tag/v0.4.3-moe.1
- **SHA-256**: `b0fffd18325ac530d7c33a9a5fc89ef7fa180fda2bc73e9417a6ee8908b6d52b`
- **Size**: 349 MB
- **Pre-release**: yes (pilot scope)

### First-launch playbook on the target laptop

```powershell
# 1. Download
Invoke-WebRequest -Uri "https://github.com/dmvevents/clawx-pilot/releases/download/v0.4.3-moe.1/Ministry.of.Education-0.4.3-win-x64.exe" -OutFile "$env:USERPROFILE\Downloads\ClawX-MoE.exe"

# 2. Verify checksum
certutil -hashfile "$env:USERPROFILE\Downloads\ClawX-MoE.exe" SHA256
# Expected: b0fffd18325ac530d7c33a9a5fc89ef7fa180fda2bc73e9417a6ee8908b6d52b

# 3. Pre-flight: Ollama + hermes3
# Install Ollama from https://ollama.com/download/windows, then:
ollama pull hermes3:8b

# 4. Install ClawX
Start-Process "$env:USERPROFILE\Downloads\ClawX-MoE.exe"
# SmartScreen will warn (unsigned). Click "More info" → "Run anyway".
# Accept the default install dir, finish.

# 5. First launch — verify
# - Tray icon present
# - Settings → Connection: emerald dot ("On this device" lights up once Ollama is reachable)
# - %USERPROFILE%\.openclaw\openclaw.json contains microsoft-graph (disabled) + moe-principal-assistant (enabled placeholders)
```

## Out-of-scope for pilot

- Code-signing cert (deferred; SmartScreen will warn on first run, principal clicks "More info → Run anyway").
- MSI/MSIX packaging (NSIS is enough for one laptop).
- Group Policy / SCCM rollout (only relevant at fleet scale).
