#!/usr/bin/env bash
# Applies the committed main-branch protection to GitHub (OpenSpec change adopt-pr-workflow, decision 2).
#
#   .github/rulesets/apply.sh                 # dry run: print the diff (exit 0 in sync, 3 on drift)
#   .github/rulesets/apply.sh --apply         # write only what differs, then re-check
#   .github/rulesets/apply.sh --repo o/r ...  # another repository (default: prix0007/cryoshield)
#
# Covers: ruleset main.json (by name), repo merge settings (repo-settings.json), and the `no-spec` label.
# Idempotent: when the live state matches, no write call is made. Requires an admin `gh auth login`.
# Diff legend: "-" = live on GitHub, "+" = committed here.
set -euo pipefail

usage() { echo "usage: $0 [--apply] [--repo OWNER/NAME]" >&2; exit 2; }

GH="${GH:-gh}"
REPO="prix0007/cryoshield"
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --repo) [ $# -ge 2 ] || usage; REPO="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "invalid --repo: $REPO" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
RULESET="$HERE/main.json"
SETTINGS="$HERE/repo-settings.json"
NORMALIZE="$HERE/../scripts/ruleset-normalize.mjs"
NAME="$(jq -r .name "$RULESET")"
LABEL="no-spec"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
drift=0

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
  local id
  id="$("$GH" api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$NAME\" and .target == \"branch\") | .id")"
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

sync_label() {
  if "$GH" api "repos/$REPO/labels?per_page=100" --paginate --jq '.[].name' | grep -x "$LABEL" > /dev/null; then
    echo "label '$LABEL': present"
    return 0
  fi
  echo "label '$LABEL': missing"
  drift=1
  if [ "$APPLY" -eq 1 ]; then
    "$GH" api -X POST "repos/$REPO/labels" \
      -f name="$LABEL" -f color=d4c5f9 \
      -f description="Code change without an OpenSpec change; PR body must hold a No-spec justification line" > /dev/null
    echo "label '$LABEL': created"
  fi
  return 0
}

echo "repository: $REPO ($([ "$APPLY" -eq 1 ] && echo apply || echo dry run))"
sync_ruleset
sync_settings
sync_label

if [ "$APPLY" -eq 0 ]; then
  [ "$drift" -eq 0 ] && exit 0
  echo "drift found; re-run with --apply to write it" >&2
  exit 3
fi
echo "done"
