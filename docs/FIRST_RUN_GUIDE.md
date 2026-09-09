# ClawX First-Run Guide

> Audience: a primary-school principal opening the .exe for the first time on a 16 GB Windows 11 laptop. No prior software installed beyond Edge.
>
> Last reviewed: **2026-05-21**.

This document has two parts:

1. **Principal-facing pre-flight** — the 30-second sheet you'd hand a principal next to the .exe today (until #69 ships).
2. **Engineering plan** — the in-app guided wizard that closes the pre-flight gap so the .exe is truly zero-prework.

---

## 1 · Principal-facing pre-flight (today)

Hand this with the installer until the in-app wizard ships.

### Step 1 — Install Ollama (one minute)

Open https://ollama.com/download/windows in Edge, click **Download for Windows**, run the installer. After it finishes, you'll see an Ollama icon in the system tray.

### Step 2 — Pull the on-device AI model (~10 min on a school connection)

Open **PowerShell** (Start → type `PowerShell` → Enter) and paste:

```powershell
ollama pull qwen2.5:3b-instruct
```

You can leave this running in the background while you do other work. ~1.9 GB.

This must match the model the app actually requests. `hermes3:8b` is in the app's
`LEGACY_LOCAL_MODELS` migration set — it won the May 2026 36-prompt agentic bake-off
but its 30 GB loaded footprint does not fit a 16 GB laptop. Qwen 2.5 3B Instruct ties
it on accuracy (11/12) while being 2.2x faster, 3.1x better at P95 cold start and 7x
smaller.

### Step 3 — Install ClawX

Double-click `Ministry of Education-0.4.3-win-x64.exe`. Windows will warn that the publisher isn't recognised — click **More info → Run anyway**. Accept the default install location.

### Step 4 — First launch

Open ClawX from the Start menu. The first time, it spends ~10 seconds setting up. When the green dot appears in the bottom-left, you're ready.

### Step 5 — Sign in to Edge with your MoE account

Open Edge, sign in with your `@moe.gov.tt` account once. ClawX uses your existing Edge session for MS Forms automation — never a separate browser, never a saved password.

That's it. From here, type into the chat to test:

> "Draft a daily report email to the District Superintendent saying everything is normal."

If you see a draft come back within 30 seconds, on-device AI is working. If you see "Online" instead of "On this device" in the corner, it's running on cloud failover — also fine.

---

## 2 · Engineering plan: the zero-prework wizard

**Goal:** delete the principal-facing pre-flight above. The .exe handles Ollama install + model pull from inside the app.

### Why we don't just bundle everything

| Option | Installer size | Update size | Verdict |
|---|---|---|---|
| Bundle nothing (today) | 349 MB | ~50 MB diffs | Smallest, but pre-flight required |
| Bundle Ollama installer | ~500 MB | ~50 MB | Saves one download step; doesn't help with model |
| Bundle Ollama + qwen2.5:3b-instruct GGUF | ~2.4 GB | ~50 MB diffs if the model is a separate payload | **Reopened** — the original rejection assumed the 5.2 GB Hermes bundle. With the 1.9 GB model, and the weights shipped as a one-time payload rather than inside the auto-updated app, the bandwidth objection no longer applies |
| Detect + guide (recommended) | 349 MB | ~50 MB | True zero-prework UX with same installer footprint |

### Wizard state machine

```
launch
  └─> probe ollama @ 127.0.0.1:11434/api/tags
       ├─ reachable + qwen2.5:3b-instruct present → state=ready
       ├─ reachable, model missing        → state=needs-model
       └─ unreachable                     → state=needs-ollama

needs-ollama
  └─> in-app modal: "On-device AI needs Ollama"
       ├─ primary button: install via winget (silent)
       │   └─> on success → re-probe → state=needs-model
       │   └─> on winget-unavailable → fall through
       └─ fallback button: open https://ollama.com/download/windows
           └─> after manual install, user clicks "I've installed it" → re-probe

needs-model
  └─> in-app modal: "Downloading on-device AI model"
       ├─ stream POST /api/pull with model=qwen2.5:3b-instruct
       ├─ render MB/sec + ETA from stream chunks
       ├─ on success → state=ready
       └─ on failure → retry button + dismiss-to-cloud-failover button

ready
  └─> canary: ask qwen2.5:3b-instruct "what is 2+2?" with 8s timeout
       ├─ pass → green dot, dismiss wizard
       └─ fail → toast "On-device AI not responding; using cloud failover"
```

While `state != ready`, the app stays fully usable on cloud failover. The wizard never blocks chat; it sits in a dismissable corner panel.

### IPC surface

New main-process handlers (all in `electron/main/ipc-handlers.ts`):

