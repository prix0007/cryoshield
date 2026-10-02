#!/usr/bin/env bash
# Deploy VaultRegistry through the canonical CREATE2 deployer and write deployments/<chainId>.json
# with {chainId, address, deployBlock, txHash, abiHash}.
#
# Usage:
#   script/deploy.sh anvil              # local node (default RPC http://127.0.0.1:8545), unlocked sender, no keys
#   script/deploy.sh op_sepolia         # testnet (chain 11155420); simulation only unless BROADCAST=1
#   script/deploy.sh <preset>           # any preset from --list-presets
#   script/deploy.sh --list-presets     # print "<name> <chainId> <rpcEnvVar>" per preset
#   script/deploy.sh --predict          # print the CREATE2 address (no RPC)
#
# Environment for public networks (never commit these; see .env.example):
#   <PRESET>_RPC_URL     RPC endpoint, e.g. OP_SEPOLIA_RPC_URL (see --list-presets)
#   DEPLOYER_ACCOUNT     name of a Foundry keystore (`cast wallet import <name> --interactive`). Required to broadcast.
#                        Raw private keys are never accepted for public networks (they would appear in argv).
#   DEPLOYER_ADDRESS     simulation only: plain sender address, used when no keystore is given (no key involved)
#   BROADCAST=1          actually send the transaction (otherwise simulate)
#   DEPLOY_PLAN_ONLY=1   print the resolved preset and forge args, then exit before any RPC call (used by tests)
# Anvil overrides: RPC_URL, ANVIL_SENDER (default: anvil account #0, sent via --unlocked; no key involved).
#
# Order of checks: preset -> credentials -> RPC chain ID (before any simulation or send) -> idempotency -> forge.
# Idempotency: if the CREATE2 address already has code, the on-chain runtime bytecode must match this build and
# deployments/<chainId>.json must already exist for that address; otherwise the script fails loudly.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Preset table: name, chain ID, RPC env var, Blockscout verifier API URL (keyless; "-" = no explorer).
# OP URLs are the canonical Blockscout hosts; optimism-*.blockscout.com 301-redirects there, which breaks forge's POST.
# Parity with config/chain-presets.json is enforced by script/test-deploy-args.sh.
# Adding a chain is a one-line data change here plus foundry.toml and config/chain-presets.json.
PRESETS="
anvil             31337     RPC_URL                   -
op_sepolia        11155420  OP_SEPOLIA_RPC_URL        https://testnet-explorer.optimism.io/api/
op_mainnet        10        OP_MAINNET_RPC_URL        https://explorer.optimism.io/api/
arbitrum_sepolia  421614    ARBITRUM_SEPOLIA_RPC_URL  https://arbitrum-sepolia.blockscout.com/api/
arbitrum_one      42161     ARBITRUM_ONE_RPC_URL      https://arbitrum.blockscout.com/api/
"
CREATE2_DEPLOYER=0x4e59b44847b379578588920cA78FbF26c0B4956C
# Verification goes to a third-party explorer with no key: strip any inherited explorer keys so they are never forwarded.
VERIFY_ENV=(env -u ETHERSCAN_API_KEY -u VERIFIER_API_KEY)
SALT_LABEL="cryoshield.vault-registry.v1"

die() { echo "ERROR: $*" >&2; exit 1; }
preset_names() { awk 'NF {print $1}' <<<"$PRESETS" | paste -sd' ' -; }

predicted_address() {
  local salt init_hash
  salt="$(cast keccak "$SALT_LABEL")"
  init_hash="$(cast keccak "$(forge inspect VaultRegistry bytecode)")"
  # CREATE2: last 20 bytes of keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))
  cast to-check-sum-address "0x$(cast keccak "0xff${CREATE2_DEPLOYER#0x}${salt#0x}${init_hash#0x}" | tail -c 41)"
}

case "${1:-}" in
  --list-presets) awk 'NF {print $1, $2, $3, $4}' <<<"$PRESETS"; exit 0 ;;
  --predict) predicted_address; exit 0 ;;
esac

NETWORK="${1:-anvil}"
read -r _ EXPECTED_CHAIN_ID RPC_ENV VERIFIER_URL < <(awk -v n="$NETWORK" '$1 == n {print $1, $2, $3, $4}' <<<"$PRESETS") || true
[[ -n "${EXPECTED_CHAIN_ID:-}" ]] || die "unknown network: $NETWORK (valid: $(preset_names))"

args=()
verify_args=()
if [[ "$NETWORK" == "anvil" ]]; then
  RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
  args+=(--unlocked --sender "${ANVIL_SENDER:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}" --broadcast)
  DO_BROADCAST=1
