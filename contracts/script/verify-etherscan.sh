#!/usr/bin/env bash
# Verify the contracts recorded in deployments/<chainId>.json on Etherscan (for chain 10: Optimistic Etherscan) through
# the Etherscan V2 API. OpenSpec launch-op-mainnet, design D2, task 2.4.
#
# Optional. Keyless Blockscout and Sourcify verification (script/deploy.sh) is the mandatory one; this script adds
# Etherscan and is never needed for a deployment to succeed. It sends no transaction and needs no wallet.
#
# Usage (the key is typed into the environment, never into the command line):
#   read -rs ETHERSCAN_API_KEY && export ETHERSCAN_API_KEY
#   script/verify-etherscan.sh 10
#   unset ETHERSCAN_API_KEY
#
# Why not `forge verify-contract --verifier etherscan`: the pinned forge 1.1.0 drops the V2 query string
# (?chainid=...) and fails (target-op-sepolia design, task 2.4 probe). So this script:
#   1. gets each contract's standard JSON input from `forge verify-contract --show-standard-json-input` (no network);
#   2. POSTs module=contract&action=verifysourcecode (codeformat=solidity-standard-json-input, contract name,
#      compiler version from the build metadata, constructor arguments) to https://api.etherscan.io/v2/api?chainid=<id>;
#   3. polls action=checkverifystatus until "Pass - Verified".
#
# Key handling (deployment-targets "Keyless explorer verification"; security review in launch-op-mainnet task 6.1):
#   - the key is read ONLY from ETHERSCAN_API_KEY, then removed from the environment, so no child process inherits it;
#   - it reaches curl only through `curl --config -`, written by the shell builtin printf into a pipe: never argv
#     (process list, shell history), never a file, never a log line;
#   - arguments that look like a key are refused without being echoed;
#   - any server response is redacted before it is printed.
#
# Contracts: contracts.vaultRegistryV2 and every contracts.wallets.<rpId> pair (factory and implementation). A
# top-level VaultRegistry v1 entry (OP Sepolia only) is skipped: it is built with the `v1` profile and already verified.
#
# Exit: 0 all verified (or already verified); 1 usage or refused input (nothing sent); 2 a verification failed (the
# retry command is printed, without the key).
# Tuning (tests): VERIFY_POLL_SECONDS (default 5), VERIFY_POLL_MAX (default 60 polls per contract).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Take the key out of the environment first: forge, curl, jq and every other child never see it.
KEY="${ETHERSCAN_API_KEY:-}"
unset ETHERSCAN_API_KEY VERIFIER_API_KEY

die() { echo "ERROR: $*" >&2; exit 1; }
USAGE="usage: ETHERSCAN_API_KEY in the environment, then: contracts/script/verify-etherscan.sh <chainId>"

# Refuse anything that looks like a key on the command line (without echoing it).
for a in "$@"; do
  if { [[ -n "$KEY" ]] && [[ "$a" == *"$KEY"* ]]; } ||
    [[ "$a" =~ ^-*(etherscan-)?(api-?)?key ]] || [[ "$a" =~ (^|[^A-Za-z])api-?key= ]] ||
    { [[ "$a" =~ ^[A-Za-z0-9]{20,}$ ]] && [[ "$a" =~ [A-Za-z] ]]; }; then
    die "an argument looks like an API key; refusing (arguments are visible in the process list and shell history). Put the key in ETHERSCAN_API_KEY instead."
  fi
