# skills/laptop/evidence/

Drop laptop-smoke evidence here as it's captured — one subdir per run, named `<ISO-date>-<what>`.

Suggested layout per run:

```
2026-07-31-home-pilot-lane-a-smoke/
├── metadata.json           # host, IP, arch, installer SHA, timestamps
├── install.log             # NSIS installer log
├── nsis-verbose.log        # verbose NSIS log (if run with /verbose=)
├── artifact-probe.json     # from pilot-check-install-artifacts.ps1
├── gateway-smoke.json      # from pilot-run-installed-gateway-smoke.ps1
├── cdp-outlook.json        # from pilot-launch-and-run-cdp-smoke.ps1 -OutlookOnly (if run)
├── office-runtime.json     # from pilot-office-runtime-check.ps1
├── verdict.md              # red/yellow/green per gate + short prose
└── redaction-note.md       # confirms no secrets/emails/URLs in above artifacts
```

**Redaction rule (hard):** no key material, no key hashes, no private Forms URLs, no email bodies, no full recipient lists — recipient counts only, subject line ≤120 chars. When in doubt, redact and note the redaction.

**After a run:** update `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` with a pointer to this subdir.
