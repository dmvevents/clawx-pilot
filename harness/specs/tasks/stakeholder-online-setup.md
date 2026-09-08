---
id: stakeholder-online-setup
title: Configure Ministry Online through the supported user seed
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let a principal configure a private Online bundle with built-in Windows PowerShell while leaving runtime and settings writes to the existing application seed.
touchedAreas:
  - windows-pilot/scripts/setup-ministry-online.ps1
  - windows-pilot/scripts/Setup Ministry Online.cmd
  - windows-pilot/scripts/ministry-online.example.json
  - windows-pilot/scripts/ministry-online-setup.md
  - tests/windows/stakeholder-online-setup.test.ps1
  - tests/windows/stakeholder-online-setup-input.test.ps1
  - harness/specs/tasks/stakeholder-online-setup.md
expectedUserBehavior:
  - Quit Ministry of Education, extract the private bundle, and double-click Setup Ministry Online.cmd.
  - Reopen the application after setup; select Online if On this device was explicitly selected previously.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - completion-evidence
requiredTests:
  - powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/windows/stakeholder-online-setup-input.test.ps1
  - powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/windows/stakeholder-online-setup.test.ps1 -AclProbeOnly
  - powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/windows/stakeholder-online-setup.test.ps1
  - pnpm harness validate --spec harness/specs/tasks/stakeholder-online-setup.md
acceptance:
  - Only the supported userData cloud-gateway.json and separate cloud-gateway.key are configured; no provider store, settings, registry or OpenClaw configuration is edited.
  - The endpoint is HTTPS with a /v1 path, models are exactly the public MoE aliases, and the nonempty key comes only from a local bundle file.
  - Running app or bundled Gateway processes block setup without being terminated.
  - Existing seed files are backed up before replacement; key, staging and backup permissions are restricted to the current user.
  - Permission updates retain verified current ownership and persist only access-rule changes, including after move and replacement, without requiring administrator privileges.
  - Individual files are replaced atomically and an ordinary partial-write failure restores both previous files. A repeated identical setup preserves file contents and creates no additional backup.
  - The default double-click flow displays only a principal-readable message. Explicit -Json mode emits only allowlisted status fields; neither mode exposes endpoint, key, key hash or exception text.
  - Native Windows tests cover initial setup, repeated setup, replacement/backup, invalid input, permissions, running-app refusal and partial-commit recovery before an installed normal-boot seed check.
docs:
  required: true
---

The existing application reads a userData seed on normal startup and performs
its own provider/runtime synchronization. This helper supplies that supported
input only. It does not install or launch the app, validate a broker over the
network, or override an explicit channel choice. File replacement is atomic
per file, not a filesystem-wide two-file transaction; keep the app closed until
setup finishes. Installed acceptance remains a separate root-owned VM check.
