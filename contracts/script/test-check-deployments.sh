#!/usr/bin/env bash
# Opt-in NETWORK test for script/check-deployments.sh (security review W2). Reads public OP Sepolia RPCs only; no keys.
# Skipped unless CRYOSHIELD_NETWORK_TESTS=1, so offline CI and local runs never depend on a public RPC.
#   CRYOSHIELD_NETWORK_TESTS=1 script/test-check-deployments.sh
# 1. the committed OP Sepolia record passes;
# 2. non-vacuity: each tampered copy (wrong deployBlock, txHash, implementation, rpIdHash, abiHash) fails.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ "${CRYOSHIELD_NETWORK_TESTS:-0}" != "1" ]]; then
  echo "SKIP network test (set CRYOSHIELD_NETWORK_TESTS=1 to run against public OP Sepolia RPCs)"
  exit 0
fi
PASS=0
FAIL=0
ok() { echo "ok   $*"; PASS=$((PASS + 1)); }
bad() { echo "FAIL $*" >&2; FAIL=$((FAIL + 1)); }
REC=deployments/11155420.json
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if script/check-deployments.sh "$REC" >"$TMP/out" 2>&1; then ok "committed OP Sepolia record matches the chain"; else bad "committed record failed:"; cat "$TMP/out" >&2; fi

mutate() { # <name> <jq filter> <expected failure text>
  mkdir -p "$TMP/$1"
  jq "$2" "$REC" >"$TMP/$1/11155420.json"
  if script/check-deployments.sh "$TMP/$1/11155420.json" >"$TMP/$1.out" 2>&1; then
    bad "$1: tampered record passed"
  elif grep -q "$3" "$TMP/$1.out"; then
    ok "$1: tampered record fails ($3)"
  else
    bad "$1: failed, but not with '$3'"; cat "$TMP/$1.out" >&2
  fi
}
mutate deployBlock '.contracts.vaultRegistryV2.deployBlock += 1' "VaultRegistryV2: deployBlock"
mutate txHash '.txHash = .contracts.vaultRegistryV2.txHash' "v1 VaultRegistry: tx derives"
mutate implementation '.contracts.wallets["cryoshield.app"].implementation = "0x8bFfA95505bAbe88d86694a245E7768fa052395c"' "factory.implementation() != recorded implementation"
mutate rpIdHash '.contracts.wallets["cryoshield.app"].rpIdHash = .contracts.wallets["cryoshield-web-dev.fly.dev"].rpIdHash' "rpIdHash != sha256(rpId)"
mutate abiHash '.contracts.vaultRegistryV2.abiHash = .abiHash' "v2: abiHash"
mutate address '.contracts.vaultRegistryV2.address = "0xB43f58cF17e64B603aE5588a1DD17E96a0849e44"' "VaultRegistryV2: tx derives"

echo "---- $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
