#!/usr/bin/env bash
# Test double for `gh api` used by test/supersede.test.mjs. Logs every call to $GH_LOG.
#   GET  repos/R/actions/runs/<id>                       -> $STUB_DIR/run-<id>.json
#   GET  repos/R/actions/workflows/deploy.yml/runs?...   -> $STUB_DIR/runs.json (status filter applied by the stub)
#   GET  repos/R/actions/runs/<id>/pending_deployments   -> $STUB_DIR/pending-<id>.json, or [] when missing
#   POST repos/R/actions/runs/<id>/cancel                -> ok (or fails when STUB_FAIL_WRITES is set)
set -euo pipefail
printf '%s\n' "$*" >> "$GH_LOG"
[ "${1:-}" = "api" ] || { echo "stub: only 'gh api' is supported" >&2; exit 2; }
shift
method=GET path="" jq_filter=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X|--method) method="$2"; shift 2 ;;
    --jq|-q) jq_filter="$2"; shift 2 ;;
    --paginate|--silent) shift ;;
    -*) echo "stub: unknown flag $1" >&2; exit 2 ;;
    *) path="$1"; shift ;;
  esac
done
[ -z "${STUB_FAIL_READS:-}" ] || { echo "HTTP 500" >&2; exit 1; }
if [ "$method" = "POST" ]; then
  [ -z "${STUB_FAIL_WRITES:-}" ] || { echo "HTTP 409: Cannot cancel" >&2; exit 1; }
  echo '{}'
  exit 0
fi
case "$path" in
  repos/*/actions/workflows/deploy.yml/runs*)
    status="$(sed -n 's/.*status=\([a-z_]*\).*/\1/p' <<<"$path")"
    jq --arg s "$status" '{workflow_runs: [.workflow_runs[] | select($s == "" or .status == $s)]}' "$STUB_DIR/runs.json" > "$STUB_DIR/.out" ;;
  repos/*/actions/runs/*/pending_deployments)
    id="$(sed -n 's#.*/runs/\([0-9]*\)/pending_deployments#\1#p' <<<"$path")"
    if [ -f "$STUB_DIR/pending-$id.json" ]; then cp "$STUB_DIR/pending-$id.json" "$STUB_DIR/.out"; else echo '[]' > "$STUB_DIR/.out"; fi ;;
  repos/*/actions/runs/*)
    id="${path##*/}"
    cp "$STUB_DIR/run-$id.json" "$STUB_DIR/.out" ;;
  *) echo "stub: unexpected path $path" >&2; exit 2 ;;
esac
if [ -n "$jq_filter" ]; then jq -r "$jq_filter" "$STUB_DIR/.out"; else cat "$STUB_DIR/.out"; fi
