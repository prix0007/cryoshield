#!/usr/bin/env bash
# Tests for script/deploy.sh network presets and argument construction (target-op-sepolia tasks 2.1, 2.6).
# No keys and no public network access: uses DEPLOY_PLAN_ONLY=1 (prints the forge args and exits before any RPC
# call) plus one throwaway anvil node for the chain-ID-mismatch check.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
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
  out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a RP_IDS=cryoshield.app CRYOSHIELD_MAINNET_GATE="approved:$2" "$3=http://rpc.invalid" "$DEPLOY" "$1" 2>&1)"; rc=$?
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
# Mainnet gate is fail-closed (security review C9): every preset that is not local/testnet needs the gate to broadcast.
for spec in "op_sepolia OP_SEPOLIA_RPC_URL allow 11155420" "arbitrum_sepolia ARBITRUM_SEPOLIA_RPC_URL allow 421614" \
  "op_mainnet OP_MAINNET_RPC_URL gate 10" "arbitrum_one ARBITRUM_ONE_RPC_URL gate 42161"; do
  set -- $spec
  out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a RP_IDS=cryoshield.app "$2=http://rpc.invalid" "$DEPLOY" "$1" 2>&1)"; rc=$?
  if [[ "$3" == "allow" ]]; then
    check "$1 broadcast plan needs no mainnet gate" test "$rc" -eq 0
  else
    check "$1 broadcast refused without the mainnet gate" test "$rc" -ne 0
    check "$1 refusal names CRYOSHIELD_MAINNET_GATE" grep -q "CRYOSHIELD_MAINNET_GATE" <<<"$out"
    out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a RP_IDS=cryoshield.app CRYOSHIELD_MAINNET_GATE="approved:$4" "$2=http://rpc.invalid" "$DEPLOY" "$1" 2>&1)"; rc=$?
    check "$1 broadcast plan allowed with approved:$4" test "$rc" -eq 0
    for wrong in approved yes "approved:1" "approved:$4x" "approved: $4"; do
      out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a RP_IDS=cryoshield.app CRYOSHIELD_MAINNET_GATE="$wrong" "$2=http://rpc.invalid" "$DEPLOY" "$1" 2>&1)"; rc=$?
      check "$1 gate refuses '$wrong' (only approved:$4)" test "$rc" -ne 0
    done
    # An approval for the OTHER mainnet must not open this one.
    other=10; [[ "$4" == 10 ]] && other=42161
    out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a RP_IDS=cryoshield.app CRYOSHIELD_MAINNET_GATE="approved:$other" "$2=http://rpc.invalid" "$DEPLOY" "$1" 2>&1)"; rc=$?
    check "$1 gate refuses another chain's approval (approved:$other)" test "$rc" -ne 0
  fi
