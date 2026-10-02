#!/usr/bin/env bash
# Test double for `gh api` used by test/apply-sh.test.mjs. Logs every call to $GH_LOG and answers
# from fixture files in $STUB_DIR: rulesets.json (list), ruleset.json (detail), repo.json, labels.json.
set -euo pipefail
printf '%s\n' "$*" >> "$GH_LOG"
[ "${1:-}" = "api" ] || { echo "stub: only 'gh api' is supported" >&2; exit 2; }
shift

method=GET path="" jq_filter=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X|--method) method="$2"; shift 2 ;;
    --jq|-q) jq_filter="$2"; shift 2 ;;
    --input|-f|-F|--field|--raw-field) shift 2 ;;
    --paginate|--silent) shift ;;
    -*) echo "stub: unknown flag $1" >&2; exit 2 ;;
    *) path="$1"; shift ;;
  esac
done

if [ "$method" != "GET" ]; then
  [ -z "${STUB_FAIL_WRITES:-}" ] || { echo "HTTP 403: Resource not accessible" >&2; exit 1; }
  echo '{}'
  exit 0
fi

case "$path" in
  repos/*/rulesets) body="$STUB_DIR/rulesets.json" ;;
  repos/*/rulesets/*) body="$STUB_DIR/ruleset.json" ;;
  repos/*/labels*) body="$STUB_DIR/labels.json" ;;
  repos/*) body="$STUB_DIR/repo.json" ;;
  *) echo "stub: unexpected path $path" >&2; exit 2 ;;
esac

if [ -n "$jq_filter" ]; then
  jq -r "$jq_filter" "$body"
else
  cat "$body"
fi
