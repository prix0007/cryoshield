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
#
# Covers: ruleset main.json (by name), repo merge settings (repo-settings.json, incl. auto-merge), Actions
# workflow permissions (actions-permissions.json: read-only token, Actions may not approve PRs), and the
# `no-spec` and `hold` labels.
# Idempotent: when the live state matches, no write call is made. Requires an admin `gh auth login`.
# Diff legend: "-" = live on GitHub, "+" = committed here.
set -euo pipefail

usage() { echo "usage: $0 [--apply] [--with-ecc-review] [--repo OWNER/NAME]" >&2; exit 2; }

GH="${GH:-gh}"
REPO="prix0007/cryoshield"
APPLY=0
ECC=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --with-ecc-review) ECC=1; shift ;;
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
ECC_CHECK="$HERE/ecc-review-check.json"
SETTINGS="$HERE/repo-settings.json"
ACTIONS="$HERE/actions-permissions.json"
NORMALIZE="$HERE/../scripts/ruleset-normalize.mjs"
NAME="$(jq -r .name "$RULESET_FILE")"
# Managed labels (portable to bash 3.2: no associative arrays).
LABELS="no-spec hold"
label_color() { case "$1" in no-spec) echo d4c5f9 ;; hold) echo b60205 ;; esac; }
label_desc() {
  case "$1" in
    no-spec) echo "Code change without an OpenSpec change; PR body must hold a No-spec justification line" ;;
    hold) echo "Owner veto: auto-merge stays off while this label is set" ;;
  esac
}

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

sync_ruleset() {
  local ids id
  ids="$("$GH" api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$NAME\" and .target == \"branch\") | .id")"
  if [ "$(printf '%s\n' "$ids" | grep -c .)" -gt 1 ]; then
    echo "more than one ruleset named '$NAME' ($(echo "$ids" | tr '\n' ' ')); delete the extras first" >&2
    exit 1
  fi
  id="$ids"
  if [ -z "$id" ]; then
    echo "ruleset '$NAME' does not exist"
    echo '{}' > "$TMP/live-ruleset.json"
    show_diff "$RULESET" "$TMP/live-ruleset.json" "ruleset '$NAME'" || true
    drift=1
    if [ "$APPLY" -eq 1 ]; then
      "$GH" api -X POST "repos/$REPO/rulesets" --input "$RULESET" > /dev/null
      echo "ruleset '$NAME': created"
    fi
    return 0
  fi
  "$GH" api "repos/$REPO/rulesets/$id" > "$TMP/live-ruleset.json"
  if [ "$ECC" -eq 0 ] && jq -e '[.rules[]? | select(.type == "required_status_checks") | .parameters.required_status_checks[]?.context] | index("ecc-review")' \
       "$TMP/live-ruleset.json" > /dev/null; then
    if [ "$APPLY" -eq 1 ]; then
      echo "the live ruleset requires ecc-review; pass --with-ecc-review to keep it (refusing to drop it silently)" >&2
      exit 1
    fi
    echo "note: the live ruleset requires ecc-review; pass --with-ecc-review to compare against that" >&2
  fi
  if ! show_diff "$RULESET" "$TMP/live-ruleset.json" "ruleset '$NAME'"; then
    drift=1
    if [ "$APPLY" -eq 1 ]; then
      "$GH" api -X PUT "repos/$REPO/rulesets/$id" --input "$RULESET" > /dev/null
      echo "ruleset '$NAME': updated (id $id)"
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

sync_label() {
  local label="$1"
  if "$GH" api "repos/$REPO/labels?per_page=100" --paginate --jq '.[].name' | grep -x "$label" > /dev/null; then
    echo "label '$label': present"
    return 0
  fi
  echo "label '$label': missing"
  drift=1
  if [ "$APPLY" -eq 1 ]; then
    "$GH" api -X POST "repos/$REPO/labels" \
      -f name="$label" -f color="$(label_color "$label")" -f description="$(label_desc "$label")" > /dev/null
    echo "label '$label': created"
  fi
  return 0
}

sync_all() {
  sync_ruleset
  sync_settings
  sync_actions
  local label
  for label in $LABELS; do
    sync_label "$label"
  done
}

echo "repository: $REPO ($([ "$APPLY" -eq 1 ] && echo apply || echo dry run)$([ "$ECC" -eq 1 ] && echo ', with ecc-review'))"
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
