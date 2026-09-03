# STAGE 2d — b2: live in-app document.write_docx turn on Windows (vbatch)

**Verdict: PASS.** One real chat turn on the installed moe.15 build called `document.write_docx`, produced a valid .docx on disk, and read it back with `document.read_docx` in the same turn — proven at all three layers (UI turn, disk + deterministic read-back, gateway session transcript tool-call records).

- **Date:** 2026-09-03 04:05 UTC (VM clock)
- **Host:** GCP VM `clawx-win-rc-20260609`, guest `clawxtest`, console session 1 (autologon session recipe from `2026-09-03-win-recorded-usecase`, commit fb6685a5 lineage), app 0.4.3-moe.15 with CDP :9223
- **Driver:** the proven `clawx-recorded-usecase-driver.js` (already on guest), prompt asked for write + same-turn read-back
- **Raw logs in this dir:** `vbatch2-b2-out.log` (driver), `vbatch2-b2-postcheck.log` (disk + mammoth read-back), `vbatch2-b2-session.log` (session-transcript tool records); driver JSON + screenshots in `b2-artifacts/`

## FACTS

### Layer 1 — the UI turn (driver JSON `b2-artifacts/usecase-2026-09-03T04-05-15-083Z.json`)
- Channel `online` (custom-moecloud/moe-demo-pro), composer enabled in 174 ms, **verdict `ANSWERED`, `settled=true`**, no run error, turn wall-clock ~31 s (04:05:15 → 04:05:46).
- Assistant reply: *"I have created the document "vbatch-b2.docx". Here is the text from the document: V-batch write test To prepare the daily report… The final deadline for submitting the daily report is 3:45pm."*
- This turn also doubles as the **cloud-recovery control** after stage 2c's hosts block was removed (Online turn, zero errors).

### Layer 2 — disk + deterministic read-back (`vbatch2-b2-postcheck.log`)
- `C:\Users\clawxtest\.openclaw\media\outbound\vbatch-b2.docx` EXISTS, **8,620 bytes**, mtime `2026-09-03T04:05:28.607Z` (13 s after send).
- Independent read-back with the gateway bundle's mammoth (the same dep `document.read_docx` uses): 180 chars, text exactly *"V-batch write test To prepare the daily report, please ensure all student and teacher attendance figures are accurate. The final deadline for submitting the daily report is 3:45pm."*
- Content assertion (title + "daily report" + "3:45"): **true**, verify exit 0.

### Layer 3 — tool-fire proof in the gateway session transcript (`vbatch2-b2-session.log`)
Session `~/.openclaw/agents/main/sessions/04329a8d-6cbe-4605-b74e-66075f96ff0c.jsonl` contains:
- assistant `toolCall` **`document.write_docx`** with arguments `{path:"vbatch-b2.docx", title:"V-batch write test", paragraphs:[…2 paragraphs…]}` on `provider=custom-moecloud, model=moe-demo-pro`;
- the tool result `{path:"C:\Users\clawxtest\.openclaw\media\outbound\vbatch-b2.docx", bytes:8620, paragraphs:2}`;
- a follow-up `toolCall` **`document.read_docx`** `{path:"vbatch-b2.docx"}` (04:05:29.930Z).
(The Electron app log does not carry tool-call lines; the session jsonl is where tool fires are recorded on this build.)

## What this proves

Gap **B (b2)** in `docs/APP_WORKFLOWS_TEST_MATRIX.md` (W6 in-app leg) is closed on Windows: not just the packaged runtime writing OpenXML (b1, 2026-09-02), but a live model turn selecting and executing `document.write_docx`/`read_docx` end-to-end inside the installed app.

## Residue on guest (intentional)

- `vbatch-b2.docx` left in `media\outbound` (evidence).
- vbatch scripts left under `C:\Users\clawxtest\`.
- Ollama left RUNNING (task `VbatchOllamaServe`) from stage 2c.
- VM left RUNNING, IAP tunnel left open, per batch instruction.
