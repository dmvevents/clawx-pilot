# Windows local VM testing for ClawX / Ministry

This runbook explains how to use a local Windows VM from the Mac as a repeatable diagnostic lane for ClawX Windows installers and runtime journeys. It also records the current evidence state so future agents do not confuse a proposed local VM lane with the verified GCP Windows VM lane.

## Current evidence, September 8 2026

| Layer | Status | Evidence | What it proves | What it does not prove |
| --- | --- | --- | --- | --- |
| Local Mac Windows-like harness | AVAILABLE | Repo tests and harness can run with Windows-like paths and packaged-output checks. Existing guidance is [windows-emulation-testing.md](../../windows-pilot/skills/windows-emulation-testing.md). | Fast source-level and packaging-adjacent regressions: path handling, stores, renderer/Electron tests, package manifests. | It is not Windows. It does not prove NSIS install behavior, Windows file locks, Chrome on Windows, RDP/interactive session behavior, ASR helper execution, or installed runtime startup. |
| Local macOS virtualization | AVAILABLE PREREQUISITE, VM NOT FOUND/NOT_RUN | Read-only audit found `/Applications/UTM.app`, `/opt/homebrew/bin/utmctl`, `qemu-system-aarch64`, and `qemu-system-x86_64`. `utmctl --help`, `utmctl list --help`, and `utmctl list` completed within a 10 second timeout; `utmctl list` returned only `UUID Status Name`. The UTM preferences registry contains one stale non-Windows entry whose bundle is absent. The default UTM documents root exists, but only `Public` was present under `~/Library/Containers/com.utmapp.UTM/Data/Documents`. | The Mac has the UTM/QEMU prerequisite tools for a local VM lane, but no current usable registered UTM Windows guest is available to run. | No local Windows guest was started, stopped, installed, or verified in this audit. Do not claim current local VM acceptance from this state. |
| Existing GCP Windows VM | VERIFIED CURRENT WINDOWS LANE | [windows-pilot/vm-testing/README.md](../../windows-pilot/vm-testing/README.md) records `clawx-win-rc-20260609` and the September 8 IAP/SSH/RDP workflow. | Installed Windows Server evidence, standard-user profile testing, visible install/upgrade, RDP, SSH, Electron CDP, app journeys under root control. | It is cloud Windows Server, not a local Mac VM and not a clean physical Windows laptop. |
| Physical stakeholder/pilot machine | SEPARATE ACCEPTANCE | Stakeholder runs or pilot-laptop runs produce external-tester evidence. | Real user's machine, tenant, microphone, network, and Chrome state. | It is slower and less controllable; use only after package/source confidence is adequate. |

Conclusion: we have used the **GCP cloud VM effectively**. We have a **local UTM capability**, but this audit did not find a ready local Windows VM image, so local VM testing remains `NOT_RUN` until a guest exists and is proven with environment/install/runtime evidence.

## When to use the local VM lane

Use a local Windows VM after source tests and before cloud/stakeholder reruns when the failure might involve Windows packaging or runtime behavior:

- NSIS install/upgrade and desktop shortcut behavior.
- `%APPDATA%`, `%LOCALAPPDATA%`, `%USERPROFILE%`, OneDrive folder discovery, and file locks.
- Packaged resources: `resources/bin`, `resources/extensions`, `resources/openclaw-plugins`, `app.asar`.
- Gateway startup, Host API bridge, Electron CDP, and app-window readiness.
- Windows Chrome/CDP attach and Outlook/Forms browser automation when a signed-in profile is available.
- Standard-user installation without developer dependencies.

Do not use it as the final proof for:

- GA or pilot release readiness.
- Physical microphone quality and classroom audio.
- Stakeholder tenant/account-specific Microsoft Conditional Access behavior.
- Fleet rollout device policy.

## Fidelity notes for Apple Silicon Macs

