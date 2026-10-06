#!/usr/bin/env bash
# Tests for script/deploy.sh network presets and argument construction (target-op-sepolia tasks 2.1, 2.6).
# No keys and no public network access: uses DEPLOY_PLAN_ONLY=1 (prints the forge args and exits before any RPC
# call) plus one throwaway anvil node for the chain-ID-mismatch check.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PRESETS_JSON="$ROOT/../config/chain-presets.json"
DEPLOY="$ROOT/script/deploy.sh"
EXPECTED_ADDRESS=0xB43f58cF17e64B603aE5588a1DD17E96a0849e44 # VaultRegistry CREATE2 address; must never drift

PASS=0
FAIL=0
ok() { echo "ok   $*"; PASS=$((PASS + 1)); }
bad() { echo "FAIL $*" >&2; FAIL=$((FAIL + 1)); }
check() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }

# Run deploy.sh with a clean, explicit environment (no inherited secrets).
run() { env -i PATH="$PATH" HOME="$HOME" "$@"; }

plan() { run DEPLOY_PLAN_ONLY=1 "$@"; }

# --- unknown network lists valid names -----------------------------------------------------------
out="$(run "$DEPLOY" nonesuch 2>&1)"; rc=$?
check "unknown network exits non-zero" test "$rc" -ne 0
for n in anvil op_sepolia op_mainnet arbitrum_sepolia arbitrum_one; do
  check "unknown network message lists $n" grep -q -- "$n" <<<"$out"
done

# --- op_sepolia broadcast plan: keyless Blockscout verifier, keystore, no secrets in argv ----------
SECRET=leftover-api-key-value-123
out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=ci-throwaway ETHERSCAN_API_KEY=$SECRET ARBISCAN_API_KEY=$SECRET OP_SEPOLIA_RPC_URL=http://rpc.invalid "$DEPLOY" op_sepolia 2>&1)"; rc=$?
check "op_sepolia broadcast plan succeeds" test "$rc" -eq 0
check "op_sepolia verifier blockscout" grep -q -- "verify-args: --verifier blockscout --verifier-url https://testnet-explorer.optimism.io/api/$" <<<"$out"
check "op_sepolia uses keystore account" grep -q -- "--account ci-throwaway" <<<"$out"
check "op_sepolia broadcasts" grep -q -- "--broadcast" <<<"$out"
check "op_sepolia expected chain id" grep -q "chainId=11155420" <<<"$out"
check "op_sepolia argv has no API key" bash -c '! grep -q -- "$1" <<<"$2"' _ "$SECRET" "$out"
check "op_sepolia uses no etherscan/arbiscan verifier" bash -c '! grep -v "^verify-env: " <<<"$1" | grep -qiE "etherscan|arbiscan"' _ "$out"
check "op_sepolia plan does not contact RPC" bash -c '! grep -qi "error sending request" <<<"$1"' _ "$out"

out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a OP_SEPOLIA_RPC_URL=http://rpc.invalid "$DEPLOY" op_sepolia 2>&1)"; rc=$?
check "broadcast needs no API key (keyless verification)" test "$rc" -eq 0

# --- inherited explorer keys are stripped before the Blockscout verify step ------------------------
check "verify step strips explorer keys" grep -q -- "^verify-env: env -u ETHERSCAN_API_KEY -u VERIFIER_API_KEY$" <<<"$out"
strip="$(grep "^verify-env: " <<<"$out" | sed 's/^verify-env: //')"
leaked="$(ETHERSCAN_API_KEY=$SECRET VERIFIER_API_KEY=$SECRET $strip sh -c 'echo "${ETHERSCAN_API_KEY:-}${VERIFIER_API_KEY:-}"')"
check "stripped env really drops inherited keys" test -z "$leaked"
check "deploy.sh verify command uses the stripped env" grep -q 'VERIFY_CMD=("${VERIFY_ENV\[@\]}" forge verify-contract' "$DEPLOY"

# --- every public preset gets its own keyless Blockscout verifier ----------------------------------
for spec in "op_mainnet 10 OP_MAINNET_RPC_URL https://explorer.optimism.io/api/" \
  "arbitrum_sepolia 421614 ARBITRUM_SEPOLIA_RPC_URL https://arbitrum-sepolia.blockscout.com/api/" \
  "arbitrum_one 42161 ARBITRUM_ONE_RPC_URL https://arbitrum.blockscout.com/api/"; do
  set -- $spec
  out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a RP_IDS=cryoshield.app CRYOSHIELD_MAINNET_GATE=approved "$3=http://rpc.invalid" "$DEPLOY" "$1" 2>&1)"; rc=$?
  check "$1 plan succeeds" test "$rc" -eq 0
  check "$1 chainId=$2" grep -q "chainId=$2" <<<"$out"
  check "$1 verifier blockscout $4" grep -q -- "verify-args: --verifier blockscout --verifier-url $4$" <<<"$out"
done
check "no OP preset uses a redirecting blockscout.com host" bash -c '! "$1" --list-presets | grep -q "optimism.*blockscout.com"' _ "$DEPLOY"

