#!/usr/bin/env bash
# Tests for script/verify-etherscan.sh (OpenSpec launch-op-mainnet task 2.4, design D2).
# No network and no real key: stub `curl` and `forge` on PATH record their argv, environment and stdin, and answer like
# the Etherscan V2 API. The script runs from a throwaway copy of the contracts tree with a test-only fixture
# deployments/10.json (built from the OP Sepolia record; never the real mainnet record).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
SCRIPT="$ROOT/script/verify-etherscan.sh"

PASS=0
FAIL=0
ok() { echo "ok   $*"; PASS=$((PASS + 1)); }
bad() { echo "FAIL $*" >&2; FAIL=$((FAIL + 1)); }
check() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
contains() { grep -qF -- "$1" <<<"$2"; }
lacks() { ! grep -qF -- "$1" <<<"$2"; }
# lacks_in_dir <needle> <dir>: no file under <dir> contains the needle.
lacks_in_dir() { ! grep -rqF -- "$1" "$2" 2>/dev/null; }

# Test-only stand-in for an Etherscan key (letters and digits, like a real one). Never a real key.
STUB_KEY=TESTONLYKEYTESTONLYKEYTESTONLY0000
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TREE="$WORK/tree"
BIN="$WORK/bin"
mkdir -p "$TREE/script" "$TREE/deployments" "$BIN"
cp "$SCRIPT" "$TREE/script/verify-etherscan.sh" 2>/dev/null || true
jq 'del(.address, .deployBlock, .txHash, .abiHash) | .chainId = 10
    | .contracts.wallets |= {"cryoshield.app": .["cryoshield.app"]}' \
  "$ROOT/deployments/11155420.json" >"$TREE/deployments/10.json"
REG="$(jq -r '.contracts.vaultRegistryV2.address' "$TREE/deployments/10.json")"
FAC="$(jq -r '.contracts.wallets["cryoshield.app"].factory' "$TREE/deployments/10.json")"
IMPL="$(jq -r '.contracts.wallets["cryoshield.app"].implementation' "$TREE/deployments/10.json")"
RPH="$(jq -r '.contracts.wallets["cryoshield.app"].rpIdHash' "$TREE/deployments/10.json")"

# --- stubs ------------------------------------------------------------------------------------------------------
cat >"$BIN/curl" <<'STUB'
#!/usr/bin/env bash
# Stub curl: logs argv / env / stdin config, answers per $STUB_SCENARIO.
{ printf 'curl'; printf ' %q' "$@"; echo; } >>"$STUB_LOG/argv"
printf '%s\n' "${1:-}" >>"$STUB_LOG/argv1"
env >>"$STUB_LOG/env"
cfg=""
prev=""
for a in "$@"; do
  if [[ "$prev" == "--config" && "$a" == "-" ]]; then cfg="$(cat)"; fi
  prev="$a"
done
printf '%s\n' "$cfg" >>"$STUB_LOG/stdin"
action=""
for a in "$@"; do case "$a" in action=*) action="${a#action=}" ;; esac; done
n="$(($(cat "$STUB_LOG/count.$action" 2>/dev/null || echo 0) + 1))"
echo "$n" >"$STUB_LOG/count.$action"
key="$(sed -n 's/.*apikey=\([^"]*\)".*/\1/p' <<<"$cfg")"
[[ "$STUB_SCENARIO" != stderr-noise ]] || echo "Warning: a curl warning on stderr" >&2
case "$STUB_SCENARIO:$action" in
  stderr-noise:verifysourcecode) echo '{"status":"1","message":"OK","result":"guid-n"}' ;;
  stderr-noise:checkverifystatus) echo '{"status":"1","message":"OK","result":"Pass - Verified"}' ;;
  curl-error:*) echo "curl: (6) Could not resolve host: api.etherscan.io" >&2; exit 6 ;;
  already:verifysourcecode) echo '{"status":"0","message":"NOTOK","result":"Contract source code already verified"}' ;;
  echo-key:verifysourcecode) echo "{\"status\":\"0\",\"message\":\"NOTOK\",\"result\":\"Invalid API Key ($key)\"}" ;;
  *:verifysourcecode) echo "{\"status\":\"1\",\"message\":\"OK\",\"result\":\"guid-$n-abc\"}" ;;
  ok:checkverifystatus)
    if ((n % 2)); then echo '{"status":"0","message":"NOTOK","result":"Pending in queue"}'
    else echo '{"status":"1","message":"OK","result":"Pass - Verified"}'; fi ;;
  already-poll:checkverifystatus) echo '{"status":"0","message":"NOTOK","result":"Already Verified"}' ;;
  pending:checkverifystatus) echo '{"status":"0","message":"NOTOK","result":"Pending in queue"}' ;;
  fail:checkverifystatus) echo '{"status":"0","message":"NOTOK","result":"Fail - Unable to verify"}' ;;
  *) echo '{"status":"0","message":"NOTOK","result":"unexpected request"}' ;;
