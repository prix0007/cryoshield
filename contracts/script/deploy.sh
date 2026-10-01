#!/usr/bin/env bash
# Deploy VaultRegistry through the canonical CREATE2 deployer and write deployments/<chainId>.json
# with {chainId, address, deployBlock, txHash, abiHash}.
#
# Usage:
#   script/deploy.sh anvil                # local node (default RPC http://127.0.0.1:8545), unlocked sender, no keys
#   script/deploy.sh arbitrum_sepolia     # simulation only, unless BROADCAST=1
#
# Environment (public networks; never commit these):
#   ARBITRUM_SEPOLIA_RPC_URL   RPC endpoint
#   DEPLOYER_ACCOUNT           name of a Foundry keystore (`cast wallet import <name> --interactive`); REQUIRED.
#                              Raw private keys are never accepted for public networks (they would appear in argv).
#   ARBISCAN_API_KEY           explorer verification key (required with BROADCAST=1; passed via env, not argv)
#   BROADCAST=1                actually send the transaction
# Anvil overrides: RPC_URL, ANVIL_SENDER (default: anvil account #0, sent via --unlocked; no key involved).
#
# Idempotency: if the CREATE2 address already has code, the on-chain runtime bytecode must match this build and
# deployments/<chainId>.json must already exist for that address; otherwise the script fails loudly.
set -euo pipefail

NETWORK="${1:-anvil}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

"$ROOT/script/export-abi.sh" >/dev/null

args=()
case "$NETWORK" in
  anvil)
    RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
    EXPECTED_CHAIN_ID=31337
    args+=(--unlocked --sender "${ANVIL_SENDER:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}" --broadcast)
    DO_BROADCAST=1
    ;;
  arbitrum_sepolia)
    RPC_URL="${ARBITRUM_SEPOLIA_RPC_URL:?set ARBITRUM_SEPOLIA_RPC_URL}"
    EXPECTED_CHAIN_ID=421614
    if [[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
      echo "DEPLOYER_PRIVATE_KEY is not accepted for public networks; import it into a Foundry keystore and set DEPLOYER_ACCOUNT" >&2
      exit 1
    fi
    args+=(--account "${DEPLOYER_ACCOUNT:?set DEPLOYER_ACCOUNT to a Foundry keystore name}")
    DO_BROADCAST="${BROADCAST:-0}"
    if [[ "$DO_BROADCAST" == "1" ]]; then
      # forge reads ETHERSCAN_API_KEY from the environment, keeping the key out of argv.
      export ETHERSCAN_API_KEY="${ARBISCAN_API_KEY:?set ARBISCAN_API_KEY}"
      args+=(--broadcast --verify)
    else
      echo "simulation only (set BROADCAST=1 to send)" >&2
    fi
    ;;
  *)
    echo "unknown network: $NETWORK (expected anvil | arbitrum_sepolia)" >&2
    exit 1
    ;;
esac

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
if [[ "$CHAIN_ID" != "$EXPECTED_CHAIN_ID" ]]; then
  echo "RPC chain id $CHAIN_ID does not match $NETWORK ($EXPECTED_CHAIN_ID)" >&2
  exit 1
fi

RECORD="deployments/$CHAIN_ID.json"
CREATE2_DEPLOYER=0x4e59b44847b379578588920cA78FbF26c0B4956C
SALT="$(cast keccak "cryoshield.vault-registry.v1")"
INIT_HASH="$(cast keccak "$(forge inspect VaultRegistry bytecode)")"
PREDICTED="$(cast to-check-sum-address "0x$(cast keccak "0xff${CREATE2_DEPLOYER#0x}${SALT#0x}${INIT_HASH#0x}" | tail -c 41)")"

# Already deployed at the deterministic address: verify, never exit 0 silently.
ONCHAIN_CODE="$(cast code "$PREDICTED" --rpc-url "$RPC_URL")"
if [[ "$ONCHAIN_CODE" != "0x" ]]; then
  if [[ "$(cast keccak "$ONCHAIN_CODE")" != "$(cast keccak "$(forge inspect VaultRegistry deployedBytecode)")" ]]; then
    echo "ERROR: code at $PREDICTED does not match this build's runtime bytecode" >&2
    exit 1
  fi
  if [[ ! -f "$RECORD" ]]; then
    echo "ERROR: VaultRegistry already deployed at $PREDICTED (bytecode verified) but $RECORD is missing." >&2
    echo "       Recreate it from the explorer's creation tx: {chainId, address, deployBlock, txHash, abiHash}." >&2
    exit 1
  fi
  if [[ "$(jq -r .address "$RECORD")" != "$PREDICTED" ]]; then
    echo "ERROR: $RECORD address $(jq -r .address "$RECORD") != deployed $PREDICTED" >&2
    exit 1
  fi
  echo "already deployed at $PREDICTED (bytecode verified); $RECORD present, nothing to do"
  exit 0
fi

forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" "${args[@]}"

[[ "$DO_BROADCAST" == "1" ]] || exit 0

RUN="broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"
if [[ ! -f "$RUN" ]] || [[ "$(jq '.transactions | length' "$RUN")" == "0" ]]; then
  echo "ERROR: broadcast produced no deployment transaction ($RUN)" >&2
  exit 1
fi

ADDRESS="$(jq -r '.transactions[0].contractAddress' "$RUN")"
TX_HASH="$(jq -r '.receipts[0].transactionHash' "$RUN")"
DEPLOY_BLOCK="$(cast to-dec "$(jq -r '.receipts[0].blockNumber' "$RUN")")"
ABI_HASH="$(cast keccak "0x$(xxd -p abi/VaultRegistry.json | tr -d '\n')")"

if [[ "$(cast to-check-sum-address "$ADDRESS")" != "$PREDICTED" ]] || [[ "$(cast code "$ADDRESS" --rpc-url "$RPC_URL")" == "0x" ]]; then
  echo "ERROR: deployment at $ADDRESS missing or not at predicted $PREDICTED" >&2
  exit 1
fi

mkdir -p deployments
jq -n \
  --argjson chainId "$CHAIN_ID" \
  --arg address "$(cast to-check-sum-address "$ADDRESS")" \
  --argjson deployBlock "$DEPLOY_BLOCK" \
  --arg txHash "$TX_HASH" \
  --arg abiHash "$ABI_HASH" \
  '{chainId: $chainId, address: $address, deployBlock: $deployBlock, txHash: $txHash, abiHash: $abiHash}' \
  >"$RECORD"
echo "wrote $RECORD"
cat "$RECORD"
