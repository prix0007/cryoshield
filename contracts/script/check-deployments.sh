#!/usr/bin/env bash
# Verify public-chain deployment records (deployments/<chainId>.json) against the chain (security review W2).
# Read-only: eth_chainId, eth_getCode, eth_call, eth_getTransactionByHash, eth_getTransactionReceipt on public RPCs.
# No keys, no secrets, nothing is sent to a public chain.
#
#   script/check-deployments.sh                 every public record in deployments/ (31337 is skipped)
#   script/check-deployments.sh 11155420 ...    only these chain IDs (or paths to <chainId>.json record files)
#   script/check-deployments.sh --offline [...]  structure and completeness only (no RPC, no anvil)
#   DEPLOYMENTS_DIR                             records directory (default deployments/; used by the self-test)
#   <PRESET>_RPC_URL                            override the default public RPC (e.g. OP_SEPOLIA_RPC_URL)
#
# Fail-closed (security review of the follow-ups, MEDIUM 1): a non-31337 record without chainId fails, having no public
# record at all fails, every record must hold exactly the contracts EXPECTED for its preset (below), and unknown keys
# (top level, under contracts, or inside an entry) fail.
#
# For every contract in a record (VaultRegistry v1 top-level, contracts.vaultRegistryV2, contracts.wallets.<rpId>;
# contracts.vaultRegistries.v<N> is shape-checked and, online, refused until this script can verify that build):
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
ANVIL_SENDER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
OFFLINE=0
DEPLOYMENTS_DIR="${DEPLOYMENTS_DIR:-deployments}" # tests point this at fixture directories
if [[ "${1:-}" == "--offline" ]]; then
  OFFLINE=1
  shift
fi

FAILS=0
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*" >&2; FAILS=$((FAILS + 1)); }
lc() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
abi_hash() { cast keccak "0x$(xxd -p "$1" | tr -d '\n')"; }

# What each public preset's record must contain: v1 (required | forbidden) and the exact set of wallet RP IDs.
# VaultRegistryV2 is required everywhere. A record for a preset not listed here fails (add it here first).
expected() {
  case "$1" in
    op_sepolia) echo "required cryoshield-web-dev.fly.dev,cryoshield.app" ;;
    op_mainnet) echo "forbidden cryoshield.app" ;;
    *) return 1 ;;
  esac
}

# Structure and completeness of one record (no RPC). Prints ok/FAIL lines; sets FAILS.
lint_record() {
  local file="$1" preset="$2" v1want wallets have extra
  read -r v1want wallets < <(expected "$preset") || { bad "$file: no expected contents for preset $preset (add it to expected() first)"; return; }
  extra="$(jq -r '(keys - ["chainId","address","deployBlock","txHash","abiHash","contracts"])[]' "$file")"
  [[ -z "$extra" ]] && ok "$preset: no unknown top-level keys" || bad "$preset: unknown top-level key(s): $(tr '\n' ' ' <<<"$extra")"
  extra="$(jq -r '(.contracts // {} | keys) - ["vaultRegistryV2","vaultRegistries","wallets"] | .[]' "$file")"
  [[ -z "$extra" ]] && ok "$preset: no unknown keys under contracts" || bad "$preset: unknown key(s) under contracts: $(tr '\n' ' ' <<<"$extra")"
  if [[ "$v1want" == required ]]; then
    jq -e '(.address|type=="string") and (.deployBlock|type=="number") and (.txHash|type=="string") and (.abiHash|type=="string")' "$file" >/dev/null &&
      ok "$preset: VaultRegistry v1 entry present" || bad "$preset: VaultRegistry v1 entry missing or incomplete"
  else
    jq -e '[.address, .deployBlock, .txHash, .abiHash] | all(. == null)' "$file" >/dev/null &&
      ok "$preset: no VaultRegistry v1 entry (forbidden here)" || bad "$preset: VaultRegistry v1 must not exist on $preset"
  fi
  jq -e '.contracts.vaultRegistryV2 | (keys == ["abiHash","address","deployBlock","txHash"]) and (.deployBlock|type=="number")' "$file" >/dev/null 2>&1 &&
    ok "$preset: vaultRegistryV2 entry complete" || bad "$preset: contracts.vaultRegistryV2 missing, incomplete or with unknown keys"
  lint_later_registries "$file" "$preset"
  have="$(jq -r '.contracts.wallets // {} | keys | join(",")' "$file")"
  [[ "$have" == "$wallets" ]] && ok "$preset: wallet RP IDs == {$wallets}" || bad "$preset: wallet RP IDs {$have} != expected {$wallets}"
  jq -e '.contracts.wallets // {} | to_entries | all(.value | (keys == ["abiHash","deployBlock","factory","factoryAbiHash","implementation","rpIdHash","txHash"]) and (.deployBlock|type=="number"))' "$file" >/dev/null &&
    ok "$preset: every wallet entry has exactly the expected fields" || bad "$preset: a wallet entry is missing fields or has unknown keys"
}

