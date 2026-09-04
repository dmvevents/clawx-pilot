# RCA: Chrome CDP attach failure on Karunesh's box — "opens Chrome, then refuses to open the email"

**Date:** 2026-09-03 · **HEAD at audit:** 52551cb9 (v0.4.3-moe.18) · **Status:** root cause identified, one 2-minute VM probe outstanding to close
**Inputs:** Karunesh field report (verbal + screenshot, 2026-09-03), clawx-2026-09-03.log (373 lines, session banner v0.4.3-moe.15), six parallel read-slice audits of the tree and git history.

---

## 1. Executive summary

The debug port on `:18792` never binds because our production launch points `--remote-debugging-port` at the **default Chrome user-data directory**, a configuration Chrome **>= 136 (April 2025) silently refuses** as an anti-cookie-theft measure ("DevTools remote debugging requires a non-default data directory" — string confirmed present in the shipped Chrome 152 binary; mechanism empirically reproduced on this Mac: Chrome opens a normal window, never binds the port, never writes `DevToolsActivePort`). The launch args live at `electron/services/chrome-cdp.ts:373-379` with `userDataDir` resolving to `%LOCALAPPDATA%\Google\Chrome\User Data` (`chrome-cdp.ts:78-95,162`). **Yes, part of this is our error — in two ways.** First, a process error: our own pilot lane wrote this exact restriction down on 2026-05-29 (`windows-pilot/scripts/pilot-probe-state.ps1:56`, commit 23052d8f: "Chrome 136+ can ignore remote debugging on the default user-data-dir"), but the knowledge never reached `electron/services/chrome-cdp.ts` when it was created on 2026-06-08 (b2d7da0f) — the shipped code has launched a structurally impossible configuration since day one. Second, a masking error: the moe.15 managed-profile fallback was accidentally compensating (a non-default dir binds fine), so the bind failure was invisible until moe.18 (8fac374f, CLWX-73) correctly deleted the fallback for the tenant hard rule — a trust fix that exposed, but did not cause and did not fix, the functional failure. The "close all Chrome windows, then retry" advice is truthful when shown but futile under this root cause; on Chrome >= 136 no number of retries can succeed with the current launch args.

---

## 2. Evidence timeline (version mismatch reconciled)

| When | Artifact | Build | What it shows |
|---|---|---|---|
| 2026-05-29 | `pilot-probe-state.ps1:56` + `windows-pilot/plans/WINDOWS_DEMO_INTEGRATION_STRATEGY_2026-05-26.md:12` (commit 23052d8f) | pilot lane | Chrome-136 default-dir restriction **already known and documented**; demo lane worked only via a separate user-data-dir (`pilot-attach-chrome-cdp-demo.ps1:81`) |
| 2026-06-08 | b2d7da0f creates `electron/services/chrome-cdp.ts` | pre-moe.15 | Production launch uses default user-data-dir + debug port from day one; managed fallback + `port_bind_timeout` + "Close all Chrome windows" advice all born here (NOT new at moe.18) |
| 2026-09-02 | `docs/BLOCKER_BUG_COLLECTION_2026-09-03.md` row 78 | our own demo VM | "Could not connect to Chrome... Could not find D[evToolsActivePort]" — the same signature, one day before the field report |
| 2026-09-02/03 | **clawx-2026-09-03.log** (banner `v0.4.3-moe.15`) | **moe.15** (27e8f89d) | attach ECONNREFUSED → launch default profile → `port_bind_timeout` → "trying managed profile fallback" (verbatim match to moe.15 `chrome-cdp.ts:476`, code **deleted at HEAD**) → managed profile launched → session proceeded to `VlmGrounder.ground` (creds failure) and `pdf-parse` missing |
| 2026-09-03 16:18 | 8fac374f (Lane A) → 298658e9 (moe.18 bump) | moe.18 | Managed fallback deleted (CLWX-73); messages reworded; vlm-grounder readable degrade (CLWX-74). Launch/bind mechanics **byte-identical** to moe.15 |
| 2026-09-03 evening | **Screenshot** (VLM-read): diagnose → "close all Chrome windows" → repair → "still unable to connect" | **moe.18** (by timeline + 52551cb9 state-vector record; the advice string itself is identical in both builds so the text alone cannot discriminate — see §9 probe list) | The predicted moe.18 steady state: hard stop at `port_bind_timeout`/`profile_locked` with retry advice that cannot succeed |

