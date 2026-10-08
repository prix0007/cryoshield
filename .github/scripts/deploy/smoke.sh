#!/usr/bin/env bash
# Post-deploy smoke test of the live site (add-continuous-deploy, design D6; split-dev-and-release-deploys, spec
# continuous-deployment "Smoke test and automatic rollback per target"). Retries the whole suite, so a rolling deploy or
# a resuming machine can settle.
#
# env: EXPECT_SHA (40-hex), DONATION_ADDRESS (0x + 40 hex, config/donation.json),
#      from contracts/deployments/<chain>.json (harden-gas-sponsorship):
#        REGISTRY_V2_ADDRESS (0x + 40 hex, contracts.vaultRegistryV2.address),
#        WALLET_FACTORY_ADDRESS (0x + 40 hex, contracts.wallets[<release rpId>].factory),
#        REGISTRY_ADDRESS (VaultRegistry v1, 0x + 40 hex, or empty where v1 does not exist, e.g. OP Mainnet),
#        REGISTRIES (optional, web-registry-versions D6): every registry of the record, newest first, as
#                   "v3=0x… v2=0x… v1=0x…"; when set, /release.json's config.registries must be exactly this list,
#      BASE_URL (default https://cryoshield.app),
#      EXPECT_NOINDEX (true on the development site: every page must send X-Robots-Tag: noindex, nofollow;
#                      false, the default, on production: no page may send a noindex X-Robots-Tag),
#      SMOKE_ATTEMPTS (default 10), SMOKE_SLEEP seconds (default 15)
set -euo pipefail

