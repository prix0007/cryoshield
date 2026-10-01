#!/usr/bin/env bash
# Export the VaultRegistry ABI (functions, events, and custom errors) to abi/VaultRegistry.json
# for the web app and the desktop recovery tool. `--check` fails if the committed file is stale.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p abi
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
forge inspect VaultRegistry abi --json >"$TMP"

if [[ "${1:-}" == "--check" ]]; then
  diff -q "$TMP" abi/VaultRegistry.json >/dev/null || { echo "abi/VaultRegistry.json is stale; run script/export-abi.sh" >&2; exit 1; }
  echo "abi/VaultRegistry.json is up to date"
else
  cp "$TMP" abi/VaultRegistry.json
  echo "wrote abi/VaultRegistry.json"
fi
