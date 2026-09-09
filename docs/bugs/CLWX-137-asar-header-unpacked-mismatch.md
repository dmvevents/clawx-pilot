# CLWX-137 — Packaged `app.asar` header declares 6 unpacked files the payload does not contain, so whole-archive extraction fails

## Identity and impact

- Reported/last verified: 2026-09-09, first observed during moe.30 package verification on the macOS host.
- Owning card: CLWX-137 (created for this defect; no existing card covered it — searched all board cards and every `docs/bugs` report for `asar`, `unpacked`, `canvas` and `prebuild` and found none). Related: [CLWX-133](../COMPLETION_PLAN.md) release run, which is where the defect surfaced; CLWX-97 and CLWX-72 are unrelated packaging defects about missing runtime dependencies, not header/payload disagreement.
- Severity: **low**. No user-facing behaviour is known to depend on it. It is a tooling and supply-chain-verification defect, not a product-journey defect.
- Status: **reproduced at the package level; no fix proposed.** Remaining gates: a packaging-configuration decision by the release owner, then a rebuild to confirm. Not required for the current candidate's acceptance.
- Environment: packaged Windows x64 artifact `Ministry of Education-0.4.3-moe.30-win-x64.exe`, installer SHA256 `9f8a2dc5fc5c238d49935a7f1b0b9b90205c104ddf933124196c62210114aff7` (476,773,051 bytes), `app.asar` SHA256 `366c3166810434b083098f8517e3e8268325216851703394368dd9bea7bfba02` (260,765,109 bytes), version `0.4.3-moe.30`, source `40cfe727f38d1b29c4f5ff77e1eddba97556061f`, hosted build `34323058772`, keyless-public profile. Inspected on the macOS host with `7zz` and `@electron/asar` 3.4.1; **no Windows install and no VM were involved**.
- Known working baseline: none. This follows from a long-standing configuration (`asarUnpack: "**/*.node"` in `electron-builder.yml`) plus wrong-architecture pruning, so earlier candidates on the same configuration are expected to share it. Earlier artifact gates used per-file host checks rather than whole-archive extraction, which is why it had not surfaced. Marked `UNVERIFIED` for prior candidates — not re-checked, because it would not change the disposition.

## Reproduction and expected result

No user state changes; host-only, read-only against a downloaded artifact.

1. Download the run's `windows-installer-x64` artifact.
2. `7zz x` the installer, then `7zz x` the inner `$PLUGINSDIR/app-64.7z` payload.
3. Read the asar header of `resources/app.asar` and compare every entry marked `unpacked` against the contents of `resources/app.asar.unpacked/`.

**Observed:** 88 entries are declared `unpacked`; **6 are absent** from the payload. Equivalently, `require('@electron/asar').extractAll(archive, out)` throws:

```
Error: ENOENT: no such file or directory, open
  '…/app.asar.unpacked/node_modules/@napi-rs/canvas-win32-arm64-msvc/skia.win32-arm64-msvc.node'
```

**Expected:** the asar header describes the payload. Either the pruned files keep their entries and are shipped, or their entries are pruned along with the files, so a whole-archive extraction completes.

Frequency: deterministic, 1/1 on this artifact; the header/payload comparison is a static property of the package, not a timing-dependent one.

## Evidence and execution path

| Timestamp / revision | Evidence locator | Observation | What it does not prove |
|---|---|---|---|
| `0.4.3-moe.30` / `40cfe727` | `moe30-package-receipts/04-extract.json` → `asarExtraction.unpackedDeclaredButAbsent` | 6 of 88 declared-unpacked entries absent: `@napi-rs/canvas-darwin-arm64`, `canvas-darwin-x64` and `canvas-win32-arm64-msvc`, each contributing `package.json` + `skia.*.node` | Nothing about installed behaviour, and nothing about other candidates |
| same | first verification run, preserved as a failed attempt | `asar.extractAll` aborts with `ENOENT` on the first absent entry | That the archive is corrupt — the packed entries all read correctly afterwards |
| same | `7zz l` of the inner payload | Only `win32-x64` and `darwin` **nested** canvas copies are present; top-level `canvas-darwin-*` and `canvas-win32-arm64-msvc` are gone | Which build step performed the pruning |
| same | packaged `node_modules/@napi-rs/canvas/js-binding.js`, extracted from the asar | Resolver branches on `process.platform`/`process.arch`; 57 `try` blocks, 26 arch checks; the Windows x64 branch loads `./skia.win32-x64-msvc.node`, **present** in the payload | That no other consumer enumerates unpacked entries eagerly |

Execution path of the failure: **artifact verification tooling** → `@electron/asar` header walk → per-entry read → for an `unpacked` entry, read from `app.asar.unpacked/<path>` → `ENOENT`. The product path is separate and does not fail: **Main/extension `require('@napi-rs/canvas')`** → `js-binding.js` → `process.platform === 'win32' && process.arch === 'x64'` → `./skia.win32-x64-msvc.node` → present.

