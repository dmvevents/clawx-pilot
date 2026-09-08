# GA blocker resolution record - 2026-09-08

Captured for the Plane board update requested during the release push. The release verdict remains **RED**. This file documents the blockers, how confirmed blockers were removed or narrowed, and what still prevents GA. It does not replace the [completion plan](../COMPLETION_PLAN.md), [current Windows candidate](../CURRENT_WINDOWS_RC.md) or [GA release evidence manifest](../GA_RELEASE_EVIDENCE_MANIFEST.md).

## Board write scope

| Field | Value |
|---|---|
| Plane project | CLWX, `81a2ea23-e060-49b4-a344-1ab0339f46d5` |
| Live project probe | Local evidence: `artifacts/plane/20260908-ga/project-probe.json` |
| Targeted readback before writes | Local evidence: `artifacts/plane/20260908-ga/live-targeted-read.json` |
| Dated board marker | `GA blocker record - 2026-09-08` |
| Current GA verdict | RED |
| Latest stakeholder connection checkpoint | Karunesh Ramdass replied at `2026-09-08T03:28:38Z` through `2026-09-08T03:29:45Z` that the sent diagnostic build repeatedly reports assistant reachability / work-safe errors and he cannot test functionality. Fresh mapped read was `2026-09-08T03:31:42Z`. The attached diagnostic log is moe.21, matching the earlier sent build; do not blame the stakeholder for testing the wrong version. Local redacted receipt: `artifacts/plane/20260908-ga/stakeholder-connection-0339-redacted.json`. |
| Latest broker/setup checkpoint | Additive scoped pilot broker revision `clawx-model-broker-00001-jss` from source `44ea379ac69b59fae834d77655c1bc55515c9faa` passed eight real API checks. A fresh standard Windows user `ClawXFresh0908` exists with no prior app/OpenClaw profile, but the native setup helper failed 5 PASS / 12 FAIL and is not ready for handoff. Local redacted receipt: `artifacts/plane/20260908-ga/broker-setup-0411-redacted.json`. |
| Latest fresh setup checkpoint | Setup helper commit `a8a9b0d518335047f77abc43230e48b25ed9b63a` passed 17/17 native Windows PowerShell 5.1 checks at `2026-09-08T04:19:24Z` in fresh standard-user RDP Session 2, removing the ownership-privilege and File.Replace null defects. Existing moe.22 run `34180280985` installed under that fresh Server 2022 standard user at `2026-09-08T04:26:05Z`, exit 0, with exact installer/ASAR/EXE identity. The actual CMD setup entrypoint then failed at `2026-09-08T04:30:22Z` because the fresh PowerShell launch had an empty `$PSScriptRoot` default; no Online seed or first reply was proved. Local redacted receipt: `artifacts/plane/20260908-ga/fresh-setup-0431-redacted.json`. |
| Latest fresh first-turn checkpoint | Helper `9d46832f2fce4036f1943c853a0f88049762e07f` passed 20/20 native PowerShell 5.1 checks at `2026-09-08T04:37:02Z`; actual setup CMD passed at `2026-09-08T04:39:32Z` under the fresh standard Server 2022 user without elevation and saved protected user-only Online setup. The first installed moe.22 Online turn still failed acceptance: the correlated cloud answer appeared at `2026-09-08T04:49:01.613Z` with the token exactly once, but automatic fallback/degrade fired before the answer, visible provenance falsely attributed the answer to local device, the composer ended on-device, the driver ended `TIMED_OUT_MID_TURN`, and later observation showed duplicate prompt/local failures. Local redacted receipt: `artifacts/plane/20260908-ga/fresh-first-turn-0454-redacted.json`. |
| Latest moe.23 package/fallback repair checkpoint | moe.23 run `34187805266` from source `2449a9483b7e4937a902e70914a382d05f8e2e58` succeeded with 204 Windows test files / 2,135 tests passed and 11 skips; 17 host package/provenance checks passed, installer SHA256 `228983187371d54a60f4018f6ee3ac86bd3e60d4ed2dbe3cd2784d76962f8d25`, and root independent host-extracted package checks match the package. Fresh standard-user profiles were backed up at `2026-09-08T04:58:49Z` before upgrade: 316 files, all hashes matched, private backups remain guest-only. moe.23 assisted upgrade is extracting, not installed acceptance. Fallback repair `7f4b06d3b943fc15ff6655dd057c3336aa62e31b` is independently approved with 107 unit tests and two Electron tests, then integrated into moe.24 source `b814f804036fc2f9f32d3326c8694f4ae2ef7805`; run `34189597051` is packaging after native preflight. Local redacted receipt: `artifacts/plane/20260908-ga/moe23-fallback-0523-redacted.json`. |
| Selected installed candidate | Run `34180280985` at source `a4efc7e4a4311d7865bf0c74ab2320289fdadd48`. This is the current selected and installed moe.22 candidate for the latest VM evidence. |
| Current moe.22 build | Selected GitHub Actions run `34180280985` from `a4efc7e4a4311d7865bf0c74ab2320289fdadd48` completed successfully; native summary: 204 files / 2,114 tests passed, 11 skipped and zero failed. Artifact verification passed for keyless-public source/profile/compiled receipts, all five manifest entries, eight helpers, runtime Playwright, keyless scans and blockmap structure; `published:false`. Installer: `394149483` bytes / SHA256 `eed3d9ec87902d1babcf7906122009ac3a0ec708871db175de52871dc3e5938f`; packaged EXE SHA256 `41ccabad0822cb5312b6bd0ebaa1c255671ba26f026824c44a44ade02bedec1a`; ASAR SHA256 `ccec2df6a9ed21fe1882cad0f71b29dd9ee60f358fb0d2786b3e85f1bbef1170`; blockmap SHA256 `4feb8bbbe2624e9fa2187fc229ef7a52d540b52df53f49c57ff98e48238caf3d`, `385769` bytes, `19033` chunks. The exact installer was installed on the reused admin Windows VM with exit 0 at `2026-09-08T03:08:57Z`; installed EXE, ASAR, all eight helpers, desktop shortcut and Start shortcut match the selected artifact. The same selected moe.22 run was later installed through the ordinary assisted path under the fresh Server 2022 standard user at `2026-09-08T04:26:05Z`, exit 0, with exact installer/ASAR/EXE identity; this is not Windows 10/11 client acceptance. |
| Prior installed moe.22 baseline | Run `34171848832` from `258d3ac079e7cbaa8a9c80c574066923f8ef988c` remains historical evidence only. It installed and passed payload, Online, observable Stop-to-next, native helper and Office helper checks, but failed P3/P5 content and on-device local chat. |
| Source repairs in selected installed candidate | Includes `a0a9e5f4aad9bebb173360c45ed83695bff27a37` for document discovery budget safety, `24c265894f09840adb34072a6cdc01a7b564b0c7` for on-device Gateway-tool denial, `f1d880390dac4ab7e67df17c57a389c45915ef53` for pending-send lifecycle ownership, `258d3ac079e7cbaa8a9c80c574066923f8ef988c` for the Windows-only document-budget fixture canonical-path correction, `1f2b405e17bd5910fbded09c3a62f8921a8d692f` for PDF circular summary guidance and `a4efc7e4a4311d7865bf0c74ab2320289fdadd48` for managed-cloud vision metadata preservation. |
| Current Windows access | RESTORED for the VM lane at `2026-09-08T01:42:21Z`; RDP protocol, SSH banner, closed guest control and authenticated SSH marker passed. Local evidence: `artifacts/windows-vm/20260908-moe22/login-refresh.json`. |

