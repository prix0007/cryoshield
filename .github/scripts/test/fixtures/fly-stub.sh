#!/usr/bin/env bash
# Test double for flyctl used by test/deploy-scripts.test.mjs. Logs every call to $FLY_LOG.
#   fly releases ... --json --image  -> prints $STUB_RELEASES (a JSON file)
#   fly deploy ...                   -> succeeds, unless STUB_FLY_FAIL is set
set -euo pipefail
printf '%s\n' "$*" >> "$FLY_LOG"
[ -z "${STUB_FLY_FAIL:-}" ] || { echo "Error: unauthorized" >&2; exit 1; }
case "${1:-}" in
  releases) cat "$STUB_RELEASES" ;;
  deploy) echo "deployed" ;;
  *) echo "stub: unsupported fly command $1" >&2; exit 2 ;;
esac
