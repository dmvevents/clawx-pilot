---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "electron/**/*.ts"
  - "tests/**/*.ts"
  - "tests/**/*.tsx"
---

# TypeScript and React

Use the repository's TypeScript configuration and pnpm scripts. Use LSP definitions/references when available to trace existing ownership before adding another implementation; diagnostics complement focused tests and `pnpm typecheck`.

Renderer code uses `src/lib/host-api.ts` and `src/lib/api-client.ts`. Main owns transport and run lifecycle. Backend changes require the existing harness task contract. React views display confirmed runtime state; a saved preference is not a runtime acknowledgement.

Preserve meaningful regression coverage at the public boundary. Use `pnpm lint:check` for review; `pnpm lint` mutates files. Do not launch Electron or the full GA gate as an automatic edit hook. Read `docs/PROJECT_CONTRACT.md` for the applicable integration checks and owner holds.
