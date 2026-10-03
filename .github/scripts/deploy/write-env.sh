#!/usr/bin/env bash
# Write apps/web/.env for the production build from the GitHub Environment `production`
# (add-continuous-deploy, design D5). Values arrive as this step's env (vars.*, and the bundler URL as a secret);
# the deploy step that runs deploy.sh must NOT have them (deploy.sh refuses exported VITE_* variables).
# Never prints a value; the bundler URL (it carries the Pimlico key) is masked in the log.
#
# env: the VITE_* keys below, OUT (default apps/web/.env)
set -euo pipefail

OUT="${OUT:-apps/web/.env}"
REQUIRED=(VITE_CHAIN_ID VITE_RPC_URL VITE_BUNDLER_URL VITE_SPONSORSHIP_POLICY_ID VITE_TURBO_UPLOAD_URL VITE_ARWEAVE_GATEWAY_URL VITE_RP_ID VITE_RP_NAME)
OPTIONAL=(VITE_ARWEAVE_FAST_INDEX_URL VITE_CF_BEACON_TOKEN)

[ ! -e "$OUT" ] || { echo "write-env: $OUT already exists; refusing to overwrite" >&2; exit 1; }
if [ -n "${VITE_BUNDLER_URL:-}" ]; then echo "::add-mask::${VITE_BUNDLER_URL}"; fi

missing=()
for k in "${REQUIRED[@]}"; do [ -n "${!k:-}" ] || missing+=("$k"); done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error title=production config::missing environment variables/secrets: ${missing[*]} (see docs/deploy.md)"
  exit 1
fi

lines=()
for k in "${REQUIRED[@]}" "${OPTIONAL[@]}"; do
  v="${!k:-}"
  [ -n "$v" ] || continue
  case "$v" in
    *$'\n'* | *$'\r'*) echo "::error title=production config::$k contains a line break" ; exit 1 ;;
  esac
  lines+=("$k=$v")
done

umask 077
printf '%s\n' "${lines[@]}" > "$OUT"
chmod 600 "$OUT"
echo "write-env: wrote ${#lines[@]} keys to $OUT"
