#!/usr/bin/env bash
# Deploy CryoShield contracts through the canonical CREATE2 deployer and write deployments/<chainId>.json
# (format: deployments/README.md).
#
#   VaultRegistry v1   legacy. Deployed on anvil only; kept (verified, never redeployed) on OP Sepolia;
#                      NEVER deployed anywhere else, in particular not on OP Mainnet.
#   VaultRegistryV2    every preset            -> contracts.vaultRegistryV2
#   wallet pair/RP ID  CryoShieldSmartWalletFactory (+ the implementation its constructor creates), one per RP ID
#                                              -> contracts.wallets.<rpId>
#   VaultRegistry v3+  not deployed by this script yet. Its record key is contracts.vaultRegistries.v<N>
#                      (deployments/README.md); existing entries there are kept when the record is merged.
#
# Usage:
#   script/deploy.sh anvil              # local node (default RPC http://127.0.0.1:8545), unlocked sender, no keys
#   script/deploy.sh op_sepolia         # testnet (chain 11155420); simulation only unless BROADCAST=1
#   script/deploy.sh <preset>           # any preset from --list-presets
#   script/deploy.sh --list-presets     # print "<name> <chainId> <rpcEnvVar> <verifierUrl>" per preset
#   script/deploy.sh --predict          # print the v1 CREATE2 address (no RPC)
#   script/deploy.sh --predict-v2 [rpIds]  # print v2 + wallet addresses (no RPC); rpIds comma/space separated
#
# Environment for public networks (never commit these; see .env.example):
#   <PRESET>_RPC_URL     RPC endpoint, e.g. OP_SEPOLIA_RPC_URL (see --list-presets)
#   DEPLOYER_ACCOUNT     name of a Foundry keystore (`cast wallet import <name> --interactive`). Required to broadcast.
#                        Raw private keys are never accepted for public networks (they would appear in argv).
#   DEPLOYER_ADDRESS     simulation only: plain sender address, used when no keystore is given (no key involved)
#   BROADCAST=1          actually send the transactions (otherwise simulate)
#   RP_IDS               WebAuthn RP IDs to deploy wallet pairs for (comma or space separated). Defaults:
#                        anvil "localhost cryoshield.app"; op_sepolia "cryoshield.app cryoshield-web-dev.fly.dev";
#                        op_mainnet "cryoshield.app"; other presets: required.
#   CRYOSHIELD_MAINNET_GATE=approved:<chainId>   required to BROADCAST to any mainnet preset (kind != local/testnet;
#                        e.g. approved:10 for op_mainnet, approved:42161 for arbitrum_one). Task 8.1. Fail-closed.
#                        An accident guard against broadcasting to a mainnet by mistake, NOT access control.
#   DEPLOY_PLAN_ONLY=1   print the resolved preset, RP IDs and forge args, then exit before any RPC call (tests)
# Anvil overrides: RPC_URL, ANVIL_SENDER (default: anvil account #0, sent via --unlocked; no key involved).
#
# Order of checks: preset -> credentials -> RP IDs -> RPC chain ID (before any simulation or send) -> v1 -> v2/wallets.
# Idempotency: a CREATE2 address commits to the full init code, so code already at a predicted address is this build.
# An already-deployed contract must already be in deployments/<chainId>.json; otherwise the script fails loudly.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Preset table: name, chain ID, RPC env var, Blockscout verifier API URL (keyless; "-" = no explorer), kind.
# kind: local | testnet | mainnet. Broadcasting to anything that is not local or testnet (including any preset added
# later without a kind) needs CRYOSHIELD_MAINNET_GATE=approved: the mainnet gate is fail-closed.
# OP URLs are the canonical Blockscout hosts; optimism-*.blockscout.com 301-redirects there, which breaks forge's POST.
# Parity with config/chain-presets.json is enforced by script/test-deploy-args.sh.
# Adding a chain is a one-line data change here plus foundry.toml and config/chain-presets.json.
PRESETS="
anvil             31337     RPC_URL                   -                                             local
op_sepolia        11155420  OP_SEPOLIA_RPC_URL        https://testnet-explorer.optimism.io/api/     testnet
op_mainnet        10        OP_MAINNET_RPC_URL        https://explorer.optimism.io/api/             mainnet
arbitrum_sepolia  421614    ARBITRUM_SEPOLIA_RPC_URL  https://arbitrum-sepolia.blockscout.com/api/  testnet
arbitrum_one      42161     ARBITRUM_ONE_RPC_URL      https://arbitrum.blockscout.com/api/          mainnet
"
CREATE2_DEPLOYER=0x4e59b44847b379578588920cA78FbF26c0B4956C
# Verification goes to a third-party explorer with no key: strip any inherited explorer keys so they are never forwarded.
VERIFY_ENV=(env -u ETHERSCAN_API_KEY -u VERIFIER_API_KEY)
SALT_LABEL="cryoshield.vault-registry.v1"
# VaultRegistry v1 is always built with the `v1` Foundry profile (foundry.toml): its CREATE2 address commits to the exact
# original bytecode, including the metadata hash that the CBSW remappings would otherwise change.

