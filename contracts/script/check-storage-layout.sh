#!/usr/bin/env bash
# harden-gas-sponsorship 4.5: CryoShieldSmartWallet must keep CBSW v1.1's storage layout so legacy accounts can
# upgrade in place. Compares the `forge inspect` storage layouts (slot, offset, label, type) of both contracts.
# The ERC-7201 MultiOwnableStorage slot is a private constant that `forge inspect` does not show; it is pinned by
# test_multiOwnableSlotConstantMatchesCbsw in test/CryoShieldSmartWallet.t.sol.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
layout() {
  forge inspect "$1" storageLayout --json | jq -c '[.storage[] | {slot, offset, label, type: (.type | sub("t_struct\\(([A-Za-z0-9_]+)\\)[0-9]+"; "t_struct(\(.captures[0].string))"))}]'
}
want="$(layout lib/cbsw-v1.1.0/src/CoinbaseSmartWallet.sol:CoinbaseSmartWallet)"
have="$(layout src/CryoShieldSmartWallet.sol:CryoShieldSmartWallet)"
if [[ "$want" != "$have" ]]; then
  echo "storage layout differs from CBSW v1.1" >&2
  echo "  CBSW v1.1:  $want" >&2
  echo "  CryoShield: $have" >&2
  exit 1
fi
echo "storage layout identical to CBSW v1.1: $have"
