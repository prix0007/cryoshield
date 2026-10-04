#!/usr/bin/env bash
# Supersede stale releases (OpenSpec change gate-production-deploys, design decision 3).
# Cancels OLDER deploy.yml runs that are still WAITING for the production approval, for another commit, once this
# run's newer commit has passed CI and built. A waiting run has deployed nothing, so cancelling it is safe. Runs that
# are deploying are `in_progress`, never `waiting`, and are never touched. The pending production deployment is
# re-checked right before each cancel.
#
# env: REPO (owner/name), RUN_ID (this run), TARGET_SHA (this run's commit), GH (default gh); GH_TOKEN for real runs.
set -euo pipefail

GH="${GH:-gh}"
REPO="${REPO:-}"
RUN_ID="${RUN_ID:-}"
TARGET_SHA="${TARGET_SHA:-}"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "supersede: invalid REPO" >&2; exit 2; }
[[ "$RUN_ID" =~ ^[0-9]+$ ]] || { echo "supersede: invalid RUN_ID" >&2; exit 2; }
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "supersede: invalid TARGET_SHA" >&2; exit 2; }

me="$("$GH" api "repos/${REPO}/actions/runs/${RUN_ID}" --jq '.created_at')"
list="$(mktemp)"
trap 'rm -f "$list"' EXIT
"$GH" api --paginate "repos/${REPO}/actions/workflows/deploy.yml/runs?status=waiting&per_page=100" \
  --jq '.workflow_runs[] | [(.id | tostring), .head_sha, .created_at, .status] | join(" ")' > "$list"

cancelled=0
while read -r id sha created status <&3; do
  [ -n "$id" ] || continue
  [ "$id" != "$RUN_ID" ] || continue
  [ "$status" = "waiting" ] || continue
  [ "$sha" != "$TARGET_SHA" ] || continue
  # Older than this run: earlier creation time, or the same time and a lower run id.
  if ! { [[ "$created" < "$me" ]] || { [ "$created" = "$me" ] && [ "$id" -lt "$RUN_ID" ]; }; }; then continue; fi
  pending="$("$GH" api "repos/${REPO}/actions/runs/${id}/pending_deployments" \
               --jq '[.[] | select(.environment.name == "production")] | length')"
  [ "$pending" -gt 0 ] || continue
  "$GH" api -X POST "repos/${REPO}/actions/runs/${id}/cancel" > /dev/null
  echo "supersede: superseded run ${id} (${sha}), still waiting for approval; this run deploys ${TARGET_SHA}"
  cancelled=$((cancelled + 1))
done 3< "$list"
echo "supersede: ${cancelled} waiting release(s) superseded"