## Plane write receipts

Each comment below was posted with `scripts/plane-comment-post.mjs`, which verified the created comment through both detail and list readback under the CLWX project. Payloads and receipts are local evidence under `artifacts/plane/20260908-ga/`.

| Card | Comment UUID | Created |
|---|---|---|
| CLWX-22 | `4d8a1452-0d99-4b2e-bb72-abef58118047` | `2026-09-07T23:41:46.887749Z` |
| CLWX-25 | `95be3980-7bbc-4570-9421-87b9afe4b356` | `2026-09-07T23:41:47.299270Z` |
| CLWX-77 | `13351f96-466e-49c7-bed2-cbb881877fad` | `2026-09-07T23:41:47.687144Z` |
| CLWX-106 | `4df7b7a3-ac92-4ba1-a435-7f2656d840ba` | `2026-09-07T23:41:48.084426Z` |
| CLWX-117 | `4421cf49-f202-4552-976c-47cfd9bb3844` | `2026-09-07T23:41:48.531100Z` |
| CLWX-73 | `ed19a63e-7f79-4b9f-9b9b-1734d4813863` | `2026-09-07T23:41:48.910648Z` |
| CLWX-107 | `0ba00f83-4aec-40fc-b311-fe9686b2a02e` | `2026-09-07T23:41:49.307040Z` |
| CLWX-123 | `b1de6471-05a4-49f1-a7bc-82069466d7cb` | `2026-09-07T23:41:49.707299Z` |
| CLWX-117 delta | `05837613-df73-4d54-a5af-05c03687a036` | `2026-09-07T23:43:00.413619Z` |
| CLWX-107 correction | `5cdfa155-72f6-49a9-90b9-9f7b5becee12` | `2026-09-07T23:45:09.262722Z` |
| CLWX-20 FFmpeg correction | `6279ff0a-b900-4b13-a7cb-adfa369db137` | `2026-09-07T23:52:34.160536Z` |
| CLWX-87 ASR correction | `a87382b4-cf0e-4bd8-980e-183eb03854f1` | `2026-09-07T23:52:34.551162Z` |
| CLWX-67 reminder correction | `6231f494-baa9-443f-95c2-9b1d3a712e0d` | `2026-09-07T23:52:34.943682Z` |
| CLWX-43 latency delta | `8679e48c-538f-4945-9c32-efc5cea9772a` | `2026-09-07T23:52:35.383612Z` |
| CLWX-77 document budget delta | `072f4ded-799f-4e9c-b164-e68f744b14bb` | `2026-09-07T23:52:35.786914Z` |
| CLWX-115 content-fidelity delta | `390909df-ba52-4345-a2ca-c676a0b182bd` | `2026-09-07T23:52:39.634508Z` |
| CLWX-117 repair delta | `c66ddea6-3585-4adc-a148-1e563ec45fc6` | `2026-09-07T23:52:40.001917Z` |
| CLWX-94 lifecycle delta | `15a0bde2-f749-40c5-9c0f-668aa3f50644` | `2026-09-07T23:52:40.443130Z` |
| CLWX-95 lifecycle delta | `41d99460-9e67-446d-b903-98eeb60bec8b` | `2026-09-07T23:52:40.842921Z` |
| CLWX-96 lifecycle delta | `525c03c3-ea32-4235-aafc-fdd4ec71d775` | `2026-09-07T23:52:41.241116Z` |
| CLWX-22 final map | `a70333d0-131c-4ec8-b780-b4ef5b98066c` | `2026-09-07T23:52:41.640027Z` |
| CLWX-25 final artifact delta | `b20094f2-c839-4188-8f72-097bf8f50a3c` | `2026-09-08T00:22:20.527929Z` |
| CLWX-20 final artifact delta | `a67e0078-973f-4fa8-afdc-35389f93211d` | `2026-09-08T00:22:20.923884Z` |
| CLWX-87 final artifact delta | `e4102631-c91f-42df-a3b1-8e23aa5d5cc8` | `2026-09-08T00:22:21.333948Z` |
| CLWX-77 final artifact delta | `2ff68ef3-dde7-4d9d-9954-347f1ab5a801` | `2026-09-08T00:22:21.718222Z` |
| CLWX-117 final artifact delta | `798c2baf-dba8-4dae-9e24-957109427164` | `2026-09-08T00:22:22.122185Z` |
| CLWX-95 final artifact delta | `e36ece7e-130c-4115-b733-bbe645f92afd` | `2026-09-08T00:22:22.566709Z` |
| CLWX-106 final artifact delta | `da2002b7-64de-4e6c-b761-4634c9ed1042` | `2026-09-08T00:22:22.949835Z` |
| CLWX-107 final artifact delta | `262743a5-a728-46de-ae3b-9d8ac918ea81` | `2026-09-08T00:22:23.349354Z` |
| CLWX-22 final artifact delta | `feca3977-444b-4267-9185-7139031c2fa1` | `2026-09-08T00:22:23.754349Z` |
| CLWX-25 installed acceptance delta | `2aa0c2a0-a0e4-43ed-acf5-a78463dcfc0f` | `2026-09-08T02:04:03.789804Z` |
| CLWX-20 installed FFmpeg delta | `771d635a-8100-487f-b8bf-ba1e46241edb` | `2026-09-08T02:04:04.316387Z` |
| CLWX-43 installed latency delta | `6d2c4a61-a006-46b7-a234-931a74dc973d` | `2026-09-08T02:04:04.827037Z` |
| CLWX-95 installed cancel delta | `832fe915-30c9-4a2c-9e7f-2c87ed1e88cf` | `2026-09-08T02:04:05.338226Z` |
| CLWX-96 installed recovery delta | `0000a308-2c7d-4a17-a9ce-9490a4bb0d85` | `2026-09-08T02:04:05.859066Z` |
| CLWX-106 installed gate delta | `f4c0416d-820d-44fa-91a3-226a042506aa` | `2026-09-08T02:04:06.439148Z` |
| CLWX-77 installed content delta | `efd96445-1933-4bb9-ad27-19e5689ee43e` | `2026-09-08T02:13:11.350582Z` |
| CLWX-115 installed content-fidelity delta | `6eefaf03-df11-46f2-bca7-2369ccb37f38` | `2026-09-08T02:13:11.897343Z` |
| CLWX-106 installed content gate delta | `a8201130-3760-4b4c-b1f0-613974e5d0bf` | `2026-09-08T02:13:12.470277Z` |
| CLWX-22 installed content anchor delta | `74e73415-6083-490b-af3b-56c13eaf687a` | `2026-09-08T02:13:12.988536Z` |
| CLWX-77 checkpoint 02:30 | `e04b66f9-5e8d-4682-908c-d865ff358034` | `2026-09-08T02:34:10.632046Z` |
| CLWX-115 checkpoint 02:30 | `e78aeb29-bf3c-431f-82e8-8679ab8a5024` | `2026-09-08T02:34:11.151957Z` |
| CLWX-20 checkpoint 02:30 | `b410c88f-5e6e-4949-a0b4-204b79d33ac5` | `2026-09-08T02:34:11.688246Z` |
| CLWX-87 checkpoint 02:30 | `7bc37da8-5369-473d-a6cc-feedb852eae5` | `2026-09-08T02:34:12.236534Z` |
| CLWX-73 checkpoint 02:30 | `15131834-838d-42d6-9039-f638ec05665d` | `2026-09-08T02:34:12.840947Z` |
| CLWX-63 checkpoint 02:30 | `54b631f9-081c-4802-9052-0b4b1883aae4` | `2026-09-08T02:34:13.387556Z` |
| CLWX-43 checkpoint 02:30 | `75662e91-311f-4d3a-aeaa-329c90a303a6` | `2026-09-08T02:34:13.916444Z` |
| CLWX-117 checkpoint 02:30 | `c564158c-915b-4cff-9683-4a7aafbd25d4` | `2026-09-08T02:34:14.445294Z` |
| CLWX-106 checkpoint 02:30 | `d3d20f65-9b86-49f9-bc97-2b06dec60aa9` | `2026-09-08T02:34:15.040901Z` |
| CLWX-22 checkpoint 02:30 | `e8207038-d551-444f-9bb3-f9887c4b0e61` | `2026-09-08T02:34:15.558901Z` |
| CLWX-25 checkpoint 03:23 selected install | `a95c8c62-9ef9-403e-9823-b1004fa5d13d` | `2026-09-08T03:25:51.939295Z` |
| CLWX-77 checkpoint 03:23 document journeys | `c9904c8e-63f9-4ddd-868e-1b7e4112a6bb` | `2026-09-08T03:25:52.536413Z` |
| CLWX-115 checkpoint 03:23 content fidelity | `cef86303-66b0-4aff-b83e-a536b5e53693` | `2026-09-08T03:25:53.059526Z` |
| CLWX-20 checkpoint 03:23 FFmpeg/helper | `1becf71d-1153-4dcf-ad0f-031233feb787` | `2026-09-08T03:25:53.587041Z` |
| CLWX-87 checkpoint 03:23 ASR boundary | `4a107d74-4ee7-4a44-83b4-df5f6257808b` | `2026-09-08T03:25:54.117664Z` |
| CLWX-43 checkpoint 03:23 latency | `119388da-c540-4512-a691-29899cce7995` | `2026-09-08T03:25:54.718868Z` |
| CLWX-117 checkpoint 03:23 on-device | `fede78d8-18d3-4ade-9709-dd22cee1acb4` | `2026-09-08T03:25:55.247622Z` |
| CLWX-73 checkpoint 03:23 email boundary | `82e51dc6-e704-420a-b94a-f4b310910007` | `2026-09-08T03:25:55.770235Z` |
| CLWX-63 checkpoint 03:23 Forms boundary | `d7ebcac9-b6a8-4917-b64c-44e20b0574c8` | `2026-09-08T03:25:56.301083Z` |
| CLWX-95 checkpoint 03:23 recovery scope | `6913f7f4-a554-440d-89ad-aad429de4230` | `2026-09-08T03:25:56.893493Z` |
| CLWX-106 checkpoint 03:23 release gate | `97240609-3135-469c-b454-e89931c88159` | `2026-09-08T03:25:57.433252Z` |
| CLWX-107 checkpoint 03:23 external handoff | `a79634d5-4448-4748-b86d-5fb6186332e2` | `2026-09-08T03:25:57.959675Z` |
| CLWX-22 checkpoint 03:23 GA anchor | `c24ee646-bc91-44e6-94d8-048bf24f6169` | `2026-09-08T03:25:58.486213Z` |
| CLWX-107 stakeholder 03:39 external connection | `e30582d8-e0cc-4713-8a3c-24ecaab95941` | `2026-09-08T03:44:55.780348Z` |
| CLWX-25 stakeholder 03:39 setup/provisioning | `9b792ed2-b013-4b03-8d33-8eab4885e4e3` | `2026-09-08T03:44:56.329826Z` |
| CLWX-73 stakeholder 03:39 email boundary | `50a13f27-bc1f-41b4-a9a9-82b640fa0295` | `2026-09-08T03:44:56.826929Z` |
| CLWX-117 stakeholder 03:39 model/on-device | `46fed7fd-8b7d-450d-8d4e-789b938ab8d6` | `2026-09-08T03:44:57.329118Z` |
| CLWX-115 stakeholder 03:39 content testing blocked | `8a97f3c4-5b80-4027-b248-d646ef84e9f9` | `2026-09-08T03:44:57.816182Z` |
| CLWX-106 stakeholder 03:39 release gate | `2017d68e-c9a9-4282-b258-6f9760315433` | `2026-09-08T03:44:58.359967Z` |
| CLWX-22 stakeholder 03:39 GA anchor | `3168953d-c254-418f-ad5c-b5a03ad03e9a` | `2026-09-08T03:44:58.852461Z` |
| CLWX-22 broker 04:11 GA anchor | `8deb7adb-16a1-4e31-b5c4-52dafaed94b5` | `2026-09-08T04:14:17.258176Z` |
| CLWX-25 broker 04:11 fresh setup | `d3a14cfe-461a-4414-aa08-01329cc6dbaf` | `2026-09-08T04:14:17.844128Z` |
| CLWX-106 broker 04:11 release gate | `b6cc41bb-9a80-496f-95f5-0e1813f14ea6` | `2026-09-08T04:14:18.386770Z` |
| CLWX-107 broker 04:11 external acceptance | `ab8b4369-fc89-4cf1-a277-1b30264073db` | `2026-09-08T04:14:18.904417Z` |
| CLWX-117 broker 04:11 local/on-device | `1e0e4bcf-33d2-4d09-ba47-5d556d2e0931` | `2026-09-08T04:14:19.423396Z` |
| CLWX-22 fresh setup 04:31 GA anchor | `e8d7798d-7699-4400-aa1c-cad3211bbde2` | `2026-09-08T04:35:33.624755Z` |
| CLWX-25 fresh setup 04:31 standard install | `2f53fc80-b6d7-42af-b1dd-332fb8d5f3a4` | `2026-09-08T04:35:34.133888Z` |
| CLWX-106 fresh setup 04:31 release gate | `2aa73bc6-5bea-4820-b387-a85d382592d8` | `2026-09-08T04:35:34.559558Z` |
| CLWX-107 fresh setup 04:31 external acceptance | `b76a4a04-fa74-4a42-9718-05ac26293d83` | `2026-09-08T04:35:34.987420Z` |
| CLWX-117 fresh setup 04:31 model/setup | `e95f7627-23b9-4236-9429-ed4ec41590de` | `2026-09-08T04:35:35.410319Z` |
| CLWX-22 fresh first-turn 04:54 GA anchor | `336adcad-cb8e-449a-b2d4-95b0fad11787` | `2026-09-08T04:55:46.238477Z` |
| CLWX-25 fresh first-turn 04:54 setup/install | `3a11c595-6661-42b9-8599-29f278e4e9f9` | `2026-09-08T04:55:46.657777Z` |
| CLWX-106 fresh first-turn 04:54 release gate | `2b287f83-522b-4c7c-81ae-d06adff3ac61` | `2026-09-08T04:55:47.078863Z` |
| CLWX-107 fresh first-turn 04:54 external acceptance | `00fb08a5-9865-4289-9ef2-8f864febb0f4` | `2026-09-08T04:55:47.537320Z` |
| CLWX-117 fresh first-turn 04:54 model/setup | `51e39f91-642d-4d94-8be6-f1ed81974a65` | `2026-09-08T04:55:47.941450Z` |
| CLWX-22 moe.23/fallback 05:23 GA anchor | `295d0127-84c9-4ff3-b59e-4eed1911a515` | `2026-09-08T05:23:39.424732Z` |
| CLWX-25 moe.23/fallback 05:23 package/install | `68c27c6d-f6c0-4361-bb5a-d7c69edc83bc` | `2026-09-08T05:23:39.836236Z` |
| CLWX-106 moe.23/fallback 05:23 release gate | `04130726-26fa-42b6-b55d-11fd649683a9` | `2026-09-08T05:23:40.298881Z` |
| CLWX-107 moe.23/fallback 05:23 external acceptance | `5eacd7cc-8bdd-4235-9588-49e727f6fef6` | `2026-09-08T05:23:40.701532Z` |
| CLWX-117 moe.23/fallback 05:23 transient fallback | `603d5b16-89c7-43fe-b4d8-994ead893608` | `2026-09-08T05:23:41.105585Z` |
| CLWX-22 moe.23 wording correction 05:29 | `95f47f66-5250-4427-8668-09b06a96b962` | `2026-09-08T05:29:21.332992Z` |

