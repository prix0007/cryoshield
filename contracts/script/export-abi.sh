#!/usr/bin/env bash
# Export the ABIs (functions, events, and custom errors) for the web app and the desktop recovery tool:
#   abi/VaultRegistry.json                 VaultRegistry v1 (legacy reads)
#   abi/VaultRegistryV2.json               VaultRegistry v2 (harden-gas-sponsorship)
#   abi/CryoShieldSmartWallet.json         account implementation (CBSW v1.1 ABI + RP_ID_HASH, MAX_OWNERS)
#   abi/CryoShieldSmartWalletFactory.json  factory (CBSW v1.1 factory ABI + RP_ID_HASH)
# `--check` fails if any committed file is stale.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CONTRACTS=(VaultRegistry VaultRegistryV2 CryoShieldSmartWallet CryoShieldSmartWalletFactory)

mkdir -p abi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

status=0
for c in "${CONTRACTS[@]}"; do
  forge inspect "src/$c.sol:$c" abi --json >"$TMP/$c.json"
  if [[ "${1:-}" == "--check" ]]; then
    if diff -q "$TMP/$c.json" "abi/$c.json" >/dev/null 2>&1; then
      echo "abi/$c.json is up to date"
    else
      echo "abi/$c.json is stale; run script/export-abi.sh" >&2
      status=1
    fi
  else
    cp "$TMP/$c.json" "abi/$c.json"
    echo "wrote abi/$c.json"
  fi
done
exit "$status"
