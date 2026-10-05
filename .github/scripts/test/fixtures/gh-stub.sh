#!/usr/bin/env bash
# Test double for `gh api` used by test/apply-sh*.test.mjs. Logs every call to $GH_LOG and answers from
# fixture files in $STUB_DIR: rulesets.json (list), ruleset-<id>.json (detail; ruleset.json for any id without its own
# file, i.e. main = 7), repo.json, labels.json, actions.json,
# user.json, env-<name>.json + policies-<name>.json (environments), actions-perms.json, asf.json
# (automated-security-fixes) and the marker file va.on (vulnerability alerts enabled). A missing env-*, asf.json
# or va.on answers HTTP 404 like GitHub.
# Writes update the fixtures like GitHub would, unless STUB_STICKY is set (simulates a write that did not stick).
# STUB_FAIL_WRITES makes every write fail; STUB_FAIL_READS_PATH=<substring> makes matching reads fail with HTTP 500.
set -euo pipefail
printf '%s\n' "$*" >> "$GH_LOG"
[ "${1:-}" = "api" ] || { echo "stub: only 'gh api' is supported" >&2; exit 2; }
shift

method=GET path="" jq_filter="" input="" field_name="" field_type=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X|--method) method="$2"; shift 2 ;;
    --jq|-q) jq_filter="$2"; shift 2 ;;
    --input) input="$2"; shift 2 ;;
    -f|-F|--field|--raw-field)
      case "$2" in name=*) field_name="${2#name=}" ;; type=*) field_type="${2#type=}" ;; esac
      shift 2 ;;
    --paginate|--silent) shift ;;
    -*) echo "stub: unknown flag $1" >&2; exit 2 ;;
    *) path="$1"; shift ;;
  esac
done

not_found() { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
env_of() { local n="${1#repos/*/environments/}"; printf '%s' "${n%%/*}"; }

if [ "$method" != "GET" ]; then
  [ -z "${STUB_FAIL_WRITES:-}" ] || { echo "HTTP 403: Resource not accessible" >&2; exit 1; }
  # Keep request bodies (apply.sh deletes its temp dir): body-<METHOD>-<last path segment>.json.
  [ -z "$input" ] || cp "$input" "$STUB_DIR/body-$method-${path##*/}.json"
  if [ -z "${STUB_STICKY:-}" ]; then
    case "$method $path" in
      "POST repos/"*/rulesets)
        # main gets id 7 (detail in ruleset.json); any other ruleset id 8 (detail in ruleset-8.json). Upsert the list.
        rname="$(jq -r .name "$input")"
        rtarget="$(jq -r .target "$input")"
        if [ "$rname" = "main" ]; then rid=7; cp "$input" "$STUB_DIR/ruleset.json"; else rid=8; cp "$input" "$STUB_DIR/ruleset-8.json"; fi
        [ -f "$STUB_DIR/rulesets.json" ] || echo '[]' > "$STUB_DIR/rulesets.json"
        jq --argjson id "$rid" --arg n "$rname" --arg t "$rtarget" 'map(select(.id != $id)) + [{id: $id, name: $n, target: $t}]' \
          "$STUB_DIR/rulesets.json" > "$STUB_DIR/rs.tmp"
        mv "$STUB_DIR/rs.tmp" "$STUB_DIR/rulesets.json" ;;
      "PUT repos/"*/rulesets/*)
        if [ -f "$STUB_DIR/ruleset-${path##*/}.json" ]; then cp "$input" "$STUB_DIR/ruleset-${path##*/}.json"; else cp "$input" "$STUB_DIR/ruleset.json"; fi ;;
      "PUT repos/"*/actions/permissions/workflow) cp "$input" "$STUB_DIR/actions.json" ;;
      "PUT repos/"*/actions/permissions) cp "$input" "$STUB_DIR/actions-perms.json" ;;
      "PUT repos/"*/vulnerability-alerts) : > "$STUB_DIR/va.on" ;;
      "PUT repos/"*/automated-security-fixes) echo '{"enabled": true, "paused": false}' > "$STUB_DIR/asf.json" ;;
      "POST repos/"*/environments/*/deployment-branch-policies)
        n="$(env_of "$path")"
        jq --arg name "$field_name" --arg type "$field_type" \
          '.branch_policies += [{id: (100 + (.branch_policies | length)), name: $name, type: $type}] | .total_count = (.branch_policies | length)' \
          "$STUB_DIR/policies-$n.json" > "$STUB_DIR/p.tmp"
        mv "$STUB_DIR/p.tmp" "$STUB_DIR/policies-$n.json" ;;
      "DELETE repos/"*/environments/*/deployment-branch-policies/*)
        n="$(env_of "$path")"
        jq --argjson id "${path##*/}" '.branch_policies |= map(select(.id != $id)) | .total_count = (.branch_policies | length)' \
          "$STUB_DIR/policies-$n.json" > "$STUB_DIR/p.tmp"
        mv "$STUB_DIR/p.tmp" "$STUB_DIR/policies-$n.json" ;;
      "PUT repos/"*/environments/*)
        n="$(env_of "$path")"
        # Answer GETs in GitHub's shape: protection_rules, not the request body.
        jq --arg n "$n" '{name: $n, can_admins_bypass: (if has("can_admins_bypass") then .can_admins_bypass else true end),
            deployment_branch_policy: .deployment_branch_policy,
            protection_rules: ([if ((.reviewers // []) | length) > 0 then {type: "required_reviewers", prevent_self_review: (.prevent_self_review // false),
                                  reviewers: [.reviewers[] | {type, reviewer: {id}}]} else empty end]
                               + [if (.wait_timer // 0) > 0 then {type: "wait_timer", wait_timer} else empty end]
                               + [if .deployment_branch_policy then {type: "branch_policy"} else empty end])}' \
          "$input" > "$STUB_DIR/env-$n.json"
        [ -f "$STUB_DIR/policies-$n.json" ] || echo '{"total_count": 0, "branch_policies": []}' > "$STUB_DIR/policies-$n.json" ;;
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

if [ -n "${STUB_FAIL_READS_PATH:-}" ] && [[ "$path" == *"$STUB_FAIL_READS_PATH"* ]]; then
  echo "gh: Server Error (HTTP 500)" >&2; exit 1
fi
case "$path" in
  users/*) body="$STUB_DIR/user.json" ;;
  repos/*/rulesets) body="$STUB_DIR/rulesets.json" ;;
  repos/*/rulesets/*)
    body="$STUB_DIR/ruleset-${path##*/}.json"
    [ -f "$body" ] || body="$STUB_DIR/ruleset.json" ;;
  repos/*/labels*) body="$STUB_DIR/labels.json" ;;
  repos/*/actions/permissions/workflow) body="$STUB_DIR/actions.json" ;;
  repos/*/actions/permissions) body="$STUB_DIR/actions-perms.json" ;;
  repos/*/vulnerability-alerts) [ -f "$STUB_DIR/va.on" ] || not_found; exit 0 ;;
  repos/*/automated-security-fixes) body="$STUB_DIR/asf.json" ;;
  repos/*/environments/*/deployment-branch-policies*) body="$STUB_DIR/policies-$(env_of "$path").json" ;;
  repos/*/environments/*) body="$STUB_DIR/env-$(env_of "$path").json" ;;
  repos/*) body="$STUB_DIR/repo.json" ;;
  *) echo "stub: unexpected path $path" >&2; exit 2 ;;
esac
[ -f "$body" ] || not_found

if [ -n "$jq_filter" ]; then
  jq -r "$jq_filter" "$body"
else
  cat "$body"
fi
