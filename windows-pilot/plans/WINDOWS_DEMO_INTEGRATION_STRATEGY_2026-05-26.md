# Windows Demo Integration Strategy - Outlook, Forms, Office, ASR

## Target Result

The Windows pilot laptop should run the Ministry app with cloud model routing, Outlook browser-session tools, Forms browser-fill tools, Excel input handling, Word/document output readiness, and higher-quality transcription. The demo persona is the principal; prompts should assume a principal writing to staff, parents, MoE officers, and school records.

## Current Evidence

- App is installed at `%LOCALAPPDATA%\Programs\Ministry of Education` and Gateway/Host API are up.
- `moe-principal-assistant` is enabled; `microsoft-graph` is intentionally disabled.
- Defaults point to `google/gemini-2.5-pro`; the local Ollama path is not demo-critical.
- Chrome shows `--remote-debugging-port=18792` on the default profile, but the port is not listening. Current Chrome versions can ignore remote debugging on the default user-data-dir.
- Forms and Outlook v2 both require live CDP on `127.0.0.1:18792`.
- Windows native ASR helper is installed, but logs show recognition failures; Azure Speech is the clean quality upgrade if credentials are provisioned.
- Excel preview is available through `xlsx`; Word/document generation skills are present, but their runtime dependencies are not fully packaged.

## Outlook And Forms Architecture

Outlook and Forms are already integrated through the app, not standalone scripts:

- Agent tool call
- `moe-principal-assistant` OpenClaw plugin
- Electron Host API with bearer token
- Main-process Outlook or Forms manager
- User Chrome session over CDP

Current pilot builds default to the Outlook v2 Chrome/CDP manager for full tool coverage. Keep `CLAWX_OUTLOOK_V2=1` only as an explicit compatibility setting for older installed builds; use `CLAWX_OUTLOOK_V2=0` when deliberately testing the legacy browser-plugin path.

Forms uses the v2 browser driver already. `forms.preview_suspension` fills the test form without submitting. `forms.submit_suspension` requires `confirm:true` and the expected title.

## Windows Configuration Plan

1. Install/refresh pilot scripts in `%USERPROFILE%`.
2. Run `pilot-install-demo-shortcuts.ps1`. Add `-SetOutlookV2UserEnv` only when repairing an older installed build that does not default to Outlook v2.
3. Use the desktop shortcut `Ministry Demo - CDP Chrome` to open a separate Chrome demo profile with CDP on `18792`.
4. Sign into Outlook in that CDP Chrome profile using the authorized test account.
5. Restart the Ministry app from `Ministry Demo - App Outlook V2` if you need to force the v2 manager on an older build; current pilot builds select it by default.
6. Run `Ministry Demo - Probe State`; required state is `INSTALLED | GATEWAY_UP | API_UP | CDP_UP`.
7. Run `Ministry Demo - Outlook Check`; required state is `OUTLOOK_READY`.
8. Execute the desktop self-test prompts. Do not send real email or submit the form during self-test.

## Office And Document Scaffold

Minimum demo-ready path:

- Keep `xlsx` for Excel preview/reading.
- Add a Node-based document generation path using direct dependencies such as `docx` and `mammoth`.
- Avoid bundling LibreOffice/Pandoc/Poppler for the demo unless conversion or PDF rendering becomes required.
- Add a smoke check that packaged Windows can import `xlsx`, `docx`, and `mammoth`.

Future complete path:

- Package a Python document runtime via bundled `uv.exe`.
- Include `pandas`, `openpyxl`, `python-docx`, `pypdf`, `pdfplumber`, and `reportlab`.
- Add explicit principal tools for `principal.write_docx` and `principal.summarize_excel_to_docx`.

## ASR Quality Plan

Keep Windows native ASR as the offline fallback, but do not rely on it as the demo-quality path. If Azure Speech keys are available:

1. Configure Azure Speech in Settings.
2. Launch future builds with `CLAWX_PREFER_AZURE_SPEECH=1`.
3. Preserve native/whisper fallback.
4. Pass a real locale (`en-US` or `en-TT`) instead of generic `en`.

If Azure keys are not available, use typed prompts for the demo and keep ASR as best-effort.

## Validation

- `pilot-probe-state.ps1` confirms app ports and live CDP, not just Chrome flags.
- `pilot-verify-outlook-tab.ps1` confirms Outlook login readiness.
- Desktop self-test prompt confirms Outlook tools do not send email during smoke.
- Forms self-test prompt confirms `forms.preview_suspension` fills but does not submit.
- Gateway logs are tailed only for tool names/status; no email body or recipient content should be logged.
