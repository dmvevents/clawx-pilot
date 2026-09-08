# Windows development and email diagnosis — September 7, 2026

The owner requested direct Windows VM development and iteration. A persistent checkout and native test loop now exist on the existing GCP VM. This is development evidence; GA remains RED.

## Workspace and access

- VM: `clawx-win-rc-20260609`, Windows Server 2022 build 20348, four vCPUs, 16 GiB RAM, existing administrator profile. Interactive session 1 is available; this is not fresh Windows 10/11 acceptance.
- The September 7 17:39 UTC IAP probe passed real RDP negotiation, SSH banner and the closed guest-port 9999 control. Authenticated SSH also passed. The stale local port 12222 tunnel was left intact; this controller uses port 29222 with the previously trusted host key.
- Workspace: `C:\Users\clawxtest\ClawXDev\source`, branch `fix/windows-vm-email`, based on `94b38aa81ba256b432537fe111ac3191cc98f1ed`. The reviewed FFmpeg test correction is also present in this checkout; its public commit is `fd678bd6f237f2477366a630ddaf30f3c125b5ec`.
- Portable Git, Node 24.20.0 and pinned pnpm 10.33.4 are under `ClawXDev\tools`; dependencies and the pnpm store persist between iterations. The copied packaged Node 22.16.0 remains available separately for runtime diagnostics. Node 24 was verified against the official archive SHA256 before use. No agent credentials were copied. The current agent executes Windows commands over SSH; a resident coding agent is not required for this loop.
- `enter-dev.ps1`, `test-email.ps1`, `start-dev.ps1` and `README.md` live in `ClawXDev`. The launcher refuses an active installed app/Gateway and SSH Session 0. A real app handoff requires the existing user-state backup procedure. A separate source directory alone does not isolate `.openclaw`.

## Stakeholder failure and current email evidence

Karunesh's exact September 4 log attachment (message `3EB0CFF271A8759916AC45`) identifies **moe.18**. Its file size and SHA256 matched the WhatsApp attachment metadata. The accompanying screenshot matched its metadata and showed the repeated close-Chrome conversation. These private attachments were retrieved through the configured local bridge for this investigation; their contents are not committed.

The log records `ECONNREFUSED` on Chrome CDP port 18792, followed by a Chrome launch, `port_bind_timeout`, and repeated `profile_locked_close_chrome` diagnoses. It never establishes authenticated Outlook attach. The moe.18 launcher targeted Chrome's default User Data directory. Chrome 136 and later require a non-default directory for remote debugging, as documented by [Chrome](https://developer.chrome.com/blog/remote-debugging-port).

The dedicated-profile correction is already in the moe.21 source. Ordinary product email uses the principal plugin, Host API, Outlook manager and Playwright CDP; installing an external Chrome MCP does not change this launch path.

| Check | Observed result | Scope |
|---|---|---|
| Native email source suites on bundled Node 22.16.0 | 46 passed, zero failed | Three suites in the full Windows checkout; mocks are source regression coverage |
| Actual source Chrome launcher, first fresh profile launch | `cdp_down_chrome_closed` → `cdp_ready`; Playwright WebSocket attach and page DOM read in 5,159 ms | System Chrome 152.0.7977.76, interactive session 1, alternate port 19492, unchanged product launcher |
| Same profile after owned Chrome shutdown | Same successful launch/attach/DOM sequence in 2,414 ms | Second iteration; both launches used the existing 12-second launch bound |
| Existing user state | Eleven other Chrome processes existed before each iteration; prior installed-app PIDs survived; owned test browser closed | No existing Chrome profile, app installation or `.openclaw` repair was performed |
| Installed moe.21 renderer → Host API at 18:01:07 UTC | Browser diagnosis `cdp_ready`; inbox request `needs_signin` | Exact installed ASAR `8905aef127a3f1e443069b484a54481e76caa8a152902b85da3d778079f2cc94`; no mailbox contents retained and no draft/send/submit |

The source Chrome probe uses the real Windows process launcher, system Chrome and Playwright. Only the Electron-dependent logger is stubbed. Its launcher source SHA256 is `1059abb73c282f8229fd0df4483a33289667f89aada8a83d5f5fd5e7143d0932`. The first scheduled-task attempt produced no result before its limit and is excluded. The recorded successful run is the source transport proof, not an authenticated mailbox journey.

The remaining email gate is Microsoft sign-in in the Chrome window controlled by the app, followed by an inbox/draft retest. The account holder must complete interactive authentication. Karunesh's unaided moe.21 retest remains unverified. A vanilla machine also still needs Chrome and supported Online provisioning; a keyless installer does not supply an account automatically.

## Native build-test repair

The VM reproduced the exact FFmpeg archive-fixture failure from the first moe.22 hosted build: 11 passed and one failed. Applying the reviewed correction produced 14 passed and zero failed, completed at 17:51:01 UTC. The corrected test SHA256 is `cdd234ac6bbf867248129bc6b7f36f127773c0fc72b601e4ee5566d27bb78b81`; the production downloader remains `11b9f0acaf1a3426df92705bd95dddca3ef225ec081662368089a2ca4726f8a9`.

Commit `fd678bd6` contains only that fixture correction and is pushed to the public candidate branch. No subsequent installer build or installed FFmpeg acceptance is claimed here.

## Native development completion

The full checkout passed **60 tests in four focused suites** on Node 24.20.0 with pnpm 10.33.4. Extension bridge generation and Vite compilation of the renderer, Electron Main and preload completed with exit 0 at 18:05:46 UTC. This is a successful native source build, not an installer or a launched moe.22 app journey. The installed moe.21 app remains in place.

The first dependency install completed in 13m13.7s, but its asynchronous PowerShell wrapper did not retain an exit code. A cached, offline frozen-lockfile install then completed with a measured exit 0. Subsequent native tests and compilation passed. This was a setup-wrapper observation, not a demonstrated dependency failure.

## Evidence locations and remaining boundary

Private machine-readable results and runner scripts are under `artifacts/windows-vm/20260907-development/` and guest `Downloads\clawx-vm-dev-20260907`. They include environment identity, before/after fixture reports, full-checkout email tests, real Chrome transport observations and redacted installed-app status. Provider keys, authentication tokens, signed download URLs, mailbox bodies and recipient lists are excluded.

The VM remains running under the existing owner hold. Clean Windows client installation, unaided tester acceptance, authenticated Microsoft journeys and the other release failures remain separate gates in the completion plan.