The final artifact export wrote 124 issues and six states. Local evidence `artifacts/plane/20260908-ga/export-marker-verification.jsonl` records exactly one `GA blocker record - 2026-09-08` marker on each intended card, and `artifacts/plane/20260908-ga/final-artifact-marker-verification.json` records exactly one final-artifact marker on CLWX-20, CLWX-22, CLWX-25, CLWX-77, CLWX-87, CLWX-95, CLWX-106, CLWX-107 and CLWX-117. The installed-acceptance export also wrote 124 issues and six states; local evidence `artifacts/plane/20260908-ga/installed-acceptance-marker-verification.json` records exactly one installed-acceptance marker on CLWX-20, CLWX-25, CLWX-43, CLWX-95, CLWX-96 and CLWX-106. The installed-content export also wrote 124 issues and six states; local evidence `artifacts/plane/20260908-ga/installed-content-marker-verification.json` records exactly one installed-content marker on CLWX-22, CLWX-77, CLWX-106 and CLWX-115. The 02:30 checkpoint export also wrote 124 issues and six states; local evidence `artifacts/plane/20260908-ga/checkpoint-0230-marker-verification.json` records exactly one checkpoint marker on CLWX-20, CLWX-22, CLWX-43, CLWX-63, CLWX-73, CLWX-77, CLWX-87, CLWX-106, CLWX-115 and CLWX-117. The 03:23 checkpoint export also wrote 124 issues and six states; local evidence `artifacts/plane/20260908-ga/checkpoint-0323-marker-verification.json` records exactly one checkpoint marker on CLWX-20, CLWX-22, CLWX-25, CLWX-43, CLWX-63, CLWX-73, CLWX-77, CLWX-87, CLWX-95, CLWX-106, CLWX-107, CLWX-115 and CLWX-117, no enrichment errors, no redaction hits, and expected live states after comment-only writes. CLWX-107 is Backlog on live and tracked HEAD readback; no state mutation was executed in this batch. The stakeholder-connection checkpoint export wrote 124 issues and six states; local evidence `artifacts/plane/20260908-ga/stakeholder-0339-marker-verification.json` records exactly one stakeholder marker on CLWX-22, CLWX-25, CLWX-73, CLWX-106, CLWX-107, CLWX-115 and CLWX-117, no enrichment errors, no redaction hits, and expected live states after comment-only writes. The `GA broker/setup checkpoint 04:11 - 2026-09-08` export wrote 124 issues and six states; local evidence `artifacts/plane/20260908-ga/broker-0411-marker-verification.json` records exactly one broker/setup marker on CLWX-22, CLWX-25, CLWX-106, CLWX-107 and CLWX-117, no enrichment errors, no redaction hits, and expected live states after comment-only writes. The `Fresh standard-user setup checkpoint 04:31 - 2026-09-08` export wrote 124 issues and six states; local evidence `artifacts/plane/20260908-ga/fresh-setup-0431-marker-verification.json` records exactly one fresh-setup marker on CLWX-22, CLWX-25, CLWX-106, CLWX-107 and CLWX-117, no enrichment errors, no redaction hits, and expected live states after comment-only writes. The `Fresh first-turn transient fallback checkpoint 04:54 - 2026-09-08` export wrote 124 issues and six states; local evidence `artifacts/plane/20260908-ga/fresh-first-turn-0454-marker-verification.json` records exactly one fresh first-turn marker on CLWX-22, CLWX-25, CLWX-106, CLWX-107 and CLWX-117, no enrichment errors, no redaction hits, and expected live states after comment-only writes. The `moe.23 package/fallback repair checkpoint 05:23 - 2026-09-08` export wrote 124 issues and six states; local evidence `artifacts/plane/20260908-ga/moe23-fallback-0523-marker-verification.json` records exactly one moe.23/fallback marker on CLWX-22, CLWX-25, CLWX-106, CLWX-107 and CLWX-117, no enrichment errors, no redaction hits, and expected live states after comment-only writes. The `moe.23 package wording correction 05:29 - 2026-09-08` comment corrects the CLWX-22 05:23 phrase to host-extracted package checks, not guest installed hash proof; local evidence `artifacts/plane/20260908-ga/moe23-wording-correction-0529-marker-verification.json` records exactly one correction marker on CLWX-22 and none on other cards. CLWX-117 also has a separate `GA blocker delta - 2026-09-08 on-device` comment for the refined gateway-tool diagnosis. CLWX-107 has a correction comment replacing "expired" with "expires at" for the signed URL because the expiry was still in the future at posting time. CLWX-20 was reconciled from Ready to In Progress after live readback because current package evidence invalidated the card's old Ready note; local evidence: `artifacts/plane/20260908-ga/clwx20-state-reconcile.json`. Final export/readback receipts are local evidence under `artifacts/plane/20260908-ga/`.

