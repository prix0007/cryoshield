#!/usr/bin/env bash
# Test double used by test/release-diff.test.mjs.
#   As `gh api repos/R/compare/A...B [--jq F]`: answers from $STUB_DIR/compare.json (fails if STUB_FAIL_READS is set).
#   As curl (invoked with a URL ending in /release.json): prints $STUB_DIR/release.json, or fails like curl -f.
set -euo pipefail
printf '%s\n' "$*" >> "$GH_LOG"
if [ "${1:-}" != "api" ]; then
  for a in "$@"; do last="$a"; done
  case "${last:-}" in
    */release.json) [ -f "$STUB_DIR/release.json" ] || { echo "curl: (22) 404" >&2; exit 22; }; cat "$STUB_DIR/release.json"; exit 0 ;;
    *) echo "stub: unexpected curl call" >&2; exit 2 ;;
  esac
fi
shift
path="" jq_filter=""
while [ $# -gt 0 ]; do
  case "$1" in
    --jq|-q) jq_filter="$2"; shift 2 ;;
    -*) echo "stub: unknown flag $1" >&2; exit 2 ;;
    *) path="$1"; shift ;;
  esac
done
[ -z "${STUB_FAIL_READS:-}" ] || { echo "HTTP 500" >&2; exit 1; }
case "$path" in
  repos/*/compare/*) body="$STUB_DIR/compare.json" ;;
  *) echo "stub: unexpected path $path" >&2; exit 2 ;;
esac
if [ -n "$jq_filter" ]; then jq -r "$jq_filter" "$body"; else cat "$body"; fi