done
[[ $# -eq 1 && "$1" =~ ^[0-9]{1,12}$ ]] || die "$USAGE"
CHAIN_ID="$1"

[[ -n "$KEY" ]] || die "set ETHERSCAN_API_KEY in the environment (never as an argument). $USAGE"
# Letters and digits only: anything else could change the meaning of the curl config line. Never printed.
[[ "$KEY" =~ ^[A-Za-z0-9]{16,128}$ ]] || die "ETHERSCAN_API_KEY has an unexpected format (expected 16-128 letters and digits); refusing"

RECORD="deployments/$CHAIN_ID.json"
[[ -f "$RECORD" ]] || die "no deployment record $RECORD"
REC_CHAIN="$(jq -r '.chainId // empty' "$RECORD")" || die "cannot parse $RECORD"
[[ "$REC_CHAIN" == "$CHAIN_ID" ]] || die "$RECORD has chainId '${REC_CHAIN}', expected $CHAIN_ID"

API="https://api.etherscan.io/v2/api?chainid=$CHAIN_ID"
POLL_SECONDS="${VERIFY_POLL_SECONDS:-5}"
POLL_MAX="${VERIFY_POLL_MAX:-60}"
is_addr() { [[ "$1" =~ ^0x[0-9a-fA-F]{40}$ ]]; }

# Queue entries: "<address>|<src:Contract>|<constructor args hex without 0x, or empty>".
QUEUE=()
REG="$(jq -r '.contracts.vaultRegistryV2.address // empty' "$RECORD")"
if [[ -n "$REG" ]]; then
  is_addr "$REG" || die "$RECORD: contracts.vaultRegistryV2.address is not an address"
  QUEUE+=("$REG|src/VaultRegistryV2.sol:VaultRegistryV2|")
fi
WALLETS="$(jq -r '.contracts.wallets // {} | to_entries[] | [.key, .value.factory, .value.implementation, .value.rpIdHash] | @tsv' "$RECORD")" ||
  die "cannot parse $RECORD"
while IFS=$'\t' read -r RPID FACTORY IMPL RPIDHASH; do
  [[ -n "$RPID" ]] || continue
  is_addr "$FACTORY" && is_addr "$IMPL" && [[ "$RPIDHASH" =~ ^0x[0-9a-fA-F]{64}$ ]] ||
    die "$RECORD: contracts.wallets entry is malformed"
  # Both constructors take bytes32 rpIdHash: abi.encode(bytes32) is the 32 bytes themselves.
  QUEUE+=("$FACTORY|src/CryoShieldSmartWalletFactory.sol:CryoShieldSmartWalletFactory|${RPIDHASH#0x}")
  QUEUE+=("$IMPL|src/CryoShieldSmartWallet.sol:CryoShieldSmartWallet|${RPIDHASH#0x}")
done <<<"$WALLETS"
((${#QUEUE[@]})) || die "$RECORD records no contracts.vaultRegistryV2 and no contracts.wallets"
[[ -z "$(jq -r '.address // empty' "$RECORD")" ]] ||
  echo "note: skipping the top-level VaultRegistry v1 entry (v1 profile build; already verified on Blockscout)"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cryoshield-verify.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

redact() { local s="$1"; printf '%s' "${s//"$KEY"/<redacted>}"; }

# etherscan <curl args...>: one request; prints the (redacted) response, or the (redacted) curl error. The key goes in
# through stdin only: printf is a shell builtin, so it never appears in any process's arguments.
etherscan() {
  local resp rc=0
  resp="$(printf 'data-urlencode = "apikey=%s"\n' "$KEY" |
    curl -sS --proto '=https' --max-time 120 --config - "$@" "$API" 2>&1)" || rc=$?
  redact "$resp"
  return "$rc"
}
# json_field <field> <response>: curl's stderr (kept in memory, never in a file) is merged into the response, so read
# the field from the last JSON line only (Etherscan answers with one line of JSON).
json_field() {
  local line
  line="$(grep -E '^[[:space:]]*\{' <<<"$2" | tail -n 1)" || true
  jq -r ".$1 // empty" 2>/dev/null <<<"$line" || true
}

# verify_one <address> <src:Contract> <constructor args>: 0 verified or already verified, 1 failed.
verify_one() {
  local addr="$1" target="$2" cargs="$3" sji version resp status result guid i extra=()
  sji="$TMP/$addr.json"
  forge verify-contract "$addr" "$target" --show-standard-json-input >"$sji" 2>"$TMP/forge.err" ||
    { echo "  $target: forge could not produce the standard JSON input:"; tail -n 5 "$TMP/forge.err"; return 1; }
  version="$(forge inspect "$target" metadata 2>/dev/null | jq -r '.compiler.version // empty')" || version=""
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+\+commit\.[0-9a-f]+$ ]] ||
    { echo "  $target: cannot read the compiler version from the build metadata"; return 1; }
  [[ -z "$cargs" ]] || extra=(--data-urlencode "constructorArguements=$cargs") # sic: Etherscan's parameter name

  resp="$(etherscan --data-urlencode module=contract --data-urlencode action=verifysourcecode \
    --data-urlencode "contractaddress=$addr" --data-urlencode "sourceCode@$sji" \
    --data-urlencode codeformat=solidity-standard-json-input --data-urlencode "contractname=$target" \
    --data-urlencode "compilerversion=v$version" "${extra[@]+"${extra[@]}"}")" ||
    { echo "  $target at $addr: request failed: $resp"; return 1; }
  status="$(json_field status "$resp")"
  result="$(json_field result "$resp")"
  if grep -qi "already verified" <<<"$result"; then
    echo "  $target at $addr: Already Verified"
    return 0
  fi
  if [[ "$status" != "1" || ! "$result" =~ ^[A-Za-z0-9-]{1,128}$ ]]; then
    echo "  $target at $addr: submission refused: ${result:-$resp}"
    return 1
  fi
  guid="$result"
  for ((i = 0; i < POLL_MAX; i++)); do
    sleep "$POLL_SECONDS"
    resp="$(etherscan -G --data-urlencode module=contract --data-urlencode action=checkverifystatus \
      --data-urlencode "guid=$guid")" || { echo "  $target at $addr: status request failed: $resp"; return 1; }
    result="$(json_field result "$resp")"
    case "$result" in
      "Pass - Verified") echo "  $target at $addr: Pass - Verified"; return 0 ;;
      *[Aa]lready\ [Vv]erified*) echo "  $target at $addr: Already Verified"; return 0 ;;
      *[Pp]ending* | *[Ii]n\ progress* | *[Qq]ueue*) ;;
      *) echo "  $target at $addr: ${result:-$resp}"; return 1 ;;
    esac
  done
  echo "  $target at $addr: still pending after $POLL_MAX polls"
  return 1
}

echo "Etherscan V2 verification for chain $CHAIN_ID ($API), contracts from $RECORD"
FAILED=()
for item in "${QUEUE[@]}"; do
  IFS='|' read -r ADDR TARGET CARGS <<<"$item"
  verify_one "$ADDR" "$TARGET" "$CARGS" || FAILED+=("$TARGET at $ADDR")
done

if ((${#FAILED[@]})); then
  echo "ERROR: Etherscan verification FAILED for:" >&2
  printf '       %s\n' "${FAILED[@]}" >&2
  echo "Retry: contracts/script/verify-etherscan.sh $CHAIN_ID   (with ETHERSCAN_API_KEY set in the environment)" >&2
  exit 2
fi
echo "all ${#QUEUE[@]} contracts verified on Etherscan for chain $CHAIN_ID"
