#!/usr/bin/env bash
# vm-verify-installed.sh — version-neutral entrypoint for the Windows VM
# installed-acceptance producer.
#
# Why this file exists: the engine's historical name (vm-verify-moe19.sh) and
# its moe.19 defaults are load-bearing for existing tests, runbooks and
# operator muscle memory, but every future candidate needs an invocation that
# carries NO version assumption at all. This wrapper therefore:
#  - REQUIRES --exe, --version and --manifest (there is no candidate default
#    here — a missing identity is a config error, never a silently-inherited
#    moe.19, and the release manifest is the exact identity contract the
#    engine equality-checks: version, installer name, sha256);
#  - REFUSES explicitly empty --exe=/--version=/--manifest= values (an unset
#    shell variable in a CI wrapper must fail loudly, not inherit moe.19);
#  - forwards every argument unchanged to the engine, so phases, hash and
#    provenance validation, fail-closed missing evidence and the
#    installed-release-evidence.mjs output layout stay identical;
#  - performs no cloud, SSH, download, install or auth action of its own.
#
# Usage:
#   bash scripts/vm-verify-installed.sh --exe "release/Ministry of Education-<v>-win-x64.exe" \
#     --version <v> --manifest <release-manifest.json> [--guest-exe-name <name>.exe] \
#     [--gcs-dest gs://bucket/prefix/] [--expect-file-version <token>] [--print-config]
#
# Exit: forwarded from the engine — 0 green / valid --print-config;
#       2 config or version/hash mismatch (fail-closed); 3 BLOCKED; 1 FAIL.
set -euo pipefail

ENGINE="$(cd "$(dirname "$0")" && pwd)/vm-verify-moe19.sh"
[ -f "$ENGINE" ] || { echo "config error: verify engine not found: $ENGINE" >&2; exit 2; }

HAS_EXE=false
HAS_VERSION=false
HAS_MANIFEST=false
for arg in "$@"; do
  case "$arg" in
    --exe=|--version=|--manifest=)
      echo "config error: ${arg%=} must carry a non-empty value — an explicitly empty flag never inherits a candidate identity" >&2
      exit 2
      ;;
    --exe|--exe=?*) HAS_EXE=true ;;
    --version|--version=?*) HAS_VERSION=true ;;
    --manifest|--manifest=?*) HAS_MANIFEST=true ;;
    -h|--help) HAS_EXE=true; HAS_VERSION=true; HAS_MANIFEST=true ;;
  esac
done
if [ "$HAS_EXE" != "true" ] || [ "$HAS_VERSION" != "true" ] || [ "$HAS_MANIFEST" != "true" ]; then
  cat >&2 <<'USAGE'
config error: vm-verify-installed.sh requires BOTH --exe and --version, plus
--manifest (the release-manifest identity contract).
This entrypoint never inherits a candidate identity; an installed acceptance
run must name the artifact it is judging and the manifest that binds it.
usage: bash scripts/vm-verify-installed.sh --exe <installer.exe> --version <app-version>
         --manifest <release-manifest.json> [--guest-exe-name <name>.exe]
         [--gcs-dest gs://bucket/prefix/] [--expect-file-version <token>]
         [--print-config]
USAGE
  exit 2
fi

# Bare-flag empty values (--exe "" / --version "") are caught by the engine's
# explicit-empty check before any cloud, hash or evidence action.
exec bash "$ENGINE" "$@"