## Blocker matrix

| Area | Plane card | Original blocker | Removal or narrowing evidence | Current status |
|---|---:|---|---|---|
| GA anchor | CLWX-22 | GA criteria were being conflated across source tests, installed binaries, stakeholder feedback and publication. | Current docs now separate source, installer, installed app, live tenant and external acceptance. Fresh stakeholder evidence supersedes the earlier no-reply state: Karunesh reported repeated assistant reachability / work-safe errors on the earlier sent moe.21 diagnostic build and could not test functionality. Broker API proof, setup-helper proof, actual setup CMD proof and moe.23 host package proof now narrow provisioning/package risk. The first fresh moe.22 Online turn still failed acceptance because transient fallback/degrade fired before the cloud answer, UI provenance was false, terminal quiet proof was absent and duplicate/local-failure evidence appeared later. The bounded fallback repair is source-approved and integrated into moe.24, but not installed-accepted. | RED. Setup entrypoint and moe.23 host package are repaired/proved, but first-turn stability, transient fallback installed proof, Windows 10/11 client proof, P3 content, on-device, tenant, microphone, recovery, external acceptance and release approval remain open. |
| Windows package completeness | CLWX-25 | moe.21 built successfully but the fresh package and second clean application-directory install omitted `resources/bin/ffmpeg.exe`; the first assisted upgrade was masked by a legacy helper. | moe.22 selected run `34180280985` already passed hosted package and installed-payload verification. moe.23 run `34187805266` from source `2449a9483b7e4937a902e70914a382d05f8e2e58` now succeeded with 204 Windows test files / 2,135 tests passed and 11 skips; 17 host package/provenance checks passed; installer SHA256 is `228983187371d54a60f4018f6ee3ac86bd3e60d4ed2dbe3cd2784d76962f8d25`; root independent host-extracted package checks match package. Local evidence: `artifacts/windows-vm/20260908-fresh-setup/moe23-host-verification.json`. | Source-fixed and host-package verified for moe.23. No GA closure: assisted upgrade is still extracting, installed acceptance is not complete, and standard Windows 10/11 client, tenant, microphone and full journeys remain open. |
| Standard Windows client install | CLWX-25 | Current installed evidence had been reused Windows Server 2022 administrator state, not a fresh Windows 10/11 principal machine or standard-user client. | A fresh standard user `ClawXFresh0908` in RDP Session 2 now has setup-helper and ordinary assisted install evidence. Setup helper `9d46832f` passed 20/20 native Windows PowerShell 5.1 checks and actual setup CMD passed at `2026-09-08T04:39:32Z` without elevation. Before the moe.23 upgrade, 316 fresh standard-user profile files were backed up at `2026-09-08T04:58:49Z`, all hashes matched and private backups remain guest-only. RDP disconnect recovered by reconnecting the same Session 2; no reboot or resize. | PARTIAL/FAILING. Fresh Server 2022 standard-user setup/install and backup preservation are proved, but moe.23 is only extracting and Windows 10/11 client acceptance plus stable provisioned first Online turn remain unproved. |
| VM access | CLWX-25 | Current VM lane could not be used while gcloud account auth failed in non-interactive execution. | `login-refresh.json` records `AUTHENTICATED_IAP_ACCESS_RESTORED`: RDP protocol PASS, SSH banner PASS, closed guest control PASS and authenticated SSH marker PASS at `2026-09-08T01:42:21Z`. The exact installer was transferred with matching bytes/hash and installed. | ACCESS BLOCKER REMOVED for the VM lane. This is not a product repair or GA proof; the environment remains reused Server 2022/admin and representative client evidence is still open. |
| Turn lifecycle and fault recovery | CLWX-94, CLWX-95, CLWX-96 | Earlier installed runs exposed orphan/replay and post-degrade recovery risks; moe.21 only has scoped ordinary Online and observable cancel-next positives. Exact runtime abort and mid-turn fault recovery are not proven installed. | Source lifecycle repairs have focused tests/review. Commit `f1d88039` preserves the existing 120 s send acknowledgement deadline while keeping the 90 s owned-run inactivity budget from adopting orphaned runs. On the exact installed `258d3ac` candidate, ordinary Online passed on `custom-moecloud` / `moe-demo-pro` with no tools or errors, one token occurrence and 30 s terminal quiet, but 99,184 ms latency. Observable cancel-next-send also passed: after Stop, the next Online send answered, settled and contained the token once. Local evidence: `artifacts/windows-vm/20260908-moe22/pending-send-source-review.json`, `installed-acceptance-34171848832/online-content-review.json`, `online-transcript-review.json` and `cancel-next-20260908T0158Z/cancel-and-next-summary.json`. | PARTIAL installed proof. `exactRuntimeAbortProven=false`; controlled mid-turn fault/degrade, stale-banner clearing, silent-send watchdog and next-turn success after real provider fault remain open. |
| Document journeys | CLWX-77 | Installed moe.21 failed P3 PDF title discovery with no tool call and P5 image grounding with invented content after a truncated JSON tool result. | Selected installed `a4efc7e4` incorporates `1f2b405e` and `a4efc7e` source repairs, then retested the P3/P5 paths from the installed app. P3 now calls `document.find` with the fixture folder and `document.read_pdf` against the correct hash-verified PDF; the reader output contains the expected source obligations, but the model summary still omits one final consolidated reporting deadline. P5 now passes content acceptance: the model used text plus one accepted native image block from `document.read_image`, recovered from one generic image-tool error and returned all expected fields plus the expected blanks. The prior `258d3ac` Office helper check remains PASS for five bundled modules and four Word/Excel write/readback checks, but it is prior-candidate evidence. | PARTIAL/FAILING installed document gate on selected `a4efc7e4`: P5 image content is repaired and installed-verified; P3 PDF summary content still fails. Recurring gate coverage must catch the remaining reader-to-summary omission. |
| Content-fidelity regression coverage | CLWX-115 and CLWX-22 | Document discovery could continue past its declared default-root budget, creating a risk that an incomplete search looked complete and safe to auto-select. | `a0a9e5f4` protects discovery budget safety; `1f2b405e` adds PDF circular summary guidance with 41 tests; `a4efc7e` preserves managed-cloud vision metadata across sync paths for managed aliases while preserving pricing, with 55+7 tests plus typecheck/lint/harness and real image-transform negative/positive validation. Installed `a4efc7e4` proves the image path improvement through P5, but P3 still demonstrates a fidelity gap where read source material is not fully carried into the final answer. Karunesh also reported that connection errors prevent him from testing functionality; document/image attachments are arriving for diagnosis but are not acceptance evidence yet. | ACTIVE installed blocker. P5 is narrowed to installed PASS; P3 remains installed FAIL; external content testing is blocked by stakeholder connection/setup failure. |
| On-device | CLWX-117 | Top-level `sessions_yield` and later installed moe.21 ordinary on-device `NO_RESPONSE` / timeout behavior. | Earlier source repair denies session-control tools on-device and adds owned-progress terminal handling. The installed `258d3ac` candidate still failed ordinary on-device. Startup repair `11db8196` is source-approved for provider import order, provider/model identity, selected-route readiness and explicit channel intent, but read-only diagnosis shows it does not cover transient fallback. In the fresh standard-user first Online turn, the correlated transcript proves the answer came from `custom-moecloud` / `moe-demo-pro` / `openai-completions`, but the renderer prepared fallback/degrade before the answer and later local attempts failed. The new bounded fallback repair `7f4b06d3b943fc15ff6655dd057c3336aa62e31b` is independently approved with 107 unit tests and two Electron tests: it avoids false local fallback on silent runs, probes local readiness before fallback, preserves the bounded timeout and ignores late timed-out finals. | FAILING installed/customer first-turn and on-device/setup gate. The fallback repair is source-approved and integrated into moe.24 source, but it is not installed acceptance and does not fix latency. |
| Email attach | CLWX-73 | Karunesh's moe.18 log showed Chrome CDP `ECONNREFUSED`, launch, `port_bind_timeout` and profile-lock loop after the app targeted Chrome's default profile under Chrome 136+. | Dedicated user-owned non-default Chrome profile correction is in moe.21 source; native Windows source Chrome launcher passed two launch/attach/DOM probes. On the prior installed `258d3ac`, browser bridge/CDP readiness passed with Gateway running, Outlook open returned `opened`, browser diagnose returned `cdp_ready`, renderer error count was zero and no email was sent. Actual `readInbox` returned `needs_signin`, with no browser Inbox row verified. Karunesh's latest reply says he cannot test functionality because the assistant is not reachable; the evidence does not prove an email-flow result. The newer selected `a4efc7e4` candidate has no account-holder sign-in or mailbox acceptance yet. | Mechanism remains repaired, tenant journey not accepted. Connection/setup must be fixed before the stakeholder can retest email; no email read/send proof exists. |
| Outlook compose boundary | CLWX-123 | `draft_email` falsely rejected a draft its own fill path created because readback did not recognize rendered Outlook compose content. | Source/local product-path repair uses rendered text readback and exact active-compose recipient bucket signals; 99 focused tests and one local signed-in synthetic draft check passed without Send. | Source/local only. Needs installed Windows signed-in saved-reopen/read/draft proof. |
| Forms workflows | CLWX-62, CLWX-63, CLWX-64 and CLWX-7 | Daily Report, Suspensions and schema-drift paths were being treated as one solved bucket even though extraction-to-form and production destination have separate acceptance. | Live card read shows CLWX-62 Daily Report and CLWX-64 schema-drift are Ready from prior evidence, while CLWX-63 document-to-form extraction remains In Progress. On the prior installed `258d3ac`, the browser bridge check returned Forms list `ok` with both Daily Report and Suspensions available; no form was submitted. The newer selected `a4efc7e4` candidate has no new exact-candidate Forms extraction-to-prefill proof yet. | PARTIAL for GA. Forms configuration has prior installed proof, but exact-candidate extraction-to-prefill and no-submit/preview proof remain open. |
| First-run provisioning | CLWX-22, CLWX-106, CLWX-107 | The public/keyless installer does not include an activation-code exchange or Entra-native Online onboarding. A vanilla Windows machine needs Chrome plus supported Online provisioning or a prepared local model runtime before advertised journeys can pass. | Karunesh's moe.21 diagnostic log shows incomplete cloud seed, local default true, local pin before persisted cloud import, then local-network connection errors. Missing cloud bootstrap does not prove a persisted provider is absent. Broker API proof exists, and setup helper `9d46832f` plus the actual private setup CMD now pass on fresh standard Server 2022 without elevation. Setup bundles were rebuilt with the tested helper and distinct VM/stakeholder credentials, but remain private and unsent. The first installed moe.22 Online turn produced a real cloud answer with the token exactly once, but the driver still failed `TIMED_OUT_MID_TURN` with automatic fallback/degrade, false on-device attribution and no terminal quiet-window proof. | PARTIAL/FAILING. Provisioning files can be written and bundles can be prepared, but stable first-turn behavior, Windows 10/11 client proof and external stakeholder acceptance remain blocked. |
| Release gate | CLWX-106 | Required lanes could be skipped or static-only without blocking publication. | Strict release scoring, source/compiled receipts, artifact identity and fail-closed release semantics have source tests/review. New positives add setup helper 20/20 native PS5.1 PASS, actual setup CMD PASS, fresh Server 2022 standard-user install proof, moe.23 run `34187805266` SUCCESS with 204 files / 2,135 tests / 11 skips, 17 host package/provenance checks PASS, and fallback repair `7f4b06d3b943fc15ff6655dd057c3336aa62e31b` source approval. moe.24 source `b814f804036fc2f9f32d3326c8694f4ae2ef7805` is packaging in run `34189597051` after native preflight. Active negatives include no newly accepted artifact, moe.23 assisted upgrade still extracting, moe.23 not containing the fallback repair, installed moe.22 first Online turn FAIL with automatic degrade/false on-device attribution/`TIMED_OUT_MID_TURN`, no terminal quiet-window proof, P3 summary-content FAIL, prior on-device timeout with no installed local repair, stakeholder-reported connection failure, Outlook sign-in blocking mailbox proof, no Windows 10/11 client acceptance, no microphone/quality/app ASR proof, no strict fault-recovery proof, no external tester acceptance and no release approval/publication. | Gate still correctly blocks GA. Package/source progress is positive, but first-turn behavior and accepted artifact/handoff remain RED. |
| External owner/tester handoff | CLWX-107 | Owner requested immediate Windows download and Karunesh asked whether email was fixed. | The earlier WhatsApp handoff sent a moe.21 diagnostic download and stated known limits. Fresh mapped read at `2026-09-08T03:31:42Z` found Karunesh replies from `03:28:38Z`, `03:28:52Z` and `03:29:45Z`: repeated assistant reachability / work-safe errors and inability to test functionality. A WhatsApp acknowledgment was accepted at `2026-09-08T03:39:18Z`; delivery/read proof is unavailable. The setup CMD now passes on the VM and setup bundles were rebuilt with the tested helper and distinct VM/stakeholder credentials, but the fresh first Online app turn still failed driver and visual review despite a late correct cloud answer. No repaired installer, new login/setup bundle or release candidate was sent in the moe.23/fallback checkpoint. | Active external blocker. This is not acceptance; do not ask the tester to run email/doc functionality until ordinary assistant turn stability is proved on a repaired installed artifact. |
| Policy and reminders | CLWX-42, CLWX-67, CLWX-115 | Policy answers and reminders have scoped positives, but complete installed ordinary journeys remain unproved. | D0/P1/P2/P4 and reminder retained-history evidence exist for moe.21; reminder natural one-shot fired, retained in history and cleaned the owned job. The selected `a4efc7e4` candidate has not yet produced exact-candidate policy/reminder ordinary-prompt proof. | PARTIAL. Needs exact-candidate policy/reminder ordinary prompts, supported visible delivery path and content-fidelity regression coverage. |
| Latency and rehearsal | CLWX-43 and CLWX-107 | Raj's latency complaint still lacks an owner-approved p50/p90 budget and current release-build distribution. | Selected `a4efc7e4` cold desktop-shortcut startup reached first Gateway/composer ready at 105,745 ms and remained stable for 20,164 ms; 61 readiness samples and a 300.067 s 1280x800 host recording were captured, with independent visual review PASS for scoped startup rendering. Earlier prior-candidate samples remain historical: cold 205,972 ms, ordinary Online 99,184 ms and one warm shortcut sample 72,527 ms. | PARTIAL and still a release concern. The new selected candidate has one cold sample only, not a p50/p90 distribution or representative client result. Needs owner budget sign-off and continuous rehearsal on the release build. |
| FFmpeg packaging and ASR quality/microphone | CLWX-20, CLWX-25 and CLWX-87 | CLWX-20's original user-machine failure was `ffmpeg-not-found`; CLWX-87 is the separate ASR quality/engine decision from repeated owner feedback; current Server 2022 VM has no microphone. | Selected `a4efc7e4` artifact and installed payload verification prove `ffmpeg.exe` is present in the installed app at `114400768` bytes / SHA256 `63a0b3c76a245bc0d986853612d9ec43a2a2d1f1c7a3fa40ee459c248075b3a6` with matching ASR helper files. Installed native-helper smoke has seven PASS rows: FFmpeg identity, WinSpeech identity, FFmpeg version/buildconf, valid PCM WAV generation, missing-file contract and WinSpeech synthetic-tone execution. | CLWX-20 package/helper blocker is removed for the selected VM artifact, but app ASR routing, microphone, quality/WER and representative client proof remain NOT_TESTED. CLWX-87 remains In Progress. |
| Production and fleet rollout | CLWX-7, CLWX-8, CLWX-28, CLWX-31, CLWX-110 | Ministry identity, production Forms destination, app-server hostname, support flow, quotas and 450-laptop rollout plan are not settled. | Outbox/storage pieces have source evidence; production tenant decisions remain outside installed desktop smoke. | Fleet rollout remains separate from the scoped pilot release and blocked on Ministry/owner decisions. |
| Durable action journal | CLWX-124 | Interrupted external actions and owned-draft cleanup need durable reconciliation. | Explicit owner direction places this after GA. | DEFERRED. Do not treat as current release blocker; do not delete drafts without proven ownership and unchanged state. |

