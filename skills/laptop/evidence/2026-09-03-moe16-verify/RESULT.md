# moe.16 install + re-verify — clawx-win-rc-20260609 (2026-09-03)

VM: `clawx-win-rc-20260609` (us-central1-a) over IAP tunnel `localhost:12222 → guest:22`.
Base: the KR2 fresh moe.15 install from earlier today. moe.16 installed **over** it
(standard NSIS upgrade, state deliberately NOT wiped — upgrade-path evidence).
App left **RUNNING** on moe.16 per instruction. No sends, no submits.

Installer: `gs://clawx-rc-artifacts-622687731621/moe16/Ministry of Education-0.4.3-moe.16-win-x64.exe`.

## Per-check verdict

| # | Check | Verdict |
|---|---|---|
| — | sha256 match (Mac download + guest hop) | **PASS** |
| 1 | Silent upgrade install over moe.15; FileVersion 0.4.3-moe.16; state preserved | **PASS** |
| 2 | CLWX-72 closure: canvas binding present + shipped doc-tools parses PDF (packaged node) | **PASS** |
| 3 | K10 in-app drag-PDF turn (summarise a PDF) | **FAIL** — distinct pdfjs `workerSrc` defect |
| 4 | CLWX-78 W10 degrade re-verify | **PARTIAL** — plain-language banner PASS; auto-degrade FAIL |
| 5a | K14(a) three-things (Online) | **PASS** |
| 5b | K14(b) parent open-day letter (Online) | **PASS** |
| 5c | K14(c) drag-PDF summarise | **FAIL** (same as #3) |
| 5d | K14(d) Word doc to Desktop (Online) — file exists + parses | **PASS** |
| 5e | K14(e) summarise last 5 emails (Online) — readable refusal, no crash | **PASS** |

**moe.16 exe FileVersion: `0.4.3-moe.16`.**

## 1. Install (PASS)

- sha256 verified at two hops, both `7f9a3018dbb389496675f4115b37ab4fdcc62a9e60bd813d1beef327e287e849`
  (matches required): on the Mac after `gcloud storage cp`, and again on the guest
  (`Get-FileHash`) immediately before install.
- Silent `/S /CURRENTUSER` upgrade over the moe.15 install. Installer exit `0` after **256s**.
- Post-install `Ministry of Education.exe` FileVersion = **`0.4.3-moe.16`**.
- **Upgrade path did NOT wipe state** (free upgrade-path evidence):
  - `~/.openclaw/openclaw.json` mtime `2026-09-03T07:06:18Z` — unchanged pre/post.
  - `%APPDATA%\Ministry of Education\clawx-providers.json` mtime `2026-09-03T07:05:27Z` — unchanged pre/post.
  - `~/.openclaw/agents/main/sessions` = 4 files before and after.
  - Four-store channel state intact and coherent after upgrade: `settings.preferredChannel=online`,
    `providers.defaultProvider=moe-cloud-gateway`, `openclaw agents.defaults.model.primary=custom-moecloud/moe-demo-pro`.
- Evidence: `logs/moe16-install.utf8.log` (raw UTF-16 as `moe16-install.log`).

## 2. CLWX-72 closure (PASS)

- (a) `resources\openclaw\node_modules\@napi-rs\` now contains **`canvas-win32-x64-msvc`**
  with the native binding **`skia.win32-x64-msvc.node` (27,294,720 B)**. (moe.15 had only `canvas`, no `.node`.)
- (b) Re-ran the packaged-node repro against the **shipped** doc-tools from the install tree
  (`resources\extensions\moe-principal-assistant\doc-tools.mjs`, `CLAWX_APP_RESOURCES` set,
  bundled `node.exe`), fixture `~/clwx72/fixture.pdf`:
  `CLWX72_SHIPPED_VERIFY=PASS pages=1 chars=835 head="MINISTRY OF EDUCATION - REPUBLIC OF TRINIDAD AND TOBAGO\nCIRCULAR NO. 2026/14 - I"`.
- CLWX-72's specific failure class (missing `@napi-rs/canvas` binding → DOMMatrix crash) is **closed** in moe.16.

## 3 & 5c. K10 in-app drag-PDF turn (FAIL — new defect, NOT CLWX-72)

- Seeded `fixture.pdf` into `Downloads`; Online turn: "Please summarise the PDF file at …\Downloads\fixture.pdf".
- Turn completed (verdict ANSWERED) but the answer is a **failure message to the principal**:
  > "I'm sorry, but I encountered a technical error while trying to read the PDF file at that
  > location and I'm unable to access its content. Could you please copy and paste the text from
  > the document? I would be happy to summarize it for you then."
- Gateway log root cause:
  `[tools] document.read_pdf failed: No "GlobalWorkerOptions.workerSrc" specified. raw_params={"path":"…\\fixture.pdf"}`.
- **This is a DIFFERENT defect than CLWX-72.** `document.read_pdf` is the moe-principal-assistant tool
  and wraps the very same `readPdf` from `doc-tools.mjs` that passes in step 2. The difference is the
  runtime: the isolated repro runs in plain packaged Node (PASS); the in-app tool runs inside the
  **gateway's Electron UtilityProcess**, where pdfjs takes a browser-like branch and demands
  `GlobalWorkerOptions.workerSrc`.
- **Differential repro proves it is environment-specific, not fixture/path-specific.** Same shipped
  `readPdf`, same fixture, but with `process.type='utility'` + `process.versions.electron='40.8.4'`
  faked in packaged node: `ELECTRONLIKE_VERIFY=FAIL error=No "GlobalWorkerOptions.workerSrc" specified`.
- Net: CLWX-72's canvas/DOMMatrix fix landed, but a second, distinct pdfjs worker-config failure
  still breaks the actual in-app PDF read on Windows. **Recommend a new card** (pdfjs `workerSrc` /
  worker-disabled config for the Electron UtilityProcess gateway). Evidence:
  `turn-evidence/k10pdf/`, `turn-evidence/k14a/` (context), differential logs in this dir's transcript.

## 4. CLWX-78 W10 degrade re-verify (PARTIAL)

Setup: warmed on-device (`qwen2.5:3b-instruct` loaded, keep_alive 45m); blocked the cloud provider
host via `hosts` (`127.0.0.1 clawx-litellm-gateway-…run.app`; probe = "Unable to connect"). One Online
turn. Ran **twice** (08:28, 08:37) — identical result. Restored `hosts` after (probe now resolves; bare
`/v1/models` → 401, i.e. reachable, no key on the probe).

- **PASS half — no raw red banner.** The old red "Model call failed Connection error." is **gone**.
  The principal sees a calm, model-anonymised, plain-language banner (CLWX-75):
  > "The online assistant could not be reached. Your work is safe — try again, or switch to
  > \"On this device\"."  + a collapsed **Technical details** expander.
- **FAIL half — no automatic degrade.** The CLWX-78 assertion (visible **degrade notice** + an
  **on-device attempt**) did NOT occur:
  - `chat-degrade-notice` element count = **0** (only `chat-run-error` rendered).
  - Composer channel stayed **Online** — no switch to On this device.
  - Gateway log shows only 4 blocked cloud retries (`model=moe-demo-pro provider=custom-moecloud
    error=…Connection error.`) then `failover decision … decision=surface_error reason=timeout`.
    **No ollama/on-device attempt; no `[settings] Degraded channel` line; no post-turn
    `[channel-router] Applied channel change`.**
- Analysis: the classifier fix IS in moe.16 (commits `bde78d94`, `f01bb43a`, `4261811a` are all
  ancestors of the moe.16 bump), and the pure policy `shouldDegradeToOnDevice` WOULD return
  `degrade:true` for the confirmed state (activeChannel=online, on-device account present with model,
  not already degraded, reason=unreachable). The gap is in the **plumbing** (`maybeDegradeChannel`
  did not fire the `/api/settings/degradeChannel` transaction on this error surface). The banner does
  offer the **manual** "switch to On this device" path, so the principal is not stranded — but the
  automatic failover the card promises did not happen. **Recommend re-opening / not closing CLWX-78 on
  the auto-degrade leg.** Evidence: `turn-evidence/w10/` (incl. `post-abort-inspect.png`).

## 5. K14 matrix (Online channel)

- **(a) PASS** — "What are three things…": real 3-item answer (Automate Daily Reports; Manage Student
  Discipline Documentation; Draft Official Correspondence). ~116s to settle. Frame-verified
  (`turn-evidence/k14a/state-08-reply-rendered.png`).
- **(b) PASS** — parent open-day letter: proper draft with subject + body + `[Date]/[Time]`
  placeholders and an offer to finalise. ~35s.
- **(c) FAIL** — see #3.
- **(d) PASS** — "Create a Word document … save to my Desktop": agent wrote
  `Desktop\Principal Morning Checklist.docx` (8757 B). Verified with shipped doc-tools:
  `DOCX_VERIFY=PASS bytes=8757 chars=409`, 5 real checklist items (attendance, schedule, urgent emails,
  walk-through, admin check-in).
- **(e) PASS (K1)** — "Summarise my last 5 emails": no Outlook Chrome on this VM, so the agent returned
  a **readable refusal/instruction**, not a crash:
  > "I am unable to access your emails because I am not currently signed into your Outlook account.
  > Please sign in to your Outlook account in the Chrome web browser, and then I will be able to
  > summarize your last 5 emails for you."

## Three most important verbatim outputs

1. **K14(a) cloud answer** (proves cloud text path healthy on moe.16): "…Here are three key things I
   can do for you: Automate Daily Reports … Manage Student Discipline Documentation … Draft Official
   Correspondence…"
2. **K14(e) email refusal** (K1 criterion): "I am unable to access your emails because I am not
   currently signed into your Outlook account. Please sign in to your Outlook account in the Chrome web
   browser, and then I will be able to summarize your last 5 emails for you."
3. **W10 degrade banner** (CLWX-78 UI): "The online assistant could not be reached. Your work is safe —
   try again, or switch to \"On this device\"."
   - and the **K10 failure** the principal actually sees: "I'm sorry, but I encountered a technical
     error while trying to read the PDF file …"

## Artifacts

- `logs/moe16-install.log` (UTF-16 raw) + `logs/moe16-install.utf8.log`
- `turn-evidence/{k14a,k14b,k10pdf,k14d,k14e,w10}/` — driver JSON + state screenshots per turn
- Key frames verified against pixels (CLWX-57 discipline): `k14a/state-08-reply-rendered.png`
  (legible cloud reply, gateway connected 18789), `w10/post-abort-inspect.png` (plain-language banner,
  channel still Online, K14(e) refusal visible).

## State left behind

- VM **RUNNING**; app installed at **0.4.3-moe.16**; `hosts` restored; on-device model warm.
- Guest state (`.openclaw`, providers, sessions) preserved through the upgrade.
