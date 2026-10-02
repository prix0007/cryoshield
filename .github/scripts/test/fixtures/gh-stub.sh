#!/usr/bin/env bash
# Test double for `gh api` used by test/apply-sh.test.mjs. Logs every call to $GH_LOG and answers from
# fixture files in $STUB_DIR: rulesets.json (list), ruleset.json (detail), repo.json, labels.json, actions.json.
# Writes update the fixtures like GitHub would, unless STUB_STICKY is set (simulates a write that did not stick).
# STUB_FAIL_WRITES makes every write fail.
set -euo pipefail
printf '%s\n' "$*" >> "$GH_LOG"
[ "${1:-}" = "api" ] || { echo "stub: only 'gh api' is supported" >&2; exit 2; }
shift

method=GET path="" jq_filter="" input="" field_name=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X|--method) method="$2"; shift 2 ;;
    --jq|-q) jq_filter="$2"; shift 2 ;;
    --input) input="$2"; shift 2 ;;
    -f|-F|--field|--raw-field)
      case "$2" in name=*) field_name="${2#name=}" ;; esac
      shift 2 ;;
    --paginate|--silent) shift ;;
    -*) echo "stub: unknown flag $1" >&2; exit 2 ;;
    *) path="$1"; shift ;;
  esac
done

if [ "$method" != "GET" ]; then
  [ -z "${STUB_FAIL_WRITES:-}" ] || { echo "HTTP 403: Resource not accessible" >&2; exit 1; }
  if [ -z "${STUB_STICKY:-}" ]; then
    case "$method $path" in
      "POST repos/"*/rulesets)
        cp "$input" "$STUB_DIR/ruleset.json"
        echo '[{"id": 7, "name": "main", "target": "branch"}]' > "$STUB_DIR/rulesets.json" ;;
      "PUT repos/"*/rulesets/*) cp "$input" "$STUB_DIR/ruleset.json" ;;
      "PUT repos/"*/actions/permissions/workflow) cp "$input" "$STUB_DIR/actions.json" ;;
      "POST repos/"*/labels)
        jq --arg n "$field_name" '. + [{name: $n}]' "$STUB_DIR/labels.json" > "$STUB_DIR/l.tmp"
        mv "$STUB_DIR/l.tmp" "$STUB_DIR/labels.json" ;;
      "PATCH repos/"*)
        jq -s '.[0] * .[1]' "$STUB_DIR/repo.json" "$input" > "$STUB_DIR/r.tmp"
        mv "$STUB_DIR/r.tmp" "$STUB_DIR/repo.json" ;;
    esac
  fi
  echo '{}'
  exit 0
fi

case "$path" in
  repos/*/rulesets) body="$STUB_DIR/rulesets.json" ;;
  repos/*/rulesets/*) body="$STUB_DIR/ruleset.json" ;;
  repos/*/labels*) body="$STUB_DIR/labels.json" ;;
  repos/*/actions/permissions/workflow) body="$STUB_DIR/actions.json" ;;
  repos/*) body="$STUB_DIR/repo.json" ;;
  *) echo "stub: unexpected path $path" >&2; exit 2 ;;
esac

if [ -n "$jq_filter" ]; then
  jq -r "$jq_filter" "$body"
else
  cat "$body"
fi
