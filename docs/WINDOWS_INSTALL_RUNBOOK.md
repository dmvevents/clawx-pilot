# Windows pilot install — historical moe.10 procedure

For current testing, use [Windows VM access, environment and visible outcomes](../windows-pilot/vm-testing/README.md) and [the current candidate](CURRENT_WINDOWS_RC.md). The commands below describe the earlier physical-laptop setup; they do not identify today's candidate or prove current VM access. Preserve host-key verification and existing user state in new runs.

**Target:** `vyonix@169.254.46.90` (pilot Windows 11, build 26100). Cat-5 link.
**Time:** ~15 min from clean state to working demo.

This archived procedure records the earlier moe.10 physical-laptop test. Its addresses, artifact selection and commands are historical examples, not instructions for the current test run. Follow the current testing entrypoint above and select the exact candidate hash before any installation.

---

## SSH multiplexer (one-time, this Mac side)

Speeds every subsequent ssh from 5s → 50ms. Already in `~/.ssh/config`:

```sshconfig
Host pilot
  HostName 169.254.46.90
  User vyonix
  ControlMaster auto
  ControlPath ~/.ssh/cm/%r@%h:%p
  ControlPersist 30m
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
```

Then every `ssh pilot ...` reuses the master TCP/auth.

---

## Step 0 — verify pilot is reachable

```bash
ssh pilot 'echo ok'
```

Expected: `ok`. If timeout, the link-local Cat-5 dropped. Re-seat the cable and `ifconfig | grep 169.254` on Mac to confirm self-IP.

---

## Step 1 — capture pre-state

Tells us what the pilot already has so we don't do redundant work:

```bash
ssh pilot 'powershell -NoProfile -c "
Get-ChildItem C:\Users\vyonix\AppData\Local\Programs -Directory | Select Name |
ConvertTo-Csv -NoTypeInformation
ollama list 2>&1 | Select-Object -First 3
Get-NetTCPConnection -State Listen -LocalPort 18789,13210,18792,11434 -ErrorAction SilentlyContinue |
Select LocalPort, OwningProcess | ConvertTo-Csv -NoTypeInformation
"'
```

Expected: Ministry of Education, Ollama, Python, Microsoft VS Code.

---

## Step 2 — kill any running gateway / app

Avoid mid-install lock-file fights. Three SIG variants because Win has no SIGTERM:

```bash
ssh pilot 'powershell -NoProfile -c "
Get-Process | Where-Object { \$_.ProcessName -match \"Ministry|Education|ClawX|openclaw\" } |
Stop-Process -Force -ErrorAction SilentlyContinue
\"Killed: \" + (Get-Process | Where-Object { \$_.ProcessName -match \"Ministry|Education\" }).Count
"'
```

---

## Step 3 — back up user state (NEVER delete it)

The principal's `openclaw.json` and chat history are sacred. Always back up before reinstall:

```bash
ssh pilot 'powershell -NoProfile -c "
$d = Get-Date -Format yyyyMMdd-HHmmss
$src = \"$env:USERPROFILE\.openclaw\"
$bk = \"$env:USERPROFILE\.openclaw.bak.$d\"
if (Test-Path $src) { Copy-Item $src $bk -Recurse -ErrorAction SilentlyContinue; \"backed up to: $bk\" } else { \"no .openclaw to back up\" }
"'
```

---

## Step 4 — uninstall the previous Ministry of Education

Use NSIS uninstaller, NOT manual delete. The NSIS uninstaller is in the install dir as `Uninstall Ministry of Education.exe`:

```bash
ssh pilot 'powershell -NoProfile -c "
$un = \"$env:LOCALAPPDATA\Programs\Ministry of Education\Uninstall Ministry of Education.exe\"
if (Test-Path $un) {
  Start-Process -FilePath $un -ArgumentList \"/S\",\"/CURRENTUSER\" -Wait
  \"uninstall complete\"
} else { \"no prior install\" }
"'
```

`/S` = silent. Removes program files + registry entries. **Keeps user data** (`%APPDATA%\Ministry of Education` and `%USERPROFILE%\.openclaw`) by design — that's why the backup in step 3 is belt-and-suspenders.

---

## Historical step 5 — acquire the June moe.10 artifact

The following packaging notes and command examples belong to the June moe.10 procedure. Do not use this section to select or install a current candidate. Use `docs/CURRENT_WINDOWS_RC.md`, its exact manifest hash and the current testing entrypoint instead. Historical workflow artifacts may have expired.

