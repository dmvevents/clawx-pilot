#!/usr/bin/env bash
# CLWX-84 grep gate — scan local operational surfaces for credential shapes.
#
# Usage: bash scripts/security-credential-grep.sh [ROOT ...]
#   Default roots: ~/openclaw-agent and ~/fleet-mailbox (the liaison-monitor
#   surfaces where chat-shared secrets have landed before).
#
# Prints file + count ONLY — never the matched text — so the gate itself can
# never become a new leak. Exit 1 on any hit (triage before the security
# sitting), 0 when clean. Shapes, not values: no plaintext credential may
# ever live in this file.
set -uo pipefail

if [ "$#" -gt 0 ]; then
  ROOTS=("$@")
else
  ROOTS=("$HOME/openclaw-agent" "$HOME/fleet-mailbox")
fi

PASSWORD_KV_PAT='[Pp]ass(word|wd)[[:space:]]*[:=][[:space:]]*[^[:space:]]+'  # password: value / password=value

PATTERNS=(
  '[A-Za-z][A-Za-z0-9]*@[0-9]{4}([^0-9A-Za-z]|$)'              # word@NNNN password style (boundary skips repo@sha refs)
  '[A-Z][a-z]+[A-Z][A-Za-z]+[0-9]{2,}%'                        # CamelCase+digits+percent temp-password style (skips disk64% metrics)
  "$PASSWORD_KV_PAT"
  '(^|[^A-Za-z0-9])sk-(ant|proj)?-?[A-Za-z0-9_-]{20,}'         # API key prefixes (boundary skips disk-/task- slugs)
  '(^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}'                           # AWS access key id
  '(^|[^A-Za-z0-9])ghp_[A-Za-z0-9]{30,}'                       # GitHub PAT
)

# Applied ONLY to the password-kv pattern: `password: $VAR` / process.env refs
# are code, not a leak. Value shapes are never excused this way — a plaintext
# value sharing a line with an env reference must still count.
ALLOW_LINE_RE='(process\.env|os\.environ|getenv|[Pp]ass(word|wd)[[:space:]]*[:=][[:space:]]*("?\$|%[A-Za-z_]+%|\[REDACTED))'

# Vendored/third-party trees are excluded; local archives are NOT (secrets hide there).
GREP_EXCLUDES=(
  --exclude-dir=node_modules
  --exclude-dir=.git
  --exclude-dir=__pycache__
  --exclude-dir='*venv*'
  --exclude-dir=site-packages
  --exclude-dir='*.dist-info'
)

total=0
for root in "${ROOTS[@]}"; do
  [ -e "$root" ] || continue
  for pat in "${PATTERNS[@]}"; do
    while IFS= read -r file; do
      case "$file" in
        *REDACTION_*|*.sha256|*/.git/*|*SHA256SUMS*) continue ;;
      esac
      if [ "$pat" = "$PASSWORD_KV_PAT" ]; then
        count="$(grep -IE "$pat" "$file" 2>/dev/null | grep -vcE "$ALLOW_LINE_RE" || true)"
      else
        count="$(grep -IcE "$pat" "$file" 2>/dev/null || true)"
      fi
      [ -z "$count" ] || [ "$count" -eq 0 ] && continue
      echo "HIT: $file — $count line(s) matching shape: $pat"
      total=$((total + count))
    done < <(grep -rIlE "${GREP_EXCLUDES[@]}" "$pat" "$root" 2>/dev/null)
  done
done

if [ "$total" -gt 0 ]; then
  echo "RESULT: $total credential-shape hit(s) — triage before the security sitting (CLWX-84)."
  exit 1
fi
echo "RESULT: clean"
exit 0