**Reconciliation:** the LOG is definitively moe.15 code (the "trying managed profile fallback" line exists only pre-8fac374f). The SCREENSHOT is attributed to the moe.18 build he was later sent. Both exhibit the same underlying no-bind condition; they differ only in what happens after the timeout (moe.15: silent detour into a managed, signed-out, CA-blocked profile; moe.18: readable dead end).

Within-log A/B (decisive): on the **same machine, same port 18792, same probe code, same Chrome binary**, the default-dir launch polled to timeout while the managed launch (non-default dir `%APPDATA%\Ministry of Education\Chrome CDP Profile`) bound and served a full CDP session (VLM grounding ran, which requires an attached page — `playwright-driver.ts:209-218`). The only variable was the user-data-dir. That single asymmetry confirms H2 and refutes firewall and probe-bug theories in one stroke.

`ECONNREFUSED` in the log means the TCP stack **actively refused** — nothing was listening. A firewall silent-drop would present as a 2s abort, not a refusal (`chrome-cdp.ts:186-218`).

Downstream log lines are **separate, pre-existing defects, not part of this RCA**: `VlmGrounder ... Could not load credentials` = no AWS creds on the tester box (expected; CLWX-74/K11 class; grounder reads only process env, never the app's provider store — `vlm-grounder.ts:218-220`, `manager.ts:46`); `pdf-parse module not found` = moe.15-era dependency-class issue, since fixed ("document reader works now" per Karunesh).

---

## 3. State diagrams

### moe.15 (27e8f89d) — attach → launch → managed fallback

```
outlook.read_inbox
      │
      ▼
connectOverCDP :18792 (5s) ──ok──► attached (user session)
      │ ECONNREFUSED
      ▼
diagnoseChromeCdp
      ├─ /json/version ok ────────────────► cdp_ready
      ├─ no chrome.exe ───────────────────► chrome_not_found
      ├─ main chrome proc on target dir ──► profile_locked_close_chrome
      │        │ allowManagedProfileFallback=true
      │        ▼
      │   launchManagedProfileForCdp ─────► managed Chromium, NON-default dir
      │                                     (binds OK — Chrome honors non-default)
      └─ else ────────────────────────────► cdp_down_chrome_closed
               │
               ▼
        launchChromeForCdp
        (--remote-debugging-port=18792
         --user-data-dir=<DEFAULT>)        ◄── Chrome >=136 REFUSES this combo
               │
               ├─ /json/version ok ───────► cdp_ready
               └─ 12-30s timeout ─────────► port_bind_timeout
                        │ fallback branch (moe.15 chrome-cdp.ts:471-478)
                        ▼
                 launchManagedProfileForCdp ► BINDS (non-default dir)
                        │
                        ▼
                 attach to managed Chromium: NO Microsoft session, CA blocks
                 sign-in (AADSTS53003) → locator miss → VlmGrounder.ground
                 → "Could not load credentials"  ═ Karunesh's moe.15 log, exactly
```

### moe.18 (HEAD 52551cb9) — attach → launch → terminal port_bind_timeout

```
outlook.read_inbox
      │
      ▼
connectOverCDP :18792 (5s, playwright-driver.ts:99) ──ok──► attached
      │ ECONNREFUSED
      ▼
ensureChromeCdpReady (chrome-cdp.ts:421-440, CLWX-73 comment 429-436)
      │
      ▼
diagnoseChromeCdp (chrome-cdp.ts:307-353)
      ├─ /json/version ok ────────────────► cdp_ready ► re-attach
      ├─ no chrome.exe ───────────────────► chrome_not_found (terminal, advice)
      ├─ main chrome proc on target dir ──► profile_locked_close_chrome
      │                                     (terminal: "Close all Chrome windows,
      │                                      then retry" — chrome-cdp.ts:339)
      └─ else ────────────────────────────► cdp_down_chrome_closed
               │  (ONLY state that launches — chrome-cdp.ts:437)
               ▼
        launchChromeForCdp (chrome-cdp.ts:368-419; SAME args as moe.15)
               │
               ├─ ok ─────────────────────► cdp_ready ► re-attach
               ├─ spawn threw ────────────► launch_failed (terminal, advice)
               └─ waitMs timeout ─────────► port_bind_timeout (TERMINAL,
                                            "retry" advice — chrome-cdp.ts:411-418)
                        │
                        ▼   spawned Chrome is NEVER killed (spawn detached,
                        │   unref, stdio ignore — chrome-cdp.ts:355-362)
                        ▼
              NEXT diagnose sees OUR OWN failed launch as a main chrome
              proc on the target dir ► profile_locked_close_chrome ►
              "close all Chrome windows" ► user closes ► repair ►
              cdp_down_chrome_closed ► launch ► timeout ► LOOP
              ═ Karunesh's screenshot sequence, exactly
```

---

## 4. Call map (with file:line anchors)

```
agent tool  outlook.read_inbox
  extensions/moe-principal-assistant/index.mjs:1455-1470  (registration; description at
  :1457 hard-steers the agent to browser.diagnose / browser.repair_chrome_cdp on failure)
    │  createHostApiOutlookFacade — HTTP, Bearer CLAWX_HOST_API_TOKEN
    ▼
host-API  POST 127.0.0.1:13210 /api/outlook/read-inbox
  electron/api/routes/outlook.ts:215-249  (allowlist 404 gate :217; Graph lane off :242-244)
    ▼
outlookBrowserManagerV2.readInbox
  electron/services/outlook-browser-v2/manager.ts:57-59
    ▼
OutlookActions.readInbox → driver.ensureOutlookTab
  electron/services/outlook-browser-v2/outlook-actions.ts:303-304
    ▼
PlaywrightDriver.ensureBrowser
  electron/services/outlook-browser-v2/playwright-driver.ts:93-132
    ├─ chromium.connectOverCDP(endpoint, {timeout: 5_000})   :98-101  ← "[outlook-v2] Connecting via CDP"
    ├─ ensureChromeCdpReady({waitMs: 30_000, allowManagedProfileFallback: true /*dead*/}) :115-125
    │     electron/services/chrome-cdp.ts:421-440
    │       ├─ diagnoseChromeCdp        chrome-cdp.ts:307-353
    │       │    ├─ probeVersion GET /json/version, 2s abort   chrome-cdp.ts:204-218
    │       │    ├─ exe check                                   chrome-cdp.ts:320-330
    │       │    └─ listChromeProcesses (PS Get-CimInstance, 5s; catch → []) chrome-cdp.ts:220-258
    │       └─ launchChromeForCdp       chrome-cdp.ts:368-419
    │            spawn(chrome.exe, [--remote-debugging-port=18792,
    │                               --user-data-dir=<DEFAULT>, ...])  :373-379
    │            via defaultSpawnDetached (detached, stdio ignore, unref) :355-362
    ├─ throw `[${state}] ${message}`   :124   ← the tool error the agent surfaces
    └─ final connectOverCDP {timeout: 5_000}  :127

parallel repair tools the tester invoked:
  browser.diagnose        index.mjs:1413 → routes/browser.ts:18 → diagnoseChromeCdp()   (no opts)
  browser.repair_chrome_cdp index.mjs:1421 → routes/browser.ts:25 → ensureChromeCdpReady() (no opts → waitMs 12_000)
  (note: 12s repair budget via host-API vs 30s via the driver path — two budgets, same op)
```

---

## 5. Library / function analysis

**Chrome `--remote-debugging-port` + `DevToolsActivePort`.** When Chrome honors the flag it binds the port within ~1-2s and writes `DevToolsActivePort` into the user-data-dir. Since **M136** (April 2025, official Chrome for Developers blog `developer.chrome.com/blog/remote-debugging-port`), Chrome refuses the switch against the **default** data directory (anti-cookie-theft). Empirically reproduced on macOS Chrome 152 during this audit: default dir → window opens, no port, no `DevToolsActivePort`, refusal strings present in the framework binary ("DevTools remote debugging requires a non-default data directory. Specify this using --user-data-dir." and "...disallowed by the system admin.", the latter = enterprise policy `DeveloperToolsRemoteDebuggingAllowed=false`). Chromium's check compares the **resolved** dir against the platform default, so passing `--user-data-dir=<the default path>` explicitly is still expected to be blocked (source-supported; explicit-equal-path variant not empirically tested — see §9). Our code never reads `DevToolsActivePort` and never logs the Chrome version, so it cannot distinguish "Chrome refused the flag" from "Chrome slow" from "singleton delegation".

**Chrome singleton delegation.** A second launch pointed at an already-owned user-data-dir hands off to the running browser and **exits 0 immediately**; the new `--remote-debugging-port` is ignored. Reproduced on this Mac. With `spawnDetached` (`chrome-cdp.ts:355-362`: `detached: true, stdio: 'ignore', unref()`) the child's instant exit is invisible to us — delegation and refusal both read as `port_bind_timeout`.

**Playwright `connectOverCDP`.** One attempt, `{timeout: 5_000}`, no retries before the repair decision (`playwright-driver.ts:99-109`); one final attempt after repair (`:127`). Against a dead port it fails fast with `connect ECONNREFUSED 127.0.0.1:18792` — the exact log line. Attach semantics are not implicated.

**Node `child_process.spawn`.** Fire-and-forget; no exit-code or stderr capture. Chrome's own refusal message (printed to stderr in some paths) is discarded.

**Timeout/retry constants.** probe = 2,000ms fetch abort (`chrome-cdp.ts:210`); poll sleep = 500ms (`:407`); `waitMs` = 12,000ms default (`:167`, env `CLAWX_CHROME_CDP_WAIT_MS`), 30,000ms on the Outlook driver path (`playwright-driver.ts:120` via `actionTimeoutMs`), 12,000ms on `/api/browser/repair-chrome-cdp` and the Forms driver. With ECONNREFUSED failing fast that is 20+ probes — **generous**. The constants are not the defect. `remoteDebugProcessCount` is computed (`chrome-cdp.ts:291`) but never consulted in any state decision. `listChromeProcesses` fails open: any inventory error (incl. the 5s PowerShell timeout) returns `[]` with only a warn (`:249-258`), and rows with null `CommandLine` are dropped (`:235`).

---

## 6. Ranked hypotheses

### H2 — Chrome >= 136 refuses `--remote-debugging-port` on the default user-data-dir · **CONFIRMED root cause · confidence HIGH**
FOR: official Chrome blog + refusal strings found in the shipped Chrome 152 binary; mechanism reproduced live on macOS (default dir: no bind, no `DevToolsActivePort`; non-default dir: binds in 0.75-1.87s with our exact args); the within-log A/B on Karunesh's own machine (default dir timed out, managed non-default dir bound the same port with the same probe); our own pilot lane documented it 2026-05-29; our own demo VM reproduced the `DevToolsActivePort` signature on 2026-09-02 (blocker row 78); Karunesh tested Sept 2026, so any auto-updated Chrome is far past 136. AGAINST: his exact Chrome version was never captured (the code doesn't log it) — one probe closes this residual.

