#!/usr/bin/env bash
# Automatic rollback after a failed smoke test (add-continuous-deploy, design D6): redeploy the image that was
# live before this deploy, then wait for /healthz. The caller still fails the run, loudly.
#
# env: PREVIOUS_IMAGE (from previous-image.sh), FLY (default fly), APP (default cryoshield-web),
#      CONFIG (default apps/web/fly.toml), BASE_URL (default https://cryoshield.app),
#      ROLLBACK_ATTEMPTS (default 20), ROLLBACK_SLEEP seconds (default 15); FLY_API_TOKEN for real runs.
set -euo pipefail

FLY="${FLY:-fly}"
APP="${APP:-cryoshield-web}"
CONFIG="${CONFIG:-apps/web/fly.toml}"
BASE_URL="${BASE_URL:-https://cryoshield.app}"
ATTEMPTS="${ROLLBACK_ATTEMPTS:-20}"
SLEEP="${ROLLBACK_SLEEP:-15}"
IMAGE="${PREVIOUS_IMAGE:-}"
[[ "$APP" =~ ^[a-z0-9-]+$ ]] || { echo "rollback: invalid APP" >&2; exit 2; }

if [ -z "$IMAGE" ]; then
  echo "::error title=rollback::No previous image was recorded (first deploy?); no automatic rollback is possible. See docs/deploy.md -> Rollback."
  exit 1
fi
if ! [[ "$IMAGE" =~ ^registry\.fly\.io/${APP}(:deployment-[0-9A-Z]{26}|@sha256:[0-9a-f]{64})$ ]]; then
  echo "::error title=rollback::Refusing unexpected image ref '$IMAGE'."
  exit 1
fi

echo "rollback: redeploying $IMAGE to $APP"
"$FLY" deploy --app "$APP" --config "$CONFIG" --image "$IMAGE"

for ((i = 1; i <= ATTEMPTS; i++)); do
  if [ "$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$BASE_URL/healthz" 2>/dev/null || echo 000)" = "200" ]; then
    echo "rollback: rolled back to $IMAGE; $BASE_URL/healthz is 200"
    exit 0
  fi
  [ "$i" -lt "$ATTEMPTS" ] && sleep "$SLEEP"
done
echo "::error title=rollback::Redeployed $IMAGE but $BASE_URL/healthz is still failing. Manual action needed (docs/deploy.md)."
exit 1
