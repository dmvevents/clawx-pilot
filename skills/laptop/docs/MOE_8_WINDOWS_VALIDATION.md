# moe.8 Windows static validation

Status as of `2026-05-24` against `release/Ministry of Education-0.4.3-moe.8-win-x64.exe`. SHA256 `9fe5d0e4c2fc6c63890a16081a069e9eb79a338460b4462ccac2bf268431f677`.

**Static-only.** Cat-5 link to the pilot is down and we don't have a Win11 ISO loaded for UTM, so this report covers what's verifiable from the unpacked `release/win-unpacked/` tree without booting Windows. Live VM + pilot validation is task #105's runtime phase, blocked on either of those resources returning.

## Score

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Top-level binary tree | PASS | 354 MB total. All expected files present (Electron .exe, .dlls, locales, resources). |
| 2 | Main exe is a Windows PE | PASS | `PE32+ executable (GUI) x86-64, for MS Windows`. 204 MB. Unsigned (expected for pilot). |
| 3 | Bundled CLI binaries are Windows PE | PASS | `bin/uv.exe` and `bin/node.exe` both `PE32+ x86-64`. |
| 4 | MoE extensions ship | PASS | `resources/extensions/microsoft-graph` and `resources/extensions/moe-principal-assistant` present with `index.mjs`, `package.json`, `openclaw.plugin.json`. |
| 5 | OpenClaw bundle complete | PASS | All expected `assets/`, `dist/`, `node_modules/`, `openclaw.mjs`, `package.json`. |
| 6 | asar entries valid for Windows | PASS | No `:`/`?`/`*`/`|` in filenames. |
| 7 | No leaked dev-host paths | PASS | The 1 hit on `/Users/antonalexander` is in TypeScript `.d.ts` source-map metadata (build artefact, not runtime-bearing). |
| 8 | NSIS uninstaller covers MoE userData | PASS | 20 occurrences of `Ministry of Education` in `installer.nsh`. |
| 9 | No auto-update endpoint | PASS | `app-update.yml` not generated. `publish: null` + runtime `ENABLE_AUTO_UPDATE` flag both holding. |
| 10 | `outlook` in `PRINCIPAL_SKILL_ALLOWLIST` | PASS | Confirmed in bundled feature-flags. |
| 11 | Tray strings rebranded to MoE | PASS | `Ministry of Education - Assistant` tooltip, `Show/Quit Ministry of Education` menu. |
| 12 | Bedrock SDK shipped | PASS | `@aws-sdk/client-bedrock-runtime` referenced 3× in main bundle. |
| 13 | apiProtocol→runtime api normaliser | PASS | `google-query-key→openai-completions` mapping live in bundle. |
| 14 | Stale plugin entries get pruned at boot | PASS | `wechat`/`wecom` etc. in stale-prune list. |
| 15 | Bedrock→Gemini fallback chain | PASS | `fallbackCaller` 4 references, `Gemini fallback` log string present. |
| 16 | Plugin facade wires 11 outlook tools | PASS | `outlook.open / read_inbox / search_inbox / read_email / draft_email / send_email / reply / forward / mark_read / list_attachments / download_attachment` — `name: 'outlook.` 11 occurrences. |
| 17 | `apiProtocol` mapping migration runs at boot | PASS | Migration in `seedGatewayPluginConfig` shipped. |
| 18 | Atomic-write `.tmp.${pid}` pattern in bundle | PASS | 2 sites (channel-config + openclaw-auth). |
| 19 | `withTimeout` on Playwright calls | PASS | Wraps `launchPersistentContext` + `screenshot` + `evaluate` per audit guidance. |
| 20 | **Mac native binaries leaking into Win bundle** | **PARTIAL → fixed for next build** | `@napi-rs/canvas-darwin-arm64` (55 MB) and `@mariozechner/clipboard-darwin-*` (12 MB) shipped. The `cleanupNativePlatformPackages` after-pack hook only walked `resources/openclaw/node_modules`. Fixed in the same commit as this doc — the hook now also walks `resources/app.asar.unpacked/node_modules` AND every `resources/openclaw/dist/extensions/*/node_modules`. Next build will be ~67 MB smaller. |

## Bundle size

```
350 MB  release/Ministry of Education-0.4.3-moe.8-win-x64.exe   (NSIS-compressed)
354 MB  release/win-unpacked/                                   (post-extract)
 204 MB  Ministry of Education.exe                              (Electron + chromium)
  55 MB  app.asar.unpacked/node_modules/@napi-rs (Mac canvas binaries — fixed for next build)
  12 MB  openclaw/dist/extensions/codex/node_modules/@mariozechner (Mac clipboard — fixed for next build)
  ~30 MB  openclaw/node_modules
  ~40 MB  bundled extensions + plugin mirrors
  ~15 MB  Bedrock SDK + AWS SDK chain
   ~50 MB  miscellaneous Electron/Chromium runtime files
```

After the fix, expect ~287 MB unpacked / ~283 MB compressed.

## Findings

### Closed in this validation pass
1. **Mac native binaries shipping in Windows** (~67 MB dead code). Fix landed in `scripts/after-pack.cjs`: `cleanupNativePlatformPackages` now walks the asar.unpacked tree and every nested extension `node_modules`. Next build will reflect.

### Carried into runtime validation
1. The 11 outlook tools register at boot — verified by static count, but the gateway needs to actually run for end-to-end confirmation. (Mac equivalent: ✓ live-verified.)
2. Sign-in flow — only verifiable on a real Windows session.
3. Outlook DOM behaviour on Edge / Chrome paths on Windows — semantic locators are theme-stable on Mac; needs Windows verification.
4. CDP attach against Chrome on Windows — driver path uses identical Playwright code, but the Chrome binary location differs (`%PROGRAMFILES%\Google\Chrome\...`). Driver auto-resolves; no Windows-specific test yet.

## What this report cannot prove

- The .exe actually launches on Windows
- Gateway boots cleanly on first run
- Plugin tools register against the live gateway (vs static plugin code presence)
- Outlook session attach works on real Win Chrome
- Eval scores on Windows match Mac (15/15 LLM tool-pick, 6/6 inbox-independent live rows)

These all need a Windows runtime. Two paths:

1. **UTM Win11 ARM64 VM** — blocked on the ISO download (Microsoft captcha)
2. **Pilot via Cat-5** — blocked on link reconnection

Both unblockers are in your hands.

## Tag

`v0.4.3-moe.8` is locally tagged. Branch `feat/outlook-v2-agentic-moe.5` carries 39+ commits since `v0.4.3-moe.4`.