### H6 — Our-code/our-process error: known restriction never reached production code; moe.18 removed the accidental mask · **confidence HIGH (owner's hypothesis SUPPORTED)**
FOR: `pilot-probe-state.ps1:56` (23052d8f, 2026-05-29) vs `chrome-cdp.ts` created 2026-06-08 without the knowledge; the managed fallback compensated from day one, hiding the failure; 8fac374f deleted the fallback (correctly, CLWX-73) but left the structurally-dead launch and futile advice. AGAINST: none. This is a knowledge-transfer/design gap, not a detection bug.

### H5 — Profile-lock advice loop (UX defect, not root cause) · **confidence HIGH as a real secondary defect, LOW as cause**
FOR: on `port_bind_timeout` the spawned Chrome is never killed (`chrome-cdp.ts:355-362, 410-418`); the next diagnose classifies our own failed launch as `profile_locked_close_chrome` (`:265-275, 334-343`) and tells the user to close Chrome — the exact ping-pong in the screenshot. `remoteDebugProcessCount` (`:291`) could recognise "this Chrome is ours" but is never used. AGAINST (as cause): in the moe.15 log the flow reached LAUNCH (state was `cdp_down_chrome_closed`), so a lock misdiagnosis did not produce the timeout.

### H1 — Singleton/zombie chrome.exe delegation · **confidence LOW for this incident; mechanism REAL as a latent secondary path**
FOR: delegation reproduced empirically (same-dir second launch exits 0, port never binds); the inventory fail-open (`:249-258`) or null-CommandLine filtering (`:235`) could blind the lock check and let us launch into a surviving singleton. AGAINST: the launch only fires from `cdp_down_chrome_closed`, i.e. WMI found zero main chrome.exe on the target profile immediately beforehand — and the launch DID fire in both the log and the screenshot flow; a WMI-visible zombie would have produced `profile_locked_close_chrome` instead. The fail-open path emits "[chrome-cdp] Chrome process inventory failed", not seen in the quoted chain (full-log grep = cheap check, §9).

