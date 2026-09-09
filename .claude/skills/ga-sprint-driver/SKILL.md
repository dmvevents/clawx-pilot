---
name: ga-sprint-driver
description: Continue the highest-priority ClawX completion workstream through diagnosis, implementation and evidence. Use for a GA sprint tick or resume; preserve the selected outcome across ticks and stop when its next dependency is concretely blocked.
---

# GA sprint driver

Read `docs/PROJECT_CONTRACT.md` and `docs/COMPLETION_PLAN.md`. They supersede old per-card ranking and historical sprint task order. A tick is a bounded execution window within one outcome, not a request to find another small change. Do not activate this workflow merely by reading this file during an audit.

**Continuation semantics.** A checkpoint is durable progress within the same accepted outcome — not a new authorization boundary and not a reason to stop because the next step is long. The scheduled timer is a polling watchdog against stalls, not a completion controller: never defer an already-authorized next step to "the next tick." If an authorized step exceeds a comfortable window, run it now with an explicit suitable timeout, an observable receipt (log/artifact/exit status) and a single named owner. Never blindly replay a write that may have partially executed; check its observable result first.

**Autonomous session entry.** When asked to configure unattended continuation, use the native Claude `/goal` procedure in [the operations runbook](../../../docs/CLAUDE_CODE_OPERATIONS.md#activate-and-resume-the-controller). Reading this skill, enabling plugins and bypassing permission prompts do not start another turn. Verify the actual goal indicator and transcript receipt. Keep one completion controller; inspect and retire only its superseded GA timer using native scheduling tools. A goal reaching its executable-work boundary is not a GA verdict.

## Local parameters

| Purpose | Source |
|---|---|
| Current priority and exit criterion | `docs/COMPLETION_PLAN.md` |
| Board snapshot | `docs/plane-board/CLWX-board-export.json` and `CLWX-board.md` |
| Historical detail | Search `docs/GA_SPRINT_STATE_VECTOR.md` and the defect/error ledgers for the selected card; do not load the entire files |
| Board API | `http://localhost:8090`, workspace `issues-agent`, project `81a2ea23-e060-49b4-a344-1ab0339f46d5` |
| Token | `~/issues-agent-runtime/plane/.agent-token`; never print. Its exported `PLANE_PROJECT` names the GHIP project, **not CLWX**. |
| Verified board writers | `node scripts/plane-comment-post.mjs --card CLWX-<n> --file <payload>`; JSON payloads need `comment_html`, other files contain literal comment HTML. Export with `node scripts/plane-board-export.mjs`. |
| Authority | Agent ceiling **Ready**; human closes **Done**. Preserve recorded owner holds and action gates from the shared contract. |

## 1. Sense only what may have changed

- Inspect git status/HEAD, the active workstream and its existing card/evidence.
- Refresh the board if needed for an actual state decision; use the committed snapshot if unavailable and label its age.
- At an external blocker, inspect the current sprint's remaining acceptance dependencies before declaring the whole sprint blocked. Execute eligible independent work; reuse unchanged evidence. Record whether an alternate lab reproduces a defect or satisfies the actual acceptance environment — these are different claims.
- Probe a blocked dependency only if that result could change the next action. For IAP, TCP acceptance is insufficient: use the existing SSH handshake/control-leg probe. Do not infer credential expiry from every failed connection.
- Do not run the full static gate on an unchanged tree just because a timer fired. Reuse dated evidence for the same revision/scope; run affected checks after changes and full checks at integration/release boundaries.

## 2. Select or resume an outcome

Resume the current completion workstream unless its exit is verified, the user changes priority, or a concrete dependency prevents further meaningful work. A newly reported core-journey regression can change priority; a larger card count cannot.

Before editing, state: observed user failure → owner module/boundary → current evidence → falsifiable exit → next bounded action. For a repeated defect, trace the full state/run path and inspect callers before adding another fallback or timeout. Reuse an existing card and test seam.

## 3. Execute and verify

Complete the chosen work through a regression, fix and focused verification. Delegate independent bounded slices with explicit file ownership when useful. A checkpoint records the next step of the same outcome; do not mark a slice as the whole feature. A checkpoint written for resume names the card, source SHA/worktree, the receipt for the last completed step, the exact next step and any concrete blocker — never credentials.

Select tools by the unanswered question using [the operations routing table](../../../docs/CLAUDE_CODE_OPERATIONS.md#route-tools-without-loading-everything): filtered project memory for earlier lessons, structural exploration/LSP for code, Plane for acceptance, domain skills for execution and native messages/background receipts for coordination. Discover session-local tool availability once; do not load every plugin, retrieve whole histories or pay for repeated reviews of unchanged code.

Work from a stated source SHA base in the assigned worktree; the author and reviewers are distinct named owners. The VM/operator lease is single-holder: one agent mutates the VM or installed app at a time, and holding the lease is part of the receipt for any such step.

Use the application's real exported path, not a copied test implementation. Separate source tests, installed-build proof, live-account results and external-tester acceptance. Static green and optional-lane probes do not establish release readiness. Strict release evaluation must fail when required proof is missing; never turn on live sends/submissions just to obtain that proof.

If blocked, prepare the exact remaining artifact, command or decision and continue independent work allowed by the completion plan. If no meaningful work remains, end the tick; do not repeat the blocker or manufacture review work.

### Recover a blocker

The project `PostToolUseFailure` hook cues this procedure after execution errors. It does not change tool results, grant permissions or repair the environment itself. Logical acceptance failures and pre-execution rejections still enter this procedure through the active goal even when no failure hook fires.

1. Classify the result against the current criterion. An expected negative control or a search with no matches is not a new product bug. For a real blocker, check the existing owner/card/report before creating another; capture revision/environment, reproduction, expected/actual, redacted receipt and next falsifiable check using the bug template. If Plane is unavailable, preserve the pending payload locally and label remote sync blocked.
2. Inspect the cause and choose a bounded recovery in the current write scope. A reviewer reports to its owner rather than becoming an author. Source defects get a regression and isolated fix; unavailable developer tools get a scoped supported fallback; transport failures use the maintained lane's diagnostics and authorized recovery. Before repeating an installation, send or other possibly executed write, inspect its receipt and actual state.
3. Retry an unchanged transient, read-only/idempotent operation once after checking its prerequisite. If it fails the same way, change the hypothesis or record a concrete dependency; do not loop the same command. A repair gets the original failed check plus affected tests and assigned independent review. Never suppress the failure, weaken the criterion or reset user data to obtain green.
4. Update the owning card/report with the attempt and verified outcome. A dependency repair can unblock a card without satisfying all of its acceptance; move to Ready only on complete evidence. Resume the dependent step immediately once its prerequisite passes.
5. Authentication/consent, model refusals, owner holds and unavailable acceptance environments are explicit dependencies, not permission to bypass them. Record owner, minimum needed change and exact resume command; select other eligible work from the same sprint. Observe a real pending job with an event/receipt; recheck an external blocker only when a relevant signal changes. If no executable work remains, report the blocked disposition once and end the controller goal with GA RED.

## 3b. Separate review before code moves to Ready

The author never approves their own change. Preserve the established review requirements:

- **Claude lanes:** 2–3 fresh review-only contexts for nontrivial code changes being moved to Ready, with diff and acceptance text; reviewers do not edit.
- **Codex cross-model lane:** additive when explicitly assigned or required by the selected acceptance. The owner's cost preference is Claude CLI on Bedrock; an enabled Codex plugin does not by itself require a paid review. Record availability and whether invoked. If assigned, use its supported review command scoped to the actual diff; do not hard-code a stale model/plugin version.

Confirm a finding against code/evidence, fix and rerun the affected tests, or refute it with a concrete reason. Assigned lanes must finish; after resolved findings and an unchanged diff, do not launch extra rounds merely to keep the loop busy. A PASS never cancels another unresolved finding or relaxes a safety gate.

## 4. Sync once per meaningful delta

When board updates are authorized, post redacted evidence through the verified writer and verify readback. Move to Ready only if that card's full acceptance is met; otherwise record the remaining proof. A Ready gate-script card is not a GA verdict.

Update completion-plan, candidate and evidence pointers only when the delta actually affects them; leave unaffected pointers alone. Preserve detailed dated evidence in existing artifacts/ledgers; do not duplicate the whole narrative across docs. Export the board after actual board changes. Commit requested changes with the workspace Lore protocol and appropriate validation trailers.

## 5. Report; stop only on a real boundary

Report the outcome advanced, evidence, remaining criterion and next action in a few lines. Valid reasons to stop: the outcome's exit is verified, the user holds/stops, or a concrete external blocker remains after independent work allowed by the completion plan is exhausted. "The next step is long" or "the checkpoint format is satisfied" are not stop reasons while an authorized next step exists — continue it under section 3's timeout/receipt/owner rules. If the tree/evidence/dependency state did not materially change and no authorized step remains, say so once and stop. A recurring timer does not override a user stop or authorize deployment, outward communication, credential changes or a new workflow.
