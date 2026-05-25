# ClawX UI snapshots — for UX designer hand-off

Captures of every top-level route in the running Mac app at 1440×900.

## How to regenerate

```bash
# Production app (real data, real Outlook session)
pkill -9 -f "Ministry of Education"
/Applications/Ministry\ of\ Education.app/Contents/MacOS/Ministry\ of\ Education --remote-debugging-port=9223 &
sleep 18
pnpm exec tsx scripts/snapshot-ui.ts --mode=production --port=9223

# Dev mode (renderer requires Electron preload IPC bridge; currently
# produces blank screens — use production mode for real UX review)
pnpm exec tsx scripts/snapshot-ui.ts --mode=dev
```

## Output structure

```
docs/ui-snapshots/
├── production/<timestamp>/
│   ├── 01-chat.png ... 11-settings-microsoft-graph.png
│   ├── manifest.json                (route list + status + viewport)
│   ├── README.md                    (per-capture summary)
│   └── ClawX-UI-snapshots.pdf       (single PDF of all 11 routes)
├── production-snapshots-<date>.zip  (one-shot bundle for hand-off)
└── README.md                        (this file)
```

## Latest capture

- **Folder:** `docs/ui-snapshots/production/2026-05-25T19-06-46/`
- **PDF:** `docs/ui-snapshots/production/2026-05-25T19-06-46/ClawX-UI-snapshots.pdf` (~700 KB)
- **Zip bundle:** `docs/ui-snapshots/production-snapshots-20260525.zip` (~1.4 MB)

## Routes captured (moe.10)

| # | Route | What's on it |
|---|---|---|
| 01 | `/` Chat | Sidebar + chat composer + active session |
| 02 | `/models` | Model picker (Online / On-device) |
| 03 | `/agents` | Agent list |
| 04 | `/channels` | Online/On-device channel toggle |
| 05 | `/skills` | Skill bundle (pdf, xlsx, docx, pptx, whisper, weather, etc.) |
| 06 | `/cron` | Scheduled tasks |
| 07–11 | `/settings` + sub-routes | General, Providers, Outlook, Microsoft Graph |

## Known UX-relevant artefacts in the captures

- **Status footer in every screen:** "gateway connected | port: 18789 | pid: <N>" — designer should rework this; it's developer-facing.
- **Chat error banner:** the live capture shows a `400 status code (no body)` from `gemini-2.5-flash` even though `gemini-2.5-pro` is the configured default. That's a real user-facing failure mode the designer should style.
- **Composer footer pills:** `Online` channel + skill picker + model dropdown — model identity is supposed to be anonymised per task #50; the dropdown still shows raw model IDs.
- **Sidebar:** "Ministry of Education" branding lockup top-left; placeholder logo (the real MoE asset is task #60, still pending).
