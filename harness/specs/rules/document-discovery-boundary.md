---
id: document-discovery-boundary
title: Bounded local document discovery
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
---

Named local document lookup returns metadata and exact candidate paths through
`document.find`. Use the existing permitted user folders and canonical home/temp
sandbox; no shell execution, file-content indexing or arbitrary network paths.
Bound recursion, entries and returned candidates, and report incomplete scans.
Readers retain exact path semantics. Multiple plausible or incompletely searched
candidates must not become an automatic content read of a guessed file.

Installed acceptance must use the original principal prompt and actual document
tools. Direct parser checks and a more explicit test prompt do not prove that the
ordinary named-document journey works.