# Registry v3 and later (deployments/README.md; recover-registry-versions D5, task 7.1): optional, under
# contracts.vaultRegistries.v<N> (N 3..999, no leading zero) with exactly {abiHash, address, deployBlock, txHash}.
# Its abiHash must be one of the committed registry ABIs (the web app and the recovery tool refuse anything else),
# and no two registry versions may share an address. Absent today on every chain.
lint_later_registries() {
  local file="$1" preset="$2" bad_keys known1 known2
  jq -e '.contracts.vaultRegistries // {} | type == "object"' "$file" >/dev/null 2>&1 ||
    { bad "$preset: contracts.vaultRegistries must be an object keyed v3, v4, …"; return; }
  [[ "$(jq -r '.contracts.vaultRegistries // {} | length' "$file")" == 0 ]] && return
  bad_keys="$(jq -r '.contracts.vaultRegistries | keys[] | select(test("^v([3-9]|[1-9][0-9]{1,2})$") | not)' "$file")" || bad_keys="(unreadable)"
  [[ -z "$bad_keys" ]] && ok "$preset: contracts.vaultRegistries keys are v3 and later" ||
    bad "$preset: invalid key(s) under contracts.vaultRegistries (expected v3, v4, …; v1 and v2 keep their own keys): $(tr '\n' ' ' <<<"$bad_keys")"
  jq -e '.contracts.vaultRegistries | to_entries | all(.value | type == "object" and (keys == ["abiHash","address","deployBlock","txHash"]) and (.deployBlock|type=="number" and . >= 0 and . == floor) and (.address|type=="string" and test("^0x[0-9a-fA-F]{40}$")) and (.txHash|type=="string" and test("^0x[0-9a-fA-F]{64}$")) and (.abiHash|type=="string"))' "$file" >/dev/null 2>&1 &&
    ok "$preset: every contracts.vaultRegistries entry has exactly the expected fields" ||
    bad "$preset: a contracts.vaultRegistries entry is missing fields, has unknown keys or an invalid value"
  known1="$(lc "$(abi_hash abi/VaultRegistry.json)")"
  known2="$(lc "$(abi_hash abi/VaultRegistryV2.json)")"
  bad_keys="$(jq -r --arg a "$known1" --arg b "$known2" \
    '.contracts.vaultRegistries | to_entries[] | select((.value | if type == "object" then .abiHash else null end | if type == "string" then ascii_downcase else "" end) as $h | $h != $a and $h != $b) | .key' "$file" 2>/dev/null)" || bad_keys="(unreadable) "
  [[ -z "$bad_keys" ]] && ok "$preset: every later registry's abiHash is a committed registry ABI" ||
    bad "$preset: registry $(tr '\n' ' ' <<<"$bad_keys")has an abiHash matching neither abi/VaultRegistry.json nor abi/VaultRegistryV2.json"
  jq -e '[.address, .contracts.vaultRegistryV2.address, (.contracts.vaultRegistries | .[] | .address?)] | map(select(type == "string") | ascii_downcase) | length == (unique | length)' "$file" >/dev/null 2>&1 &&
    ok "$preset: registry addresses are distinct" || bad "$preset: two registry versions have the same address"
  # The newest registry takes every write, so it needs the v2 (write) ABI, as the web build requires.
  jq -e --arg b "$known2" '.contracts.vaultRegistries | to_entries | max_by(.key | ltrimstr("v") | tonumber) | .value.abiHash | ascii_downcase == $b' "$file" >/dev/null 2>&1 &&
    ok "$preset: the newest registry has the v2 (write) ABI" || bad "$preset: the newest registry's abiHash is not abi/VaultRegistryV2.json (it takes every write)"
}

default_rpc() {
  case "$1" in
    op_sepolia) echo "https://sepolia.optimism.io" ;;
    op_mainnet) echo "https://mainnet.optimism.io" ;;
    arbitrum_sepolia) echo "https://sepolia-rollup.arbitrum.io/rpc" ;;
    arbitrum_one) echo "https://arb1.arbitrum.io/rpc" ;;
    *) echo "" ;;
  esac
}

