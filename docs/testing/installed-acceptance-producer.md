# Installed acceptance producer — version-parameterized invocation

Scope: how to run the Windows installed-acceptance evidence producer for **any**
candidate, and what its exit codes mean. This is a how-to-invoke runbook only;
current candidate identity lives in `docs/CURRENT_WINDOWS_RC.md`, acceptance
verdicts in `docs/GA_RELEASE_EVIDENCE_MANIFEST.md`, and the VM/lane procedure in
`windows-pilot/vm-testing/README.md`. Running the producer requires the single
authorized VM operator window; nothing here authorizes a VM, install or cloud
action.

## Entrypoints

| Command | Use |
|---|---|
| `scripts/vm-verify-installed.sh` | Every candidate. **Requires** `--exe`, `--version` and `--manifest`; inherits no candidate identity, and an explicitly empty `--exe=`/`--version=`/`--manifest=` is a config error, never a fall-through. |
| `scripts/vm-verify-moe19.sh` | The engine. Retained for the historical moe.19 invocation and existing references; with no arguments at all it still resolves the moe.19 installer, guest object `moe19.exe`, `…/moe19/` bucket prefix and the `moe.19` FileVersion assert. Any non-legacy invocation requires `--manifest`. |

Both run the same phases and emit the same evidence layout consumed by
`scripts/installed-release-evidence.mjs` (`vm-run.json`, `environment.json`,
`install-artifacts.json`, `packages-nscc-presence.txt`, `gateway-smoke.txt`,
`electron-probe-run.txt`, `office-runtime.txt`, `office-write.txt`, plus the
current-run `clawx-electron-probe-*.json`).

## Parameters

| Flag | Default | Notes |
|---|---|---|
| `--exe <path>` | moe.19 installer (legacy invocation only) | Must be paired with `--version`; a partial or explicitly empty identity is a config error. |
| `--version <app-version>` | `0.4.3-moe.19` (legacy only) | Must appear in the installer filename as the delimited token `-<version>-win` (the electron-builder shape `…-<version>-win-x64.exe`); a bare substring never binds, so `0.4.3-moe.3` refuses `…moe.30…` and `0.4.3` refuses any `0.4.3-*` pre-release. `[A-Za-z0-9.-]+`. |
| `--manifest <release-manifest.json>` | none (legacy); **required otherwise** | The exact identity contract: manifest `version`, installer `name` and installer `sha256` are equality-checked against `--version` and the local artifact before any cloud call. |
| `--guest-exe-name <name>.exe` | `clawx-installer-<version>.exe` (`moe19.exe` legacy) | Guest `Downloads` object name; also written to `vm-run.json` `installer.guestPath`. |
| `--gcs-dest gs://bucket/prefix/` | `gs://clawx-rc-artifacts-622687731621/<version>/` | Upload is skipped when the exact installer basename is already listed. |
| `--expect-file-version <token>` | `<version>` (`moe.19` legacy) | Delimiter-anchored token assert against on-disk and **running-process** FileVersion: it must appear whole, not as a prefix of a longer version (`moe.3` never accepts `moe.30`), and must contain a digit. Real installed FileVersions are the full semver string (moe.15/17/18/20 evidence), and `installed-release-evidence.mjs` compares `runningApp.version` to the manifest version exactly, so keep this the full version unless the packaged FileVersion legitimately differs. |
| `--print-config` | off | Resolve + validate only, print JSON, exit. No gcloud/gsutil/SSH/install action and no evidence directory. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Scripted phases green, or a valid `--print-config` resolution. |
| 1 | FAIL — a product/phase assertion failed (guest hash mismatch, installer exit, FileVersion assert, missing bundled package or NSCC pack, producer failure). |
| 2 | Config or identity mismatch, fail-closed: partial/unknown arguments, explicitly empty `--exe=`/`--version=`, unsafe or digit-free assert values, filename/version token disagreement, a missing `--manifest` on a non-legacy invocation, or any manifest version/name/sha256 disagreement. Nothing is uploaded or installed. |
| 3 | BLOCKED — environment gate (installer absent, expired gcloud credentials, VM not running, tunnel/CDP/interactive-session prerequisites). Never a pass. |

## Dry-run check before an operator window

```bash
bash scripts/vm-verify-installed.sh --print-config \
  --exe "release/Ministry of Education-<version>-win-x64.exe" \
  --version <version> \
  --manifest docs/release/<manifest>.json
```

Exit 0 with `"status": "OK"` means installer, version, guest object, bucket
prefix and manifest hash agree. Exit 2 means the pairing is wrong — fix the
inputs, never the assert. Exit 3 means the named artifact is not present in this
checkout.

## Rules that must not be relaxed

- Never accept a mismatched version or hash: the both-hop installer sha256, the
  required `--manifest` equality check and the delimiter-anchored running-binary
  FileVersion assert are the identity binding between source, artifact and
  receipt. A wrong pairing fails closed (exit 2); it is never inferred from a
  substring.
- Missing evidence stays `NOT_RUN`/`BLOCKED`; a synthesized PASS is a defect.
- `--print-config` is a configuration check, not acceptance. Installed
  acceptance requires the real phases plus the interactive checklist the run
  writes to `INTERACTIVE_CHECKLIST.md`.
- Windows Server results are not Windows 10/11 standard-user proof, and no
  producer run substitutes for the unaided stakeholder rerun.

Focused coverage: `tests/unit/vm-verify-version-parameters.test.ts` (argument,
validation and manifest behaviour via `--print-config`, with negative controls)
and `tests/unit/vm-evidence-collector.test.ts` (phase ordering and evidence
collection).
