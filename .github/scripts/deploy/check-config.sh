#!/usr/bin/env bash
# Is the production build configured? (OpenSpec change deploy-skip-when-unconfigured.)
# An unconfigured or partially configured `production-build` environment must not turn main red: this warns, names
# what is missing, and outputs configured=false so the rest of the Deploy pipeline is skipped (the run succeeds).
#
# env: HAS_<NAME>=true|false for every required name, computed in the workflow as `${{ vars.X != '' }}` or
#      `${{ secrets.X != '' }}`: the values themselves never reach this step. SUMMARY (default $GITHUB_STEP_SUMMARY).
# out: configured=true|false to $GITHUB_OUTPUT (and stdout)
set -euo pipefail

# Must equal REQUIRED in write-env.sh (asserted by test/deploy-config.test.mjs).
REQUIRED=(VITE_CHAIN_ID VITE_RPC_URL VITE_BUNDLER_URL VITE_SPONSORSHIP_POLICY_ID VITE_TURBO_UPLOAD_URL VITE_ARWEAVE_GATEWAY_URL VITE_RP_ID VITE_RP_NAME)
SUMMARY="${SUMMARY:-${GITHUB_STEP_SUMMARY:-/dev/null}}"

emit() {
  echo "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >> "$GITHUB_OUTPUT"; fi
}

missing=()
for k in "${REQUIRED[@]}"; do
  flag="HAS_${k}"
  case "${!flag-unset}" in
    true) ;;
    false) missing+=("$k") ;;
    # A missing or odd flag is a bug in deploy.yml, not a configuration gap: fail loudly rather than skip forever.
    *) echo "check-config: ${flag} must be true or false (is the config step env out of sync with this script?)" >&2; exit 2 ;;
  esac
done

if [ "${#missing[@]}" -eq 0 ]; then
  emit "configured=true"
  exit 0
fi

msg="The production-build environment is missing: ${missing[*]}. Nothing was built or deployed; set them up as in docs/deploy.md (First-time setup), then merge or run: gh workflow run deploy.yml --ref main -f force=true"
echo "::warning title=deploy not configured::${msg}"
{
  echo "## Deploy skipped: not configured"
  echo
  echo "${msg}"
} >> "$SUMMARY"
emit "configured=false"