# Record discovery is fail-closed: a non-31337 record without a chainId, or no public record at all, fails.
FILES=()
if (($#)); then
  for c in "$@"; do
    if [[ "$c" == *.json ]]; then FILES+=("$c"); else FILES+=("deployments/$c.json"); fi
  done
else
  for f in "$DEPLOYMENTS_DIR"/*.json; do
    [[ -e "$f" ]] || continue
    [[ "$(basename "$f")" == "31337.json" ]] && continue
    FILES+=("$f")
  done
fi
((${#FILES[@]})) || { echo "FAIL no public deployment record found under $DEPLOYMENTS_DIR/" >&2; exit 1; }

# preset_of <file> -> preset name, or empty
preset_of() {
  local chain
  chain="$(jq -r '.chainId // empty | tostring' "$1" 2>/dev/null || true)"
  [[ -n "$chain" ]] || return 1
  script/deploy.sh --list-presets | awk -v c="$chain" '$2 == c {print $1}'
}

if ((OFFLINE)); then
  for f in "${FILES[@]}"; do
    [[ -f "$f" ]] || { bad "$f: no such record"; continue; }
    jq -e '.chainId | type == "number"' "$f" >/dev/null 2>&1 || { bad "$f: no numeric chainId"; continue; }
    [[ "$(basename "$f" .json)" == "$(jq -r .chainId "$f")" ]] || { bad "$f: chainId does not match the file name"; continue; }
    p="$(preset_of "$f")" || true
    [[ -n "$p" ]] || { bad "$f: chain $(jq -r .chainId "$f") is not a deploy.sh preset"; continue; }
    echo "== $f ($p, offline)"
    lint_record "$f" "$p"
  done
  if ((FAILS)); then echo "---- $FAILS check(s) FAILED" >&2; exit 1; fi
  echo "---- all deployment records are complete and well-formed (offline)"
  exit 0
fi

# Build artifacts: v1 with its pinned profile, everything else with the default profile.
INIT_V1="$(FOUNDRY_PROFILE=v1 forge inspect src/VaultRegistry.sol:VaultRegistry bytecode)"
INIT_V2="$(forge inspect src/VaultRegistryV2.sol:VaultRegistryV2 bytecode)"
INIT_FACTORY="$(forge inspect src/CryoShieldSmartWalletFactory.sol:CryoShieldSmartWalletFactory bytecode)"

# Throwaway anvil producing the expected runtime code at the same CREATE2 addresses, on a free port, verified alive.
ANVIL_PORT="${CHECK_ANVIL_PORT:-$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')}"
ANVIL_RPC="http://127.0.0.1:$ANVIL_PORT"
anvil --port "$ANVIL_PORT" --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do cast chain-id --rpc-url "$ANVIL_RPC" >/dev/null 2>&1 && break; sleep 0.1; done
kill -0 "$ANVIL_PID" 2>/dev/null && [[ "$(cast chain-id --rpc-url "$ANVIL_RPC" 2>/dev/null)" == 31337 ]] ||
  { echo "FAIL could not start a local anvil on port $ANVIL_PORT" >&2; exit 1; }
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
  jq -e '.chainId | type == "number"' "$file" >/dev/null 2>&1 || { bad "$file: no numeric chainId"; return; }
  chain="$(jq -r .chainId "$file")"
  [[ "$(basename "$file" .json)" == "$chain" ]] || { bad "$file: chainId $chain does not match the file name"; return; }
  read -r preset _ rpc_env _ < <(script/deploy.sh --list-presets | awk -v c="$chain" '$2 == c {print $1, $2, $3, $4}') || true
  [[ -n "${preset:-}" ]] || { bad "$file: chain $chain is not a deploy.sh preset"; return; }
  rpc="${!rpc_env:-$(default_rpc "$preset")}"
  [[ -n "$rpc" ]] || { bad "$file: no RPC for $preset (set $rpc_env)"; return; }
  echo "== $file ($preset, $rpc)"
  lint_record "$file" "$preset"
  got="$(cast chain-id --rpc-url "$rpc" 2>/dev/null || true)"
  [[ "$got" == "$chain" ]] || { bad "$preset: RPC chain id '$got' != $chain"; return; }

  v1="$(jq -r '.address // empty' "$file")"
  if [[ -n "$v1" ]]; then
    check_deploy "v1 VaultRegistry" "$rpc" "$v1" "$(jq -r .deployBlock "$file")" "$(jq -r .txHash "$file")" "$INIT_V1"
    [[ "$(jq -r .abiHash "$file")" == "$(abi_hash abi/VaultRegistry.json)" ]] && ok "v1: abiHash" || bad "v1: abiHash != abi/VaultRegistry.json"
  fi

  v2="$(jq -r '.contracts.vaultRegistryV2.address // empty' "$file")"
  if [[ -n "$v2" ]]; then
    check_deploy "VaultRegistryV2" "$rpc" "$v2" "$(jq -r .contracts.vaultRegistryV2.deployBlock "$file")" \
      "$(jq -r .contracts.vaultRegistryV2.txHash "$file")" "$INIT_V2"
    [[ "$(jq -r .contracts.vaultRegistryV2.abiHash "$file")" == "$(abi_hash abi/VaultRegistryV2.json)" ]] && ok "v2: abiHash" || bad "v2: abiHash != abi/VaultRegistryV2.json"
  fi

  # Fail-closed: this checker has no build to compare a v3+ registry with. Before recording one, add its init code
  # (from contracts/src) and a check_deploy call here.
  while IFS= read -r v; do
    [[ -n "$v" ]] && bad "registry $v (contracts.vaultRegistries.$v): no build to verify it against; extend check-deployments.sh first"
  done < <(jq -r '.contracts.vaultRegistries // {} | keys[]' "$file")

  while IFS= read -r rpId; do
    [[ -n "$rpId" ]] || continue
    w() { jq -r --arg r "$rpId" ".contracts.wallets[\$r].$1" "$file"; } # RP ID passed as data, never as filter text
    f="$(w factory)"
    i="$(w implementation)"
    h="$(w rpIdHash)"
    [[ "$h" == "0x$(printf '%s' "$rpId" | shasum -a 256 | cut -d' ' -f1)" ]] && ok "wallet $rpId: rpIdHash == sha256(rpId)" || bad "wallet $rpId: rpIdHash != sha256(rpId)"
    check_deploy "wallet $rpId factory" "$rpc" "$f" "$(w deployBlock)" "$(w txHash)" \
      "${INIT_FACTORY}$(cast abi-encode 'f(bytes32)' "$h" | cut -c3-)"
    [[ "$(lc "$(cast call "$f" 'implementation()(address)' --rpc-url "$rpc")")" == "$(lc "$i")" ]] && ok "wallet $rpId: factory.implementation() == $i" || bad "wallet $rpId: factory.implementation() != recorded implementation"
    [[ "$(cast call "$f" 'RP_ID_HASH()(bytes32)' --rpc-url "$rpc")" == "$h" ]] && ok "wallet $rpId: factory RP_ID_HASH" || bad "wallet $rpId: factory RP_ID_HASH != rpIdHash"
    [[ "$(cast call "$i" 'RP_ID_HASH()(bytes32)' --rpc-url "$rpc")" == "$h" ]] && ok "wallet $rpId: implementation RP_ID_HASH" || bad "wallet $rpId: implementation RP_ID_HASH != rpIdHash"
    # The implementation is created inside the factory's constructor: compare it with the anvil copy too.
    local icode
    icode="$(cast code "$i" --rpc-url "$rpc")"
    [[ "$icode" != "0x" && "$(cast keccak "$icode")" == "$(cast keccak "$(cast code "$i" --rpc-url "$ANVIL_RPC")")" ]] && ok "wallet $rpId: implementation runtime code == expected" || bad "wallet $rpId: implementation has no code or its runtime code differs"
    [[ "$(w abiHash)" == "$(abi_hash abi/CryoShieldSmartWallet.json)" ]] && ok "wallet $rpId: abiHash" || bad "wallet $rpId: abiHash != abi/CryoShieldSmartWallet.json"
    [[ "$(w factoryAbiHash)" == "$(abi_hash abi/CryoShieldSmartWalletFactory.json)" ]] && ok "wallet $rpId: factoryAbiHash" || bad "wallet $rpId: factoryAbiHash != abi/CryoShieldSmartWalletFactory.json"
  done < <(jq -r '.contracts.wallets // {} | keys[]' "$file")
}

for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { bad "$f: no such record"; continue; }
  check_record "$f"
done

if ((FAILS)); then
  echo "---- $FAILS check(s) FAILED" >&2
  exit 1
fi
echo "---- all deployment records match the chain"
