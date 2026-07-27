# Email Production Test Status - 2026-06-07

## Current Result

Email is working through the production app path on the Windows laptop after
the rebuilt `app.asar` payload was patched into the installed app.

The remaining release risks are not the Outlook tool path:

- Microsoft Forms preview still times out waiting for question items to render.
- The NSIS silent installer automation still hangs as a lone installer process
  before extraction/child processes. The final source-matching installer is on
  the laptop for GUI/manual install testing, but silent reinstall is not a pass.

## How Email Access Works Now

1. The MoE assistant plugin calls the Electron Host API from the OpenClaw
   gateway. The renderer is not calling Outlook directly.
2. Host API Outlook routes choose Microsoft Graph first when Graph is configured
   and signed in.
3. If Graph is not available, Host API falls back to the Outlook browser v2
   manager, which drives Outlook Web through Chrome CDP.
4. Chrome CDP now supports a managed fallback profile under the app's data
   directory. This avoids requiring the teacher's existing Chrome profile to be
   relaunched with remote debugging when normal Chrome is already open.

Graph is still the preferred production architecture because it removes browser
state and CDP from the email path. Current laptop config has Graph tenant/client
placeholders but `microsoft-graph.enabled=false`, so the verified path is the
browser/CDP fallback.

## Evidence Collected

- Local code checks:
  - `pnpm exec vitest run tests/unit/chrome-cdp.test.ts tests/unit/outlook-playwright-driver-cdp.test.ts tests/unit/outlook-routes-graph.test.ts tests/unit/windows-pilot-electron-cdp-probe.test.ts`
  - Result: 4 files / 30 tests passed.
  - `pnpm run typecheck` passed.
- Final Windows build:
  - `release/Ministry of Education-0.4.3-moe.10-win-x64.exe`
  - SHA-256: `5e66e59476bf510cd2dcf605b999b1c9b525563822f2316a48b96f3902b738b7`
  - Copied to laptop:
    `C:\Users\Public\Downloads\Ministry.of.Education-0.4.3-moe.10-current-win-x64.exe`
  - Laptop hash matched: `5E66E59476BF510CD2DCF605B999B1C9B525563822F2316A48B96F3902B738B7`.
- Installed laptop payload:
  - `C:\Users\VYONIX\AppData\Local\Programs\Ministry of Education\resources\app.asar`
  - SHA-256 after patch:
    `2FF7AC099196C9DEA155AE6425FF83FF94575C891CF53BFB36AAABABD4AF8F0F`.
  - `resources\openclaw\node_modules\playwright-core\package.json` exists;
    version `1.59.1`.
- Outlook-only production smoke:
  - Remote artifact:
    `C:\Users\Public\Downloads\clawx-cdp-smoke-20260607-154048`
  - Result: `STATE:RESULT=COMPLETE`.
  - Runtime ready before probe: Electron CDP, Host API, and Gateway were ready.
  - `outlookSmoke.readInbox`: HTTP `200`, result `status: ok`,
    `messageCount: 0`.
  - `sendWithoutConfirm`: refused with confirmation-required reason.
  - `downloadWithoutConfirm`: refused with confirmation-required reason.
  - Post-probe runtime stayed ready inside the same SSH session:
    Electron CDP, Host API, Gateway, and Chrome CDP all ready.
- Full Outlook + Forms smoke:
  - Remote artifact:
    `C:\Users\Public\Downloads\clawx-cdp-smoke-20260607-142134`
  - Outlook passed as above.
  - Forms failed because Microsoft Forms did not render question items within
    30 seconds. The old `profile_locked_close_chrome` blocker did not recur.

## What Was Wrong

1. The previous `playwright-core` module error was a packaging/probe-resolution
   issue. Current installed resources include `playwright-core`, and the CDP
   probe loads it from the packaged `resources\openclaw\node_modules` path.
2. The previous Outlook/browser failure was not an email credential failure. It
   was a browser attachment problem: the app tried to use a normal Chrome
   profile that could already be open without CDP. The managed Chrome profile
   fallback makes this recoverable without asking the user to relaunch their
   day-to-day Chrome profile with debugging flags.
3. SSH-launched GUI apps on the laptop are not reliable as long-lived desktop
   processes after the SSH command exits. Same-session launch+probe is reliable
   for automation evidence; a real teacher launch should use the desktop/start
   menu shortcut.
4. Silent installer automation is still not release-quality. `/S` and
   `/S /currentuser` both hang with only the NSIS installer process alive, no
   visible windows, and no child extraction/PowerShell process. The installer
   does not overwrite `Ministry of Education.exe` before it is killed.

## Next Production Checks

1. Run the final installer from the Windows desktop GUI and confirm it exits.
2. Launch the desktop shortcut and rerun the Outlook-only smoke:
   `C:\Users\Public\Downloads\pilot-launch-and-run-cdp-smoke.ps1 -StopExisting -OutlookOnly`.
3. Fix Forms rendering separately by capturing the page URL/state/screenshot
   from the Forms managed Chrome page and updating the selector/readiness logic.
4. Decide whether the release candidate requires silent install support. If yes,
   debug the assisted NSIS silent path before calling the installer production
   ready.
5. For production email without browser state, complete Microsoft Graph Entra
   app registration and sign-in, then rerun Outlook tests with Graph enabled.
