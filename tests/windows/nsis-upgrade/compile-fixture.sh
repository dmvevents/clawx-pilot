#!/bin/sh
# Compile the CLWX-135/25 upgrade fixture with the pinned electron-builder
# NSIS 3.0.4.1 (mac makensis, reports v3.04). No GUI, no install run.
#
# Usage:
#   tests/windows/nsis-upgrade/compile-fixture.sh [prepare-source.nsh]
#
#   prepare-source.nsh  Reviewed source defining !macro
#                       ClawXPrepareInstallDirectory. Defaults to
#                       ../../../scripts/installer.nsh (fails with a clear
#                       !error until the author lands the macro there).
#                       Pass contract-compile-check.nsh for a compile-only
#                       validation build that always aborts at runtime.
#
# Env: NSISDIR overrides the NSIS root; CLAWX_FIXTURE_OUT_DIR the output dir.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
NSISDIR="${NSISDIR:-$HOME/Library/Caches/electron-builder/nsis/nsis-3.0.4.1}"
export NSISDIR # makensis resolves stubs/headers via the explicit compiler root
MAKENSIS="$NSISDIR/mac/makensis"
[ -x "$MAKENSIS" ] || { echo "makensis not found/executable at $MAKENSIS" >&2; exit 2; }

PREPARE_SOURCE="${1:-$HERE/../../../scripts/installer.nsh}"
[ -f "$PREPARE_SOURCE" ] || { echo "prepare source not found: $PREPARE_SOURCE" >&2; exit 2; }
PREPARE_SOURCE="$(cd "$(dirname "$PREPARE_SOURCE")" && pwd)/$(basename "$PREPARE_SOURCE")"

OUT_DIR="${CLAWX_FIXTURE_OUT_DIR:-$HERE/out}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)" # OutFile must be absolute regardless of CWD

echo "compiler: $MAKENSIS ($("$MAKENSIS" -VERSION 2>/dev/null || true))"
echo "prepare source: $PREPARE_SOURCE"
# Tie the build to frozen content, not a moving worktree revision claim.
echo "prepare source sha256: $(shasum -a 256 "$PREPARE_SOURCE" | cut -d' ' -f1)"
exec "$MAKENSIS" -V3 \
  -DCLAWX_PREPARE_SOURCE="$PREPARE_SOURCE" \
  -DCLAWX_FIXTURE_OUTFILE="$OUT_DIR/clawx-upgrade-prepare-fixture.exe" \
  "$HERE/fixture.nsi"