| Channel | Direction | Purpose |
|---|---|---|
| `firstrun:probe` | renderer → main → reply | Returns `{ ollama: 'ok'\|'down', model: 'present'\|'missing' }` |
| `firstrun:install-ollama` | renderer → main → reply | Spawns `winget install --id Ollama.Ollama -e --silent`, returns `{ ok, stderr? }` |
| `firstrun:open-ollama-download` | renderer → main | `shell.openExternal('https://ollama.com/download/windows')` |
| `firstrun:pull-model` | renderer → main, streaming | Streams `POST /api/pull` chunks to renderer as `{ totalBytes, completedBytes, status }` |
| `firstrun:cancel-pull` | renderer → main | Aborts the in-flight pull |

### File plan

| File | Action |
|---|---|
| `electron/main/firstrun-detector.ts` | NEW — `probeOllama()`, `probeModel(modelId)` |
| `electron/main/firstrun-installer.ts` | NEW — `runWingetInstall()`, fallback to `shell.openExternal` |
| `electron/main/firstrun-puller.ts` | NEW — streaming pull wrapper around `POST :11434/api/pull` |
| `electron/main/ipc-handlers.ts` | MODIFY — register the five `firstrun:*` channels |
| `electron/preload/index.ts` | MODIFY — expose `window.firstrun.*` (typed) |
| `src/components/firstrun/FirstRunWizard.tsx` | NEW — modal driven by the state machine above |
| `src/components/firstrun/PullProgress.tsx` | NEW — MB/sec + ETA bar |
| `src/lib/firstrun-store.ts` | NEW — Zustand slice tracking the wizard state |
| `src/i18n/locales/en/firstrun.json` | NEW — strings (English-only locale rule) |
| `tests/unit/firstrun-detector.test.ts` | NEW — mocks `:11434` 200/connection-refused/404 |
| `tests/unit/firstrun-puller.test.ts` | NEW — mocks streaming chunks, verifies progress math |

### Edge cases the wizard must handle

- **winget missing** (older Win11 or stripped image): fall through to "open download page" path; never error-loop.
- **Ollama installed but service stopped**: `tasklist /FI "IMAGENAME eq ollama.exe"`; if absent, run `ollama serve` in a detached process; if winget-installed, the service auto-starts on user logon.
- **Slow connection / partial pull**: pull is resumable on Ollama's side; surface "Resume" not "Restart" if `completedBytes > 0` from prior chunks.
- **Disk full**: catch `enospc` from the streamed write, show a clear "Need 5 GB free in `%USERPROFILE%\.ollama\models`" message.
- **Conditional Access blocking the download**: if `:11434` returns but pull fails repeatedly, surface "Ask MoE IT to whitelist `ollama.com` and `registry.ollama.ai`".
- **Already-pulled different quant** (`qwen2.5:3b-instruct-q4_K_M` vs base tag): treat any `qwen2.5:3b*` as a hit; don't re-pull.
- **Offline first run**: state stays `needs-ollama`; chat works on cloud failover; wizard re-probes whenever `navigator.onLine` flips true.

### Anti-patterns we explicitly reject

- **Bundling the GGUF in the .exe** — kills auto-update math.
- **Forcing the principal to use PowerShell** — defeats the zero-prework goal.
- **Auto-pulling without a confirmation** — 4.7 GB on a metered school connection is rude. Always show size + ETA estimate first.
- **Blocking the app on `state != ready`** — failover-first is non-negotiable; pilot users with no AI is worse than pilot users on cloud.

### Open questions

- Do MoE IT firewalls allow `winget` egress? If not, the silent install path collapses to the manual-download fallback for every laptop.
- Should we pin a specific GGUF quantisation (e.g. `qwen2.5:3b-instruct-q4_K_M`) for reproducible benchmarks? Today the seed uses the default tag, and the app sends the exact id `qwen2.5:3b-instruct`, so any pinned tag must remain an accepted alias.
- For the fleet rollout, is there a Group Policy preference for pre-imaging Ollama + the model on the school's golden image? That would skip the wizard entirely.

### Acceptance for #69

- A fresh Windows 11 VM with **no** Ollama installed runs `Ministry of Education-X.Y.Z-win-x64.exe`.
- The principal clicks **Install** in the in-app modal (no PowerShell).
- ClawX is fully usable (cloud failover) within 30 seconds of finishing the .exe install.
- On-device AI becomes ready within ~45 minutes on a typical school connection.
- A re-launch on the same machine probes-and-skips the wizard in <500 ms.

---

## Cross-references

- Distribution plan: [`WINDOWS_DEPLOY.md`](./WINDOWS_DEPLOY.md)
- Production gate: [`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md)
- Anthropic / Claude wire-up (operator-only): [`ANTHROPIC_SETUP.md`](./ANTHROPIC_SETUP.md)
- Task #64 (auto-pull) and #69 (graceful first-run path) in the project tracker