### H4 — Our detection/timeout wrong · **REFUTED as the no-bind cause · confidence in refutation HIGH**
12-30s budget, 500ms polls, 2s probes; the identical probe declared the managed-dir Chrome ready on the same machine, and binds in <2s on this Mac with a non-default dir. Narrow residue (real but not causal): fail-open inventory, unused `remoteDebugProcessCount`, no `DevToolsActivePort` read, no Chrome-version logging, 12s vs 30s split budgets — all diagnosis-blindness, not mechanics.

### H3 — Windows Firewall loopback drop · **REFUTED for this incident**
The same in-process HTTP probe reached the managed-profile Chrome on the SAME port 18792 moments later in the same session; and the log error is `ECONNREFUSED` (active refusal = nothing listening), not a timeout/abort as a silent drop would produce. The `nc -z` false-negative memory note concerns remote probing over the Cat-5 link, not local 127.0.0.1. (One belt-and-braces VM check listed in §9.)

---

## 7. The decisive question, answered plainly

**No. moe.18 does NOT make email send work on Karunesh's box. It only fails more honestly.**

The `git diff 27e8f89d..HEAD` on `chrome-cdp.ts` is exactly one commit (8fac374f, 18+/58-): it deletes `launchManagedProfileForCdp` and both fallback call sites, rewords two messages, and adds the CLWX-73 comment. The launch args, default-profile targeting, probe loop, timeouts, lock heuristic, and `connectOverCDP` sequence are **byte-identical** between moe.15 and moe.18. Whatever prevented `:18792` from binding on moe.15 prevents it identically on moe.18. Worse, moe.18 removes the only path that ever produced a bound CDP port on his machine (the managed profile — which was itself a dead end: signed-out, CA-blocked, AADSTS53003, and forbidden by the hard rule). moe.18 is the correct trust/compliance fix; the functional fix does not exist yet in any build. On an updated Chrome, moe.18's "close all Chrome windows, then retry" loop can never converge.

