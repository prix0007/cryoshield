#!/usr/bin/env bash
# Verify public-chain deployment records (deployments/<chainId>.json) against the chain (security review W2).
# Read-only: eth_chainId, eth_getCode, eth_call, eth_getTransactionByHash, eth_getTransactionReceipt on public RPCs.
# No keys, no secrets, nothing is sent to a public chain.
#
#   script/check-deployments.sh                 every public record in deployments/ (31337 is skipped)
#   script/check-deployments.sh 11155420 ...    only these chain IDs (or paths to <chainId>.json record files)
#   <PRESET>_RPC_URL                            override the default public RPC (e.g. OP_SEPOLIA_RPC_URL)
#
# For every contract in a record (VaultRegistry v1 top-level, contracts.vaultRegistryV2, contracts.wallets.<rpId>):
#   1. deploy tx: receipt status 1, block == deployBlock, sent to the canonical CREATE2 deployer, and the CREATE2
#      address derived from the tx input (salt || initCode) equals the recorded address;
#   2. the tx's init code is exactly this build's init code (v1: `v1` Foundry profile; wallets: + abi.encode(rpIdHash));
#   3. the runtime code at the address equals the runtime code the same init code produces on a throwaway anvil
#      (same CREATE2 addresses there, so immutables are compared too);
#   4. wallets: factory.implementation() == implementation, factory/implementation RP_ID_HASH() == rpIdHash ==
#      sha256(rpId); abiHash/factoryAbiHash == keccak256 of the committed ABI files.
# Exit 0 if every check passes, 1 otherwise (each failure is printed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CREATE2_DEPLOYER=0x4e59b44847b379578588920cA78FbF26c0B4956C
ANVIL_PORT="${CHECK_ANVIL_PORT:-8551}"
ANVIL_RPC="http://127.0.0.1:$ANVIL_PORT"
ANVIL_SENDER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

FAILS=0
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*" >&2; FAILS=$((FAILS + 1)); }
lc() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
abi_hash() { cast keccak "0x$(xxd -p "$1" | tr -d '\n')"; }

default_rpc() {
  case "$1" in
    op_sepolia) echo "https://sepolia.optimism.io" ;;
    op_mainnet) echo "https://mainnet.optimism.io" ;;
    arbitrum_sepolia) echo "https://sepolia-rollup.arbitrum.io/rpc" ;;
    arbitrum_one) echo "https://arb1.arbitrum.io/rpc" ;;
    *) echo "" ;;
  esac
}

# Build artifacts: v1 with its pinned profile, everything else with the default profile.
INIT_V1="$(FOUNDRY_PROFILE=v1 forge inspect src/VaultRegistry.sol:VaultRegistry bytecode)"
INIT_V2="$(forge inspect src/VaultRegistryV2.sol:VaultRegistryV2 bytecode)"
INIT_FACTORY="$(forge inspect src/CryoShieldSmartWalletFactory.sol:CryoShieldSmartWalletFactory bytecode)"

# Throwaway anvil producing the expected runtime code at the same CREATE2 addresses.
anvil --port "$ANVIL_PORT" --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do cast chain-id --rpc-url "$ANVIL_RPC" >/dev/null 2>&1 && break; sleep 0.1; done
expected_code() { # <salt> <initCode> -> runtime code at the CREATE2 address on anvil
  local addr
  addr="$(cast create2 --deployer "$CREATE2_DEPLOYER" --salt "$1" --init-code "$2" 2>/dev/null | awk '{print $NF}')"
  if [[ "$(cast code "$addr" --rpc-url "$ANVIL_RPC")" == "0x" ]]; then
    cast send --unlocked --from "$ANVIL_SENDER" --rpc-url "$ANVIL_RPC" --gas-limit 15000000 \
      "$CREATE2_DEPLOYER" "${1}${2#0x}" >/dev/null
  fi
  cast code "$addr" --rpc-url "$ANVIL_RPC"
}