die() { echo "ERROR: $*" >&2; exit 1; }
preset_names() { awk 'NF {print $1}' <<<"$PRESETS" | paste -sd' ' -; }

# v1 policy per preset: deploy | keep | none.
v1_policy() {
  case "$1" in
    anvil) echo deploy ;;
    op_sepolia) echo keep ;;
    *) echo none ;;
  esac
}

default_rp_ids() {
  case "$1" in
    anvil) echo "localhost cryoshield.app" ;;
    op_sepolia) echo "cryoshield.app cryoshield-web-dev.fly.dev" ;;
    op_mainnet) echo "cryoshield.app" ;;
    *) echo "" ;;
  esac
}

# Normalise "a, b c" -> "a,b,c" and validate each RP ID (same rule as the web app's VITE_RP_ID).
rp_ids_csv() {
  local out="" id ids
  read -r -a ids <<<"$(tr ',' ' ' <<<"$1")" # array split: no glob expansion of operator input
  for id in "${ids[@]+"${ids[@]}"}"; do
    [[ "$id" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$ && ${#id} -le 64 ]] ||
      die "invalid RP ID '$id' (bare lowercase host name, no scheme, port or path)"
    out="${out:+$out,}$id"
  done
  [[ -n "$out" ]] || return 1
  echo "$out"
}

predicted_address() {
  local salt init_hash
  salt="$(cast keccak "$SALT_LABEL")"
  init_hash="$(cast keccak "$(FOUNDRY_PROFILE=v1 forge inspect src/VaultRegistry.sol:VaultRegistry bytecode)")"
  # CREATE2: last 20 bytes of keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))
  cast to-check-sum-address "0x$(cast keccak "0xff${CREATE2_DEPLOYER#0x}${salt#0x}${init_hash#0x}" | tail -c 41)"
}

# Prints "registry <addr>" and "wallet <rpId> <factory> <implementation> <rpIdHash>" lines (no RPC).
predict_v2() {
  forge script script/DeployV2.s.sol:DeployV2 --sig 'predict(string)' "$1" 2>/dev/null |
    awk '$1 == "registry" || $1 == "wallet" {$1 = $1; print}'
}

abi_hash() { cast keccak "0x$(xxd -p "$1" | tr -d '\n')"; }

case "${1:-}" in
  --list-presets) awk 'NF {print $1, $2, $3, $4, $5}' <<<"$PRESETS"; exit 0 ;;
  --predict) predicted_address; exit 0 ;;
  --predict-v2)
    csv="$(rp_ids_csv "${2:-localhost}")" || die "no RP IDs given"
    predict_v2 "$csv"
    exit 0
    ;;
esac

NETWORK="${1:-anvil}"
read -r _ EXPECTED_CHAIN_ID RPC_ENV VERIFIER_URL KIND < <(awk -v n="$NETWORK" '$1 == n {print $1, $2, $3, $4, $5}' <<<"$PRESETS") || true
[[ -n "${EXPECTED_CHAIN_ID:-}" ]] || die "unknown network: $NETWORK (valid: $(preset_names))"

# --slow: send one transaction at a time and wait for its receipt, so transactions land in a fixed order and blocks
# (the anvil record is then reproducible byte for byte, and public deploys never race each other).
args=(--slow)
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
    # Fail-closed: only local and testnet presets broadcast without the gate.
    # An accident guard, not access control: anyone holding the keystore can set the variable. It is bound to the
    # chain ID so an approval for one mainnet can never be reused for another.
    if [[ "${KIND:-}" != "testnet" && "${KIND:-}" != "local" && "${CRYOSHIELD_MAINNET_GATE:-}" != "approved:$EXPECTED_CHAIN_ID" ]]; then
      die "$NETWORK (chain $EXPECTED_CHAIN_ID, kind ${KIND:-unset}) broadcast is gated (harden-gas-sponsorship task 8.1): set CRYOSHIELD_MAINNET_GATE=approved:$EXPECTED_CHAIN_ID only after the recorded founder approval"
    fi
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

V1_POLICY="$(v1_policy "$NETWORK")"
RP_IDS_CSV="$(rp_ids_csv "${RP_IDS:-$(default_rp_ids "$NETWORK")}")" ||
  die "set RP_IDS (WebAuthn RP IDs to deploy wallet pairs for) for $NETWORK"

if [[ "${DEPLOY_PLAN_ONLY:-0}" == "1" ]]; then
  echo "network=$NETWORK chainId=$EXPECTED_CHAIN_ID rpcEnv=$RPC_ENV broadcast=$DO_BROADCAST kind=${KIND:-unset}"
  echo "v1=$V1_POLICY"
  echo "rpIds=$RP_IDS_CSV"
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
if [[ -f "$RECORD" ]]; then RECORD_JSON="$(cat "$RECORD")"; else RECORD_JSON='{}'; fi
VERIFY_QUEUE=() # entries: "<address>|<src:Contract>|<constructor-args or ->"

# Pull {hash, block} of the CREATE2 deployment of <address> from a forge broadcast file.
tx_of() {
  local run="$1" addr="$2" hash block
  [[ -f "$run" ]] || return 1
  hash="$(jq -r --arg a "$(tr '[:upper:]' '[:lower:]' <<<"$addr")" \
    '[.transactions[] | select((.contractAddress // "" | ascii_downcase) == $a) | .hash] | first // empty' "$run")"
  [[ -n "$hash" ]] || return 1
  block="$(jq -r --arg h "$hash" '[.receipts[] | select(.transactionHash == $h) | .blockNumber] | first // empty' "$run")"
  [[ -n "$block" ]] || return 1
  echo "$hash $(cast to-dec "$block")"
}

# ---------------------------------------------------------------------------------------------------------------
# VaultRegistry v1
# ---------------------------------------------------------------------------------------------------------------
case "$V1_POLICY" in
  none)
    [[ "$(jq -r '.address // empty' <<<"$RECORD_JSON")" == "" ]] ||
      die "$RECORD has a VaultRegistry v1 entry, but v1 must not exist on $NETWORK"
    echo "v1: not deployed on $NETWORK (by design)"
    ;;
  keep | deploy)
    V1="$(predicted_address)"
    V1_CODE="$(cast code "$V1" --rpc-url "$RPC_URL")"
    if [[ "$V1_CODE" != "0x" ]]; then
      [[ "$(cast keccak "$V1_CODE")" == "$(cast keccak "$(FOUNDRY_PROFILE=v1 forge inspect src/VaultRegistry.sol:VaultRegistry deployedBytecode)")" ]] ||
        die "code at $V1 does not match this build's VaultRegistry v1 runtime bytecode"
      [[ "$(jq -r '.address // empty' <<<"$RECORD_JSON")" == "$V1" ]] ||
        die "VaultRegistry v1 is deployed at $V1 (bytecode verified) but $RECORD does not record it"
      echo "v1: present at $V1 (bytecode verified, recorded)"
    elif [[ "$V1_POLICY" == "keep" ]]; then
      die "VaultRegistry v1 expected at $V1 on $NETWORK but has no code"
    else
      FOUNDRY_PROFILE=v1 forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" "${args[@]}"
      if [[ "$DO_BROADCAST" == "1" ]]; then
        read -r TX BLOCK < <(tx_of "broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json" "$V1") ||
          die "broadcast produced no VaultRegistry v1 deployment"
        RECORD_JSON="$(jq --argjson c "$CHAIN_ID" --arg a "$V1" --argjson b "$BLOCK" --arg t "$TX" \
          --arg h "$(abi_hash abi/VaultRegistry.json)" \
          '. + {chainId: $c, address: $a, deployBlock: $b, txHash: $t, abiHash: $h}' <<<"$RECORD_JSON")"
        VERIFY_QUEUE+=("$V1|src/VaultRegistry.sol:VaultRegistry|-") # anvil only: no explorer, never verified
      fi
    fi
    ;;