---

## 8. Simplest fix per surviving hypothesis (all keep profile=user; none touch managed Chromium)

**First, before any code: the single cheapest confirming probe** (2 minutes on the Windows VM / Karunesh's box, closes H2):

```powershell
# all Chrome closed
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-port=18792
Start-Sleep 8; curl.exe -s http://127.0.0.1:18792/json/version   # EXPECT: fail (H2)
Test-Path "$env:LOCALAPPDATA\Google\Chrome\User Data\DevToolsActivePort"  # EXPECT: false
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-port=18792 --user-data-dir=$env:TEMP\cdp-probe
Start-Sleep 8; curl.exe -s http://127.0.0.1:18792/json/version   # EXPECT: JSON (kills H3/H4 residue too)
(Get-Item "$env:ProgramFiles\Google\Chrome\Application\chrome.exe").VersionInfo.ProductVersion  # EXPECT: >=136
```

**H2 (root cause) — fix shape.** The constraint set is: profile=user (hard rule), Chrome >= 136 (immovable), CDP on the default dir (impossible). Something must give, and it can only be the third element or the transport:

- *(a) Non-default user-data-dir that the USER owns and signs into once* — SYSTEM Chrome, `--user-data-dir` at e.g. `%LOCALAPPDATA%\ClawX\Chrome Profile`, the principal signs in interactively one time. This is the pattern the demo lane already runs successfully (`pilot-attach-chrome-cdp-demo.ps1:81`); it is NOT managed Chromium (system Chrome binary, user-owned persistent profile, user's own interactive sign-in — no token replay). Smallest code change: the `CLAWX_CHROME_USER_DATA_DIR` escape hatch (`chrome-cdp.ts:162`) already exists; productizing = change the default `userDataDir` for the self-launch path + one first-run sign-in screen. **Open compliance question:** does tenant Conditional Access accept this secondary profile for `@moe.gov.tt`? test.fac evidence says yes (`windows-pilot/skills/chrome-cdp-windows.md:93`); moe.gov.tt is UNVERIFIED — probe before committing (§9.5).
- *(b) Extension/MCP bridge inside the user's default signed-in Chrome* (the owner's Chrome-MCP suggestion) — no CDP flag at all, rides the exact signed-in session, strongest profile=user fidelity; larger lift (extension install/consent lane, new transport). Needs its own AADSTS53003/consent analysis.
- *(c) Interim honesty patch (ship regardless):* detect the condition and stop advising futile retries — log Chrome version on every launch attempt; after `port_bind_timeout` with `userDataDir === defaultChromeUserDataDir()` and Chrome >= 136, emit a distinct state ("Chrome no longer allows automation on the main profile; ClawX needs the assistant profile") instead of "retry".

**H5 (advice loop) — fix shape.** Two one-liners' worth of logic: (1) on `port_bind_timeout`, record/kill the Chrome we spawned (we currently unref and forget, `chrome-cdp.ts:355-362`); (2) in `diagnoseChromeCdp`, consult the already-computed `remoteDebugProcessCount` (`:291`) and command lines to distinguish "locked by user's Chrome" from "locked by our own failed CDP launch", and stop prescribing "close all Chrome windows" for the latter.

**H1 (latent inventory blindness) — fix shape.** `listChromeProcesses` should fail CLOSED into a distinct `inventory_unavailable` state rather than returning `[]` (`chrome-cdp.ts:249-258`), and null-CommandLine rows should count as unknown rather than absent (`:235`). Prevents launching into an invisible singleton.

**H4 residue — fix shape.** Read `DevToolsActivePort` from the target dir after launch (present+different port = stale-port class; absent with Chrome running = refusal/delegation); unify the 12s/30s repair budgets; log the `Browser` string whenever `/json/version` succeeds.

**Also flagged (adjacent, from the same log, separate cards):** the moe.15→moe.18 upgrade edge where a leftover managed-profile Chrome still holding `:18792` would read `cdp_ready` against a CA-blocked profile — `diagnoseChromeCdp` never verifies WHICH profile owns the port (`chrome-cdp.ts:313-318`); and the dead `allowManagedProfileFallback:true` still passed at `playwright-driver.ts:121` / `forms-driver.ts:202` (intentional per 8fac374f, but the callers now lie about behavior — cleanup nit).

---

## 9. Windows VM verification list (concrete, ordered)

1. **H2 decisive probe** — the two-launch experiment in §8 plus Chrome `ProductVersion`. Expected: default dir fails, temp dir binds, version >= 136. 2 minutes; closes the case.
2. **Explicit-equal-path variant (UNRESOLVED)** — `chrome.exe --remote-debugging-port=18792 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data"` vs a **copy** of that dir at a different path. Chromium source (resolved-path comparison in `IsRemoteDebuggingAllowed`) predicts still-blocked, but it was not empirically tested in this audit.
3. **H1 residue** — immediately after closing all Chrome windows: `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"`; expect count 0. If nonzero, capture `CommandLine` of survivors (background-apps setting / pending update).
4. **Enterprise policy check (UNRESOLVED)** — `chrome://policy` or `HKLM\SOFTWARE\Policies\Google\Chrome` for `DeveloperToolsRemoteDebuggingAllowed=false`; if set, CDP is dead even on non-default dirs and fix (a) is off the table on MoE-managed laptops.
5. **CA compliance of a secondary user profile for `@moe.gov.tt` (UNRESOLVED, gates fix (a))** — sign into Outlook web in a system-Chrome window launched with a non-default `--user-data-dir` using a Ministry test identity; watch for AADSTS53003.
6. **H3 belt-and-braces** — while the temp-dir probe Chrome runs: `Test-NetConnection 127.0.0.1 -Port 18792`; expect `TcpTestSucceeded: true`.
7. **Full-log greps on Karunesh's clawx-2026-09-03.log** — (a) `"Chrome process inventory failed"` (decides whether fail-open masking was active, H1/H4-narrow); (b) the managed launch's `"reachable after launch"` line (confirms the managed attach was the bind that fed VLM grounding); (c) any `Browser:` string from `/json/version` (direct Chrome version evidence).
8. **Screenshot-session attribution** — obtain the moe.18 log; expect the NEW string "ClawX opened Google Chrome but could not connect to it for automation" (`chrome-cdp.ts:415`), which exists only at HEAD, to close attribution definitively.
9. **Mac lane sanity (UNRESOLVED)** — why does Mac dev still attach on `:18792`? Confirm the long-running demo Chrome was launched by `outlook-lane-debug` with `--user-data-dir=$HOME/.clawx-demo-chrome` (non-default). If so, Mac GREEN never validated the shipped default-dir launch path and should not be cited as evidence it works.
10. **Blocker row 78 source log** — confirm the truncated "Could not find D..." reads `DevToolsActivePort`, tying our own 2026-09-02 VM repro to the H2 signature.

---

*Prepared by the synthesis auditor from six parallel read slices (state-machine, attach-and-tools, moe15-vs-moe18-diff, vlm-creds, port-bind-crux, mac-replicate). No source files were modified. Where slices left gaps they are marked UNRESOLVED above with the probe that closes each.*
