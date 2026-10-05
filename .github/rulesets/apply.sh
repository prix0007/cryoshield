#!/usr/bin/env bash
# Applies the committed main-branch protection to GitHub (OpenSpec change adopt-pr-workflow, decision 2).
#
#   .github/rulesets/apply.sh                 # dry run: print the diff (exit 0 in sync, 3 on drift)
#   .github/rulesets/apply.sh --apply         # write only what differs, then re-check (exit 1 if still drifted)
#   .github/rulesets/apply.sh --repo o/r ...  # another repository (default: prix0007/cryoshield)
#   .github/rulesets/apply.sh --with-ecc-review [--apply]
#                                             # also require the `ecc-review` check (ecc-review-check.json). Use
#                                             # only after the CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY secret
#                                             # exists, and keep passing it afterwards: without the flag, --apply
#                                             # refuses to drop a live ecc-review requirement.
#   .github/rulesets/apply.sh --environments [--apply]
#                                             # also the deploy environments (environments.json; changes
#                                             # gate-production-deploys, split-dev-and-release-deploys): `production`
#                                             # (Fly token) and `production-build` (build config) deploy from main and
#                                             # v* tags; `development` and `development-build` from main only. No
#                                             # admin bypass. Extra branch/tag policies are removed. The repo owner is
#                                             # looked up only if an environment names "@owner" as a reviewer.
#   .github/rulesets/apply.sh --founder-hardening [--apply]
#                                             # also Dependabot security updates and "require actions pinned to a
#                                             # full-length commit SHA" (actions-hardening.json). Off unless passed.
#
# Covers: rulesets main.json (branch) and release-tags.json (tag: only admins may create, move or delete v* tags,
# so only the owner can cut a production release; split-dev-and-release-deploys), each by name and target, repo merge settings (repo-settings.json, incl. auto-merge), Actions
# workflow permissions (actions-permissions.json: read-only token, Actions may not approve PRs), and the
# managed labels (labels.json); with the flags above, the environments and the founder hardening.
# Idempotent: when the live state matches, no write call is made. Requires an admin `gh auth login`.
# Diff legend: "-" = live on GitHub, "+" = committed here.
set -euo pipefail

usage() { echo "usage: $0 [--apply] [--with-ecc-review] [--environments] [--founder-hardening] [--repo OWNER/NAME]" >&2; exit 2; }

GH="${GH:-gh}"
REPO="prix0007/cryoshield"
APPLY=0
ECC=0
ENVS=0
HARDEN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --with-ecc-review) ECC=1; shift ;;
    --environments) ENVS=1; shift ;;
    --founder-hardening) HARDEN=1; shift ;;
    --repo) [ $# -ge 2 ] || usage; REPO="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
seg='[A-Za-z0-9_][A-Za-z0-9_.-]*'
if ! [[ "$REPO" =~ ^${seg}/${seg}$ ]] || [[ "$REPO" == *..* ]]; then
  echo "invalid --repo: $REPO (expected OWNER/NAME)" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
RULESET_FILE="$HERE/main.json"
TAG_RULESET_FILE="$HERE/release-tags.json"
ECC_CHECK="$HERE/ecc-review-check.json"
SETTINGS="$HERE/repo-settings.json"
ACTIONS="$HERE/actions-permissions.json"
NORMALIZE="$HERE/../scripts/ruleset-normalize.mjs"
# Managed labels: name, color, description (labels.json; names may contain spaces and '?').
LABELS_FILE="$HERE/labels.json"
ENVIRONMENTS="$HERE/environments.json"
HARDENING="$HERE/actions-hardening.json"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
drift=0

# The ruleset actually applied: main.json, plus the ecc-review required check when asked for.
RULESET="$RULESET_FILE"
if [ "$ECC" -eq 1 ]; then
  RULESET="$TMP/main-with-ecc-review.json"
  jq --slurpfile c "$ECC_CHECK" '(.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks) += $c' \
    "$RULESET_FILE" > "$RULESET"
fi

# show_diff <committed> <live-json-file> <title>; returns 0 when in sync.
show_diff() {
  node "$NORMALIZE" "$1" "$2" "$TMP"
  if diff -u --label "live" --label "committed" "$TMP/live.json" "$TMP/committed.json"; then
    echo "$3: in sync"
    return 0
  fi
  return 1
}

# sync_ruleset <committed file>: the ruleset with the file's name AND target (branch or tag), created or updated.
sync_ruleset() {
  local file="$1" name target ids id live
  name="$(jq -r .name "$file")"
  target="$(jq -r .target "$file")"
  [[ "$name" =~ ^[A-Za-z0-9_-]+$ ]] && [[ "$target" =~ ^(branch|tag)$ ]] || { echo "invalid ruleset name/target in $file" >&2; exit 1; }
  live="$TMP/live-ruleset-$name.json"
  ids="$("$GH" api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$name\" and .target == \"$target\") | .id")"
  if [ "$(printf '%s\n' "$ids" | grep -c .)" -gt 1 ]; then
    echo "more than one ruleset named '$name' ($(echo "$ids" | tr '\n' ' ')); delete the extras first" >&2
    exit 1
  fi
  id="$ids"
  if [ -z "$id" ]; then
    echo "ruleset '$name' does not exist"
    echo '{}' > "$live"
    show_diff "$file" "$live" "ruleset '$name'" || true
    drift=1
    if [ "$APPLY" -eq 1 ]; then
      "$GH" api -X POST "repos/$REPO/rulesets" --input "$file" > /dev/null
      echo "ruleset '$name': created"
    fi
    return 0
  fi
  [[ "$id" =~ ^[0-9]+$ ]] || { echo "unexpected ruleset id '$id'" >&2; exit 1; }
  "$GH" api "repos/$REPO/rulesets/$id" > "$live"
  if [ "$file" = "$RULESET" ] && [ "$ECC" -eq 0 ] && jq -e '[.rules[]? | select(.type == "required_status_checks") | .parameters.required_status_checks[]?.context] | index("ecc-review")' \
       "$live" > /dev/null; then
    if [ "$APPLY" -eq 1 ]; then
      echo "the live ruleset requires ecc-review; pass --with-ecc-review to keep it (refusing to drop it silently)" >&2
      exit 1
    fi
    echo "note: the live ruleset requires ecc-review; pass --with-ecc-review to compare against that" >&2
  fi
  if ! show_diff "$file" "$live" "ruleset '$name'"; then
    drift=1
    if [ "$APPLY" -eq 1 ]; then
      "$GH" api -X PUT "repos/$REPO/rulesets/$id" --input "$file" > /dev/null
      echo "ruleset '$name': updated (id $id)"
    fi
  fi
  return 0
}

