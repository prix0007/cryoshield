#!/usr/bin/env bash
# Record the image that is live BEFORE a deploy, for automatic rollback (add-continuous-deploy, design D5/D6).
# Newest release with Status "complete" from `fly releases --json --image`; the ref is validated so nothing
# unexpected can reach `fly deploy --image` later. No complete release yet (first deploy) = empty output.
#
# env: FLY (default fly), APP (default cryoshield-web); needs FLY_API_TOKEN in the environment for real runs.
# out: previous_image=<ref or empty> to $GITHUB_OUTPUT (and stdout)
set -euo pipefail

FLY="${FLY:-fly}"
APP="${APP:-cryoshield-web}"
[[ "$APP" =~ ^[a-z0-9-]+$ ]] || { echo "previous-image: invalid APP" >&2; exit 2; }
# The token sits behind the approval in `production`, so it can only be checked here, after a human approved: fail
# explicitly rather than with a flyctl auth error (deploy-skip-when-unconfigured).
if [ -z "${FLY_API_TOKEN:-}" ]; then
  echo "::error title=deploy not configured::FLY_API_TOKEN is empty: add it to the production environment (docs/deploy.md, First-time setup, step 2), then re-run with: gh workflow run deploy.yml --ref main -f force=true"
  exit 1
fi

emit() {
  echo "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >> "$GITHUB_OUTPUT"; fi
}

json="$("$FLY" releases --app "$APP" --json --image)" || { echo "previous-image: fly releases failed" >&2; exit 1; }
ref="$(jq -r '[.[] | select(.Status == "complete")][0].ImageRef // empty' <<<"$json")" || { echo "previous-image: unexpected fly releases output" >&2; exit 1; }

if [ -z "$ref" ]; then
  echo "previous-image: no complete release yet (first deploy); automatic rollback will not be possible" >&2
  emit "previous_image="
  exit 0
fi
if ! [[ "$ref" =~ ^registry\.fly\.io/${APP}(:deployment-[0-9A-Z]{26}|@sha256:[0-9a-f]{64})$ ]]; then
  echo "previous-image: refusing unexpected image ref '$ref'" >&2
  exit 1
fi
emit "previous_image=$ref"
