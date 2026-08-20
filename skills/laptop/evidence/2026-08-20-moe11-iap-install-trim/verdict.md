# Verdict — moe.11 install + on-device tool-trim validation over the IAP lane

Run date: 2026-08-20. Lane: GCP `clawx-win-rc-20260609` over IAP (no pilot laptop, no public
port, no whitelisted IP). Build under test: `0.4.3-moe.11` from `7add864b`
(`fix/tool-catalog-trim`), which has `fc435c6b` (BUG-012) as an ancestor.

## Gates

| Gate | Verdict | Evidence |
|---|---|---|
| moe.11 Windows installer exists | **GREEN** | sha256 `b01bb6c3…`, 390,097,611 bytes, build exit 0, zero errors. Closes the "release/ tops out at moe.10" version gap. |
| Artifact integrity Mac -> GCS -> guest | **GREEN** | sha256 identical at all three points. |
| Install over moe.10 | **GREEN** | exit 0. |
| Trim ships in the packaged asar | **GREEN** | `strings -a app.asar` finds the contiguous literal deny array. |
| Trim flag active by default | **GREEN** | `shared/feature-flags.ts:122` — `flagFromEnv('CLAWX_TRIM_ONDEVICE_TOOLS', true)`. Shipped *and* live, not dormant. |
| **Trim written to runtime config on the guest** | **GREEN** | `DENY[ollama-ollamalo]=tts\|process\|subagents\|sessions_list\|sessions_spawn\|web_search\|web_fetch\|image\|canvas` — all nine, provider-scoped. First on-device proof outside unit tests. |
| Gateway + host-API bind | **GREEN** | `PORT_18789=LISTENING`, `PORT_13210=LISTENING`, control `PORT_9999=CLOSED`. |
| Install duration | **RED** | 460.6s first, **344.1s re-installing the identical version**. See below. |
| Defender exclusion effective | **YELLOW** | INSTDIR exclusion present but `DISABLE_REALTIME=False`; real-time scanning still walks the payload. |
| On-device tool-cascade re-test | **GREEN (blocker cleared)** | Differential `FULL` 6/6 -> `TRIM` 4/6 -> `NONE` 0/6 spurious tool calls; residual `exec` call self-recovers in one hop, 3/3 trials. The hang is gone. See `ondevice-cascade-test.md`. |
| Residual spurious `exec` | **YELLOW** | 4/6 on a knowledge question, but terminates correctly next hop — one wasted ~5s round-trip, not a hang. Denying `exec` too would take it to 0/6. |

## Two findings that correct prior characterizations

**1. "The installer reinstalls dependencies every time" is wrong.** `scripts/installer.nsh`
(415 lines) contains no package-manager or dependency-install step at all. The cost is
re-extracting **131,404 files / 1588 MB** on every run, with Defender real-time scanning
active. Optimizing the wrong layer would have wasted the effort — the target is payload
size/extraction and Defender, not dependency resolution.

**2. `AGENTS_COUNT=0` is the designed BUG-012 state, not a regression.**
`ensureBootableAgentsConfig` (`electron/utils/agent-config.ts:775`) defines "bootable" as
`agents.defaults` existing — the gateway binds an *implicit* main agent from
`defaults.model.primary` and never needs an `agents.list` entry. Guest state:
`DEFAULT_MODEL={"primary":"custom-moecloud/moe-demo-pro"}`, log
`ensured:true, created:false` (correct idempotent no-op), preflight `reason:already-coherent`.
An empty `list` alongside a populated `defaults` is expected and the Gateway binds. Do not
"fix" this.

## Method notes worth reusing

- **The app is a child of the SSH session.** A first launch showed `APP_PROCS=6`, then `0`
  after the shell closed, which read as a crash — the log ended cleanly at 04:18:32 with no
  error and a WS client had already connected to 18789. Relaunch via
  `Invoke-CimMethod Win32_Process Create` parents the app to WMI so it survives teardown.
  Launched **visible** throughout (hidden launch kills the Gateway).
- **Control leg is mandatory and it earned its keep.** The very first port probe reported
  PASS through a **stale tunnel from an earlier session** holding the port (PID 48862). Fresh
  ports plus a closed-port control leg gave the real answer.
- **Never inline `powershell -c` against these paths.** "Ministry of Education" contains
  spaces; quoting through SSH breaks (`A positional parameter cannot be found that accepts
  argument 'of'`). Author a local `.ps1`, `scp` it, run `-ExecutionPolicy Bypass -File`, and
  use `Join-Path`/`$env:` rather than interpolation.
- **`grep -c` under-reports on binaries.** Use `grep -ac` / `strings -a`, and include a
  control marker so "absent" is distinguishable from "method broken". Only *string literals*
  are valid evidence in a bundle — TS identifiers minify away.

## Not done

- Full in-app on-device chat turn: the cascade arms hit the ollama API directly and the turn loop was faithfully simulated, but `preferredChannel` was not flipped to `on-device` in the installed app (guest is `online` / `custom-moecloud/moe-demo-pro`).
- Outlook/Forms CDP flows — not attempted; needs a signed-in Chrome session.
- `fix/tool-catalog-trim` remains under **HOLD**: not merged, not self-approved, `main`
  unaffected, upstream `origin` untouched.

## Silent `/S` install did NOT reproduce the known RED partial-tree failure

`docs/GA_RELEASE_EVIDENCE_MANIFEST.md` records hidden/silent `/S` installs against June
assets as `RED`: the installer copied a large partial tree but never created
`Ministry of Education.exe`, `playwright-core`, `ffmpeg.exe`, or `WinSpeechRecognize.exe`.
Against the moe.11 asset the tree is **complete**:

| Artifact | Result |
|---|---|
| `Ministry of Education.exe` | present, 214,315,008 bytes, ProductVersion `0.4.3.0` |
| `resources\app.asar` | present, 242,375,661 bytes |
| `resources\openclaw\openclaw.mjs` | present |
| `playwright-core` | present in 3 locations, 460 files each (the moe.9 regression class) |
| `resources\bin\ffmpeg.exe` | present |
| `resources\bin\WinSpeechRecognize.exe` | present, 12,288 bytes (+ `.config`) |
| tree total | 131,404 files / 1588 MB |

Correction to my own first probe: `playwright-core` and `WinSpeechRecognize.exe` initially
read as MISS because I guessed the wrong paths — the ASR helper lives at `resources\bin\`
**flat**, not `resources\bin\win32-x64\`, and `playwright-core` ships under
`resources\openclaw\...\node_modules`, not `app.asar.unpacked`. Both are present. A path guess
that misses is not a missing artifact; the follow-up recursive search is what settles it.

This is one data point on one asset via `/S` (not the hidden-WinRM variant). It is evidence
that the moe.11 asset extracts completely, not a promotion of silent install to a supported
end-user flow — the manifest's requirement for assisted installer screens stands.
