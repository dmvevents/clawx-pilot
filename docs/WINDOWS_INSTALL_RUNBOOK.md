# Windows pilot install — end-to-end runbook (moe.10)

**Target:** `vyonix@169.254.46.90` (pilot Windows 11, build 26100). Cat-5 link.
**Time:** ~15 min from clean state to working demo.

This runbook is **autonomous** — every step is a one-liner you can paste, with expected output. Stop at the first ✗ and consult `docs/WINDOWS_PROBLEMS_ATLAS.md` for the matching root cause.

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

## Step 5 — fetch the latest moe.10 .exe

Build is on GitHub Actions, downloadable for 7 days after each push:

```bash
# On Mac:
gh run list --repo dmvevents/clawx-pilot --workflow package-win-manual.yml --limit 1 --json databaseId
# Note the databaseId, then:
mkdir -p /tmp/moe10
gh run download <id> --repo dmvevents/clawx-pilot --name windows-installer-x64 --dir /tmp/moe10

# Push to pilot via SSH:
scp -o ProxyCommand=none /tmp/moe10/*.exe vyonix@169.254.46.90:/Users/vyonix/Downloads/
```

Or use the in-repo `release/Ministry of Education-0.4.3-moe.10-win-x64.exe` if it exists from a local build.

---

## Step 6 — silent install on pilot

```bash
ssh pilot 'powershell -NoProfile -c "
$exe = Get-ChildItem \"$env:USERPROFILE\Downloads\Ministry of Education-*-win-x64.exe\" |
  Sort-Object LastWriteTime -Descending | Select -First 1
\"installing: $($exe.Name)\"
$p = Start-Process -FilePath $exe.FullName -ArgumentList \"/S\",\"/CURRENTUSER\" -Wait -PassThru
\"exit: $($p.ExitCode)\"
"'
```

Expected: `exit: 0`. If you see `exit: 1`, NSIS hit a precondition (e.g., `vc_redist.x64.exe` missing — see PROBLEMS_ATLAS).

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

## Step 11 — agent smoke (without launching Chrome)

The Outlook tools need Chrome on `--remote-debugging-port=18792`. For the demo we won't drive Outlook from SSH; we drive it from the app's chat composer once a principal opens the GUI on the laptop directly. SSH-side smoke is just gateway sanity:

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
1. Opens Chrome (the openclaw browser plugin auto-attaches via `--remote-debugging-port=18792` when first navigated)
2. Signs into Outlook in that Chrome
3. Opens the Ministry of Education app
4. Types into the chat composer

The SSH-driven steps above are just for IT-side install/verify.

---

## Failure-mode escape hatches

| Symptom | Look in PROBLEMS_ATLAS § |
|---|---|
| Install exits with code 1 | "vc_redist.x64.exe missing" |
| App launches but no helpers | "Electron Session 0" + "playwright-core" |
| Gateway logs `Invalid option` | "google-query-key reseed" |
| 0 bytes in stdout, no userData | "userData not created" |
| `Cannot find module` errors | "playwright-core devDep" |
| Chrome opens but Outlook tools 404 | "Conditional Access / managed Chromium" |
| `chflags uchg` urge | NEVER do this on Windows; band-aid is wrong |
