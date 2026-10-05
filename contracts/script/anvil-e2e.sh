#!/usr/bin/env bash
# Local end-to-end check against a throwaway anvil node (no keys, nothing leaves the machine):
#   1. deploy via script/deploy.sh (CREATE2) and check the address equals the independently computed prediction (8.1)
#   2. check deployments/31337.json matches the chain: code at address, tx receipt block and status (8.3),
#      and that re-running is a verified no-op while a missing record fails loudly
#   3. store a 1024-byte 0xA5 vault, add a junk vault under the same locator from another account,
#      then recover using ONLY the locator via `cast call` and require the exact blob back (5.3)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${ANVIL_PORT:-8546}"
export RPC_URL="http://127.0.0.1:$PORT"
anvil --port "$PORT" --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 && break; sleep 0.1; done

fail() { echo "FAIL: $*" >&2; exit 1; }

# --- 1. deterministic deploy -------------------------------------------------
script/deploy.sh anvil >/dev/null
RECORD=deployments/31337.json
ADDR="$(jq -r .address "$RECORD")"

CREATE2_DEPLOYER=0x4e59b44847b379578588920cA78FbF26c0B4956C
SALT="$(cast keccak "cryoshield.vault-registry.v1")"
INIT_HASH="$(cast keccak "$(FOUNDRY_PROFILE=v1 forge inspect src/VaultRegistry.sol:VaultRegistry bytecode)")"
# CREATE2: address = last 20 bytes of keccak256(0xff ++ deployer ++ salt ++ keccak256(initCode))
PREIMAGE="0xff${CREATE2_DEPLOYER#0x}${SALT#0x}${INIT_HASH#0x}"
PREDICTED="0x$(cast keccak "$PREIMAGE" | tail -c 41)"
[[ "$(cast to-check-sum-address "$PREDICTED")" == "$ADDR" ]] || fail "deployed $ADDR != predicted $PREDICTED"
echo "ok   deploy address matches CREATE2 prediction: $ADDR"

# --- 2. deployment record matches chain --------------------------------------
[[ "$(cast code "$ADDR" --rpc-url "$RPC_URL")" != "0x" ]] || fail "no code at $ADDR"
TX="$(jq -r .txHash "$RECORD")"
[[ "$(cast receipt "$TX" status --rpc-url "$RPC_URL")" == 1* ]] || fail "deploy tx $TX not successful"
[[ "$(cast receipt "$TX" blockNumber --rpc-url "$RPC_URL")" == "$(jq -r .deployBlock "$RECORD")" ]] || fail "deployBlock mismatch"
[[ "$(jq -r .abiHash "$RECORD")" == "$(cast keccak "0x$(xxd -p abi/VaultRegistry.json | tr -d '\n')")" ]] || fail "abiHash mismatch"
echo "ok   deployments/31337.json matches chain (block $(jq -r .deployBlock "$RECORD"), tx $TX)"

# --- 2b. idempotency: re-run is explicit, missing record fails loudly ------------
RERUN="$(script/deploy.sh anvil 2>&1)"
grep -q "v1: present at $ADDR (bytecode verified, recorded)" <<<"$RERUN" || fail "re-run did not report existing v1"
grep -q "vaultRegistryV2 already deployed" <<<"$RERUN" || fail "re-run did not report existing v2"
mv "$RECORD" "$RECORD.bak"
if script/deploy.sh anvil >/dev/null 2>&1; then mv "$RECORD.bak" "$RECORD"; fail "missing record did not fail"; fi
mv "$RECORD.bak" "$RECORD"
echo "ok   re-deploy is a verified no-op; missing record fails loudly"

# --- 3. write, then recover with only a locator -----------------------------
OWNER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 # anvil account #1 (unlocked; no key needed)
JUNK=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  # anvil account #2
BLOB="0x$(printf 'a5%.0s' $(seq 1 1024))"
VAULT_ID="$(cast keccak "e2e-vault")"
LOC_A="$(cast keccak "e2e-locator-a")"
LOC_B="$(cast keccak "e2e-locator-b")"

cast send --unlocked --from "$OWNER" --rpc-url "$RPC_URL" "$ADDR" \
  "createVault(bytes32,bytes,bytes32[])" "$VAULT_ID" "$BLOB" "[$LOC_A,$LOC_B]" >/dev/null
cast send --unlocked --from "$JUNK" --rpc-url "$RPC_URL" "$ADDR" \
  "createVault(bytes32,bytes,bytes32[])" "$(cast keccak junk)" 0xdead "[$LOC_A,$(cast keccak junk-loc)]" >/dev/null

