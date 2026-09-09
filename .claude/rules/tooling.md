---
paths:
  - "scripts/**/*.py"
  - "scripts/**/*.mjs"
  - "scripts/**/*.sh"
  - ".claude/hooks/**/*"
  - ".claude/settings.json"
  - ".github/workflows/**/*"
---

# CLI, hooks and automation

Read `docs/CLAUDE_CODE_OPERATIONS.md` for the selected CLI lane. Preserve `scripts/claude-runner.py` receipts, explicit deadlines and configured-versus-observed model/provider reporting. `CLI_SUCCEEDED` is process evidence, not task acceptance. Bare lanes do not automatically load the interactive session's hooks, LSP or instructions.

Use argument arrays for subprocesses, explicit cwd, bounded waits and redacted output. Hook commands quote paths; a hook that needs the active worktree reads the event's `cwd`, since `CLAUDE_PROJECT_DIR` stays at the launch root. Keep hooks small and deterministic. Do not start a build, GUI, remote mutation, paid reviewer or full test suite from an edit/Stop hook.

CI changes follow `docs/build/windows-build-pipeline.md`. Preserve exact source/artifact provenance and failure exit codes. Inspect the current command's side effects before running it.
