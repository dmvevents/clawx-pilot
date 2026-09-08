# Set up Ministry Online

Close Ministry of Education completely, including its notification-area icon.
Extract the private setup bundle into a local folder, then double-click
**Setup Ministry Online.cmd**. Keep the app closed until setup finishes.
Reopen Ministry of Education afterward. If you previously selected **On this
device**, select **Online** after reopening.

The private bundle contains the CMD wrapper, `setup-ministry-online.ps1`,
`ministry-online.private.json` and the key file named by that JSON. Keep the
bundle private. No administrator account, developer tools or additional runtime
is required; the script uses Windows PowerShell 5.1.

For the support operator: copy `ministry-online.example.json` to
`ministry-online.private.json` only inside the private bundle and fill `baseUrl`
with the deployed HTTPS endpoint ending in `/v1`. Supply the client key in the
separate local file. The example intentionally has no endpoint or key. Do not
commit, log or pass the key as a command argument. Run with the principal's
normal account, not another administrator's account.

The helper writes `%APPDATA%\Ministry of Education\cloud-gateway.json` and
`cloud-gateway.key`. The application consumes these through its existing seed
on normal startup. It does not directly edit settings, provider stores,
`.openclaw`, the registry or unrelated files, and does not contact the endpoint.
An existing explicit channel preference is left to the application's existing
seed rules; the helper does not change it itself.

Before changing existing seed files, setup retains copies under the protected
`.ministry-online-backups` directory beside them. Key, temporary staging and
backup access is restricted to the current user. Permission updates verify
existing ownership and do not request ownership assignment or elevation.
A repeated identical setup
does not rewrite file content or create another backup. Individual replacements
are atomic, and an ordinary partial-commit error triggers restoration. They are
not a power-loss-safe two-file filesystem transaction. Keep the app closed
throughout setup. Failed restoration reports `RESTORE_FAILED` and retains the
protected backup for support.

The double-click flow displays a plain result message. Support automation can
explicitly pass `-Json` to the PowerShell helper to receive one
`CLWX_SETUP_RESULT=` record instead, containing only `status`, `code`, `changed`
and a generated `backupId`. The CMD wrapper does not enable that option.
Neither mode emits endpoint, key, key hash or raw exception text. Setup success
means the files were saved; verify normal app boot and an ordinary Online reply
separately before claiming a working connection.

Native contract checks, in a closed-app Windows session:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/windows/stakeholder-online-setup-input.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/windows/stakeholder-online-setup.test.ps1 -AclProbeOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/windows/stakeholder-online-setup.test.ps1
```

The checks use synthetic credentials and a temporary APPDATA directory; they
do not configure the real app profile or perform network, email or Forms calls.
The native suite also launches the actual CMD and fresh Windows PowerShell
processes from a bundle path with spaces, checking default configuration,
explicit configuration and JSON output through the real script entrypoint.
The input-only script also runs with developer-host `pwsh`; that does not prove
Windows ACLs, atomic replacement or normal application startup.

The native test invokes the dot-sourced function with its support-only
`-Diagnostic` switch. On failure it records the operation phase, exception
types, numeric HRESULTs and source line number, plus a fixed assertion label
and allowlisted setup status. It never prints exception messages, file paths
or private input. The normal CMD and `-Json` entrypoints do not enable these
internal test diagnostics.
