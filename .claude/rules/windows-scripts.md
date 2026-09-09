---
paths:
  - "windows-pilot/**/*"
  - "scripts/**/*.ps1"
  - "resources/**/*.ps1"
---

# Windows scripts

Read `windows-pilot/CLAUDE.md` and the selected Windows domain skill. Target Windows PowerShell 5.1 where the runbook requires it; PowerShell 7 on a Mac cannot prove compatibility with the installed Windows host.

Prefer parameterized script files copied and run through the documented SSH/IAP path over nested shell quoting. Capture the remote exit code and typed receipt, keep writes idempotent, and preserve user profiles. Use explicit operation timeouts and one VM operator; inspect receipts after an interruption before retrying a potentially executed write.

Parse/syntax checks are separate from installed runtime tests. Never include account secrets, tokens or customer content in console output or committed evidence.