# check_deploy <label> <rpc> <address> <deployBlock> <txHash> <expectedInitCode>
check_deploy() {
  local label="$1" rpc="$2" addr="$3" block="$4" tx="$5" init="$6" input salt txinit derived status rblock to code want
  status="$(cast receipt "$tx" status --rpc-url "$rpc" 2>/dev/null || true)"
  [[ "$status" == 1* ]] && ok "$label: deploy tx $tx succeeded" || bad "$label: deploy tx $tx status '$status'"
  rblock="$(cast receipt "$tx" blockNumber --rpc-url "$rpc" 2>/dev/null || true)"
  [[ "$rblock" == "$block" ]] && ok "$label: deployBlock $block matches the receipt" || bad "$label: deployBlock $block != receipt block '$rblock'"
  to="$(cast tx "$tx" to --rpc-url "$rpc" 2>/dev/null || true)"
  [[ "$(lc "$to")" == "$(lc "$CREATE2_DEPLOYER")" ]] && ok "$label: tx sent to the CREATE2 deployer" || bad "$label: tx to '$to', not the CREATE2 deployer"
  input="$(cast tx "$tx" input --rpc-url "$rpc" 2>/dev/null || true)"
  salt="0x${input:2:64}"
  txinit="0x${input:66}"
  derived="$(cast create2 --deployer "$CREATE2_DEPLOYER" --salt "$salt" --init-code "$txinit" 2>/dev/null | awk '{print $NF}')"
  [[ "$(lc "$derived")" == "$(lc "$addr")" ]] && ok "$label: CREATE2(tx salt, tx init code) == $addr" || bad "$label: tx derives '$derived', record says $addr"
  [[ "$(cast keccak "$txinit")" == "$(cast keccak "$init")" ]] && ok "$label: deployed init code == this build" || bad "$label: deployed init code differs from this build"
  code="$(cast code "$addr" --rpc-url "$rpc")"
  want="$(expected_code "$salt" "$init")"
  [[ "$code" != "0x" && "$(cast keccak "$code")" == "$(cast keccak "$want")" ]] && ok "$label: runtime code == expected ($(((${#code} - 2) / 2)) bytes)" || bad "$label: runtime code at $addr differs from the expected runtime"
}

