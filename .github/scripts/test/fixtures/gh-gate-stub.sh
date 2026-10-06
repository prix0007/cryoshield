#!/usr/bin/env bash
# Test double for `gh`, used by test/author-gate.test.mjs to run the trusted-author gate steps of ecc-review.yml and
# auto-merge.yml (OpenSpec change gate-external-pr-automation). Logs every call to $GH_LOG.
#   contents/.github/trusted-authors.json  -> $STUB_LIST          (STUB_LIST_FAIL=1: HTTP 404)
#   issues/<n>/comments                     -> $STUB_COMMENTS      (STUB_COMMENTS_FAIL=1: HTTP 500)
#   pr merge ...                            -> ok
set -euo pipefail
printf '%s\n' "$*" >> "$GH_LOG"
case "$*" in
  *"contents/.github/trusted-authors.json?ref="*)
    [ -z "${STUB_LIST_FAIL:-}" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
    printf '%s\n' "${STUB_LIST:-}" ;;
  *"/comments?"*)
    [ -z "${STUB_COMMENTS_FAIL:-}" ] || { echo "gh: Server Error (HTTP 500)" >&2; exit 1; }
    printf '%s\n' "${STUB_COMMENTS:-[]}" ;;
  "pr merge "*) ;;
  *) echo "stub: unexpected gh call: $*" >&2; exit 2 ;;
esac