sync_settings() {
  "$GH" api "repos/$REPO" > "$TMP/live-repo.json"
  if ! show_diff "$SETTINGS" "$TMP/live-repo.json" "repo merge settings"; then
    drift=1
    if [ "$APPLY" -eq 1 ]; then
      "$GH" api -X PATCH "repos/$REPO" --input "$SETTINGS" > /dev/null
      echo "repo merge settings: updated"
    fi
  fi
  return 0
}

sync_actions() {
  "$GH" api "repos/$REPO/actions/permissions/workflow" > "$TMP/live-actions.json"
  if ! show_diff "$ACTIONS" "$TMP/live-actions.json" "actions workflow permissions"; then
    drift=1
    if [ "$APPLY" -eq 1 ]; then
      "$GH" api -X PUT "repos/$REPO/actions/permissions/workflow" --input "$ACTIONS" > /dev/null
      echo "actions workflow permissions: updated"
    fi
  fi
  return 0
}

sync_labels() {
  local existing name color desc
  existing="$TMP/labels.txt"
  "$GH" api "repos/$REPO/labels?per_page=100" --paginate --jq '.[].name' > "$existing"
  # Fields joined by the ASCII unit separator (not tab: tab is IFS whitespace, so empty fields would collapse and
  # @tsv would escape tabs in descriptions).
  while IFS=$'\x1f' read -r name color desc; do
    # Literal, whole-line match: label names may contain regex characters such as '?'.
    if grep -Fx -- "$name" "$existing" > /dev/null; then
      echo "label '$name': present"
      continue
    fi
    echo "label '$name': missing"
    drift=1
    if [ "$APPLY" -eq 1 ]; then
      "$GH" api -X POST "repos/$REPO/labels" -f name="$name" -f color="$color" -f description="$desc" > /dev/null
      echo "label '$name': created"
    fi
  done < <(jq -r '.[] | [.name, .color, (.description // "")] | map(gsub("[\u001f\n]"; " ")) | join("\u001f")' "$LABELS_FILE")
  return 0
}

# probe <path>: 0 when the GET succeeds, 1 on HTTP 404; any other failure aborts (an error never reads as "off").
probe() {
  local out
  if out="$("$GH" api "$1" --silent 2>&1)"; then return 0; fi
  if printf '%s' "$out" | grep -q 'HTTP 404'; then return 1; fi
  echo "GET $1 failed: $out" >&2
  exit 1
}

