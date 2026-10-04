#!/usr/bin/env bash
# What this release changes, shown on the run page BEFORE the owner approves it (OpenSpec change
# gate-production-deploys, security review H1). Compares the commit live on the site (/release.json) with the
# release commit, writes the compare link and the changed files to the job summary, and raises a
# "TOKEN-PATH CHANGED" warning for every file that can change what runs with the Fly token: the deploy scripts,
# workflows, the workflow policy and its digests, fly.toml and the Docker build context.
# Informational only: it never blocks, but anything it cannot establish becomes a loud "review the whole commit".
#
# env: REPO, TARGET_SHA, BASE_URL (https://...), SUMMARY (default $GITHUB_STEP_SUMMARY), GH (gh), CURL (curl).
set -euo pipefail

GH="${GH:-gh}"
CURL="${CURL:-curl}"
REPO="${REPO:-}"
TARGET_SHA="${TARGET_SHA:-}"
BASE_URL="${BASE_URL:-}"
SUMMARY="${SUMMARY:-${GITHUB_STEP_SUMMARY:-/dev/stdout}}"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "release-diff: invalid REPO" >&2; exit 2; }
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "release-diff: invalid TARGET_SHA" >&2; exit 2; }
[[ "$BASE_URL" =~ ^https://[A-Za-z0-9.-]+$ ]] || { echo "release-diff: invalid BASE_URL" >&2; exit 2; }

TOKEN_PATHS='^(\.github/workflows/|\.github/scripts/deploy/|\.github/scripts/workflow-policy\.mjs$|\.github/scripts/privileged-run-steps\.json$|apps/web/fly\.toml$|apps/web/\.dockerignore$|apps/web/deploy/|contracts/deployments/)'
commit_url="https://github.com/${REPO}/commit/${TARGET_SHA}"

# Only these characters reach the summary and the workflow commands.
clean() { LC_ALL=C sed 's#[^A-Za-z0-9._/@+-]#?#g'; }

whole_commit() {
  echo "::warning title=REVIEW THE WHOLE COMMIT::$1"
  {
    echo "## Release review"
    echo
    echo "**$1** Review the whole commit before approving: ${commit_url}"
  } >> "$SUMMARY"
  exit 0
}

live="$("$CURL" -fsS --max-time 20 "${BASE_URL}/release.json" 2>/dev/null | jq -r '.commit // empty' 2>/dev/null || true)"
[[ "$live" =~ ^[0-9a-f]{40}$ ]] || whole_commit "The live commit is unknown (first release, or ${BASE_URL}/release.json unreadable)."

out="$(mktemp)"
trap 'rm -f "$out"' EXIT
"$GH" api "repos/${REPO}/compare/${live}...${TARGET_SHA}" --jq '.status, (.files | length), (.files[].filename)' > "$out" 2>/dev/null \
  || whole_commit "Could not compare the live commit ${live} with ${TARGET_SHA}."
status="$(sed -n 1p "$out" | clean)"
count="$(sed -n 2p "$out")"
[[ "$count" =~ ^[0-9]+$ ]] || whole_commit "Unexpected compare answer."

compare_url="https://github.com/${REPO}/compare/${live}...${TARGET_SHA}"
{
  echo "## Release review"
  echo
  echo "Live: \`${live}\` → release: \`${TARGET_SHA}\` (${status}, ${count} files changed). Diff: ${compare_url}"
  echo
} >> "$SUMMARY"
if [ "$status" = "behind" ] || [ "$status" = "diverged" ]; then
  echo "::warning title=NOT NEWER THAN LIVE::The release ${TARGET_SHA} is ${status} relative to the live ${live}; approving it would roll the site back."
fi
[ "$count" -lt 300 ] || echo "::warning title=REVIEW THE WHOLE COMMIT::The compare API lists at most 300 files; this list may be incomplete."

flagged="$(sed -n '3,$p' "$out" | clean | grep -E "$TOKEN_PATHS" || true)"
if [ -z "$flagged" ]; then
  echo "No token-path file changed (deploy scripts, workflows, policy, fly.toml, Docker context)." >> "$SUMMARY"
  exit 0
fi
{
  echo "### TOKEN-PATH CHANGED: read these before approving"
  echo
  echo "These files can change what runs with the Fly token:"
  echo
  while IFS= read -r f; do echo "- \`$f\`"; done <<< "$flagged"
} >> "$SUMMARY"
while IFS= read -r f; do echo "::warning title=TOKEN-PATH CHANGED::$f"; done <<< "$flagged"
