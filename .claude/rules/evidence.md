---
paths:
  - "docs/**/*.md"
  - "docs/plane-board/**/*.json"
  - "docs/release-manifests/**/*.json"
---

# Documentation and Plane evidence

Use the truth-source table in `docs/PROJECT_CONTRACT.md`. Synchronize the completion plan, candidate pointer and evidence manifest when a change affects those facts; retain dated failed evidence. Keep technical research and runbooks separate from current release status.

For a defect, update its existing Plane card and `docs/bugs` report before inventing a duplicate. Use `scripts/plane-comment-post.mjs` with the verified CLWX project identity and verify readback before refreshing the board export. Agents can move a card to Ready only with its full acceptance evidence; humans close Done.

Record criterion, revision, artifact when applicable, environment, timestamp, command, result and evidence location. Source checks, package checks, installed behavior, authenticated-account tests and stakeholder acceptance remain separate. Unknown evidence is NOT_RUN or BLOCKED, never PASS.