# --- harden-gas-sponsorship: RP IDs, v1 policy, mainnet gate ---------------------------------------
out="$(plan DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD OP_SEPOLIA_RPC_URL=x "$DEPLOY" op_sepolia 2>&1)"
check "op_sepolia default RP IDs are prod + dev" grep -q "^rpIds=cryoshield.app,cryoshield-web-dev.fly.dev$" <<<"$out"
check "op_sepolia keeps v1 (never redeploys)" grep -q "^v1=keep$" <<<"$out"
out="$(plan RPC_URL=x "$DEPLOY" anvil 2>&1)"
check "anvil default RP IDs are localhost + cryoshield.app" grep -q "^rpIds=localhost,cryoshield.app$" <<<"$out"
check "anvil deploys v1" grep -q "^v1=deploy$" <<<"$out"
out="$(plan DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD OP_MAINNET_RPC_URL=x "$DEPLOY" op_mainnet 2>&1)"
check "op_mainnet never deploys v1" grep -q "^v1=none$" <<<"$out"
check "op_mainnet default RP ID is cryoshield.app only" grep -q "^rpIds=cryoshield.app$" <<<"$out"
out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a OP_MAINNET_RPC_URL=x "$DEPLOY" op_mainnet 2>&1)"; rc=$?
check "op_mainnet broadcast refused without the gate" test "$rc" -ne 0
check "op_mainnet gate message" grep -q "CRYOSHIELD_MAINNET_GATE" <<<"$out"
out="$(plan RP_IDS="https://cryoshield.app" RPC_URL=x "$DEPLOY" anvil 2>&1)"; rc=$?
check "invalid RP ID refused" test "$rc" -ne 0
out="$(plan DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD ARBITRUM_ONE_RPC_URL=x "$DEPLOY" arbitrum_one 2>&1)"; rc=$?
check "preset without default RP IDs requires RP_IDS" test "$rc" -ne 0
pred="$(run "$DEPLOY" --predict-v2 "cryoshield.app,cryoshield-web-dev.fly.dev" 2>/dev/null)"
check "predict-v2 lists registry + 2 wallet pairs" test "$(grep -c . <<<"$pred")" -eq 3
check "wallet pairs differ per RP ID" test "$(awk '$1 == "wallet" {print $3}' <<<"$pred" | sort -u | wc -l | tr -d ' ')" -eq 2

# --- refusals ------------------------------------------------------------------------------------
for n in op_sepolia op_mainnet arbitrum_sepolia arbitrum_one; do
  out="$(plan DEPLOYER_PRIVATE_KEY=0x01 DEPLOYER_ACCOUNT=a OP_SEPOLIA_RPC_URL=x OP_MAINNET_RPC_URL=x ARBITRUM_SEPOLIA_RPC_URL=x ARBITRUM_ONE_RPC_URL=x "$DEPLOY" "$n" 2>&1)"; rc=$?
  check "$n refuses raw private key" test "$rc" -ne 0
done

out="$(plan BROADCAST=1 DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD ETHERSCAN_API_KEY=k OP_SEPOLIA_RPC_URL=x "$DEPLOY" op_sepolia 2>&1)"; rc=$?
check "broadcast requires keystore (address alone refused)" test "$rc" -ne 0

out="$(plan DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD OP_SEPOLIA_RPC_URL=x "$DEPLOY" op_sepolia 2>&1)"; rc=$?
check "simulation accepts a bare sender address" test "$rc" -eq 0
check "simulation uses --sender" grep -q -- "--sender 0x000000000000000000000000000000000000dEaD" <<<"$out"
check "simulation has no --broadcast" bash -c '! grep -q -- "--broadcast" <<<"$1"' _ "$out"
check "simulation has no --verify" bash -c '! grep -q -- "--verify" <<<"$1"' _ "$out"

out="$(plan DEPLOYER_ACCOUNT=a "$DEPLOY" op_sepolia 2>&1)"; rc=$?
check "missing OP_SEPOLIA_RPC_URL fails" test "$rc" -ne 0
check "missing RPC message names OP_SEPOLIA_RPC_URL" grep -q OP_SEPOLIA_RPC_URL <<<"$out"

# --- chain-ID mismatch stops before simulating ---------------------------------------------------
PORT=8547
anvil --port "$PORT" --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do cast chain-id --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1 && break; sleep 0.1; done
out="$(run DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD OP_SEPOLIA_RPC_URL=http://127.0.0.1:$PORT "$DEPLOY" op_sepolia 2>&1)"; rc=$?
check "wrong chain exits non-zero" test "$rc" -ne 0
check "wrong chain message" grep -q "does not match op_sepolia (11155420)" <<<"$out"
check "wrong chain never simulates" bash -c '! grep -qE "Script ran|SIMULATION|Simulated" <<<"$1"' _ "$out"

# --- CREATE2 address unchanged -------------------------------------------------------------------
check "predicted address unchanged" test "$(run "$DEPLOY" --predict 2>/dev/null)" = "$EXPECTED_ADDRESS"

# --- 2.6 preset parity with config/chain-presets.json ---------------------------------------------------------
# parity <chain-presets.json>: deploy.sh table == chain-presets.json (foundryKey, chainId), both directions, and every
# public preset has a foundry.toml [rpc_endpoints] entry.
parity() {
  local want have
  want="$(jq -r '.presets[] | "\(.foundryKey) \(.chainId)"' "$1" | sort)"
  have="$(run "$DEPLOY" --list-presets | awk '{print $1, $2}' | sort)"
  [[ -n "$want" && "$want" == "$have" ]] || return 1
  local key
  for key in $(jq -r '.presets[].foundryKey' "$1"); do
    grep -qE "^$key[[:space:]]*=" foundry.toml || return 1
  done
}
check "deploy.sh presets match config/chain-presets.json" parity "$PRESETS_JSON"
MUT="$(mktemp)"
jq '(.presets[] | select(.foundryKey == "op_sepolia") | .chainId) = 11155421' "$PRESETS_JSON" >"$MUT"
if parity "$MUT"; then bad "parity check is vacuous (edited chain id accepted)"; else ok "parity rejects edited chain id"; fi
rm -f "$MUT"

echo "---- $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