else
  [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]] ||
    die "DEPLOYER_PRIVATE_KEY is not accepted for public networks; import it into a Foundry keystore and set DEPLOYER_ACCOUNT"
  RPC_URL="${!RPC_ENV:-}"
  [[ -n "$RPC_URL" ]] || die "set $RPC_ENV (RPC endpoint for $NETWORK, chain $EXPECTED_CHAIN_ID)"
  DO_BROADCAST="${BROADCAST:-0}"
  if [[ "$DO_BROADCAST" == "1" ]]; then
    [[ -n "${DEPLOYER_ACCOUNT:-}" ]] || die "BROADCAST=1 requires DEPLOYER_ACCOUNT (a Foundry keystore name)"
    args+=(--account "$DEPLOYER_ACCOUNT" --broadcast)
    # Keyless Blockscout verification. It runs as a separate step after the deployment record is written, so a
    # verifier failure can never leave a live deployment without a record. Etherscan V2 needs a newer forge (post-MVP).
    if [[ "$VERIFIER_URL" != "-" ]]; then
      verify_args=(--verifier blockscout --verifier-url "$VERIFIER_URL")
    fi
  elif [[ -n "${DEPLOYER_ACCOUNT:-}" ]]; then
    args+=(--account "$DEPLOYER_ACCOUNT")
  elif [[ -n "${DEPLOYER_ADDRESS:-}" ]]; then
    args+=(--sender "$DEPLOYER_ADDRESS")
  else
    die "set DEPLOYER_ACCOUNT (keystore) or, for simulation only, DEPLOYER_ADDRESS"
  fi
  [[ "$DO_BROADCAST" == "1" ]] || echo "simulation only (set BROADCAST=1 to send)" >&2
fi

if [[ "${DEPLOY_PLAN_ONLY:-0}" == "1" ]]; then
  echo "network=$NETWORK chainId=$EXPECTED_CHAIN_ID rpcEnv=$RPC_ENV broadcast=$DO_BROADCAST"
  echo "forge-args: ${args[*]}"
  echo "verify-args: ${verify_args[*]:-}"
  echo "verify-env: ${VERIFY_ENV[*]}"
  exit 0
fi

# Chain-ID check comes before any simulation or transaction.
CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")" || die "cannot reach $RPC_ENV"
[[ "$CHAIN_ID" == "$EXPECTED_CHAIN_ID" ]] ||
  die "RPC chain id $CHAIN_ID does not match $NETWORK ($EXPECTED_CHAIN_ID)"

"$ROOT/script/export-abi.sh" >/dev/null

RECORD="deployments/$CHAIN_ID.json"
PREDICTED="$(predicted_address)"
echo "network=$NETWORK chainId=$CHAIN_ID predicted=$PREDICTED"

# Already deployed at the deterministic address: verify, never exit 0 silently.
ONCHAIN_CODE="$(cast code "$PREDICTED" --rpc-url "$RPC_URL")"
if [[ "$ONCHAIN_CODE" != "0x" ]]; then
  [[ "$(cast keccak "$ONCHAIN_CODE")" == "$(cast keccak "$(forge inspect VaultRegistry deployedBytecode)")" ]] ||
    die "code at $PREDICTED does not match this build's runtime bytecode"
  if [[ ! -f "$RECORD" ]]; then
    echo "ERROR: VaultRegistry already deployed at $PREDICTED (bytecode verified) but $RECORD is missing." >&2
    echo "       Recreate it from the explorer's creation tx: {chainId, address, deployBlock, txHash, abiHash}." >&2
    exit 1
  fi
  [[ "$(jq -r .address "$RECORD")" == "$PREDICTED" ]] ||
    die "$RECORD address $(jq -r .address "$RECORD") != deployed $PREDICTED"
  echo "already deployed at $PREDICTED (bytecode verified); $RECORD present, nothing to do"
  exit 0
fi

forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" "${args[@]}"

[[ "$DO_BROADCAST" == "1" ]] || exit 0

RUN="broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"
if [[ ! -f "$RUN" ]] || [[ "$(jq '.transactions | length' "$RUN")" == "0" ]]; then
  die "broadcast produced no deployment transaction ($RUN)"
fi

ADDRESS="$(jq -r '.transactions[0].contractAddress' "$RUN")"
TX_HASH="$(jq -r '.receipts[0].transactionHash' "$RUN")"
DEPLOY_BLOCK="$(cast to-dec "$(jq -r '.receipts[0].blockNumber' "$RUN")")"
ABI_HASH="$(cast keccak "0x$(xxd -p abi/VaultRegistry.json | tr -d '\n')")"

if [[ "$(cast to-check-sum-address "$ADDRESS")" != "$PREDICTED" ]] || [[ "$(cast code "$ADDRESS" --rpc-url "$RPC_URL")" == "0x" ]]; then
  die "deployment at $ADDRESS missing or not at predicted $PREDICTED"
fi

mkdir -p deployments
jq -n \
  --argjson chainId "$CHAIN_ID" \
  --arg address "$PREDICTED" \
  --argjson deployBlock "$DEPLOY_BLOCK" \
  --arg txHash "$TX_HASH" \
  --arg abiHash "$ABI_HASH" \
  '{chainId: $chainId, address: $address, deployBlock: $deployBlock, txHash: $txHash, abiHash: $abiHash}' \
  >"$RECORD"
echo "wrote $RECORD"
cat "$RECORD"

if ((${#verify_args[@]})); then
  VERIFY_CMD=("${VERIFY_ENV[@]}" forge verify-contract "$PREDICTED" src/VaultRegistry.sol:VaultRegistry --chain "$CHAIN_ID"
    "${verify_args[@]}" --watch)
  echo "verifying: ${VERIFY_CMD[*]}"
  if ! "${VERIFY_CMD[@]}"; then
    echo "ERROR: deployed and recorded, but explorer verification FAILED. Retry:" >&2
    echo "       ${VERIFY_CMD[*]}" >&2
    exit 2
  fi
fi
