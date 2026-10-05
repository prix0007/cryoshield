#!/usr/bin/env bash
# Deploy the CryoShield web app to Fly.io (add-fly-hosting D5). Fails closed at every step.
#   apps/web/deploy/deploy.sh                                  # production: https://cryoshield.app (cryoshield-web)
#   DEPLOY_TARGET=development apps/web/deploy/deploy.sh        # development: https://cryoshield-web-dev.fly.dev (cryoshield-web-dev)
#   apps/web/deploy/deploy.sh --build-only   # every guard and build step, but no fly (CI build job, add-continuous-deploy H1)
# Never pass secrets on the command line; this script needs none (fly uses its own auth).
#
# Targets (split-dev-and-release-deploys D5/D6): each fixes the host (= the WebAuthn RP ID the build must use), the Fly app,
# its config and whether the site may be indexed. The development host and RP ID is cryoshield-web-dev.fly.dev: a different
# registrable domain (fly.dev is on the Public Suffix List), so a dev page can never assert rpId cryoshield.app (T1).
set -euo pipefail

PROD_HOST="cryoshield.app"
die() {
  echo "deploy: REFUSED: $*" >&2
  exit 1
}
# Is $1 the production registrable domain or any subdomain of it? Such an origin may use rpId cryoshield.app.
under_prod() { [[ "$1" == "$PROD_HOST" || "$1" == *".$PROD_HOST" ]]; }

# DEPLOY_HOST is retired: a stale invocation must not silently build for production.
[ -z "${DEPLOY_HOST+x}" ] || die "DEPLOY_HOST is no longer supported; set DEPLOY_TARGET=production or DEPLOY_TARGET=development"
TARGET="${DEPLOY_TARGET:-production}"
case "$TARGET" in
  production) HOST="$PROD_HOST" APP="cryoshield-web" CONFIG="fly.toml" NOINDEX=() ;;
  development) HOST="cryoshield-web-dev.fly.dev" APP="cryoshield-web-dev" CONFIG="fly.dev.toml" NOINDEX=(--noindex) ;;
  *) die "unknown DEPLOY_TARGET '$TARGET' (production or development)" ;;
esac
# A non-production host under cryoshield.app could ask browsers for PRF outputs of production credentials (T1).
if [[ "$TARGET" != "production" ]] && under_prod "$HOST"; then
  die "the $TARGET host $HOST is $PROD_HOST or a subdomain of it; dev must be on another registrable domain"
fi
WEB="$(cd "$(dirname "$0")/.." && pwd)"

BUILD_ONLY=0
case "${1:-}" in
  "") ;;
  --build-only) BUILD_ONLY=1 ;;
  *) die "unknown argument: $1 (usage: deploy.sh [--build-only])" ;;
esac

tools=(git pnpm node)
[ "$BUILD_ONLY" -eq 1 ] || tools+=(fly)
for tool in "${tools[@]}"; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not on PATH"
done

ROOT="$(git -C "$WEB" rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"

# 1. Exported VITE_* variables would silently override apps/web/.env in the build.
if env | grep -q '^VITE_'; then
  die "VITE_* variables are set in the environment ($(env | grep '^VITE_' | cut -d= -f1 | tr '\n' ' ')); unset them"
fi

# 2. What is deployed must be reproducible from a commit.
if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=all)" ]]; then
  die "git working tree is not clean (commit or stash first):
$(git -C "$ROOT" status --porcelain --untracked-files=all | head -20)"
fi

# 3. The WebAuthn RP ID must be the host we serve from; a mismatch would make every vault unopenable in the browser.
[[ -f "$WEB/.env" ]] || die "apps/web/.env is missing"
# Vite also loads .env.local, .env.production and .env.*.local in production mode; they would shadow .env.
shopt -s nullglob
shadow=("$WEB"/.env.local "$WEB"/.env.production "$WEB"/.env.*.local)
shopt -u nullglob
for f in "${shadow[@]}"; do
  [[ -e "$f" ]] && die "$(basename "$f") exists in apps/web; it would override .env in the production build. Remove it."
done
RP_ID="$(grep -E '^VITE_RP_ID=' "$WEB/.env" | tail -n 1 | cut -d= -f2- | tr -d "[:space:]\"'")"
# A non-production build may never carry the production RP ID or any RP ID under it: code that ships to dev without a
# human step must not be able to request PRF outputs for production vaults (split-dev-and-release-deploys D5, T1).
if [[ "$TARGET" != "production" ]] && under_prod "$RP_ID"; then
  die "the $TARGET build uses RP ID $RP_ID, which is the production RP ID $PROD_HOST or under it; it must be $HOST"
fi
[[ "$RP_ID" == "$HOST" ]] || die "VITE_RP_ID ($RP_ID) != deploy host ($HOST)"

cd "$WEB"

# 4. Two production builds with the real .env: identical bytes, bundle checks, bundle RP ID == host.
NODE_ENV=production node scripts/verify-build.mjs --real-env --expect-host "$HOST" || die "verify-build failed"

# 5. Docker context = verified dist/ (minus _headers) + Caddyfile with the CSP derived from the built meta tag.
# Development adds X-Robots-Tag: noindex, nofollow to every response (never on production).
node deploy/gen-context.mjs --dist dist --out deploy/.build --host "$HOST" ${NOINDEX[@]+"${NOINDEX[@]}"} || die "context generation failed"

# 6. Publishable release manifest: commit, deterministic tree hash, config summary (no key values).
node deploy/release-manifest.mjs --site deploy/.build/site --out deploy/.build/release-manifest.json \
  --commit "$(git -C "$ROOT" rev-parse HEAD)" --env .env --contracts "$ROOT/contracts" --caddyfile deploy/.build/Caddyfile --site-release || die "release manifest failed"
# --site-release also publishes deploy/.build/site/release.json, served as /release.json (add-continuous-deploy D3).
echo "deploy: the site serves /release.json; keep deploy/.build/release-manifest.json (CI uploads it as an artifact)"

if [ "$BUILD_ONLY" -eq 1 ]; then
  echo "deploy: build only: deploy/.build is ready for commit $(git -C "$ROOT" rev-parse --short HEAD); fly deploy not run"
  exit 0
fi
echo "deploy: commit $(git -C "$ROOT" rev-parse --short HEAD) -> https://$HOST ($APP, $TARGET)"
fly deploy --config "$CONFIG" --remote-only --app "$APP"