UTM on Apple Silicon should use a Windows 11 ARM64 guest. UTM documents `arm64` for Apple Silicon and `amd64` for Intel Macs, and its QEMU system settings state that virtualization requires the guest architecture to match the host architecture. Microsoft documents Windows 11 Arm64 ISO files as usable for local-device virtual machines for development. In this repo, the historical bootstrap path is [docs/UTM_WINDOWS_SETUP.md](../UTM_WINDOWS_SETUP.md); it remains a setup recipe, not current acceptance evidence.

The ClawX Windows installer we test is x64. On Apple Silicon, that means the guest is Windows on Arm and the app runs through Windows' x64 compatibility layer; on an Intel Mac, use an x64 Windows guest for an x64 installer. Treat findings this way:

- PASS on local ARM64 Windows with x64 emulation is useful diagnostic evidence, not physical-laptop acceptance.
- FAIL on local ARM64 Windows is actionable when the failing component is architecture-neutral: installer files, app config, JS runtime, Host API, Gateway startup, document tools, or Chrome/CDP orchestration.
- Native helper behavior needs explicit architecture context. ASR is deferred unless the test is specifically about helper presence or a reviewed ASR fixture. Physical audio still needs cloud VM with configured devices or the real laptop.

## Local guest bootstrap path

Use [docs/UTM_WINDOWS_SETUP.md](../UTM_WINDOWS_SETUP.md) as the repo-local bootstrap recipe when no registered local VM exists. Use the [official UTM Windows guide](https://docs.getutm.app/guides/windows/), [UTM QEMU system settings](https://docs.getutm.app/settings-qemu/system/), [Microsoft Windows 11 download page](https://www.microsoft.com/en-us/software-download/windows11), and [Microsoft Windows 11 Arm ISO overview](https://learn.microsoft.com/en-us/windows/arm/iso) for current platform behavior.

For this workspace on September 8 2026, the bootstrap status is `NOT_RUN`: UTM and QEMU are installed, but UTM reports no usable registered Windows guest. The next local VM work should create or import a Windows guest, record host and guest architecture, then verify the environment receipt before proceeding through the ClawX install/test loop below.

## Prerequisite record before first run

For a new or imported local Windows VM, record these facts before installing ClawX:

- Hypervisor and version: UTM/Parallels/VMware/VirtualBox/QEMU.
- Guest OS, build, architecture, CPU/RAM/disk allocation, graphics/audio devices.
- Network mode and whether guest has outbound Internet.
- Interactive desktop resolution.
- Test account name class only: administrator or standard user. Do not write passwords in repo docs.
- SSH/RDP availability and local tunnel ports if used.
- Chrome installation state and version.
- Existing `%APPDATA%\Ministry of Education`, `%LOCALAPPDATA%\Programs\Ministry of Education`, and `%USERPROFILE%\.openclaw` state.

Use [pilot-fresh-install-environment.ps1](../../windows-pilot/scripts/pilot-fresh-install-environment.ps1) where possible and save the JSON under a dated private artifact directory outside git.

## Checked command examples

These examples show the command shapes checked against the current script parameters on September 8 2026. Replace `<windows-ssh-alias>`, `<run-id>`, `<candidate.exe>`, and paths for the actual run. Do not run mutation commands while another owner controls the VM.

### Host inventory and guest discovery

Run this from the Mac. It is read-only and bounds `utmctl` calls so a hung registry query does not block the session:

```bash
python3 - <<'PY'
import subprocess
for cmd in (['utmctl', '--help'], ['utmctl', 'list', '--help'], ['utmctl', 'list']):
    try:
        p = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        print('CMD:', ' '.join(cmd), 'RC:', p.returncode)
        print(p.stdout.strip() or '(no stdout)')
        if p.stderr.strip():
            print('STDERR:', p.stderr.strip())
    except FileNotFoundError:
        print('MISSING:', cmd[0])
    except subprocess.TimeoutExpired:
        print('TIMEOUT:', ' '.join(cmd))
PY
```

The current audit result was `utmctl list` header-only, plus a stale non-Windows entry in the UTM preferences registry whose package path is missing. No usable registered UTM Windows guest was visible.

### Transfer installer and reviewed script tools

Use an already configured local VM SSH alias or IP. The transfer changes the guest Downloads folder, so keep it under the single mutator lane. The later guest commands require the reviewed `windows-pilot/scripts` files; stage those from the selected source SHA with `git archive` instead of requiring a full developer checkout inside the guest.

```bash
SELECTED_SHA=<reviewed-source-sha>
RUN_ID=clawx-localvm-YYYYMMDD-HHMMSS
INSTALLER=/absolute/path/to/Ministry.of.Education-0.4.3-moe.NN-win-x64.exe
INSTALLER_NAME=$(basename "$INSTALLER")
TOOLS_TAR=/tmp/clawx-windows-pilot-scripts-$SELECTED_SHA.tar

git archive --format=tar --output="$TOOLS_TAR" "$SELECTED_SHA" windows-pilot/scripts
shasum -a 256 "$INSTALLER" "$TOOLS_TAR"

ssh <windows-ssh-alias> "powershell -NoProfile -Command \"New-Item -ItemType Directory -Force -Path (Join-Path \$env:USERPROFILE 'Downloads\\$RUN_ID') | Out-Null\""
scp "$INSTALLER" <windows-ssh-alias>:"Downloads/$RUN_ID/$INSTALLER_NAME"
scp "$TOOLS_TAR" <windows-ssh-alias>:"Downloads/$RUN_ID/windows-pilot-scripts.tar"

ssh <windows-ssh-alias> "powershell -NoProfile -Command \"\$run = Join-Path \$env:USERPROFILE 'Downloads\\$RUN_ID'; \$tools = Join-Path \$run 'tools'; New-Item -ItemType Directory -Force -Path \$tools | Out-Null; tar.exe -xf (Join-Path \$run 'windows-pilot-scripts.tar') -C \$tools; \$installer = Join-Path \$run '$INSTALLER_NAME'; Get-FileHash -LiteralPath \$installer -Algorithm SHA256 | Select-Object Algorithm,Hash,Path | ConvertTo-Json -Compress\""
```

Compare the guest installer hash and tools archive hash to the hosted package/source receipt before installing. In later guest PowerShell examples, run from `$ToolsRoot`, where `$ToolsRoot = Join-Path $env:USERPROFILE "Downloads\<run-id>\tools"`, so script paths such as `.\windows-pilot\scripts\pilot-fresh-install-environment.ps1` resolve without a full checkout.

### Environment probe and state backup

`pilot-fresh-install-environment.ps1` supports `-Mode Probe`, `-ArtifactRoot`, `-InstallerPattern`, `-JsonOutputPath`, and `-OpenSandbox`. Use `Probe` for observation before any install:

```powershell
$RunId = "clawx-localvm-YYYYMMDD-HHMMSS"
$RunRoot = Join-Path $env:USERPROFILE ("Downloads\" + $RunId)
$Evidence = Join-Path $RunRoot "evidence"
$ToolsRoot = Join-Path $RunRoot "tools"
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null
Set-Location $ToolsRoot
& .\windows-pilot\scripts\pilot-fresh-install-environment.ps1 `
  -Mode Probe `
  -ArtifactRoot $Evidence `
  -JsonOutputPath (Join-Path $Evidence "fresh-install-environment.json")
```

Before upgrade or repair, back up `%APPDATA%\Ministry of Education` and `%USERPROFILE%\.openclaw` or record that they are absent. The backup action is a VM mutation and belongs to the same mutator.

### Visible installer first; silent branch only for diagnostics

For acceptance or stakeholder-facing proof, run the normal visible installer in the interactive Windows session and record its process exit plus installed hashes. Silent `/S` installs are diagnostic only and have failed historically; do not use them as final install acceptance.

```powershell
$RunId = "clawx-localvm-YYYYMMDD-HHMMSS"
$RunRoot = Join-Path $env:USERPROFILE ("Downloads\" + $RunId)
$Evidence = Join-Path $RunRoot "evidence"
$ToolsRoot = Join-Path $RunRoot "tools"
$Installer = Join-Path $RunRoot "<candidate.exe>"
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null
Set-Location $ToolsRoot

$proc = Start-Process -FilePath $Installer -ArgumentList @("/CURRENTUSER") -PassThru -Wait
[pscustomobject]@{ Installer = $Installer; ExitCode = $proc.ExitCode } |
  ConvertTo-Json -Compress |
  Out-File -Encoding utf8 (Join-Path $Evidence "visible-installer-exit.json")

& .\windows-pilot\scripts\pilot-check-install-artifacts.ps1 |
  Out-File -Encoding utf8 (Join-Path $Evidence "install-artifacts-after-visible-installer.json")
```

If the owner needs a diagnostic unattended run, call the helper with PowerShell array semantics from an already running PowerShell process. Do not pass `@("/S", "/currentuser")` through `powershell -File`, because that is parsed as command-line text rather than the intended array.

```powershell
$script = Join-Path $ToolsRoot "windows-pilot\scripts\pilot-run-silent-install.ps1"
& $script `
  -InstallerPath $Installer `
  -EvidenceRoot $Evidence `
  -TimeoutSeconds 1800 `
  -InstallerArgs @("/S", "/currentuser")
```

Add `-StopRunningApp` only when the mutator intentionally owns closing the existing app.

### Installed package, helper, and Office checks

`pilot-check-install-artifacts.ps1` accepts `-InstallDir`; by default it checks `%LOCALAPPDATA%\Programs\Ministry of Education` plus desktop/start-menu shortcuts, `app.asar`, `ffmpeg.exe`, `WinSpeechRecognize.exe`, packaged browser/runtime resources, and secret files as metadata-only rows.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-check-install-artifacts.ps1 |
  Out-File -Encoding utf8 (Join-Path $Evidence "install-artifacts.json")

powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-office-runtime-check.ps1 |
  Out-File -Encoding utf8 (Join-Path $Evidence "office-runtime.txt")

powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-office-write-smoke.ps1 |
  Out-File -Encoding utf8 (Join-Path $Evidence "office-write-smoke.txt")
```

`pilot-office-runtime-check.ps1` optionally accepts `-ExcelPath` and `-PowerPointPath`; use those only when the run has explicit fixture files.

### Shortcut launch, Electron CDP, and browser CDP

For direct shortcut evidence, `pilot-shell-launch-shortcut.ps1` supports `-ShortcutPath` and `-WaitSeconds` and uses the logged-in Windows shell to open `%USERPROFILE%\Desktop\Ministry of Education.lnk`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-shell-launch-shortcut.ps1 `
  -ShortcutPath (Join-Path $env:USERPROFILE "Desktop\Ministry of Education.lnk") `
  -WaitSeconds 20 |
  Out-File -Encoding utf8 (Join-Path $Evidence "shortcut-launch.txt")
```

For app-level CDP smoke, `pilot-launch-and-run-cdp-smoke.ps1` supports `-ElectronCdpPort`, `-StartupTimeoutSeconds`, `-ArtifactRoot`, `-AppExe`, `-OutlookOnly`, and `-StopExisting`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-launch-and-run-cdp-smoke.ps1 `
  -ElectronCdpPort 9223 `
  -StartupTimeoutSeconds 240 `
  -ArtifactRoot $Evidence
```

Use `-StopExisting` only when the mutator owns app closure. The wrapper launches the installed app and runs the existing Electron CDP probe.

For Microsoft tenant acceptance, use the installed app's user-Chrome/browser-manager path and require evidence that Outlook or Forms is authenticated in the intended user Chrome context. `pilot-launch-cdp-task.ps1` supports `-WaitSeconds`, `-TaskName`, and `-DemoDir`, but it launches a separate demo Chrome profile through Task Scheduler. That helper is useful for isolated Chrome/CDP diagnostics; it is not final Outlook/Forms tenant proof. Chrome CDP repair is a mutation and belongs to the same controller.

A direct Electron probe is available when the app is already running with CDP:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-run-electron-cdp-probe.ps1 `
  -Endpoint http://127.0.0.1:9223 `
  -OutlookSmoke `
  -FormsSmoke `
  -WaitMs 5000 `
  -ArtifactDir $Evidence
```

Do not use `-SendEmail`, `-SubmitForms`, or message-bearing flags unless the exact side effect has same-session explicit confirmation.

### Ordinary first and warm chat turns

`pilot-run-chat-turn.ps1` sends one real chat prompt through the installed renderer and supports `-Prompt`, `-CdpPort`, `-StartupTimeoutSeconds`, `-TurnTimeoutSeconds`, `-ExpectedChannel`, `-TerminalQuietSeconds`, `-OutDir`, `-NewSession`, and `-NoRelaunch`:

```powershell
$ChatEvidence = Join-Path $Evidence "chat-first"
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-run-chat-turn.ps1 `
  -Prompt "In two sentences, confirm you are ready to help a school principal." `
  -CdpPort 9223 `
  -StartupTimeoutSeconds 240 `
  -TurnTimeoutSeconds 180 `
  -ExpectedChannel online `
  -TerminalQuietSeconds 30 `
  -OutDir $ChatEvidence `
  -NewSession

$WarmEvidence = Join-Path $Evidence "chat-warm"
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows-pilot\scripts\pilot-run-chat-turn.ps1 `
  -Prompt "In one sentence, say what file and form tasks you can help with." `
  -CdpPort 9223 `
  -StartupTimeoutSeconds 60 `
  -TurnTimeoutSeconds 180 `
  -ExpectedChannel online `
  -TerminalQuietSeconds 30 `
  -OutDir $WarmEvidence `
  -NoRelaunch
```

Use `-NoRelaunch` only after the interactive session already launched the real shortcut with CDP. Document whether the run was first-start or warm-start.

### Return evidence to the Mac

Return only redacted receipts and probe outputs. Keep raw logs/private screenshots in a private artifact store unless reviewed for disclosure.

```bash
mkdir -p artifacts/windows-local-vm/<run-id>
scp -r <windows-ssh-alias>:"Downloads/<run-id>" artifacts/windows-local-vm/<run-id>/guest-downloads
find artifacts/windows-local-vm/<run-id> -maxdepth 3 -type f -print0 | xargs -0 shasum -a 256 > artifacts/windows-local-vm/<run-id>/returned-sha256.txt
```


## One-controller rule

Only one controller mutates the VM at a time. Guest file transfer, tool staging, installation, app launch, app quit, Gateway restart, Chrome repair, setup bundle execution, and profile backup are VM mutations. Coordinate those through the current root owner. Other agents may prepare source, artifact hashes, commands, and read-only analysis without touching the guest.

Read-only observation is still bounded: do not dump private logs, email bodies, recipient lists, keys, Form URLs, Host API tokens, or Chrome command lines. Redact before storing anything in repo docs.

## End-to-end diagnostic loop

### 1. Select the candidate

Bind the run to an exact source SHA and installer hash before entering Windows. Use the hosted package receipt or release manifest. Do not choose “latest” by filename.

Minimum source/package receipt:

- Git commit and branch.
- Version string.
- Installer filename, byte size, SHA-256.
- `app.asar` SHA-256 and version.
- Packaged app EXE SHA-256.
- Build profile, especially whether it is `keyless-public` or seeded-private.
- Manifest/provenance path.

### 2. Transfer candidate and reviewed tools through one mutator

Preferred local VM paths:

- UTM shared directory mounted read-only for the installer, followed by a copy into the guest run folder when the mutator begins.
- `scp` into a dated run folder if OpenSSH Server is configured.

Stage the installer and the reviewed `windows-pilot/scripts` bundle together. The recommended source-controlled tools bundle is `git archive <selected-sha> windows-pilot/scripts`, extracted under the guest run folder. After transfer, hash the guest installer copy and tools archive and compare them to the manifest/source receipt. A successful copy alone is not candidate proof.

### 3. Snapshot and backup user state

Before install, upgrade, or setup repair:

- Capture environment JSON.
- Back up `%APPDATA%\Ministry of Education` if present.
- Back up `%USERPROFILE%\.openclaw` if present.
- Record backup file counts and hashes. An absent directory is a recorded observation, not proof of a clean machine image.

For upgrade tests, preserving existing app data and `.openclaw` is part of the test. For clean-profile tests, create or restore a known standard-user snapshot rather than deleting state ad hoc.

### 4. Install or upgrade through one mutator

Use one explicit mutator path for the run. Acceptance should use the normal visible installer in the interactive user session; silent `/S` is diagnostic-only evidence.

Existing scripts to prefer when they fit the exact candidate:

- [pilot-run-silent-install.ps1](../../windows-pilot/scripts/pilot-run-silent-install.ps1) for silent installer diagnostics only.
- [pilot-check-install-artifacts.ps1](../../windows-pilot/scripts/pilot-check-install-artifacts.ps1) for installed file/hash inventory.
- [pilot-probe-install-process.ps1](../../windows-pilot/scripts/pilot-probe-install-process.ps1) for installer process state.

Interactive acceptance needs normal screens and desktop shortcut proof. Silent install is a diagnostic shortcut, not a replacement for visible install acceptance.

### 5. Launch the actual installed shortcut in the interactive desktop

Start from the Windows desktop session, not a headless SSH-only process, when testing user-visible behavior. Confirm:

- The process path is the installed app under `%LOCALAPPDATA%\Programs\Ministry of Education`.
- The launched app version and ASAR hash match the selected candidate.
- Desktop shortcut target is the installed app.
- Gateway and composer reach stable readiness.
- No stale Gateway/app process from a previous candidate is answering.

Electron CDP inspection can be exposed on a loopback debug port for diagnostics, but the port itself is not readiness. Use the existing Electron CDP probe and require Host API bridge evidence.

### 6. Run package/runtime probes before model-driven journeys

Use existing probes before asking the model to use tools:

- [pilot-check-install-artifacts.ps1](../../windows-pilot/scripts/pilot-check-install-artifacts.ps1) — installed files, ASAR, helper presence.
- [pilot-office-runtime-check.ps1](../../windows-pilot/scripts/pilot-office-runtime-check.ps1) — bundled document/runtime dependencies.
- [pilot-office-write-smoke.ps1](../../windows-pilot/scripts/pilot-office-write-smoke.ps1) — DOCX/XLSX write/read round trip.
- [pilot-run-electron-cdp-probe.ps1](../../windows-pilot/scripts/pilot-run-electron-cdp-probe.ps1) with safe options — renderer Host API and UI bridge.
- [pilot-probe-state.ps1](../../windows-pilot/scripts/pilot-probe-state.ps1) — app/Gateway/process state.

A probe that only shows a listening port or an enabled composer is partial evidence. Chat acceptance needs terminal send/run/recovery/result signals.

### 7. Run ordinary app journeys

Use the same user-facing journeys tracked in release evidence:

- First Online chat turn: realistic short prompt, expected channel Online, terminal answer, no fallback, no stale replay, no late error.
- Warm Online chat turn in the same session: confirms first-response repair and cache/startup behavior.
- PDF summary: `document.read_pdf` called, source-grounded response preserves actionable obligations.
- DOCX summarize/rewrite/save: `document.read_docx`/`document.write_docx`, output file proof.
- XLSX update/save: `document.read_xlsx`/`document.write_xlsx`, output file proof.
- Image read: `document.read_image`; if the selected local model is text-only, report image understanding as unavailable or switch to Online according to product rules. Do not pretend text-only on-device inference proves vision.
- Reminder scheduling: explicit timezone/offset evidence.
- Outlook/Forms no-send/no-submit checks only when Chrome is signed in and CDP is ready.

No-send gates remain active:

- Outlook drafts may be opened for review; never send without explicit same-session confirmation.
- Forms may be previewed; never submit without explicit same-session confirmation.
- Attachment downloads and externally visible messages require explicit confirmation for that exact action.

### 8. Browser, RDP, SSH, and CDP handling

Use RDP for visual state and the actual interactive desktop. Use SSH for bounded PowerShell scripts and file return. Use Electron CDP for app renderer diagnostics. Use Chrome CDP only for Outlook/Forms browser automation.

Keep these facts separate:

- RDP protocol reachable.
- SSH authenticated command access.
- Interactive user session unlocked and visible.
- Electron app CDP attached to the app renderer.
- Chrome CDP attached to the signed-in user Chrome profile.
- Outlook/Forms authenticated and semantically ready.

Chrome/CDP repair is a mutation and belongs to the single VM controller. If Outlook reports sign-in needed, ask for sign-in in the opened Chrome window; do not script credentials or use managed Chromium as a tenant substitute.

### 9. ASR deferral

For local VM release diagnostics, defer ASR quality unless the test is specifically scoped to audio:

- Verify packaged helper presence and hashes with install artifact checks.
- Run helper smoke only if a reviewed fixture path exists.
- Do not claim microphone quality from UTM/Server VM unless a real audio device and capture path were tested.
- Physical audio remains a separate laptop/stakeholder acceptance item.

### 10. Return evidence

Every local VM run should return a redacted receipt with:

- Environment JSON path and hash.
- Candidate source SHA, installer SHA, ASAR SHA, packaged EXE SHA.
- Install/upgrade command or interactive action summary.
- Backup paths, counts, and hashes.
- Installed artifact inventory path.
- Runtime probe paths and results.
- Journey transcript review JSONs or redacted summaries.
- Screenshots/video only when they contain no sensitive tenant content or are stored in private artifacts.
- PASS / FAIL / BLOCKED / NOT_RUN per criterion.

Do not put credentials, private Form URLs, Host API tokens, email bodies, full recipient lists, raw private logs, or Chrome command lines into repo docs.

## Minimal first local VM proof checklist

Before treating local VM as effective, collect one dated run showing:

- `PASS` environment probe on the local guest.
- `PASS` installer transfer hash check.
- `PASS` state backup or documented absence.
- `PASS` install or upgrade.
- `PASS` installed artifact hash inventory.
- `PASS` desktop shortcut launch in interactive session.
- `PASS` Gateway/composer stable readiness.
- `PASS` first Online chat turn and warm Online turn with expected provider/channel.
- `PASS` document runtime smoke for DOCX/PDF/XLSX at minimum.
- `NOT_RUN` or `PASS` Outlook/Forms depending on signed-in Chrome availability.
- `NOT_RUN` for ASR unless specifically tested.

Until those exist, report local VM status as `AVAILABLE PREREQUISITE / NOT_RUN`, not “validated.”

## Relation to existing docs

- Current cloud VM entrypoint: [windows-pilot/vm-testing/README.md](../../windows-pilot/vm-testing/README.md).
- Historical UTM setup: [docs/UTM_WINDOWS_SETUP.md](../UTM_WINDOWS_SETUP.md).
- Historical physical install runbook: [docs/WINDOWS_INSTALL_RUNBOOK.md](../WINDOWS_INSTALL_RUNBOOK.md).
- Fast Mac approximation: [windows-pilot/skills/windows-emulation-testing.md](../../windows-pilot/skills/windows-emulation-testing.md).
- Project evidence rules: [docs/PROJECT_CONTRACT.md](../PROJECT_CONTRACT.md) and [harness/specs/rules/completion-evidence.md](../../harness/specs/rules/completion-evidence.md).