The inconsistency is also incomplete rather than uniform: the nested duplicates under `@napi-rs/canvas/node_modules/` and `pdf-parse/node_modules/pdfjs-dist/node_modules/` were **not** pruned and remain in the payload. Any fix should explain that asymmetry rather than only deleting header rows.

## Cause and confidence

**Confirmed.** `electron-builder.yml` sets `asarUnpack: "**/*.node"`, so every native binding is recorded as `unpacked` in the asar header. The Windows x64 pack then removes foreign-architecture prebuilds from the payload, but the header entries written for them are not removed with the files. Result: the header advertises files the payload lacks. Confidence: **high** — both halves are directly observed in the shipped artifact, and the missing set is exactly the foreign-arch prebuilds, with no other category affected.

**Runtime impact on the pilot target: none, and this is verified rather than assumed.** The binding resolver selects by platform and architecture and guards every candidate `require`, and the x64 binding it selects is present. An x64 install never requests the absent files.

Competing hypothesis considered and rejected: that the archive or the download is corrupt. Rejected because the installer and `app.asar` hashes both match the build's own manifest, and all 12,528 packed entries read successfully — including the 172 compiled files, which compare byte-identical to an independent compile of the same revision.

Not investigated: whether `electron-builder` or a repository `afterPack` step performs the pruning. That distinction decides where the fix belongs and is the first thing the next owner should establish.

## Attempts, decisions and fix

| Attempt / commit | Change or experiment | Outcome | Decision / remaining limitation |
|---|---|---|---|
| moe.30 verification, first run | `asar.extractAll` on the packaged archive | **FAIL** (`ENOENT`) | Preserved as the discovery evidence rather than retried |
| `moe30-asar-extract.js` | Targeted extraction: walk the header, extract only packed entries under `dist`, `dist-electron` and `package.json`, and **report** the absent unpacked entries as data | **PASS** — 173 entries extracted, the mismatch recorded | Verification tooling repaired; the packaging defect itself is untouched |
| — | Deleting the stale header rows, or narrowing `asarUnpack` to the host architecture | **NOT_RUN** | Deliberately not attempted. Both are release-packaging changes on a candidate already undergoing acceptance; changing packaging now would invalidate the verified artifact for no acceptance gain |

Write ownership: verification tooling lives in the private candidate artifact directory and is owned by the release lane. `electron-builder.yml` was **not** modified.

## Verification and acceptance

| Criterion | Command / action | Revision / environment | Result | Evidence | Remaining gap |
|---|---|---|---|---|---|
| Header/payload mismatch exists | header walk vs `app.asar.unpacked/` | `0.4.3-moe.30` package, macOS host | **FAIL** (6 of 88 absent) — the defect is present | `04-extract.json` | — |
| Whole-archive extraction | `asar.extractAll` | same | **FAIL** `ENOENT` | first verification run | — |
| Negative control: packed entries intact | extract 173 packed entries incl. all compiled output | same | **PASS** | `04-extract.json`, `06-compiled-comparison.json` | — |
| Negative control: artifact not corrupt | installer and asar SHA256 vs the build's manifest | same | **PASS**, both match | `02-artifact-bytes.json`, `release-manifests/0.4.3-moe.30.json` | — |
| Runtime binding resolves on x64 | static read of the packaged `js-binding.js` and payload presence of `skia.win32-x64-msvc.node` | same | **PASS** (static) | this report | Not confirmed on an installed Windows run; that requires the blocked QA desktop |
| Any other consumer affected | — | — | **NOT_RUN** | — | No search was made for product code that enumerates unpacked entries |
| Fix verified | — | — | **NOT_RUN** | — | No fix proposed |

Independent review: **not yet obtained.** This report is authored by the release lane that found the defect; no reviewer has confirmed it, and the author's own checks cannot approve it. The static no-runtime-impact conclusion in particular deserves a second reader.

## Resume here

- Durable evidence: candidate `0.4.3-moe.30`, source `40cfe727f38d1b29c4f5ff77e1eddba97556061f`, branch `release/moe30-integration`. Receipts in the private artifact directory `moe30-package-receipts/` (`04-extract.json` holds the exact absent list). Extracted payload under `/private/tmp/clawx-moe30-artifact/`, which is disposable.
- First next action: determine **where** the foreign-arch pruning happens — `electron-builder`'s own arch filtering or a repository `afterPack` hook — and whether it can remove the header entries with the files. Stop condition: the pruning step is named with a file and line.
- Then: decide between narrowing `asarUnpack` and pruning header entries. This is a release-owner decision because it changes packaging on a line that is under acceptance; it should not ride along with an unrelated change.
- Independent: nothing here blocks the moe.30 acceptance path. Do **not** rebuild the candidate for this defect alone.
- Required authority: release owner for any `electron-builder.yml` change. No account, credential or VM access is needed to reproduce or to fix.
- Do not repeat: `asar.extractAll` on this package (it fails by design of the defect — use targeted extraction); re-verifying the installer or asar hashes (both already match the manifest); assuming a corrupt download.