esac
STUB
cat >"$BIN/forge" <<'STUB'
#!/usr/bin/env bash
# Stub forge: logs argv / env; prints a standard JSON input or metadata. No network, no compiler.
{ printf 'forge'; printf ' %q' "$@"; echo; } >>"$STUB_LOG/argv"
env >>"$STUB_LOG/env"
case "$1" in
  verify-contract) echo '{"language":"Solidity","sources":{"src/X.sol":{"content":"// x"}},"settings":{}}' ;;
  inspect) echo '{"compiler":{"version":"0.8.28+commit.7893614a"}}' ;;
  *) exit 0 ;;
esac
STUB
chmod +x "$BIN/curl" "$BIN/forge"

# run <scenario> [env assignments...] -- [args...]: run the copied script with stubs first on PATH and a clean env.
RUN_N=0
run() {
  local scenario="$1"; shift
  local envs=()
  while (($#)) && [[ "$1" != "--" ]]; do envs+=("$1"); shift; done
  shift
  RUN_N=$((RUN_N + 1))
  LOG="$WORK/log.$RUN_N"
  TMPD="$WORK/tmp.$RUN_N"
  mkdir -p "$LOG" "$TMPD"
  : >"$LOG/argv"; : >"$LOG/argv1"; : >"$LOG/env"; : >"$LOG/stdin"
  out="$(env -i PATH="$BIN:$PATH" HOME="$HOME" TMPDIR="$TMPD" STUB_LOG="$LOG" STUB_SCENARIO="$scenario" \
    VERIFY_POLL_SECONDS=0 VERIFY_POLL_MAX=4 "${envs[@]+"${envs[@]}"}" "$TREE/script/verify-etherscan.sh" "$@" 2>&1)"
  rc=$?
  argv="$(cat "$LOG/argv")"
}
curl_calls() { grep -c '^curl ' <<<"$argv"; }

check "verify-etherscan.sh exists and is executable" test -x "$SCRIPT"

# --- happy path: V2 URL, key only through curl's stdin config, record addresses -----------------------------------
run ok ETHERSCAN_API_KEY="$STUB_KEY" -- 10
check "ok: exits 0" test "$rc" -eq 0
check "ok: three submissions (registry, factory, implementation)" test "$(grep -c 'action=verifysourcecode' <<<"$argv")" -eq 3
check "ok: every curl call uses the V2 URL for chain 10" \
  test "$(grep '^curl ' <<<"$argv" | grep -cF 'https://api.etherscan.io/v2/api\?chainid=10')" -eq "$(curl_calls)"
# -q must be curl's FIRST argument, or curl reads ~/.curlrc (a trace/verbose option there would write the key to a file).
first_args_all_q() { [[ -s "$1" ]] && [[ "$(sort -u "$1")" == "-q" ]] && [[ $(wc -l <"$1") -eq $2 ]]; }
check "ok: argv[1] of every curl call is -q (no ~/.curlrc)" first_args_all_q "$LOG/argv1" "$(curl_calls)"
check "ok: every curl call reads its config from stdin" test "$(grep '^curl ' <<<"$argv" | grep -cF -- '--config -')" -eq "$(curl_calls)"
check "ok: the key reaches curl through stdin" contains "apikey=$STUB_KEY" "$(cat "$LOG/stdin")"
check "ok: no subprocess argv contains the key" lacks "$STUB_KEY" "$argv"
check "ok: no subprocess argv contains part of the key" lacks "${STUB_KEY:4:12}" "$argv"
check "ok: no subprocess inherits the key in its environment" lacks "$STUB_KEY" "$(cat "$LOG/env")"
check "ok: output has no key" lacks "$STUB_KEY" "$out"
check "ok: no temp file holds the key" lacks_in_dir "$STUB_KEY" "$TMPD"
check "ok: temp files cleaned up" test -z "$(ls -A "$TMPD")"
check "ok: no file in the tree holds the key" lacks_in_dir "$STUB_KEY" "$TREE"
for a in "$REG" "$FAC" "$IMPL"; do
  check "ok: submits $a from deployments/10.json" contains "contractaddress=$a" "$argv"
done
check "ok: registry contract name" contains "contractname=src/VaultRegistryV2.sol:VaultRegistryV2" "$argv"
check "ok: factory contract name" contains "contractname=src/CryoShieldSmartWalletFactory.sol:CryoShieldSmartWalletFactory" "$argv"
check "ok: implementation contract name" contains "contractname=src/CryoShieldSmartWallet.sol:CryoShieldSmartWallet" "$argv"
check "ok: standard JSON input format" contains "codeformat=solidity-standard-json-input" "$argv"
check "ok: compiler version from the build metadata" contains "compilerversion=v0.8.28+commit.7893614a" "$argv"
check "ok: wallet constructor args are abi.encode(rpIdHash)" test "$(grep -cF "constructorArguements=${RPH#0x}" <<<"$argv")" -eq 2
check "ok: standard JSON comes from forge --show-standard-json-input" contains "--show-standard-json-input" "$argv"
check "ok: polls checkverifystatus" contains "action=checkverifystatus" "$argv"
check "ok: reports Pass - Verified" test "$(grep -c "Pass - Verified" <<<"$out")" -eq 3

# --- idempotent: "Already Verified" is success ----------------------------------------------------------------------
run already ETHERSCAN_API_KEY="$STUB_KEY" -- 10
check "already (on submit): exits 0" test "$rc" -eq 0
check "already (on submit): no polling" lacks "action=checkverifystatus" "$argv"
check "already (on submit): says already verified" grep -qi "already verified" <<<"$out"
run already-poll ETHERSCAN_API_KEY="$STUB_KEY" -- 10
check "already (on poll): exits 0" test "$rc" -eq 0
run stderr-noise ETHERSCAN_API_KEY="$STUB_KEY" -- 10
check "a curl warning on stderr does not break the JSON parse" test "$rc" -eq 0

# --- failures exit 2 with a key-free retry command --------------------------------------------------------------------
for scenario in fail pending curl-error echo-key; do
  run "$scenario" ETHERSCAN_API_KEY="$STUB_KEY" -- 10
  check "$scenario: exits 2" test "$rc" -eq 2
  check "$scenario: prints the retry command" contains "Retry: contracts/script/verify-etherscan.sh 10" "$out"
  check "$scenario: output has no key" lacks "$STUB_KEY" "$out"
  check "$scenario: no subprocess argv contains the key" lacks "$STUB_KEY" "$argv"
  check "$scenario: no temp file holds the key" lacks_in_dir "$STUB_KEY" "$TMPD"
done
run echo-key ETHERSCAN_API_KEY="$STUB_KEY" -- 10
check "echo-key: a server response echoing the key is redacted" contains "Invalid API Key" "$out"

# --- refusals: before any request -------------------------------------------------------------------------------------
run ok -- 10
check "no ETHERSCAN_API_KEY: refused" test "$rc" -eq 1
check "no ETHERSCAN_API_KEY: message names the variable" contains "ETHERSCAN_API_KEY" "$out"
check "no ETHERSCAN_API_KEY: no request" test "$(curl_calls)" -eq 0
for args in "10 --api-key $STUB_KEY" "10 --etherscan-api-key=$STUB_KEY" "--api-key=$STUB_KEY 10" "$STUB_KEY" "10 $STUB_KEY" \
  "10 apikey=$STUB_KEY" "10 --key $STUB_KEY"; do
  read -r -a argarr <<<"$args"
  run ok ETHERSCAN_API_KEY="$STUB_KEY" -- "${argarr[@]}"
  check "key-like argument refused: ${args//$STUB_KEY/<key>}" test "$rc" -eq 1
  check "key-like argument: refused as a key, not as bad usage" contains "looks like an API key" "$out"
  check "key-like argument: refusal does not echo it" lacks "$STUB_KEY" "$out"
  check "key-like argument: no request" test "$(curl_calls)" -eq 0
done
# A different key-shaped value (not the environment's) is refused too.
run ok ETHERSCAN_API_KEY="$STUB_KEY" -- 10 ABCDEFGHIJKLMNOPQRSTUVWXYZ012345AB
check "unrelated key-shaped argument refused" test "$rc" -eq 1
check "unrelated key-shaped argument: refused as a key" contains "looks like an API key" "$out"
for bad_key in 'abc" -o /tmp/x' $'ABCDEFGHIJKLMNOP\nurl = "https://evil.example"' 'short'; do
  run ok ETHERSCAN_API_KEY="$bad_key" -- 10
  check "malformed key refused (curl config injection)" test "$rc" -eq 1
  check "malformed key: not echoed" lacks "evil.example" "$out"
  check "malformed key: no request" test "$(curl_calls)" -eq 0
done
run ok ETHERSCAN_API_KEY="$STUB_KEY" --
check "missing chain id: usage" test "$rc" -eq 1
run ok ETHERSCAN_API_KEY="$STUB_KEY" -- op_mainnet
check "non-numeric chain id refused" test "$rc" -eq 1
run ok ETHERSCAN_API_KEY="$STUB_KEY" -- 42161
check "missing record refused" test "$rc" -eq 1
check "missing record: names deployments/42161.json" contains "deployments/42161.json" "$out"
check "missing record: no request" test "$(curl_calls)" -eq 0
jq '.chainId = 11155420' "$TREE/deployments/10.json" >"$TREE/deployments/5.json"
run ok ETHERSCAN_API_KEY="$STUB_KEY" -- 5
check "record whose chainId differs is refused" test "$rc" -eq 1
jq '.contracts.vaultRegistryV2.address = "0xabc; rm -rf /"' "$TREE/deployments/10.json" >"$TREE/deployments/7.json"
jq '.chainId = 7' "$TREE/deployments/7.json" >"$TREE/deployments/7.tmp" && mv "$TREE/deployments/7.tmp" "$TREE/deployments/7.json"
run ok ETHERSCAN_API_KEY="$STUB_KEY" -- 7
check "malformed address in the record refused" test "$rc" -eq 1
check "malformed address: no request" test "$(curl_calls)" -eq 0

echo "---- $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
