# Codex Adversarial Review

Target: branch diff against 8473a8e6
Verdict: needs-attention

Do not ship: three reproduced failures omit policy safeguards or misreport coverage. The 16/20 score is internally consistent; inventory updates are consistent and existing safety gates remain intact.

Findings:
- [high] Return the policy text used to score each passage (extensions/moe-principal-assistant/nscc-lookup.mjs:155)
  30 of 324 shipped passages exceed 1,600 characters. Scoring considers their full text, but this truncation permanently discards their tails. For “Must parents be notified before teachers require social media for learning projects?”, the correct passage ranks first, yet its requirement “parents must be notified beforehand” starts at offset 1,720 and is absent from every returned excerpt. Even an exact-phrase query cannot expose the operative requirement.
  Recommendation: Return complete scored passages or split them within the excerpt budget without discarding content. Add a regression asserting the parent-notification requirement is returned.
- [high] Keep continued safeguards together across page breaks (extensions/moe-principal-assistant/nscc-lookup.mjs:87-88)
  Emitting each sufficiently long block independently separates the four-part suspension/expulsion safeguards list at a page break. NSCC-Q03 retrieves clauses (a) and (b), while the separate continuation containing the child's best interests and applicable Minister decision is excluded. The committed tool-lane answer demonstrably omits both conditions. This produces incomplete guidance on serious disciplinary measures.
  Recommendation: Join page-break continuations and preserve list context, or include adjacent continuation passages within the retrieval budget. Require all four Q03 safeguards in a retrieval regression.
- [medium] Do not interpret a lexical miss as absent policy (extensions/moe-principal-assistant/persona.mjs:22)
  The query “Is it okay to smack pupils?” reproducibly returns zero passages, although the shipped text explicitly prohibits corporal and physical punishment. This instruction then requires the assistant to say the Code does not appear to cover it. A vocabulary mismatch therefore becomes misleading policy guidance instead of an acknowledged retrieval failure.
  Recommendation: Distinguish retrieval failure from document coverage in both persona and tool notes. Retry with policy terminology; if unresolved, report that relevant text could not be retrieved. Add colloquial-query regressions.

Next steps:
- Fix these three cases and rerun retrieval and tool-lane evaluations.
- Run the targeted Vitest suites in a writable environment; sandbox temp-file restrictions blocked them here. Direct Node reproductions confirmed the findings.

[exited with code 0]
