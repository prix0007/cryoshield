#!/usr/bin/env bash
# Post-deploy smoke test of the live site (add-continuous-deploy, design D6; spec continuous-deployment
# "Smoke test and automatic rollback"). Retries the whole suite, so a rolling deploy or a resuming machine can settle.
#
# env: EXPECT_SHA (40-hex), REGISTRY_ADDRESS (0x + 40 hex), DONATION_ADDRESS (0x + 40 hex, config/donation.json),
#      BASE_URL (default https://cryoshield.app),
#      SMOKE_ATTEMPTS (default 10), SMOKE_SLEEP seconds (default 15)
set -euo pipefail

BASE_URL="${BASE_URL:-https://cryoshield.app}"
ATTEMPTS="${SMOKE_ATTEMPTS:-10}"
SLEEP="${SMOKE_SLEEP:-15}"
EXPECT_SHA="${EXPECT_SHA:-}"
REGISTRY_ADDRESS="${REGISTRY_ADDRESS:-}"
DONATION_ADDRESS="${DONATION_ADDRESS:-}"
[[ "$EXPECT_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "smoke: EXPECT_SHA must be a full 40-hex commit" >&2; exit 2; }
[[ "$REGISTRY_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "smoke: REGISTRY_ADDRESS must be 0x + 40 hex" >&2; exit 2; }
[[ "$DONATION_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "smoke: DONATION_ADDRESS must be 0x + 40 hex" >&2; exit 2; }

PAGES=(/ /app/ /architecture /devices /support /privacy /healthz)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
errors=()

fetch() { # fetch <path> -> sets status, writes headers/body files
  status="$(curl -sS --max-time 20 -D "$TMP/h" -o "$TMP/b" -w '%{http_code}' "$BASE_URL$1" 2>/dev/null || echo 000)"
  tr -d '\r' < "$TMP/h" | tr '[:upper:]' '[:lower:]' > "$TMP/hl" 2>/dev/null || : > "$TMP/hl"
}

header_has() { # header_has <name> <required substring, lower-case>
  grep -E "^$1:" "$TMP/hl" | grep -qF -- "$2"
}

check_once() {
  errors=()
  for p in "${PAGES[@]}"; do
    fetch "$p"
    [ "$status" = "200" ] || errors+=("$p returned $status")
    case "$p" in
      / | /app/)
        header_has content-security-policy "frame-ancestors 'none'" || errors+=("$p: content-security-policy missing or without frame-ancestors 'none'")
        header_has strict-transport-security "max-age=" || errors+=("$p: strict-transport-security missing")
        header_has x-frame-options "deny" || errors+=("$p: x-frame-options is not DENY")
        header_has x-content-type-options "nosniff" || errors+=("$p: x-content-type-options is not nosniff")
        header_has referrer-policy "no-referrer" || errors+=("$p: referrer-policy is not no-referrer")
        header_has cross-origin-opener-policy "same-origin" || errors+=("$p: cross-origin-opener-policy missing")
        header_has cross-origin-resource-policy "same-origin" || errors+=("$p: cross-origin-resource-policy missing")
        ;;
      /architecture)
        grep -qiF -- "$REGISTRY_ADDRESS" "$TMP/b" || errors+=("/architecture does not show the registry address $REGISTRY_ADDRESS")
        ;;
      /support)
        # add-donation: the live page shows exactly the configured donation address (case-sensitive: EIP-55), and
        # no other 20-byte hex address (post-deploy tamper check).
        grep -qF -- "$DONATION_ADDRESS" "$TMP/b" || errors+=("/support does not show the donation address $DONATION_ADDRESS")
        others="$(grep -oE '0x[0-9a-fA-F]{40}' "$TMP/b" | grep -vxF -- "$DONATION_ADDRESS" | sort -u | tr '\n' ' ' || true)"
        [ -z "$others" ] || errors+=("/support shows another address: $others")
        ;;
    esac
  done
  fetch /release.json
  live="$(jq -r '.commit // empty' "$TMP/b" 2>/dev/null || true)"
  [ "$status" = "200" ] && [ "$live" = "$EXPECT_SHA" ] || errors+=("/release.json reports ${live:-nothing} (HTTP $status), expected $EXPECT_SHA")
  [ "${#errors[@]}" -eq 0 ]
}

for ((i = 1; i <= ATTEMPTS; i++)); do
  if check_once; then
    echo "smoke: $BASE_URL serves $EXPECT_SHA; all checks passed (attempt $i)"
    exit 0
  fi
  echo "smoke: attempt $i/$ATTEMPTS failed: ${errors[*]}"
  if [ "$i" -lt "$ATTEMPTS" ]; then sleep "$SLEEP"; fi
done
for e in "${errors[@]}"; do echo "::error title=smoke test::$e"; done
exit 1
