#!/usr/bin/env bash
# Tests for script/check-deployments.sh (security review W2 and its follow-up review).
# The OFFLINE part always runs (no RPC): fail-closed discovery, per-preset completeness, unknown keys.
# The NETWORK part reads public OP Sepolia RPCs only (no keys) and runs only with CRYOSHIELD_NETWORK_TESTS=1.
#   CRYOSHIELD_NETWORK_TESTS=1 script/test-check-deployments.sh
# 1. the committed OP Sepolia record passes;
# 2. non-vacuity: each tampered copy (wrong deployBlock, txHash, implementation, rpIdHash, abiHash) fails.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PASS=0
FAIL=0
ok() { echo "ok   $*"; PASS=$((PASS + 1)); }
bad() { echo "FAIL $*" >&2; FAIL=$((FAIL + 1)); }
REC=deployments/11155420.json
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- OFFLINE (always): discovery is fail-closed, records are complete, unknown keys are rejected ---------------------
off() { # <name> <dir> <expect pass|fail> [grep text]
  local out rc
  out="$(DEPLOYMENTS_DIR="$2" script/check-deployments.sh --offline 2>&1)"; rc=$?
  if [[ "$3" == pass ]]; then
    [[ $rc -eq 0 ]] && ok "offline $1: passes" || { bad "offline $1: should pass"; echo "$out" >&2; }
  elif [[ $rc -ne 0 ]] && grep -q -- "$4" <<<"$out"; then
    ok "offline $1: fails ($4)"
  else
    bad "offline $1: expected a failure with '$4' (rc=$rc)"; echo "$out" >&2
  fi
}
case_dir() { # <name> <jq filter> [file name] -> dir holding the mutated OP Sepolia record
  mkdir -p "$TMP/off-$1"
  jq "$2" "$REC" >"$TMP/off-$1/${3:-11155420.json}"
  echo "$TMP/off-$1"
}
off committed deployments pass
mkdir -p "$TMP/empty" && cp deployments/31337.json "$TMP/empty/"
off "no public record" "$TMP/empty" fail "no public deployment record"
off "record without chainId" "$(case_dir nochain 'del(.chainId)')" fail "no numeric chainId"
off "chainId != file name" "$(case_dir wrongname '.' 10.json)" fail "does not match the file name"
off "unknown top-level key" "$(case_dir topkey '. + {extra: 1}')" fail "unknown top-level key"
off "unknown key under contracts" "$(case_dir ckey '.contracts.paymaster = {}')" fail "unknown key(s) under contracts"
off "unknown wallet field" "$(case_dir wkey '.contracts.wallets["cryoshield.app"].note = "x"')" fail "wallet entry is missing fields or has unknown keys"
off "missing dev RP ID" "$(case_dir nodev 'del(.contracts.wallets["cryoshield-web-dev.fly.dev"])')" fail "wallet RP IDs"
off "extra RP ID" "$(case_dir xrp '.contracts.wallets.localhost = .contracts.wallets["cryoshield.app"]')" fail "wallet RP IDs"
off "op_sepolia without v1" "$(case_dir nov1 'del(.address, .deployBlock, .txHash, .abiHash)')" fail "VaultRegistry v1 entry missing"
off "missing vaultRegistryV2" "$(case_dir nov2 'del(.contracts.vaultRegistryV2)')" fail "contracts.vaultRegistryV2 missing"
off "op_mainnet with v1" "$(case_dir mainv1 '.chainId = 10 | .contracts.wallets |= {"cryoshield.app": .["cryoshield.app"]}' 10.json)" fail "must not exist on op_mainnet"
off "op_mainnet complete" "$(case_dir mainok '.chainId = 10 | del(.address, .deployBlock, .txHash, .abiHash) | .contracts.wallets |= {"cryoshield.app": .["cryoshield.app"]}' 10.json)" pass
off "preset without expected contents" "$(case_dir arb '.chainId = 42161' 42161.json)" fail "no expected contents for preset arbitrum_one"

# ---- NETWORK (opt-in) -------------------------------------------------------------------------------------------
if [[ "${CRYOSHIELD_NETWORK_TESTS:-0}" != "1" ]]; then
  echo "SKIP network part (set CRYOSHIELD_NETWORK_TESTS=1 to run against public OP Sepolia RPCs)"
  echo "---- $PASS passed, $FAIL failed"
  [[ "$FAIL" -eq 0 ]]
  exit
fi

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
