# Redaction note

Confirmed for every artifact in this directory:

- No passwords, tokens, API keys, or key hashes. The Gateway auth token appears in guest logs
  as `--token [redacted]` by the app's own logger; no token value was copied into evidence.
- No email bodies, recipients, or subject lines — no Outlook flow was exercised in this run.
- No private Forms URLs.
- No credential was requested, printed, or reset to obtain guest access. SSH was established
  via a startup-script-installed operator public key; `reset-windows-password` was
  deliberately avoided because it prints a credential.
- Installer sha256 and byte size are integrity data, not secrets, and are recorded
  deliberately per the evidence README.