Release builds must include the managed online gateway seed. The manual
packaging workflow now fails by default unless these GitHub repository secrets
exist:

- `CLAWX_CLOUD_GATEWAY_CONFIG_JSON`: JSON matching `resources/cloud-gateway.example.json`
- `CLAWX_CLOUD_GATEWAY_KEY`: broker/client-scoped gateway key only, not an upstream provider key

For a release candidate that should use programmatic Outlook instead of Chrome
remote-debugging guidance, also set:

- `CLAWX_MICROSOFT_GRAPH_CONFIG_JSON`: JSON matching `resources/microsoft-graph.example.json`

For a release candidate or GA installer that should use high-quality cloud ASR
instead of relying on the weaker Windows local recognizer, also set:

- `CLAWX_AZURE_SPEECH_CONFIG_JSON`: JSON matching `resources/azure-speech.example.json`
- `CLAWX_AZURE_SPEECH_KEY`: Speech resource key only; keep it out of the JSON

This Graph config is not a secret; it contains only tenant/client/scopes. Use
the workflow input `requireMicrosoftGraphSeed=true` only after MoE IT returns
the Entra app registration. Until then, leave it optional and the installer
keeps the browser/CDP demo fallback.

Use the workflow input `requireAzureSpeechSeed=true` for GA packages where the
microphone must be cloud-first. If the Azure Speech seed is absent, pilot mode
still tries Azure first, sees no configured key, then falls back to Windows
native ASR and finally Whisper CLI when available.

The workflow writes those secrets into ignored `resources/cloud-gateway.json`
and `resources/cloud-gateway.key` files on the runner before packaging. The
installer should then first-run with the Online channel selected and the cloud
gateway as the default provider; a clean install falling back to `qwen2.5` is a
release-blocking packaging failure. When the Microsoft Graph seed is present,
the workflow also writes ignored `resources/microsoft-graph.json`, and the
packaged app should show Microsoft 365 as configured before sign-in. When the
Azure Speech seed is present, the workflow writes ignored
`resources/azure-speech.json` and `resources/azure-speech.key`; the app should
transcribe through Azure Speech before trying local ASR.

```bash
# HISTORICAL June example only; do not run for current acceptance.
# Select the recorded historical run ID, never the newest workflow run:
mkdir -p /tmp/moe10
gh run download <id> --repo dmvevents/clawx-pilot --name windows-installer-x64 --dir /tmp/moe10

# Push to pilot via SSH:
scp -o ProxyCommand=none /tmp/moe10/*.exe vyonix@169.254.46.90:/Users/vyonix/Downloads/
```

The June procedure also used `release/Ministry of Education-0.4.3-moe.10-win-x64.exe`. File presence alone is not candidate selection; do not substitute this historical file for the current manifest-bound installer.

---

## Historical step 6 — install the selected June artifact on pilot

The commands below illustrate the archived procedure only. Their wildcard/latest-file lookup must not be used for current acceptance; the current procedure requires one explicit installer path with its verified hash.

For a real tester or principal, use the normal assisted Windows installer
screens by double-clicking the downloaded `.exe`. Keep the default install
location and desktop shortcut enabled.

For automation-only smoke tests, the hidden NSIS `/S /CURRENTUSER` path is a
diagnostic helper, not user-facing release proof. On busy VM/WinRM sessions it
can stall after copying a partial tree. If that happens, mark the automation
path red and rerun proof from an interactive desktop/RDP install before
claiming visual acceptance.

```bash
ssh pilot 'powershell -NoProfile -c "
$exe = Get-ChildItem \"$env:USERPROFILE\Downloads\Ministry of Education-*-win-x64.exe\" |
  Sort-Object LastWriteTime -Descending | Select -First 1
\"installing: $($exe.Name)\"
$p = Start-Process -FilePath $exe.FullName -ArgumentList \"/S\",\"/CURRENTUSER\" -Wait -PassThru
\"exit: $($p.ExitCode)\"
"'
```

Expected for the automation helper: `exit: 0` plus
`%LOCALAPPDATA%\Programs\Ministry of Education\Ministry of Education.exe`
present. If you see a timeout, a partial install tree, or the app exe is
missing, do not treat the VM as green. Use
`windows-pilot/scripts/pilot-run-silent-install.ps1` to capture process and
install-tree evidence, then switch to an assisted desktop/RDP install or fix
the NSIS silent path.

