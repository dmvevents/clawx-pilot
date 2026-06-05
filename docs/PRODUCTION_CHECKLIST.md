# ClawX Production-Readiness Checklist

> **Audience**: ClawX, the MoE Trinidad & Tobago primary-school principal admin assistant. Pilot target: one Windows laptop on a principal's desk. Fleet target: one principal per school across the seven MoE districts (Caroni, North Eastern, Port of Spain & Environs, South Eastern, St. George East, St. Patrick, Victoria).
>
> **Used by**: the `production-readiness` sub-agent and any human on-call before a release tag.
>
> Last reviewed: **2026-06-05**.

## Legend

- ✅ **Green** — verified, no action.
- ⚠️ **Yellow** — drift or open question; ship pilot only.
- ❌ **Red** — blocker; do not ship.

---

## 1 · Gateway boot health

| # | Check | How to verify | State |
|---|---|---|---|
| 1.1 | In-process seeder exists | `ls electron/main/gateway-plugin-config-seed.ts` | ✅ |
| 1.2 | Seeder wired before gateway start | `grep -n "seedGatewayPluginConfig" electron/main/index.ts` shows call inside `if (!isE2EMode)` block | ✅ |
| 1.3 | Seeder tests green | `pnpm test tests/unit/gateway-plugin-config-seed.test.ts` → 8/8 | ✅ |
| 1.4 | Recovery protocol documented | `/tmp/gateway-recovery-protocol.md` exists | ✅ |
| 1.5 | `~/.openclaw/openclaw.json` valid | both `microsoft-graph` and `moe-principal-assistant` blocks schema-valid | ✅ |

## 2 · Skill bundle parity

| # | Check | How to verify | State |
|---|---|---|---|
| 2.1 | `bundles.json` advertises 17 skills | `jq '.bundles[0].skills \| length' resources/skills/bundles.json` → 17 | ✅ |
| 2.2 | Manifest seeds all 17 (modulo platform gating) | `jq '.skills \| length' resources/skills/preinstalled-manifest.json` → 17 | ✅ |
| 2.3 | Darwin-only skills tagged | `jq '.skills[] \| select(.platforms != null)' resources/skills/preinstalled-manifest.json` → imsg only (bluebubbles dropped 2026-05-20: not in openclaw/openclaw upstream) | ✅ |
| 2.4 | `platforms` field honored at install time | `electron/utils/skill-config.ts` filters by `process.platform` before deploy | ✅ |
| 2.5 | Bundling script accepts new entries | `zx scripts/bundle-preinstalled-skills.mjs` runs clean (verify on next CI build) | ⚠️ verify |

## 3 · UI invariants (anonymized identity)

| # | Check | How to verify | State |
|---|---|---|---|
| 3.1 | No vendor names in user-visible UI | `grep -rE "(Anthropic\|OpenAI\|Claude\|GPT-)" src/components/ \| grep -v dev-mode \| wc -l` → 0 | ✅ |
| 3.2 | Composer shows "Online" / "On this device" only | `src/lib/provider-display.ts` `publicLabel()` returns those exact strings | ✅ |
| 3.3 | Cost hidden in frontend | `grep -rE "\$[0-9]" src/components/ \| grep -v test \| grep -v dev-mode` → 0 | ✅ |
| 3.4 | Connection dot present | `publicStatusDot()` returns red / emerald / zinc | ✅ |
| 3.5 | Reasoning effort dropdown gated by `supportsReasoningEffort` | gateway capability flag check | ✅ |

## 4 · Security & secrets

| # | Check | How to verify | State |
|---|---|---|---|
| 4.1 | No committed API keys | `git grep -E "(sk-ant-\|sk-proj-\|hf_[A-Za-z0-9]{30,})"` → empty | ✅ |
| 4.2 | `.env` gitignored | `grep -E "^\.env" .gitignore` matches | ✅ |
| 4.3 | MoE test password rotated | Verbal confirmation from Anton; no stored plaintext anywhere in repo | ⚠️ pending |
| 4.4 | `microsoft-graph.enabled: false` in default seed | `electron/main/gateway-plugin-config-seed.ts` line 39 | ✅ |
| 4.5 | Browser automation forces `profile=user` | grep `profile=user` in `electron/` browser code paths | ⚠️ verify in browser-automation skill |

## 5 · Locales

| # | Check | How to verify | State |
|---|---|---|---|
| 5.1 | English-only | `ls src/i18n/locales/` → `en` only | ✅ |
| 5.2 | i18n initializer has English as default | `src/i18n/index.ts` `lng: 'en'` | ✅ |

## 6 · Test gates

| # | Check | How to verify | State |
|---|---|---|---|
| 6.1 | Vitest green | `pnpm test` → 781 pass, 5 skipped — channel-routes flake fixed in `electron/utils/gateway-health.ts` (failure>=ok comparison) | ✅ |
| 6.2 | Typecheck clean | `pnpm run typecheck` passed 2026-06-05 | ✅ |
| 6.3 | Harness CI green | `pnpm run harness:ci` passed 2026-06-05 | ✅ |
| 6.4 | E2E (Playwright) green | `pnpm run test:e2e` | ⚠️ run before release |
| 6.5 | Windows installed-app chat procedures | Latest evidence reached `READY_SAFE_CHAT_PROCEDURES` with Outlook open, Forms list, Downloads inventory, Excel summary, suspension-source extraction, and Host API Outlook/Forms safety smoke | ✅ |
| 6.6 | Teacher Daily Report guardrail | `teacher-daily-report-missing-counts` safe-chat scenario asks for missing required counts instead of inventing them | ⚠️ added; rerun on Windows |