## Current fix path

1. Finish the stakeholder connection/provisioning fix: broker relay API proof, setup-helper native proof, actual setup CMD proof and private setup-bundle rebuild now exist, but the first Online turn still fails with transient fallback/degrade and Karunesh still cannot test functionality.
2. Repair the remaining selected-candidate P3 PDF summary omission, then re-run installed P3 on the exact release artifact.
3. Install-verify the source-approved transient fallback/session pinning repair so an Online cloud answer is not falsely attributed to on-device and does not leave the composer on-device after a delayed cloud response.
4. Finish the moe.23 assisted upgrade only as package/provenance evidence, then package and install moe.24 with the approved transient-fallback repair; moe.24 run `34189597051` is packaging and has no accepted artifact yet.
5. Verify both unprovisioned and supported provisioned first-turn behavior on the exact candidate with no unintended degrade, correct channel/provenance and terminal quiet-window proof.
6. Finish installed ordinary prompt acceptance for policy, reminders, Outlook and Forms extraction on the exact installer; P5 image content, native helper execution and startup rendering have scoped positives.
7. Prove Outlook mailbox access after account-holder sign-in and retain no-send/no-submit safety boundaries until explicitly authorized.
8. Add representative Windows client/standard-user and microphone evidence, or record an explicit accepted deferral.
9. Record external owner/tester result for the exact artifact after connection/setup is fixed; the current Karunesh reply is failure evidence, not acceptance.
10. Keep release publication blocked until the [GA release evidence manifest](../GA_RELEASE_EVIDENCE_MANIFEST.md) has artifact-bound PASS or explicit accepted deferral for every release-critical gate.

