#!/usr/bin/env bash
# Deploy the CryoShield web app to Fly.io (add-fly-hosting D5). Fails closed at every step.
#   DEPLOY_HOST=cryoshield.app apps/web/deploy/deploy.sh
# Never pass secrets on the command line; this script needs none (fly uses its own auth).
set -euo pipefail

HOST="${DEPLOY_HOST:-cryoshield.app}"
APP="cryoshield-web"
WEB="$(cd "$(dirname "$0")/.." && pwd)"

die() {
  echo "deploy: REFUSED: $*" >&2
  exit 1
}

for tool in git pnpm node fly; do
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
[[ "$RP_ID" == "$HOST" ]] || die "VITE_RP_ID ($RP_ID) != deploy host ($HOST)"

cd "$WEB"

# 4. Two production builds with the real .env: identical bytes, bundle checks, bundle RP ID == host.
NODE_ENV=production node scripts/verify-build.mjs --real-env --expect-host "$HOST" || die "verify-build failed"

# 5. Docker context = verified dist/ (minus _headers) + Caddyfile with the CSP derived from the built meta tag.
node deploy/gen-context.mjs --dist dist --out deploy/.build --host "$HOST" || die "context generation failed"

# 6. Publishable release manifest: commit, deterministic tree hash, config summary (no key values).
node deploy/release-manifest.mjs --site deploy/.build/site --out deploy/.build/release-manifest.json \
  --commit "$(git -C "$ROOT" rev-parse HEAD)" --env .env --contracts "$ROOT/contracts" || die "release manifest failed"
echo "deploy: publish deploy/.build/release-manifest.json as a GitHub release asset for this commit"

echo "deploy: commit $(git -C "$ROOT" rev-parse --short HEAD) -> https://$HOST ($APP)"
fly deploy --config fly.toml --remote-only --app "$APP"