done
# Every preset in config/chain-presets.json is classified; the default testnet is a testnet; non-testnets are gated.
kinds_ok() {
  local key kind def
  def="$(jq -r '.defaultTestnet' "$PRESETS_JSON")"
  for key in $(jq -r '.presets[].foundryKey' "$PRESETS_JSON"); do
    kind="$(run "$DEPLOY" --list-presets | awk -v k="$key" '$1 == k {print $5}')"
    [[ "$kind" == local || "$kind" == testnet || "$kind" == mainnet ]] || return 1
  done
  [[ "$(run "$DEPLOY" --list-presets | awk -v k="${def//-/_}" '$1 == k {print $5}')" == testnet ]]
}
check "every chain-presets.json preset has a kind (local/testnet/mainnet)" kinds_ok
# Fail-closed: a preset whose kind is missing or unknown is treated as mainnet.
MUTDEPLOY="$(mktemp -d)/deploy.sh"
sed -E 's#^(arbitrum_one +42161 +ARBITRUM_ONE_RPC_URL +[^ ]+) +mainnet$#\1#' "$DEPLOY" >"$MUTDEPLOY"
chmod +x "$MUTDEPLOY"
check "mutation removed arbitrum_one's kind" bash -c '! grep -qE "^arbitrum_one .* mainnet$" "$1"' _ "$MUTDEPLOY"
out="$(cd "$ROOT" && plan BROADCAST=1 DEPLOYER_ACCOUNT=a RP_IDS=cryoshield.app ARBITRUM_ONE_RPC_URL=x bash "$MUTDEPLOY" arbitrum_one 2>&1)"; rc=$?
check "preset with no kind is gated (fail-closed)" test "$rc" -ne 0
check "fail-closed refusal is the mainnet gate (kind unset)" grep -q "kind unset) broadcast is gated" <<<"$out"
rm -rf "$(dirname "$MUTDEPLOY")"

out="$(plan RP_IDS="https://cryoshield.app" RPC_URL=x "$DEPLOY" anvil 2>&1)"; rc=$?
check "invalid RP ID refused" test "$rc" -ne 0
out="$(plan DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD ARBITRUM_ONE_RPC_URL=x "$DEPLOY" arbitrum_one 2>&1)"; rc=$?
check "preset without default RP IDs requires RP_IDS" test "$rc" -ne 0
pred="$(run "$DEPLOY" --predict-v2 "cryoshield.app,cryoshield-web-dev.fly.dev" 2>/dev/null)"
check "predict-v2 lists registry + 2 wallet pairs" test "$(grep -c . <<<"$pred")" -eq 3
check "wallet pairs differ per RP ID" test "$(awk '$1 == "wallet" {print $3}' <<<"$pred" | sort -u | wc -l | tr -d ' ')" -eq 2

# --- launch-op-mainnet 2.1: D1 address parity guard (op_mainnet == deployments/11155420.json) --------
# The reference record can be swapped only for plans and simulations (DEPLOY_RECORDS_DIR); a broadcast refuses it.
REAL_SEPOLIA="$ROOT/deployments/11155420.json"
RECS="$(mktemp -d)"
trap 'rm -rf "$RECS"' EXIT
mainnet_plan() { plan DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD OP_MAINNET_RPC_URL=http://rpc.invalid "$@" "$DEPLOY" op_mainnet; }
out="$(mainnet_plan 2>&1)"; rc=$?
check "op_mainnet plan passes with the committed 11155420 record" test "$rc" -eq 0
check "op_mainnet plan reports address parity ok" grep -q "^parity=ok " <<<"$out"
for addr in 0xA622c92d3D5b54aeA081Cf410224a8A2eCb08cB7 0x775dc816594262274E78Ae75D97C8EdB0df5DfED 0x8aA76FaA6629cA1EA8ccC3F9Edf0E8D98816Acd7; do
  check "op_mainnet plan prints D1 address $addr" grep -q "$addr" <<<"$out"
done
for spec in "VaultRegistryV2|.contracts.vaultRegistryV2.address" \
  "cryoshield.app factory|.contracts.wallets[\"cryoshield.app\"].factory" \
  "cryoshield.app implementation|.contracts.wallets[\"cryoshield.app\"].implementation"; do
  IFS='|' read -r name path <<<"$spec"
  mkdir -p "$RECS/drift"
  jq "$path = \"0x000000000000000000000000000000000000bEEF\"" "$REAL_SEPOLIA" >"$RECS/drift/11155420.json"
  out="$(mainnet_plan DEPLOY_RECORDS_DIR="$RECS/drift" 2>&1)"; rc=$?
  check "parity guard refuses drifted $name" test "$rc" -ne 0
  check "parity refusal names $name" grep -q "address parity: $name " <<<"$out"
  # Without DEPLOY_PLAN_ONLY it would reach the RPC next; the guard must stop it first (rpc.invalid never contacted).
  out="$(run DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD OP_MAINNET_RPC_URL=http://rpc.invalid DEPLOY_RECORDS_DIR="$RECS/drift" "$DEPLOY" op_mainnet 2>&1)"; rc=$?
  check "simulation refused on drifted $name before any RPC call" bash -c '[[ $1 -ne 0 ]] && grep -q "address parity: $2 " <<<"$3" && ! grep -q "cannot reach" <<<"$3"' _ "$rc" "$name" "$out"
done
mkdir -p "$RECS/missing"
jq 'del(.contracts.wallets["cryoshield.app"])' "$REAL_SEPOLIA" >"$RECS/missing/11155420.json"
out="$(mainnet_plan DEPLOY_RECORDS_DIR="$RECS/missing" 2>&1)"; rc=$?
check "parity guard fails closed on a missing reference entry" test "$rc" -ne 0
out="$(mainnet_plan DEPLOY_RECORDS_DIR="$RECS/none" 2>&1)"; rc=$?
check "parity guard fails closed on a missing reference record" test "$rc" -ne 0
mkdir -p "$RECS/ok" && cp "$REAL_SEPOLIA" "$RECS/ok/11155420.json"
out="$(mainnet_plan DEPLOY_RECORDS_DIR="$RECS/ok" 2>&1)"; rc=$?
check "parity guard passes with an unmodified copy of the record" test "$rc" -eq 0
out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a CRYOSHIELD_MAINNET_GATE=approved:10 OP_MAINNET_RPC_URL=x DEPLOY_RECORDS_DIR="$RECS/ok" "$DEPLOY" op_mainnet 2>&1)"; rc=$?
check "a broadcast refuses a swapped records directory" test "$rc" -ne 0
check "swapped records refusal names DEPLOY_RECORDS_DIR" grep -q "DEPLOY_RECORDS_DIR" <<<"$out"
out="$(plan OP_SEPOLIA_RPC_URL=x DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD "$DEPLOY" op_sepolia 2>&1)"
check "parity guard is op_mainnet only" bash -c '! grep -q "^parity=" <<<"$1"' _ "$out"

# --- launch-op-mainnet 2.2: only cryoshield.app on op_mainnet; no v1 record on chain 10 ----------------
for ids in "cryoshield.app,cryoshield-web-dev.fly.dev" "cryoshield-web-dev.fly.dev" "localhost" "cryoshield.app.evil.example" \
  "cryoshield.app cryoshield.app"; do
  out="$(mainnet_plan RP_IDS="$ids" 2>&1)"; rc=$?
  check "op_mainnet refuses RP_IDS='$ids'" test "$rc" -ne 0
  check "op_mainnet RP ID refusal explains cryoshield.app only" grep -q "op_mainnet deploys only the cryoshield.app wallet pair" <<<"$out"
  out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a CRYOSHIELD_MAINNET_GATE=approved:10 OP_MAINNET_RPC_URL=x RP_IDS="$ids" "$DEPLOY" op_mainnet 2>&1)"; rc=$?
  check "op_mainnet gated broadcast still refuses RP_IDS='$ids'" test "$rc" -ne 0
done
out="$(mainnet_plan RP_IDS=cryoshield.app 2>&1)"; rc=$?
check "op_mainnet accepts RP_IDS=cryoshield.app" test "$rc" -eq 0
mkdir -p "$RECS/v1on10" && cp "$REAL_SEPOLIA" "$RECS/v1on10/11155420.json"
jq '.chainId = 10' "$REAL_SEPOLIA" >"$RECS/v1on10/10.json" # has a top-level v1 "address"
out="$(mainnet_plan DEPLOY_RECORDS_DIR="$RECS/v1on10" 2>&1)"; rc=$?
check "op_mainnet refuses a 10.json with a v1 address" test "$rc" -ne 0
check "v1-on-mainnet refusal names v1" grep -q "VaultRegistry v1 entry, but v1 must not exist on op_mainnet" <<<"$out"
out="$(run DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD OP_MAINNET_RPC_URL=http://rpc.invalid DEPLOY_RECORDS_DIR="$RECS/v1on10" "$DEPLOY" op_mainnet 2>&1)"; rc=$?
check "v1-on-mainnet refusal comes before any RPC call" bash -c '[[ $1 -ne 0 ]] && ! grep -q "cannot reach" <<<"$2"' _ "$rc" "$out"
jq 'del(.address, .deployBlock, .txHash, .abiHash) | .chainId = 10 | del(.contracts.wallets["cryoshield-web-dev.fly.dev"])' \
  "$REAL_SEPOLIA" >"$RECS/v1on10/10.json"
out="$(mainnet_plan DEPLOY_RECORDS_DIR="$RECS/v1on10" 2>&1)"; rc=$?
check "op_mainnet accepts a v2-only 10.json" test "$rc" -eq 0

# --- launch-op-mainnet 2.3: Blockscout AND Sourcify per contract, keyless, after the record -------------
out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a CRYOSHIELD_MAINNET_GATE=approved:10 OP_MAINNET_RPC_URL=x "$DEPLOY" op_mainnet 2>&1)"; rc=$?
check "op_mainnet gated broadcast plan succeeds" test "$rc" -eq 0
check "verify-args-sourcify line" grep -q -- "^verify-args-sourcify: --verifier sourcify$" <<<"$out"
check "verification runs after the record is written" grep -q "^verify-order: after deployments/10.json is written$" <<<"$out"
for c in "VaultRegistryV2" "CryoShieldSmartWalletFactory\[cryoshield.app\]" "CryoShieldSmartWallet\[cryoshield.app\]"; do
  check "op_mainnet verifies $c on blockscout" grep -q "^verify: $c via blockscout https://explorer.optimism.io/api/$" <<<"$out"
  check "op_mainnet verifies $c on sourcify" grep -q "^verify: $c via sourcify$" <<<"$out"
done
check "op_mainnet verify plan is exactly 3 contracts x 2 verifiers" test "$(grep -c '^verify: ' <<<"$out")" -eq 6
check "op_mainnet verify plan has no key or etherscan" bash -c '! grep -E "^verify" <<<"$1" | grep -v "^verify-env: " | grep -qiE "key|etherscan"' _ "$out"
out="$(plan BROADCAST=1 DEPLOYER_ACCOUNT=a OP_SEPOLIA_RPC_URL=x "$DEPLOY" op_sepolia 2>&1)"
for c in "VaultRegistryV2" "CryoShieldSmartWalletFactory\[cryoshield.app\]" "CryoShieldSmartWallet\[cryoshield-web-dev.fly.dev\]"; do
  check "op_sepolia verifies $c on blockscout and sourcify" bash -c 'grep -q "^verify: $1 via blockscout https://testnet-explorer.optimism.io/api/$" <<<"$2" && grep -q "^verify: $1 via sourcify$" <<<"$2"' _ "$c" "$out"
done
check "op_sepolia verify plan is 5 contracts x 2 verifiers" test "$(grep -c '^verify: ' <<<"$out")" -eq 10
check "op_sepolia v1 is never re-verified (kept, not redeployed)" bash -c '! grep -q "^verify: VaultRegistry via" <<<"$1"' _ "$out"
out="$(mainnet_plan 2>&1)"
check "simulation plans no verification" bash -c '! grep -q "^verify: " <<<"$1"' _ "$out"
out="$(plan RPC_URL=x "$DEPLOY" anvil 2>&1)"
check "anvil plans no verification (no explorer)" bash -c '! grep -q "^verify: " <<<"$1"' _ "$out"
check "deploy.sh verify loop runs every queued contract through every verifier" grep -q 'for verifier in "${VERIFIERS\[@\]}"' "$DEPLOY"

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
trap 'kill $ANVIL_PID 2>/dev/null || true; rm -rf "$RECS"' EXIT
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
    grep -qE "^${key}[[:space:]]*=" foundry.toml || return 1
  done
}
check "deploy.sh presets match config/chain-presets.json" parity "$PRESETS_JSON"
MUT="$(mktemp)"
jq '(.presets[] | select(.foundryKey == "op_sepolia") | .chainId) = 11155421' "$PRESETS_JSON" >"$MUT"
if parity "$MUT"; then bad "parity check is vacuous (edited chain id accepted)"; else ok "parity rejects edited chain id"; fi
rm -f "$MUT"

echo "---- $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
