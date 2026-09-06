# Codex Adversarial Review

Target: branch diff against c9c0c5f2
Verdict: needs-attention

Do not ship: transport can validate an unstaged plugin, and the fast gate can silently omit required rows.

Findings:
- [high] Isolate configuration and plugin discovery roots (/Users/antonalexander/Github/moe-tt/ClawX/scripts/harness-artifact.mjs:718-725)
  The inherited OPENCLAW_CONFIG_PATH overrides OPENCLAW_STATE_DIR in the bundled gateway, bypassing the config written here. An existing developer plugin can then satisfy checkTransportInspect because it never verifies the plugin source. Probes confirmed both the override precedence and acceptance of an unstaged source. Additionally, the default workspace remains under the user's home, allowing discovery outside the stage.
  Recommendation: Use an allowlisted environment, explicitly pin configuration and home/workspace roots inside the stage, and require the reported plugin ID and canonical source to match the staged entry.
- [medium] Reject incomplete fast subsets at runtime (/Users/antonalexander/Github/moe-tt/ClawX/scripts/harness-artifact.mjs:901-907)
  The filter rejects only an empty selection. In an in-memory execution with passing child outcomes, renaming the PDF row silently removed both PDF variants: --fast exited 0 with 6 of 8 required rows. The unit drift guard does not protect package paths such as package:linux and release, which omit preflight.
  Recommendation: Before spawning, require every FAST_ROW_IDS entry to resolve exactly once and fail on missing or duplicate IDs. Test the actual selector with renamed and missing rows.
- [medium] Terminate the respawned gateway on timeout (/Users/antonalexander/Github/moe-tt/ClawX/scripts/harness-artifact.mjs:743-746)
  With the default environment, the staged CLI respawns itself to add its warning flag. This SIGKILL terminates only the wrapper; its signal bridge cannot forward SIGKILL. A controlled probe using that bridge confirmed the grandchild survives. A hanging plugin therefore continues running after the row fails and can outlive stage cleanup and subsequent runs.
  Recommendation: Set OPENCLAW_NO_RESPAWN=1 for transport probes and ensure timeout cleanup terminates and awaits any descendants before removing their stage.

Next steps:
- Add negative controls for external configuration, missing fast rows, and hanging gateway descendants.
- Run targeted Vitest and full/fast artifact checks after fixes; Vitest execution here was blocked by the read-only filesystem.

[exited with code 0]
