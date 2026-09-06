# Codex adversarial review — CLWX-103 board-comment poster (2026-09-06)

Lane: cross-model adversary (§3b, additive — never replaces the Claude lenses).
Runner: `codex-companion.mjs adversarial-review` (codex-cli 0.153.4, active pin
`gpt-6-astra`, allowlisted). Target: branch diff against `046766ba`
(commit `83ef926b`: `scripts/plane-comment-post.mjs` + skill-doc row +
state-vector delta). Focus: readback-verify genuinely catches the cross-project
orphan class; pagination; payload handling; secret hygiene; exit-code contract;
docs honesty.

## Verdict (verbatim)

> Verdict: needs-attention
>
> Do not ship: reproduced credential leakage, wrong-card posting, and silent
> payload corruption. Mocked orphan and page-two checks passed; historical
> audit/deletion claims remain unverified.
>
> Findings:
> - [high] Prevent native fetch errors from exposing the API key
>   (scripts/plane-comment-post.mjs:57-60) — With an embedded newline in
>   PLANE_API_KEY, native fetch throws a Headers.append error containing the
>   entire credential. Reproduced with a synthetic key: both --card's uncaught
>   exception and --issue's e.message logging expose it on stderr.
> - [medium] Reject foreign card prefixes before posting
>   (scripts/plane-comment-post.mjs:109-113) — The regex accepts any alphabetic
>   prefix and discards it. In a mocked run, --card GHIP-83 posted to CLWX-83
>   and exited 0 with readback verification.
> - [medium] Preserve UTF-8 characters across stdin chunks
>   (scripts/plane-comment-post.mjs:82-85) — Each Buffer is independently
>   converted to text by d += c. Mocked-fetch run with € split across two stdin
>   writes produced comment_html '<p>���</p>', posted it, and exited 0.

Positive legs from the same run: the mocked ORPHAN case (created comment not
readable under the project path) exits non-zero; the mocked page-two case (a
just-posted comment landing on the second list page of a >100-comment card) is
found by the cursor loop; `node --check` clean.

## Triage — all three CONFIRMED, fixed same tick, re-proven

1. **[high] key leak** → FIXED: `PLANE_API_KEY` validated against
   `/^[\x21-\x7E]+$/` with a fixed diagnostic before any request can throw;
   `scrub()` replaces the key value in any dynamic error text; top-level
   `uncaughtException`/`unhandledRejection` handlers print scrubbed messages
   only. Re-proof: synthetic `sk-synthetic\nLEAKME` key → stderr contains the
   fixed diagnostic, `grep -c LEAKME` = 0, exit 1 (no network attempted).
2. **[medium] foreign prefix** → FIXED: the card prefix must equal the board's
   canonical `project.identifier` (fetched from the API, case-insensitive).
   Re-proof: `--card GHIP-83` → `FAIL: card prefix "GHIP" is not this board's
   identifier "CLWX" — refusing to cross-post`, exit 1, pre-write.
3. **[medium] stdin multibyte** → FIXED: `process.stdin.setEncoding('utf8')`
   before reading. Re-proof: Readable pushing `<p>€€€</p>` split mid-multibyte
   (5-byte / remainder) through the identical pattern reassembles intact.

Regressions re-run after the fixes: unknown card (`CLWX-99999`) exit 1;
malformed card exit 1; `node --check` clean.

"Historical audit/deletion claims remain unverified" (Codex could not re-run
them): those legs are session evidence, not code — the 0-mismatch audit
(102 issues, live list vs export), the 5 reconcile posts (readback-verified ids
in the tick transcript), and the 5 GHIP orphan deletes (5×204, DB live-row
count 0) are recorded in the state-vector 2026-09-06 third-tick delta and the
CLWX-103 card body.

No gate loosened. Claude lenses ran as the required lane in the same tick
(separate workflow, fresh contexts); this lane is additive.