esac

# ---------------------------------------------------------------------------------------------------------------
# VaultRegistryV2 + one wallet pair per RP ID
# ---------------------------------------------------------------------------------------------------------------
PRED="$(predict_v2 "$RP_IDS_CSV")"
REG="$(awk '$1 == "registry" {print $2}' <<<"$PRED")"
[[ -n "$REG" ]] || die "could not predict VaultRegistryV2 address"
echo "network=$NETWORK chainId=$CHAIN_ID rpIds=$RP_IDS_CSV"
echo "$PRED"

# Already-deployed contracts must already be recorded (never silently adopt an unrecorded deployment).
if [[ "$(cast code "$REG" --rpc-url "$RPC_URL")" != "0x" ]]; then
  [[ "$(jq -r '.contracts.vaultRegistryV2.address // empty' <<<"$RECORD_JSON")" == "$REG" ]] ||
    die "VaultRegistryV2 already deployed at $REG but $RECORD has no matching contracts.vaultRegistryV2"
fi
while read -r _ RPID FACTORY _ _; do
  if [[ "$(cast code "$FACTORY" --rpc-url "$RPC_URL")" != "0x" ]]; then
    [[ "$(jq -r --arg r "$RPID" '.contracts.wallets[$r].factory // empty' <<<"$RECORD_JSON")" == "$FACTORY" ]] ||
      die "wallet factory for $RPID already deployed at $FACTORY but $RECORD has no matching contracts.wallets[\"$RPID\"]"
  fi
