# Codex Adversarial Review

Target: branch diff against 99977356
Verdict: needs-attention

Do not ship: isolated probes reproduced a subject-gate bypass, false-PASS gate proof, content leakage, and unsafe timeout behavior. Vitest could not start under the read-only filesystem restrictions.

Findings:
- [high] The advertised send arguments bypass subject verification (scripts/clawx-mcp-server.mjs:139-147)
  The normal {confirm:true, subject:'...'} call omits to/body. OutlookActions.sendEmail checks subject equality only when all three assertions are present; otherwise clickSendInCurrentReviewedDraft drops the subject. A probe using the actual adapter and host actions against a fixture DOM clicked Send with a mismatching subject. Omitting subject also reached the host because the low-level SDK does not enforce the advertised inputSchema. An unrelated open draft can therefore be sent despite the claimed second gate.
  Recommendation: Enforce runtime argument validation and mandatory subject matching in the host's atomic send check, independently of recipient/body assertions. Refuse backend paths that cannot provide this guarantee.
- [high] Transport failures conceal potentially completed sends (scripts/clawx-mcp-server.mjs:220-228)
  A connection failure after dispatch is reported as 'not reachable', although send/submit may already have occurred. This loses the status:'unknown' and explicit no-retry warning provided by the existing Outlook facade. The handler also ignores MCP cancellation: a timed-out probe continued its fetch and completed a simulated send. The SDK defaults to 60 seconds while this adapter allows 180 seconds. Retrying an apparently failed operation can duplicate irreversible actions.
  Recommendation: Preserve an explicit unknown-outcome/no-automatic-retry result for dispatched mutations. Propagate cancellation where operations remain cancellable and provide operation reconciliation or deduplication before permitting retries.
- [medium] Caller-controlled key names leak content into stderr (scripts/clawx-mcp-server.mjs:159-164)
  Argument names are untrusted content. A valid MCP call containing a key with confidential text and a newline reproduced both content disclosure and a forged log line. Even forms_list accepted the key despite additionalProperties:false, since schemas are only advertised. The existing log test exercises confidential values under benign keys and misses this path.
  Recommendation: Log only fixed, allowlisted field labels and counts; summarize unknown keys numerically without emitting their names. Add runtime stderr assertions with confidential and control-character key names.
- [medium] The handshake accepts a downstream refusal as confirm-gate proof (scripts/clwx71-mcp-handshake.ts:145-148)
  Searching for 'refused' and any occurrence of 'confirm' does not identify the confirm gate. The actual host returns 'No open draft found. Call draftEmail first and confirm with the user before retrying send.' for a confirmed call without a draft. Running the exact harness against a mutation that added confirm:true produced exit 0 and VERDICT: PASS with that response. The proof therefore passes when the invariant it claims to verify is broken.
  Recommendation: Parse the response and require a dedicated confirm-required gate code. Add mutation tests and assertions that refusal occurs before browser actions; do not infer 'never sent' from status text alone.
- [medium] The registration example puts the bearer token in argv (docs/MCP_ADAPTER.md:26-27)
  Substituting a real token into this command passes it as an argument to the claude registration process. Supplying it to the eventual server through environment variables does not remove that earlier argv exposure. This contradicts the documented env-only contract and exposes the credential to process-argument capture.
  Recommendation: Document a token-free registration launcher that acquires the per-boot token in memory and supplies it only through the server child's environment. Remove the equivalent example from the server header.

Next steps:
- Add mocked MCP regression tests covering these failures before repeating the live handshake.
- Rerun Vitest with writable temporary storage. No live email or form submission was performed during this review.

[exited with code 0]