BASE_URL="${BASE_URL:-https://cryoshield.app}"
ATTEMPTS="${SMOKE_ATTEMPTS:-10}"
SLEEP="${SMOKE_SLEEP:-15}"
EXPECT_SHA="${EXPECT_SHA:-}"
REGISTRY_ADDRESS="${REGISTRY_ADDRESS:-}"
REGISTRY_V2_ADDRESS="${REGISTRY_V2_ADDRESS:-}"
WALLET_FACTORY_ADDRESS="${WALLET_FACTORY_ADDRESS:-}"
DONATION_ADDRESS="${DONATION_ADDRESS:-}"
REGISTRIES="${REGISTRIES:-}"
EXPECT_NOINDEX="${EXPECT_NOINDEX:-false}"
[[ "$EXPECT_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "smoke: EXPECT_SHA must be a full 40-hex commit" >&2; exit 2; }
[ -z "$REGISTRY_ADDRESS" ] || [[ "$REGISTRY_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "smoke: REGISTRY_ADDRESS must be empty or 0x + 40 hex" >&2; exit 2; }
[[ "$REGISTRY_V2_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "smoke: REGISTRY_V2_ADDRESS must be 0x + 40 hex" >&2; exit 2; }
[[ "$WALLET_FACTORY_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "smoke: WALLET_FACTORY_ADDRESS must be 0x + 40 hex" >&2; exit 2; }
[[ "$DONATION_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "smoke: DONATION_ADDRESS must be 0x + 40 hex" >&2; exit 2; }
[[ "$EXPECT_NOINDEX" =~ ^(true|false)$ ]] || { echo "smoke: EXPECT_NOINDEX must be true or false" >&2; exit 2; }
REG_ITEM='v[1-9][0-9]{0,2}=0x[0-9a-fA-F]{40}'
[ -z "$REGISTRIES" ] || [[ "$REGISTRIES" =~ ^$REG_ITEM( $REG_ITEM)*$ ]] || { echo "smoke: REGISTRIES must be 'vN=0x<40 hex>' entries separated by single spaces" >&2; exit 2; }

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

lc() { tr 'A-F' 'a-f' <<<"$1"; }
release_field() { # release_field <jq path> -> lower-case value from the fetched /release.json, or "null"
  lc "$(jq -r "$1 // \"null\"" "$TMP/b" 2>/dev/null || echo unreadable)"
}

# web-registry-versions D6: config.registries lists every registry, newest first; its v1/v2 equal the record, each is
# shown on /architecture, and with REGISTRIES set it is exactly that list. Reads the fetched /release.json ($TMP/b).
check_registries() {
  local shape list
  shape='type == "array" and length > 0 and all(.[]; type == "object"
    and (.version | type == "string" and test("^v[1-9][0-9]{0,2}$"))
    and (.address | type == "string" and test("^0x[0-9a-fA-F]{40}$")))'
  if ! jq -e ".config.registries | $shape" "$TMP/b" >/dev/null 2>&1; then
    errors+=("/release.json config.registries is missing or malformed (expected [{version: vN, address}], newest first)")
    return
  fi
  jq -e '[.config.registries[].version[1:] | tonumber] as $n | all(range(1; $n | length); $n[. - 1] > $n[.])' "$TMP/b" >/dev/null ||
    errors+=("/release.json config.registries is not newest first with unique versions")
  list="$(lc "$(jq -r '[.config.registries[] | "\(.version)=\(.address)"] | join(" ")' "$TMP/b")")"
  local want_v2 want_v1
  want_v2="$(lc "$REGISTRY_V2_ADDRESS")"
  want_v1="$(lc "$REGISTRY_ADDRESS")"
  [[ " $list " == *" v2=$want_v2 "* ]] || errors+=("/release.json config.registries v2 is not $REGISTRY_V2_ADDRESS ($list)")
  if [ -n "$REGISTRY_ADDRESS" ]; then
    [[ " $list " == *" v1=$want_v1 "* ]] || errors+=("/release.json config.registries v1 is not $REGISTRY_ADDRESS ($list)")
  else
    [[ " $list " != *" v1="* ]] || errors+=("/release.json config.registries names a registry v1 but the deployment record has none")
  fi
  local item
  for item in $list; do
    grep -qiF -- "${item#*=}" "$TMP/arch" 2>/dev/null || errors+=("/architecture does not show registry ${item%%=*} ${item#*=}")
  done
  if [ -n "$REGISTRIES" ] && [ "$list" != "$(lc "$REGISTRIES")" ]; then
    errors+=("/release.json registries are $list, expected $REGISTRIES")
  fi
}

check_once() {
  errors=()
  for p in "${PAGES[@]}"; do
    fetch "$p"
    [ "$status" = "200" ] || errors+=("$p returned $status")
    # Development is never indexed; production never says noindex (a dev Caddyfile shipped to production fails here).
    robots="$(grep -E "^x-robots-tag:" "$TMP/hl" | cut -d: -f2- | tr -d " " | tr "\n" ";" || true)"
    if [ "$EXPECT_NOINDEX" = "true" ]; then
      [ "$robots" = "noindex,nofollow;" ] || errors+=("$p: x-robots-tag is '${robots%;}', expected 'noindex, nofollow' on the development site")
    else
      case "$robots" in *noindex* | *none*) errors+=("$p: production sends x-robots-tag '${robots%;}' (noindex)") ;; esac
    fi
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
        cp "$TMP/b" "$TMP/arch"
        grep -qiF -- "$REGISTRY_V2_ADDRESS" "$TMP/b" || errors+=("/architecture does not show the registry v2 address $REGISTRY_V2_ADDRESS")
        grep -qiF -- "$WALLET_FACTORY_ADDRESS" "$TMP/b" || errors+=("/architecture does not show the wallet factory $WALLET_FACTORY_ADDRESS")
        if [ -n "$REGISTRY_ADDRESS" ]; then
          grep -qiF -- "$REGISTRY_ADDRESS" "$TMP/b" || errors+=("/architecture does not show the registry v1 address $REGISTRY_ADDRESS")
        fi
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
  # The live build's contracts equal the deployment record (v2 and this RP ID's wallet always; v1 only where it exists).
  v2="$(release_field .config.registryV2.address)"
  [ "$v2" = "$(lc "$REGISTRY_V2_ADDRESS")" ] || errors+=("/release.json registry v2 is $v2, expected $REGISTRY_V2_ADDRESS")
  factory="$(release_field .config.wallet.factory)"
  [ "$factory" = "$(lc "$WALLET_FACTORY_ADDRESS")" ] || errors+=("/release.json wallet factory is $factory, expected $WALLET_FACTORY_ADDRESS")
  v1="$(release_field .config.registry.address)"
  if [ -n "$REGISTRY_ADDRESS" ]; then
    [ "$v1" = "$(lc "$REGISTRY_ADDRESS")" ] || errors+=("/release.json registry v1 is $v1, expected $REGISTRY_ADDRESS")
  else
    [ "$v1" = "null" ] || errors+=("/release.json names a registry v1 ($v1) but the deployment record has none")
  fi
  check_registries
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
