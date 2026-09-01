# Repo & release map

_Last updated: 2026-09-01._

Every git repo this pilot touches, its role, and the plan for cutting a release
a tester can actually download.

## Repos we use

| Repo | Visibility | Role | Notes |
|---|---|---|---|
| `ValueCell-ai/ClawX` | public | **Upstream** we forked | Remote `origin`. ~102 commits ahead of us; **don't push without confirmation.** |
| `dmvevents/clawx-pilot` | **public** | Our pilot: **distributes the installer** AND (today) **hosts full source** | Remote `pilot`. 41 MB, 13 branches. Releases carry `Ministry.of.Education-*-win-x64.exe` (~300 MB). |
| `dmvevents/anton-claw` | private | Older/personal fork | 634 KB, last push 2026-07-29. Stale — candidate to repurpose as private source. |
| `dmvevents/trinidad-moe-platform` | private | Larger MoE platform work | 180 MB, push 2026-08-04. Server/platform-side, not the ClawX desktop. |
| `dmvevents/trinidad-moe-aegis-integration` | private | Integration workstream | Older. |
| `dmvevents/openclaw-personal` | private | Personal OpenClaw | 42 KB. |

Local working tree: `~/Github/moe-tt/ClawX`, branch `fix/doc-tooling-steering`.
Remotes: `origin`→ValueCell-ai (upstream), `pilot`→dmvevents/clawx-pilot.

## The distribution question (why clawx-pilot is public)

A tester downloads the signed Windows installer from the repo's **Releases**
tab — a ~300 MB `.exe`, sometimes pulled over SSH / from an instance. **Public
GitHub release assets are downloadable by anyone with the URL, no GitHub account
needed.** That is the legitimate reason the repo is public, and it should stay
easy.

The problem is **not** that releases are public. It's that the *source tree* and
a *plaintext credential* ride along on the same public repo.

## The recommendation (three decisions)

**Decision 1 — Rotate the test password now.** `Education@2000` is in 3 public
files (`scripts/v2-signin.ts`, `scripts/forms-relogin-helper.ts`, `CLAUDE.md`).
Zero downside to rotating; do it first. Update `PILOT_TEST_PASSWORD` locally and
the test.fac account.

**Decision 2 — Split distribution from source.** Recommended target state:

- Keep **`clawx-pilot` public but releases-only** — matches its own description
  ("distributes signed releases only"). Strip the source tree; keep the
  installer assets, `README`, and the install runbook. The tester's download URL
  is unchanged.
- Move active **source to a private repo** — repurpose the stale `anton-claw`
  (or create `clawx-src`). Dev pushes go there, not to the public repo.
- If you ever need the source itself downloadable on an instance without a
  browser login: a **fine-grained read PAT** or adding the tester's GitHub
  username as a read collaborator on the private repo, or a signed GCS/S3 URL —
  all avoid making source public.

Alternative (lighter, less clean): keep source on `clawx-pilot` but scrub the
password from files + history and accept that source stays public. Only sensible
if there's genuinely nothing sensitive left — CLAUDE.md alone (tenant details,
architecture, hard rules) argues against it.

**Decision 3 — Lane C reply.** Default: **hold** `MINISTRY_REPLY_DRAFT_2026-08-20.md`
for owner review; send only on explicit go. It's the unlock for KR7/KR6 but it's
an outward-facing message to a Ministry official — owner-gated (B3).

## Release plan (installer the tester runs)

1. **Source** builds on the private repo (or current tree): `pnpm build:win` (NSIS x64).
2. **Artifact** = `Ministry.of.Education-<ver>-win-x64.exe` + `.blockmap` + release notes.
3. **Publish** the artifact as a GitHub Release on the public releases-only repo
   (`gh release create <tag> <exe> <notes>`), pre-release until GA.
4. **Tester** downloads the `.exe` from the Releases URL — no account needed —
   or we hand them the URL / SSH the file to their instance.
5. **Verify** on their side with `docs/WINDOWS_INSTALL_RUNBOOK.md` + the
   `windows-smoke` checklist. Auto-update stays OFF in `PILOT_MODE`.
6. **Version** bump `0.4.3-moe.N` per shippable build.

## Open items

- Confirm whether `anton-claw` or a fresh `clawx-src` becomes the private source home.
- Decide releases-only-public vs scrub-and-stay-public for `clawx-pilot` (Decision 2).
- Password rotation (Decision 1) — owner action.
- Two unpushed local commits still carry the (now-redacted) phone number in
  history; scrub before any push if we push this branch.
