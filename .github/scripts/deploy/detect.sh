#!/usr/bin/env bash
# Is main newer than what https://cryoshield.app serves? (OpenSpec change add-continuous-deploy, design D3.)
# Reads /release.json's commit. Anything missing, unreachable or malformed counts as "deploy": the deploy itself is
# fully gated by CI, so erring toward deploying is safe; erring toward skipping would leave main undeployed.
#
# env: TARGET_SHA (40-hex, required), BASE_URL (default https://cryoshield.app), FORCE (true|false),
#      MAIN_SHA (current main HEAD; a different value means superseded), PREVIOUSLY_FAILED (true|false)
# out: deploy=true|false, and (when the site was checked) live=true|false, to $GITHUB_OUTPUT (and stdout)
set -euo pipefail

BASE_URL="${BASE_URL:-https://cryoshield.app}"
TARGET_SHA="${TARGET_SHA:-}"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "detect: TARGET_SHA must be a full 40-hex commit (got '$TARGET_SHA')" >&2; exit 2; }

emit() {
  echo "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >> "$GITHUB_OUTPUT"; fi
}

# The reusable CI tests github.sha, so a run may only deploy its own commit. If main has moved on, a newer run
# (push or schedule) owns the deploy; skipping here keeps an older commit from ever replacing a newer one.
if [ -n "${MAIN_SHA:-}" ]; then
  [[ "$MAIN_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "detect: MAIN_SHA must be a full 40-hex commit" >&2; exit 2; }
  if [ "$MAIN_SHA" != "$TARGET_SHA" ]; then
    echo "detect: superseded: main is now $MAIN_SHA, this run is for $TARGET_SHA; a newer run deploys"
    emit "deploy=false"
    exit 0
  fi
fi

# A commit whose earlier deploy/smoke failed (and was rolled back) is not retried every 15 minutes (review M2):
# fix forward with a new commit, or redeploy on purpose with workflow_dispatch force=true.
if [ "${PREVIOUSLY_FAILED:-false}" = "true" ] && [ "${FORCE:-false}" != "true" ]; then
  echo "detect: a previous deploy of $TARGET_SHA previously failed (deploy or smoke); not retrying automatically"
  emit "deploy=false"
  exit 0
fi

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

# Whether a site is live at all: check-config.sh fails (instead of skipping) when config goes missing after go-live.
if [ -n "$live" ]; then emit "live=true"; else emit "live=false"; fi
if [ "$live" = "$TARGET_SHA" ]; then
  echo "detect: $BASE_URL already serves $TARGET_SHA; nothing to deploy"
  emit "deploy=false"
else
  echo "detect: $BASE_URL serves ${live:-an unknown commit}; main is $TARGET_SHA"
  emit "deploy=true"
fi