# Recovery: the reader knows nothing but LOC_A and the registry address.
CANDIDATES="$(cast call "$ADDR" "resolveLocator(bytes32)(bytes32[])" "$LOC_A" --rpc-url "$RPC_URL" | tr -d '[] ' | tr ',' ' ')"
FOUND=""
for id in $CANDIDATES; do
  GOT="$(cast call "$ADDR" "getVault(bytes32)(address,bytes,uint32)" "$id" --rpc-url "$RPC_URL" | sed -n 2p)"
  # Stand-in for "the candidate that decrypts": the client keeps the blob it can open.
  [[ "$GOT" == "$BLOB" ]] && FOUND="$id"
done
[[ "$(echo "$CANDIDATES" | wc -w | tr -d ' ')" == "2" ]] || fail "expected 2 candidates, got: $CANDIDATES"
[[ "$FOUND" == "$VAULT_ID" ]] || fail "exact 1024-byte blob not recovered via locator"
echo "ok   recovered exact 1024-byte 0xA5 blob via cast call using only the locator ($(echo "$CANDIDATES" | wc -w | tr -d ' ') candidates)"

# --- 4. v2 + wallet pairs (harden-gas-sponsorship 4.7) -----------------------
REG="$(jq -r .contracts.vaultRegistryV2.address "$RECORD")"
[[ "$REG" == "$(script/deploy.sh --predict-v2 localhost | awk '$1 == "registry" {print $2}')" ]] || fail "v2 address != prediction"
[[ "$(cast code "$REG" --rpc-url "$RPC_URL")" != "0x" ]] || fail "no code at v2 $REG"
TX2="$(jq -r .contracts.vaultRegistryV2.txHash "$RECORD")"
[[ "$(cast receipt "$TX2" blockNumber --rpc-url "$RPC_URL")" == "$(jq -r .contracts.vaultRegistryV2.deployBlock "$RECORD")" ]] || fail "v2 deployBlock mismatch"
[[ "$(jq -r .contracts.vaultRegistryV2.abiHash "$RECORD")" == "$(cast keccak "0x$(xxd -p abi/VaultRegistryV2.json | tr -d '\n')")" ]] || fail "v2 abiHash mismatch"
for RPID in localhost cryoshield.app; do
  F="$(jq -r --arg r "$RPID" '.contracts.wallets[$r].factory' "$RECORD")"
  I="$(jq -r --arg r "$RPID" '.contracts.wallets[$r].implementation' "$RECORD")"
  H="$(jq -r --arg r "$RPID" '.contracts.wallets[$r].rpIdHash' "$RECORD")"
  [[ "$H" == "0x$(printf '%s' "$RPID" | shasum -a 256 | cut -d' ' -f1)" ]] || fail "$RPID rpIdHash != sha256(rpId)"
  [[ "$(cast call "$F" 'implementation()(address)' --rpc-url "$RPC_URL")" == "$I" ]] || fail "$RPID factory.implementation()"
  [[ "$(cast call "$I" 'RP_ID_HASH()(bytes32)' --rpc-url "$RPC_URL")" == "$H" ]] || fail "$RPID implementation RP_ID_HASH"
done
echo "ok   v2 + wallet pairs (localhost, cryoshield.app) recorded and match the chain"

SALT2="$(cast keccak "e2e-salt")"
cast send --unlocked --from "$OWNER" --rpc-url "$RPC_URL" "$REG" \
  "createVault(bytes32,bytes,bytes32[])" "$SALT2" "$BLOB" "[$LOC_A,$LOC_B]" >/dev/null
V2ID="$(cast call "$REG" "vaultIdFor(address,bytes32)(bytes32)" "$OWNER" "$SALT2" --rpc-url "$RPC_URL")"
[[ "$(cast call "$REG" "locatorLength(bytes32)(uint256)" "$LOC_A" --rpc-url "$RPC_URL")" == "1" ]] || fail "v2 locatorLength"
PAGE="$(cast call "$REG" "resolveLocator(bytes32,uint256,uint256)(bytes32[])" "$LOC_A" 0 256 --rpc-url "$RPC_URL" | tr -d '[] ')"
[[ "$PAGE" == "$V2ID" ]] || fail "v2 page != derived vaultId"
[[ "$(cast call "$REG" "getVault(bytes32)(address,bytes,uint32)" "$V2ID" --rpc-url "$RPC_URL" | sed -n 2p)" == "$BLOB" ]] || fail "v2 blob"
echo "ok   v2: derived vaultId, paginated locator read and exact blob via cast call"
echo "PASS anvil-e2e"
