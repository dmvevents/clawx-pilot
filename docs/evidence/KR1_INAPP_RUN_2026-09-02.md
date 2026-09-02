# KR1 in-app live run — moe.12 on Windows (IAP VM) — 2026-09-02

First live-LLM, in-app chat turn on the shipped Windows build. Supersedes the
BM25-proxy eval lanes (all green) with the real model path a principal hits.
This is the evidence lane F was a proxy for.

## Environment
- VM: `clawx-win-rc-20260609` (us-central1-a), guest user `clawxtest`, over IAP.
- Build: **moe.12**, `0.4.3-moe.12` (UA `MinistryofEducation/0.4.3-moe.12`),
  installed from GCS artifact, **SHA256 `0a3bbf27…5ee64` verified end-to-end**
  (build host == guest).
- Model: on-device ollama `qwen2.5:3b-instruct` up; agent channel served
  **Online via `moe-demo-pro`** (cloud broker responded this turn).
- Prompt: "Read the file moe-demo-suspension-source.docx on my Desktop and
  summarise the key points."
- Target file actually at `C:\Users\clawxtest\OneDrive\Desktop\moe-demo-suspension-source.docx` (OneDrive KFM Desktop).

## Result — corrected root cause (2026-09-02, after fixture inspection)

> **Correction.** A first pass read this as a `resolveReadablePath` KFM gap.
> Pulling the fixture apart disproved that: resolution WORKS; the fixture was a
> malformed docx. The corrected analysis stands below.

### PASS — doc-tooling selection is live
The agent selected document tools for the prompt (gateway log, 01:44 UTC), and
its FIRST call was the correct one — `document.read_docx` with the bare filename:
```
[tools] document.read_docx failed: Could not find main document part ... path="moe-demo-suspension-source.docx"
```
The doc-tooling steering fix (`c1b18125`) shipped in moe.12 works against a real
LLM turn, not just the BM25 harness. **KR1 tool-selection criterion: met.**

### PASS — KFM path-resolution WORKS (this is the key correction)
`document.read_docx path="moe-demo-suspension-source.docx"` returned **"Could not
find main document part"** — a docx *parse* error, NOT `ENOENT`. A parse error
proves the file was **found and opened**. The only copy on the guest is at
`C:\Users\clawxtest\OneDrive\Desktop\` (verified: workspace has no such file, no
`workspace\Desktop` at all). So `resolveReadablePath` correctly resolved the bare
filename to the **OneDrive-redirected Desktop** — exactly what KR1 requires.
`resolveReadablePath`/`oneDriveRoots()` in `doc-tools.mjs` and its
"KFM-redirected Desktop" unit test are behaving. **KR1 path-resolution: met.**

### ROOT CAUSE — malformed test fixture (not a product bug)
The seeded `moe-demo-suspension-source.docx` (1524 bytes) is a structurally
broken docx. `tar -tf` lists the three expected parts, but:
- `word/document.xml` is **zero-length**
- `_rels/.rels` is **zero-length** (so no officeDocument relationship → parser
  can't locate the main part → "Could not find main document part")
- only `[Content_Types].xml` has content

The generator `windows-pilot/scripts/pilot-seed-demo-documents.ps1` has correct
templates (relationship + document body) but `Write-PackageText` /
`CreateFromDirectory` writes empty `word\document.xml` and `_rels\.rels` on the
guest — likely the dotted `_rels\.rels` filename plus here-string handling. This
is a **test-fixture defect**, tracked separately; it is NOT a resolver or steering
regression.

### SECONDARY — steering weakness on parse failure
After the (correct) `document.read_docx` parse failure, the agent fell back to the
GENERIC `read` tool with guessed paths, which IS workspace-rooted and KFM-unaware:
```
[tools] read failed: ENOENT ... 'C:\Users\clawxtest\.openclaw\workspace\Desktop\moe-demo-suspension-source.docx'
[tools] read failed: ENOENT ... 'C:\Users\clawxtest\.openclaw\workspace\moe-demo-suspension-source.docx'
[tools] read failed: ENOENT ... 'C:\Users\clawxtest\.openclaw\workspace\Downloads\moe-demo-suspension-source.docx'
```
`persona.mjs` says on a `document.*` failure to "report the specific error and ask
the principal for the exact filename or folder; do not fall back to a Python
skill." It didn't fall back to Python — but it DID fall back to the generic `read`
tool instead of surfacing the parse error. Minor steering nit; low priority.

### PASS — graceful failure (no hang / no silence)
The agent produced a helpful fallback rather than hanging or going silent:
> "I'm still having trouble finding the file. It seems it's not in the usual
> places. Could you please drag and drop the file into our chat?"

## Secondary findings (flight-check material)
1. **Slow gateway ready on cold/empty config.** With `~/.openclaw/openclaw.json`
   empty (0 agents/0 channels/0 providers after the VM reboot), the gateway's
   ready-fallback loop retries with `retryAfterMs≈285000` (~4–5 min). The
   composer shows "Gateway not connected" (disabled) for that whole window on
   BOTH moe.11 and moe.12. IN-FLIGHT CHECK: poll composer **enabled**
   (`isDisabled()==false`), not just port :18789 bound.
2. **Boot-path safety net gap.** `ensureBootableAgentsConfig` (BUG-012 fix) did
   NOT seed a channel because a config file already existed but was empty; the
   agent/channel eventually came up via the gateway itself, slowly. Worth a card:
   the safety net should treat present-but-empty the same as absent.
3. **acpx codex probe noise.** `[plugins] embedded acpx runtime backend probe
   failed ... npx @zed-industries/codex-acp` on every boot — non-fatal but adds
   handshake latency; the codex ACP backend can't spawn on the guest.
4. **Driver settle-detection artifact.** The answer arrived as a threaded
   "4 tool calls · 3 process messages" block; the driver's +2 `chat-message-*`
   counter + text-stability heuristic reported `TIMED_OUT_MID_TURN` though the
   turn settled. Fix: detect the assistant thread block / a "done" affordance.

## Artifacts (on guest)
- `C:\Users\clawxtest\Downloads\clawx-chat-turn-evidence\moe12-run\chat-turn-2026-09-02T01-43-12-499Z.json`
- Screenshots `cdp-page-1.png` under `...\cdp-inspect\`
- Gateway log `%APPDATA%\Ministry of Education\logs\clawx-2026-09-02.log`

## Bottom line
KR1 is **half green**: tool-selection proven live; **path-resolution to the
OneDrive KFM Desktop is a confirmed defect**. KR1 cannot be checked at GA until
`resolveReadablePath` resolves user-profile Known-Folder paths (Desktop,
Downloads, Documents incl. OneDrive redirection) OR KR1's acceptance criterion is
formally narrowed. This is now the top KR1 blocker with a reproducible trace.