## Supporting documents

Project documents:

- [Completion plan](../COMPLETION_PLAN.md)
- [Current Windows candidate](../CURRENT_WINDOWS_RC.md)
- [moe.22 release manifest](../release-manifests/0.4.3-moe.22.json)
- [GA release evidence manifest](../GA_RELEASE_EVIDENCE_MANIFEST.md)
- [Plane board API](../PLANE_BOARD_API.md)
- [Windows VM development evidence](WINDOWS_VM_DEVELOPMENT_2026-09-07.md)
- [Windows owner test download evidence](WINDOWS_OWNER_TEST_DOWNLOAD_2026-09-07.md)
- [Windows VM testing evidence](WINDOWS_VM_TESTING_2026-09-07.md)
- [Windows runtime recovery evidence](WINDOWS_RUNTIME_RECOVERY_2026-09-07.md)
- [CLWX-106 release gate review](CLWX-106_release-gate_review_2026-09-07.md)
- [Stakeholder connection failure](WINDOWS_STAKEHOLDER_CONNECTION_2026-09-08.md)

Local evidence artifacts:

- `artifacts/windows-vm/20260908-moe22/access-status.json`
- `artifacts/windows-vm/20260908-moe22/document-budget-source-review.json`
- `artifacts/windows-vm/20260908-moe22/document-budget-fixture-review.json`
- `artifacts/windows-vm/20260908-moe22/ondevice-policy-source-review.json`
- `artifacts/windows-vm/20260908-moe22/pending-send-source-review.json`
- `artifacts/windows-vm/20260908-moe22/stakeholder-intake-refresh.json`
- `artifacts/plane/20260908-ga/stakeholder-connection-0339-redacted.json`
- `artifacts/plane/20260908-ga/broker-setup-0411-redacted.json`
- `artifacts/windows-vm/20260908-fresh-setup/broker-live-verification.json`
- `artifacts/plane/20260908-ga/broker-0411-batch-results.txt`
- `artifacts/plane/20260908-ga/broker-0411-marker-verification.json`
- `artifacts/plane/20260908-ga/broker-0411-write-receipts.txt`
- `artifacts/plane/20260908-ga/export-after-broker-0411.log`
- `artifacts/plane/20260908-ga/fresh-setup-0431-redacted.json`
- `artifacts/windows-vm/20260908-fresh-setup/native-setup-evidence/native-setup-contract.json`
- `artifacts/windows-vm/20260908-fresh-setup/native-setup-evidence/native-setup-contract.log`
- `artifacts/windows-vm/20260908-fresh-setup/native-setup-evidence.zip`
- `artifacts/windows-vm/20260908-fresh-setup/setup-source-hashes.json`
- `artifacts/windows-vm/20260908-fresh-setup/resize-proposal.json`
- `artifacts/windows-vm/20260908-fresh-setup/rdp-client-cleanup.json`
- `artifacts/plane/20260908-ga/fresh-setup-0431-batch-results.txt`
- `artifacts/plane/20260908-ga/fresh-setup-0431-marker-verification.json`
- `artifacts/plane/20260908-ga/fresh-setup-0431-write-receipts.txt`
- `artifacts/plane/20260908-ga/export-after-fresh-setup-0431.log`
- `artifacts/plane/20260908-ga/fresh-first-turn-0454-redacted.json`
- `artifacts/windows-vm/20260908-fresh-setup/native-setup-contract-20.json`
- `artifacts/windows-vm/20260908-fresh-setup/native-setup-contract-20.log`
- `artifacts/windows-vm/20260908-fresh-setup/fresh-first-turn-evidence/actual-online-setup.json`
- `artifacts/windows-vm/20260908-fresh-setup/fresh-first-turn-evidence/online-first-turn/chat-turn-2026-09-08T04-46-06-965Z.json`
- `artifacts/windows-vm/20260908-fresh-setup/fresh-first-turn-evidence/fresh-first-turn-transcript.json`
- `artifacts/windows-vm/20260908-fresh-setup/startup-metric-values-redacted.txt`
- `artifacts/windows-vm/20260908-fresh-setup/moe23-host-verification.json`
- `artifacts/windows-vm/20260908-fresh-setup/pre-upgrade-backup.json`
- `artifacts/windows-vm/20260908-fresh-setup/setup-bundle-preparation.json`
- `artifacts/windows-vm/20260908-fresh-setup/fresh-first-turn-evidence/fresh-online-turn/host-verification/host-verification.json`
- `artifacts/windows-vm/20260908-fresh-setup/fresh-first-turn-evidence/fresh-online-turn/visual-review.json`
- `artifacts/windows-vm/20260908-fresh-setup/fresh-first-turn-evidence/fresh-app-observed.json`
- `artifacts/plane/20260908-ga/fresh-first-turn-0454-batch-results.txt`
- `artifacts/plane/20260908-ga/fresh-first-turn-0454-marker-verification.json`
- `artifacts/plane/20260908-ga/fresh-first-turn-0454-write-receipts.txt`
- `artifacts/plane/20260908-ga/export-after-fresh-first-turn-0454.log`
- `artifacts/plane/20260908-ga/moe23-fallback-0523-redacted.json`
- `artifacts/plane/20260908-ga/moe23-fallback-0523-batch-results.txt`
- `artifacts/plane/20260908-ga/moe23-fallback-0523-marker-verification.json`
- `artifacts/plane/20260908-ga/moe23-fallback-0523-write-receipts.txt`
- `artifacts/plane/20260908-ga/export-after-moe23-fallback-0523.log`
- `artifacts/plane/20260908-ga/moe23-wording-correction-0529-redacted.json`
- `artifacts/plane/20260908-ga/moe23-wording-correction-0529-batch-results.txt`
- `artifacts/plane/20260908-ga/moe23-wording-correction-0529-marker-verification.json`
- `artifacts/plane/20260908-ga/moe23-wording-correction-0529-write-receipts.txt`
- `artifacts/plane/20260908-ga/export-after-moe23-wording-correction-0529.log`
- `artifacts/plane/20260908-ga/github-artifacts-34171848832.json`
- `artifacts/plane/20260908-ga/final-artifact-marker-verification.json`
- `artifacts/plane/20260908-ga/installed-acceptance-marker-verification.json`
- `artifacts/plane/20260908-ga/installed-content-marker-verification.json`
- `artifacts/plane/20260908-ga/checkpoint-0230-marker-verification.json`
- `artifacts/plane/20260908-ga/checkpoint-0323-batch-results-success.txt`
- `artifacts/plane/20260908-ga/checkpoint-0323-write-receipts.txt`
- `artifacts/plane/20260908-ga/export-after-checkpoint-0323.log`
- `artifacts/plane/20260908-ga/checkpoint-0323-marker-verification.json`
- `artifacts/plane/20260908-ga/stakeholder-0339-batch-results.txt`
- `artifacts/plane/20260908-ga/stakeholder-0339-marker-verification.json`
- `artifacts/plane/20260908-ga/stakeholder-0339-write-receipts.txt`
- `artifacts/plane/20260908-ga/export-after-stakeholder-0339.log`
- `artifacts/windows-vm/20260908-moe22/hosted-package-34180280985/verification.json`
- `artifacts/windows-vm/20260908-moe22/hosted-package-34180280985/workflow-summary.json`
- `artifacts/windows-vm/20260908-moe22/hosted-package-34180280985/blockmap-verification.json`
- `artifacts/windows-vm/20260908-moe22/hosted-package-34180280985/download-verification.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34180280985/install-result.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34180280985/installed-payload-verification.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34180280985/startup-content-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34180280985/startup-visual-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34180280985/p3-transcript-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34180280985/p3-grounding-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34180280985/p5-transcript-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34180280985/p5-grounding-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34180280985/native-helper-summary.json`
- `artifacts/windows-vm/20260908-moe22/hosted-package-34171848832/verification.json`
- `artifacts/windows-vm/20260908-moe22/hosted-package-34171848832/download-verification.json`
- `artifacts/windows-vm/20260908-moe22/hosted-package-34171848832/blockmap-verification.json`
- `artifacts/windows-vm/20260908-moe22/hosted-package-34171848832/workflow-summary.json`
- `artifacts/windows-vm/20260908-moe22/login-refresh.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/install-result.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/installed-payload-verification.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/package-directory-preservation.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/running-identity.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/cold-start.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/startup-verified/host-verification.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/startup-verified/startup-visual-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/online-content-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/online-transcript-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/cancel-next-20260908T0158Z/cancel-and-next-summary.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/p3-content-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/p3-reader-shape.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/p5-content-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/p5-transcript-review.json`
- `artifacts/windows-vm/20260908-moe22/build-request-34180280985.json`
- `artifacts/plane/20260908-ga/build-status-34180280985-checkpoint.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/native-helpers-20260908T0220Z/native-helper-summary.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/office-helper-content-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/browser-20260908T0222Z/browser-readiness-summary.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/warm-start-check/warm-content-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/ondevice-content-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/p5-native-visual-review.json`
- `artifacts/windows-vm/20260908-moe22/installed-acceptance-34171848832/p5-model-capabilities.json`