---

## Step 7 — verify install dir

```bash
ssh pilot 'powershell -NoProfile -c "
$d = \"$env:LOCALAPPDATA\Programs\Ministry of Education\"
if (Test-Path $d) {
  Get-Item \"$d\Ministry of Education.exe\" | Select Name, Length, LastWriteTime
  Get-ChildItem \"$d\resources\extensions\" -Directory | Select Name
} else { \"NOT INSTALLED: $d missing\" }
"'
```

Expected: `Ministry of Education.exe` present (~250 MB), and `resources\extensions\` contains `microsoft-graph` + `moe-principal-assistant`.

---

## Step 8 — pre-flight: Ollama running with qwen2.5:3b-instruct

```bash
ssh pilot 'powershell -NoProfile -c "
ollama list 2>&1
if (-not (ollama list 2>&1 | Select-String \"qwen2.5:3b-instruct\")) {
  \"pulling qwen2.5:3b-instruct (1.9 GB)…\"
  ollama pull qwen2.5:3b-instruct
}
# Make sure the daemon is up
$svc = Get-Process ollama -ErrorAction SilentlyContinue
if (-not $svc) { Start-Process ollama -ArgumentList \"serve\" -WindowStyle Hidden; Start-Sleep 3 }
\"ollama daemon: \" + (Test-NetConnection 127.0.0.1 -Port 11434 -InformationLevel Quiet -WarningAction SilentlyContinue)
"'
```

Expected: ollama list shows `qwen2.5:3b-instruct`, port 11434 = True.

---

## Step 9 — launch the app

NSIS installed to per-user; launch via Explorer (NOT terminal — Electron GUI doesn't render right from SSH):

```bash
ssh pilot 'powershell -NoProfile -c "
# Start in detached mode so it survives the SSH session
$exe = \"$env:LOCALAPPDATA\Programs\Ministry of Education\Ministry of Education.exe\"
Start-Process -FilePath $exe -WindowStyle Hidden
Start-Sleep 18
\"PIDs: \" + ((Get-Process | Where-Object { $_.ProcessName -eq \"Ministry of Education\" }).Id -join \",\")
\"Ports:\"
Get-NetTCPConnection -State Listen -LocalPort 18789,13210 -ErrorAction SilentlyContinue |
  Select LocalAddress, LocalPort, OwningProcess
"'
```

Expected: ≥3 PIDs (main + GPU + network helpers), both 18789 and 13210 listening.

---

## Step 10 — verify the gateway is RPC-ready

```bash
ssh pilot 'powershell -NoProfile -c "
$tail = Get-Content \"$env:APPDATA\Ministry of Education\logs\clawx-*.log\" -Tail 30 |
  Select-String -Pattern \"Gateway|ready|error\" |
  Select-Object -Last 10
$tail
"'
```

Look for `Gateway auto-start succeeded` and `Gateway ready fallback RPC router probe succeeded`. If you see `Config validation failed.*Invalid option`, see PROBLEMS_ATLAS § "google-query-key reseed".

---

## Step 11 — agent smoke (without manual Chrome setup)

The app owns the Chrome automation repair path for Outlook and Forms. Do not ask a principal to configure Chrome flags or run Chrome commands. For the demo we won't drive Outlook from SSH; we drive it from the app's chat composer once a principal opens the GUI on the laptop directly. SSH-side smoke is just gateway sanity:

```bash
ssh pilot 'powershell -NoProfile -c "
# Gateway WS handshake (proves it accepts WS upgrades)
$resp = curl.exe -sI -H \"Connection: Upgrade\" -H \"Upgrade: websocket\" -H \"Sec-WebSocket-Version: 13\" -H \"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\" http://127.0.0.1:18789/ 2>&1 | Select-Object -First 5
$resp
\"---\"
\"Host-API health:\"
curl.exe -s -o NUL -w \"%{http_code}\" http://127.0.0.1:13210/health
"'
```

Expected: `HTTP/1.1 101 Switching Protocols` from gateway, `401` from host-API (means auth wired).

---

## Demo path (principal sits at the laptop, NOT SSH)

For the actual demo, the principal:
1. Opens the Ministry of Education app.
2. Asks the assistant to check email or open Outlook.
3. Signs into Outlook in the Chrome window if Microsoft asks for sign-in.
4. If the assistant says Chrome is already open with the target profile, closes all Chrome windows and retries from ClawX.
5. Types the demo request into the chat composer.

The SSH-driven steps above are just for IT-side install/verify.

---

## Visual VM smoke (GCP Windows)

Use this when a physical laptop is unavailable or when validating a clean
installer path before sending a download link. The VM proof must still be
treated as interactive Windows evidence, not CI Session 0 evidence.

Current VM:

- project: `gen-lang-client-0649986230`
- zone: `us-central1-a`
- instance: `clawx-win-rc-20260609`
- Windows user: `clawxtest`

Start the WinRM tunnel from the Mac:

```bash
gcloud compute start-iap-tunnel clawx-win-rc-20260609 5986 \
  --local-host-port=localhost:15986 \
  --zone=us-central1-a \
  --project=gen-lang-client-0649986230
```

Run the installed-app visual smoke from the VM:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "$env:USERPROFILE\Downloads\clawx-e2e-runner\pilot-managed-cdp-visual-smoke.ps1" `
  -StopExistingApp -StopChrome
```

Expected artifact directory:

```text
C:\Users\clawxtest\Downloads\clawx-managed-cdp-visual-smoke-<timestamp>
```

Minimum evidence:

- screenshot `clawx-electron-*.png` shows the app shell, not the setup wizard;
- `STATE:CHROME_CDP_READY=True`;
- `STATE:ELECTRON_CDP_READY=True`;
- `STATE:HOSTAPI_READY=True`;
- `STATE:GATEWAY_PORT_READY=True`;
- `STATE:POST_PROBE_*` still true after the probe;
- `OFFICE_RUNTIME_READY`;
- Outlook read and no-send/no-download safety probes return safe statuses;
- Forms list returns the Daily Report and Suspensions forms;
- Forms preview either fills the expected fields or returns a precise sign-in/access diagnostic.

Optional visual desktop:

```bash
gcloud compute start-iap-tunnel clawx-win-rc-20260609 3389 \
  --local-host-port=localhost:13389 \
  --zone=us-central1-a \
  --project=gen-lang-client-0649986230
```

Then connect Microsoft Remote Desktop to `localhost:13389` as `clawxtest`.
Credentials stay in the operator vault/local temp file and must not be pasted
into logs or docs.

2026-06-09 evidence:

- clean install on the GCP Windows VM succeeded with silent install exit `0`;
- app screenshot confirmed the setup wizard no longer appears after cloud gateway seeding;
- Host API, Gateway, Chrome CDP, Electron CDP, Office runtime, and Outlook safety probes were green;
- Forms preview failed because the managed Chrome profile landed on `login.microsoftonline.com`, meaning Microsoft sign-in is required before the tenant Forms questions render.

---

## Failure-mode escape hatches

| Symptom | Look in PROBLEMS_ATLAS § |
|---|---|
| Install exits with code 1 | "vc_redist.x64.exe missing" |
| App launches but no helpers | "Electron Session 0" + "playwright-core" |
| Gateway logs `Invalid option` | "google-query-key reseed" |
| Chat stays on "thinking" or model call failed | "Gemini shows thinking" |
| 0 bytes in stdout, no userData | "userData not created" |
| `Cannot find module` errors | "playwright-core devDep" |
| Chrome opens but Outlook tools 404 | "Conditional Access / managed Chromium" |
| Forms preview waits 30s for question items | "Forms preview redirects to Microsoft sign-in" |
| `chflags uchg` urge | NEVER do this on Windows; band-aid is wrong |

## Authentication prerequisite for Microsoft acceptance

Give principals [Connect your email and forms](USER_GUIDE.md). They sign into their own account; this operator procedure uses a test account only for QA.

Before running mailbox or Forms acceptance, follow the [browser sign-in prerequisite](../windows-pilot/vm-testing/README.md#microsoft-browser-sign-in-is-a-test-prerequisite). Use the designated test account in the exact interactive Windows session and user Chrome profile controlled by the app. Verify account identity and real inbox/form controls; a URL or CDP connection alone is insufficient. VM credentials, browser authentication and Graph OAuth are separate. Missing sign-in, MFA or form permission is BLOCKED for the dependent journey, and does not become a passed automation result. Never include passwords or session tokens in evidence.
