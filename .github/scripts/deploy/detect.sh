#!/usr/bin/env bash
# Is main newer than what https://cryoshield.app serves? (OpenSpec change add-continuous-deploy, design D3.)
# Reads /release.json's commit. Anything missing, unreachable or malformed counts as "deploy": the deploy itself is
# fully gated by CI, so erring toward deploying is safe; erring toward skipping would leave main undeployed.
#
# env: TARGET_SHA (40-hex, required), BASE_URL (default https://cryoshield.app), FORCE (true|false)
# out: deploy=true|false to $GITHUB_OUTPUT (and stdout)
set -euo pipefail

BASE_URL="${BASE_URL:-https://cryoshield.app}"
TARGET_SHA="${TARGET_SHA:-}"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "detect: TARGET_SHA must be a full 40-hex commit (got '$TARGET_SHA')" >&2; exit 2; }

emit() {
  echo "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >> "$GITHUB_OUTPUT"; fi
}

if [ "${FORCE:-false}" = "true" ]; then
  echo "detect: forced redeploy of $TARGET_SHA"
  emit "deploy=true"
  exit 0
fi

live=""
if body="$(curl -fsS --max-time 20 --retry 2 --retry-delay 2 "$BASE_URL/release.json" 2>/dev/null)"; then
  live="$(jq -r '.commit // empty' <<<"$body" 2>/dev/null || true)"
fi
[[ "$live" =~ ^[0-9a-f]{40}$ ]] || live=""

if [ "$live" = "$TARGET_SHA" ]; then
  echo "detect: $BASE_URL already serves $TARGET_SHA; nothing to deploy"
  emit "deploy=false"
else
  echo "detect: $BASE_URL serves ${live:-an unknown commit}; main is $TARGET_SHA"
  emit "deploy=true"
fi