## 7 · Self-test cron

| # | Check | How to verify | State |
|---|---|---|---|
| 7.1 | LaunchAgent installed | `~/Library/LaunchAgents/com.moe.clawx.selftest.plist` exists | ✅ |
| 7.2 | Last run within 3h | `~/.openclaw/selftest/last-run.json` `.timestamp` recent | ✅ |
| 7.3 | `.overall == "pass"` | `jq .overall ~/.openclaw/selftest/last-run.json` → `"pass"` | ✅ |
| 7.4 | Hermes 3 canaries 3/3 | `.local.passed == .local.total` | ✅ |

## 8 · Windows packaging readiness

See `docs/WINDOWS_DEPLOY.md` for the full plan and `docs/FIRST_RUN_GUIDE.md` for the principal pre-flight + #69 zero-prework wizard plan. Summary:

| # | Check | How to verify | State |
|---|---|---|---|
| 8.1 | `win.target = nsis x64` | `electron-builder.yml` | ✅ |
| 8.2 | NSIS one-click off, allow install dir change | `nsis.oneClick: false`, `nsis.allowToChangeInstallationDirectory: true` | ✅ |
| 8.3 | Custom installer script | `scripts/installer.nsh` exists | ✅ |
| 8.4 | `npmRebuild: false` | electron-builder.yml | ✅ |
| 8.5 | `prep:win-binaries` script wired | `package.json` | ✅ |
| 8.6 | Update sig verification disabled (no cert yet) | `win.verifyUpdateCodeSignature: false` | ✅ |
| 8.7 | Code-signing cert acquired | OUT OF SCOPE for pilot; flag yellow | ⚠️ deferred |
| 8.8 | Real MoE logo asset | `src/assets/logo.svg` is not placeholder | ❌ TODO |

## 9 · Telemetry & observability

| # | Check | How to verify | State |
|---|---|---|---|
| 9.1 | Cost logged to backend, not UI | `electron/` logs include `cost`; `src/components/` does not render it | ✅ |
| 9.2 | Backend telemetry pipeline | task #51 — usage + transcripts → MoE cloud server | ❌ pending |
| 9.3 | Local logs rotate | `~/.openclaw/logs/` size sane | ⚠️ verify weekly |

## 10 · External dependencies (out-of-band)

| # | Check | Action owner | State |
|---|---|---|---|
| 10.1 | Entra app-registration packet sent to MoE IT | `/tmp/moe-entra-app-registration-request.md` | ⚠️ pending |
| 10.2 | At least one cloud upstream key rotated | `/tmp/router-key-rotation.md` | ⚠️ pending |
| 10.3 | Windows laptop available for smoke test | Windows RC harness produced installed-app evidence on 2026-06-05 | ✅ |
| 10.4 | Ollama installable on target laptop | https://ollama.com/download/windows | ✅ available |
| 10.5 | `hermes3:8b` reachable from target network | network policy | ⚠️ verify |

## 11 · Online model broker

| # | Check | How to verify | State |
|---|---|---|---|
| 11.1 | Broker code exists | `services/model-broker/server.mjs`; `node --check services/model-broker/server.mjs` | ✅ |
| 11.2 | Broker unit tests green | `pnpm exec vitest run tests/unit/model-broker.test.ts` | ✅ |
| 11.3 | Provider keys stay server-side | Desktop stores only a broker-issued client key; upstream key lives in broker env | ✅ design verified |
| 11.4 | Broker deployed to a controlled endpoint | `/healthz` from deployed URL; logs redacted | ❌ pending |
| 11.5 | Installed Windows app chat through broker | Custom provider points at `https://<broker>/v1` and completes one chat | ❌ pending |

---

## Verdict template

After every audit, append a one-line verdict:

```
2026-MM-DD — VERDICT: GREEN | YELLOW | RED — <one-line reason>
```

### History

- 2026-05-20 — VERDICT: **YELLOW** — gateway self-heal shipped + skill manifest expanded; logo asset and telemetry pipeline still pending; Entra packet still with MoE IT. Pilot-deployable, fleet-deployable when 8.8, 9.2, 10.1 close.
- 2026-05-20 (PM) — VERDICT: **YELLOW** — channel-routes flake closed (full vitest 781/781), seeder hardened for first-run-from-zero (writes skeleton instead of skipping ENOENT), bluebubbles removed from manifest+bundles (not present upstream — was the Windows build blocker). Skill count down to 17. Logo, telemetry, Entra still pending. Pilot-deployable.
- 2026-06-05 — VERDICT: **YELLOW** — Windows installed-app RC evidence is green for safe Outlook/Forms/Downloads procedures, and model-broker code/tests are present. Pilot production is still blocked on deployed broker configuration, rerun of the new teacher Daily Report guardrail scenario, clean installer smoke, logo, telemetry, and Entra/fleet items.