# get_or_empty <path> <file>: the GET body, or {} on HTTP 404.
get_or_empty() {
  if probe "$1"; then
    "$GH" api "$1" > "$2"
  else
    echo '{}' > "$2"
  fi
}

# The reviewer "@owner" in environments.json is the repository owner's numeric user id (a User, not an organization).
# Resolved once, before any environment is read or written, and only when some environment names "@owner".
OWNER_ID=""
resolve_owner() {
  local owner="${REPO%%/*}" user
  if ! user="$("$GH" api "users/$owner" --jq '[.type, (.id | tostring)] | join(" ")' 2>/dev/null)"; then
    echo "could not look up the repo owner '$owner' (gh api users/$owner)" >&2
    exit 1
  fi
  if ! [[ "$user" =~ ^User\ [1-9][0-9]*$ ]]; then
    echo "the repo owner '$owner' is not a GitHub user with a numeric id ($user); set the production reviewers by hand" >&2
    exit 1
  fi
  OWNER_ID="${user#User }"
}

# One comparable shape for the committed entry and GitHub's GET answer.
ENV_SHAPE='{name, can_admins_bypass, prevent_self_review, wait_timer, deployment_branch_policy,
            reviewers: (.reviewers | sort), branches: (.branches | sort)}'
# "<type>:<name>" for each deployment branch policy.
POLICY_KEYS='[.branch_policies[]? | "\(.type // "branch"):\(.name)"]'