check_record() {
  local file="$1" chain preset rpc_env rpc got v1 v2 rpId f i h
  chain="$(jq -r .chainId "$file")"
  [[ "$(basename "$file" .json)" == "$chain" ]] || { bad "$file: chainId $chain does not match the file name"; return; }
  read -r preset _ rpc_env _ < <(script/deploy.sh --list-presets | awk -v c="$chain" '$2 == c {print $1, $2, $3, $4}') || true
  [[ -n "${preset:-}" ]] || { bad "$file: chain $chain is not a deploy.sh preset"; return; }
  rpc="${!rpc_env:-$(default_rpc "$preset")}"
  [[ -n "$rpc" ]] || { bad "$file: no RPC for $preset (set $rpc_env)"; return; }
  echo "== $file ($preset, $rpc)"
  got="$(cast chain-id --rpc-url "$rpc" 2>/dev/null || true)"
  [[ "$got" == "$chain" ]] || { bad "$preset: RPC chain id '$got' != $chain"; return; }

  v1="$(jq -r '.address // empty' "$file")"
  if [[ -n "$v1" ]]; then
    [[ "$preset" != "op_mainnet" ]] || bad "$preset: VaultRegistry v1 must never exist on OP Mainnet"
    check_deploy "v1 VaultRegistry" "$rpc" "$v1" "$(jq -r .deployBlock "$file")" "$(jq -r .txHash "$file")" "$INIT_V1"
    [[ "$(jq -r .abiHash "$file")" == "$(abi_hash abi/VaultRegistry.json)" ]] && ok "v1: abiHash" || bad "v1: abiHash != abi/VaultRegistry.json"
  fi

  v2="$(jq -r '.contracts.vaultRegistryV2.address // empty' "$file")"
  if [[ -n "$v2" ]]; then
    check_deploy "VaultRegistryV2" "$rpc" "$v2" "$(jq -r .contracts.vaultRegistryV2.deployBlock "$file")" \
      "$(jq -r .contracts.vaultRegistryV2.txHash "$file")" "$INIT_V2"
    [[ "$(jq -r .contracts.vaultRegistryV2.abiHash "$file")" == "$(abi_hash abi/VaultRegistryV2.json)" ]] && ok "v2: abiHash" || bad "v2: abiHash != abi/VaultRegistryV2.json"
  fi

  while IFS= read -r rpId; do
    [[ -n "$rpId" ]] || continue
    local p=".contracts.wallets[\"$rpId\"]"
    f="$(jq -r "$p.factory" "$file")"
    i="$(jq -r "$p.implementation" "$file")"
    h="$(jq -r "$p.rpIdHash" "$file")"
    [[ "$h" == "0x$(printf '%s' "$rpId" | shasum -a 256 | cut -d' ' -f1)" ]] && ok "wallet $rpId: rpIdHash == sha256(rpId)" || bad "wallet $rpId: rpIdHash != sha256(rpId)"
    check_deploy "wallet $rpId factory" "$rpc" "$f" "$(jq -r "$p.deployBlock" "$file")" "$(jq -r "$p.txHash" "$file")" \
      "${INIT_FACTORY}$(cast abi-encode 'f(bytes32)' "$h" | cut -c3-)"
    [[ "$(lc "$(cast call "$f" 'implementation()(address)' --rpc-url "$rpc")")" == "$(lc "$i")" ]] && ok "wallet $rpId: factory.implementation() == $i" || bad "wallet $rpId: factory.implementation() != recorded implementation"
    [[ "$(cast call "$f" 'RP_ID_HASH()(bytes32)' --rpc-url "$rpc")" == "$h" ]] && ok "wallet $rpId: factory RP_ID_HASH" || bad "wallet $rpId: factory RP_ID_HASH != rpIdHash"
    [[ "$(cast call "$i" 'RP_ID_HASH()(bytes32)' --rpc-url "$rpc")" == "$h" ]] && ok "wallet $rpId: implementation RP_ID_HASH" || bad "wallet $rpId: implementation RP_ID_HASH != rpIdHash"
    # The implementation is created inside the factory's constructor: compare it with the anvil copy too.
    [[ "$(cast keccak "$(cast code "$i" --rpc-url "$rpc")")" == "$(cast keccak "$(cast code "$i" --rpc-url "$ANVIL_RPC")")" ]] && ok "wallet $rpId: implementation runtime code == expected" || bad "wallet $rpId: implementation runtime code differs"
    [[ "$(jq -r "$p.abiHash" "$file")" == "$(abi_hash abi/CryoShieldSmartWallet.json)" ]] && ok "wallet $rpId: abiHash" || bad "wallet $rpId: abiHash != abi/CryoShieldSmartWallet.json"
    [[ "$(jq -r "$p.factoryAbiHash" "$file")" == "$(abi_hash abi/CryoShieldSmartWalletFactory.json)" ]] && ok "wallet $rpId: factoryAbiHash" || bad "wallet $rpId: factoryAbiHash != abi/CryoShieldSmartWalletFactory.json"
  done < <(jq -r '.contracts.wallets // {} | keys[]' "$file")
}

FILES=()
if (($#)); then
  for c in "$@"; do
    if [[ "$c" == *.json ]]; then FILES+=("$c"); else FILES+=("deployments/$c.json"); fi
  done
else
  for f in deployments/*.json; do
    [[ "$(basename "$f")" == "31337.json" ]] && continue
    jq -e '.chainId' "$f" >/dev/null 2>&1 || continue
    FILES+=("$f")
  done
fi
((${#FILES[@]})) || { echo "no public deployment records to check"; exit 0; }
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { bad "$f: no such record"; continue; }
  check_record "$f"
done

if ((FAILS)); then
  echo "---- $FAILS check(s) FAILED" >&2
  exit 1
fi
echo "---- all deployment records match the chain"