done < <(awk '$1 == "wallet"' <<<"$PRED")

RP_IDS="$RP_IDS_CSV" forge script script/DeployV2.s.sol:DeployV2 --rpc-url "$RPC_URL" "${args[@]}"

[[ "$DO_BROADCAST" == "1" ]] || { echo "simulation complete; nothing sent, no record written"; exit 0; }

RUN2="broadcast/DeployV2.s.sol/$CHAIN_ID/run-latest.json"
if read -r TX BLOCK < <(tx_of "$RUN2" "$REG"); then
  [[ "$(cast code "$REG" --rpc-url "$RPC_URL")" != "0x" ]] || die "VaultRegistryV2 missing at $REG after broadcast"
  RECORD_JSON="$(jq --argjson c "$CHAIN_ID" --arg a "$REG" --argjson b "$BLOCK" --arg t "$TX" \
    --arg h "$(abi_hash abi/VaultRegistryV2.json)" \
    '.chainId = $c | .contracts.vaultRegistryV2 = {address: $a, deployBlock: $b, txHash: $t, abiHash: $h}' <<<"$RECORD_JSON")"
  VERIFY_QUEUE+=("$REG|src/VaultRegistryV2.sol:VaultRegistryV2|-")
fi
while read -r _ RPID FACTORY IMPL HASH; do
  if read -r TX BLOCK < <(tx_of "$RUN2" "$FACTORY"); then
    [[ "$(cast code "$FACTORY" --rpc-url "$RPC_URL")" != "0x" ]] || die "factory missing at $FACTORY after broadcast"
    [[ "$(cast call "$FACTORY" 'implementation()(address)' --rpc-url "$RPC_URL")" == "$IMPL" ]] ||
      die "factory $FACTORY implementation() != predicted $IMPL"
    RECORD_JSON="$(jq --argjson c "$CHAIN_ID" --arg r "$RPID" --arg f "$FACTORY" --arg i "$IMPL" --arg rh "$HASH" \
      --argjson b "$BLOCK" --arg t "$TX" --arg h "$(abi_hash abi/CryoShieldSmartWallet.json)" \
      --arg fh "$(abi_hash abi/CryoShieldSmartWalletFactory.json)" \
      '.chainId = $c | .contracts.wallets[$r] = {implementation: $i, factory: $f, rpIdHash: $rh, deployBlock: $b, txHash: $t, abiHash: $h, factoryAbiHash: $fh}' \
      <<<"$RECORD_JSON")"
    ARGS="$(cast abi-encode 'f(bytes32)' "$HASH")"
    VERIFY_QUEUE+=("$FACTORY|src/CryoShieldSmartWalletFactory.sol:CryoShieldSmartWalletFactory|$ARGS")
    VERIFY_QUEUE+=("$IMPL|src/CryoShieldSmartWallet.sol:CryoShieldSmartWallet|$ARGS")
  fi
done < <(awk '$1 == "wallet"' <<<"$PRED")

# Every requested contract must now be recorded.
[[ "$(jq -r '.contracts.vaultRegistryV2.address // empty' <<<"$RECORD_JSON")" == "$REG" ]] ||
  die "VaultRegistryV2 not recorded after broadcast"
IFS=',' read -r -a RPID_LIST <<<"$RP_IDS_CSV"
for RPID in "${RPID_LIST[@]}"; do
  [[ -n "$(jq -r --arg r "$RPID" '.contracts.wallets[$r].factory // empty' <<<"$RECORD_JSON")" ]] ||
    die "wallet pair for $RPID not recorded after broadcast"
done

mkdir -p deployments
jq --sort-keys . <<<"$RECORD_JSON" >"$RECORD"
echo "wrote $RECORD"
cat "$RECORD"

if ((${#verify_args[@]})) && ((${#VERIFY_QUEUE[@]})); then
  FAILED=()
  for item in "${VERIFY_QUEUE[@]}"; do
    IFS='|' read -r ADDR TARGET CARGS <<<"$item"
    VERIFY_CMD=("${VERIFY_ENV[@]}" forge verify-contract "$ADDR" "$TARGET" --chain "$CHAIN_ID" "${verify_args[@]}" --watch)
    [[ "$CARGS" == "-" ]] || VERIFY_CMD+=(--constructor-args "$CARGS")
    echo "verifying: ${VERIFY_CMD[*]}"
    "${VERIFY_CMD[@]}" || FAILED+=("${VERIFY_CMD[*]}")
  done
  if ((${#FAILED[@]})); then
    echo "ERROR: deployed and recorded, but explorer verification FAILED. Retry:" >&2
    printf '       %s\n' "${FAILED[@]}" >&2
    exit 2
  fi
fi