sync_environment() {
  local name="$1" desired live raw pols want id
  desired="$TMP/env-$name.committed.json"
  live="$TMP/env-$name.live.json"
  raw="$TMP/env-$name.raw.json"
  pols="$TMP/env-$name.policies.json"
  jq -S --arg n "$name" --arg oid "$OWNER_ID" '.[] | select(.name == $n)
      | {name, can_admins_bypass, prevent_self_review, wait_timer,
         deployment_branch_policy: {protected_branches: false, custom_branch_policies: true},
         reviewers: [.required_reviewers[] | if . == "@owner" then "User:" + $oid else error("unknown reviewer " + .) end],
         branches: ([.branches[] | "branch:" + .] + [(.tags // [])[] | "tag:" + .])} | '"$ENV_SHAPE" "$ENVIRONMENTS" > "$desired"
  get_or_empty "repos/$REPO/environments/$name" "$raw"
  if [ "$(jq 'length' "$raw")" -eq 0 ]; then
    echo "environment '$name' does not exist"
    echo '{}' > "$pols"
  else
    get_or_empty "repos/$REPO/environments/$name/deployment-branch-policies?per_page=100" "$pols"
  fi
  jq -S --arg n "$name" --slurpfile p "$pols" '{name: $n,
      can_admins_bypass: (if has("can_admins_bypass") then .can_admins_bypass else true end),
      prevent_self_review: ([.protection_rules[]? | select(.type == "required_reviewers") | .prevent_self_review][0] // false),
      wait_timer: ([.protection_rules[]? | select(.type == "wait_timer") | .wait_timer][0] // 0),
      deployment_branch_policy: (.deployment_branch_policy // null),
      reviewers: [.protection_rules[]? | select(.type == "required_reviewers") | .reviewers[]? | "\(.type):\(.reviewer.id)"],
      branches: ($p[0] | '"$POLICY_KEYS"')} | '"$ENV_SHAPE" "$raw" > "$live"
  if diff -u --label "live" --label "committed" "$live" "$desired"; then
    echo "environment '$name': in sync"
    return 0
  fi
  drift=1
  [ "$APPLY" -eq 1 ] || return 0
  # Reviewers, bypass, wait timer and branch-policy mode in one PUT (it also creates a missing environment).
  if [ "$(jq -c 'del(.branches)' "$live")" != "$(jq -c 'del(.branches)' "$desired")" ]; then
    jq '{wait_timer, prevent_self_review, can_admins_bypass, deployment_branch_policy,
         reviewers: [.reviewers[] | split(":") | {type: .[0], id: (.[1] | tonumber)}]}' "$desired" > "$TMP/env-$name.put.json"
    "$GH" api -X PUT "repos/$REPO/environments/$name" --input "$TMP/env-$name.put.json" > /dev/null
    echo "environment '$name': settings updated"
    get_or_empty "repos/$REPO/environments/$name/deployment-branch-policies?per_page=100" "$pols"
  fi
  # Branch policies: add the committed ones, delete every other one (an extra pattern widens what may deploy).
  while read -r want; do
    if ! jq -e --arg w "$want" "$POLICY_KEYS"' | index($w)' "$pols" > /dev/null; then
      "$GH" api -X POST "repos/$REPO/environments/$name/deployment-branch-policies" -f name="${want#*:}" -f type="${want%%:*}" > /dev/null
      echo "environment '$name': branch policy '${want#*:}' added"
    fi
  done < <(jq -r '.branches[]' "$desired")
  while read -r id; do
    [[ "$id" =~ ^[0-9]+$ ]] || { echo "unexpected branch policy id '$id'" >&2; exit 1; }
    "$GH" api -X DELETE "repos/$REPO/environments/$name/deployment-branch-policies/$id" > /dev/null
    echo "environment '$name': branch policy $id removed"
  done < <(jq -r --slurpfile d "$desired" '.branch_policies[]?
      | select(("\(.type // "branch"):\(.name)") as $k | $d[0].branches | index($k) | not) | .id' "$pols")
  return 0
}

sync_environments() {
  local name
  if [ "$ENVS" -eq 0 ]; then
    echo "environments: skipped (pass --environments)"
    return 0
  fi
  # Only an "@owner" reviewer needs the owner's id; with none, no users/ lookup is made (PR #32 review).
  if [ -z "$OWNER_ID" ] && jq -e '[.[].required_reviewers[]?] | index("@owner")' "$ENVIRONMENTS" > /dev/null; then
    resolve_owner
  fi
  while read -r name; do
    [[ "$name" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "invalid environment name '$name' in environments.json" >&2; exit 1; }
    sync_environment "$name"
  done < <(jq -r '.[].name' "$ENVIRONMENTS")
  return 0
}

sync_hardening() {
  local alerts=0 fixes=0
  if [ "$HARDEN" -eq 0 ]; then
    echo "founder hardening: skipped (pass --founder-hardening)"
    return 0
  fi
  # Dependabot security updates need vulnerability alerts first; GitHub answers HTTP 404 for "off".
  if probe "repos/$REPO/vulnerability-alerts"; then alerts=1; fi
  if probe "repos/$REPO/automated-security-fixes" \
     && [ "$("$GH" api "repos/$REPO/automated-security-fixes" --jq '.enabled')" = "true" ]; then
    fixes=1
  fi
  if [ "$alerts" -eq 1 ] && [ "$fixes" -eq 1 ]; then
    echo "dependabot security updates: on"
  else
    echo "dependabot security updates: off (vulnerability alerts $([ "$alerts" -eq 1 ] && echo on || echo off))"
    drift=1
    if [ "$APPLY" -eq 1 ]; then
      if [ "$alerts" -eq 0 ]; then
        "$GH" api -X PUT "repos/$REPO/vulnerability-alerts" > /dev/null
        echo "vulnerability alerts: enabled"
      fi
      "$GH" api -X PUT "repos/$REPO/automated-security-fixes" > /dev/null
      echo "dependabot security updates: enabled"
    fi
  fi
  "$GH" api "repos/$REPO/actions/permissions" > "$TMP/live-actions-perms.json"
  if ! show_diff "$HARDENING" "$TMP/live-actions-perms.json" "actions permissions (SHA pinning)"; then
    drift=1
    if [ "$APPLY" -eq 1 ]; then
      "$GH" api -X PUT "repos/$REPO/actions/permissions" --input "$HARDENING" > /dev/null
      echo "actions permissions: updated (actions must be pinned to a full-length commit SHA)"
    fi
  fi
  return 0
}

sync_all() {
  sync_ruleset "$RULESET"
  sync_ruleset "$TAG_RULESET_FILE"
  sync_settings
  sync_actions
  sync_labels
  sync_environments
  sync_hardening
}

echo "repository: $REPO ($([ "$APPLY" -eq 1 ] && echo apply || echo dry run)$([ "$ECC" -eq 1 ] && echo ', with ecc-review')$([ "$ENVS" -eq 1 ] && echo ', environments')$([ "$HARDEN" -eq 1 ] && echo ', founder hardening'))"
sync_all

if [ "$APPLY" -eq 0 ]; then
  [ "$drift" -eq 0 ] && exit 0
  echo "drift found; re-run with --apply to write it" >&2
  exit 3
fi

if [ "$drift" -eq 1 ]; then
  echo "re-check:"
  APPLY=0
  drift=0
  sync_all
  if [ "$drift" -ne 0 ]; then
    echo "live state still differs from the committed files after --apply" >&2
    exit 1
  fi
fi
echo "re-check: in sync"
echo "done"
