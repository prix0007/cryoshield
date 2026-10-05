#!/usr/bin/env bash
# Test double for `gh api` used by test/release-ref.test.mjs (split-dev-and-release-deploys). Logs every call to $GH_LOG.
#   GET repos/R/git/ref/tags/<tag>   -> $STUB_DIR/ref-<tag>.json   (HTTP 404 when missing)
#   GET repos/R/git/tags/<sha>       -> $STUB_DIR/tag-<sha>.json   (annotated tag objects; 404 when missing)
#   GET repos/R/git/ref/heads/main   -> $STUB_DIR/main.json
#   GET repos/R/compare/<a>...<b>    -> $STUB_DIR/compare.json
# STUB_FAIL_READS_PATH=<substring> makes matching reads fail with HTTP 500. Any write fails the test (exit 3).
set -euo pipefail
printf '%s\n' "$*" >> "$GH_LOG"
[ "${1:-}" = "api" ] || { echo "stub: only 'gh api' is supported" >&2; exit 2; }
shift
path="" jq_filter=""
while [ $# -gt 0 ]; do
  case "$1" in
    --jq|-q) jq_filter="$2"; shift 2 ;;
    -X|--method|-f|-F|--input) echo "stub: release-ref.sh must never write" >&2; exit 3 ;;
    -*) echo "stub: unknown flag $1" >&2; exit 2 ;;
    *) path="$1"; shift ;;
  esac
done
if [ -n "${STUB_FAIL_READS_PATH:-}" ] && [[ "$path" == *"$STUB_FAIL_READS_PATH"* ]]; then
  echo "gh: Server Error (HTTP 500)" >&2; exit 1
fi
case "$path" in
  repos/*/git/ref/tags/*) body="$STUB_DIR/ref-${path##*/git/ref/tags/}.json" ;;
  repos/*/git/tags/*) body="$STUB_DIR/tag-${path##*/}.json" ;;
  repos/*/git/ref/heads/main) body="$STUB_DIR/main.json" ;;
  repos/*/compare/*) body="$STUB_DIR/compare.json" ;;
  *) echo "stub: unexpected path $path" >&2; exit 2 ;;
esac
[ -f "$body" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
if [ -n "$jq_filter" ]; then jq -r "$jq_filter" "$body"; else cat "$body"; fi
