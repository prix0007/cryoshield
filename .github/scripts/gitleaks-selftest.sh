#!/usr/bin/env bash
# Proves the committed .gitleaks.toml allowlist is narrow (OpenSpec change adopt-pr-workflow, task 4.4).
# Plants findings in a temp tree that mirrors the repo layout and checks gitleaks reports exactly the ones
# that must NOT be allowlisted. Fake secrets are assembled at runtime so this file itself never matches.
#
# usage: gitleaks-selftest.sh <gitleaks-binary> <path-to-.gitleaks.toml>
set -euo pipefail
GITLEAKS="$(cd "$(dirname "${1:?usage: $0 <gitleaks-binary> <config>}")" && pwd)/$(basename "$1")"
CONFIG="$(cd "$(dirname "${2:?usage: $0 <gitleaks-binary> <config>}")" && pwd)/$(basename "$2")"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/packages/vault-crypto/test-vectors" "$T/apps/web/src"

hexmix="3096a441a3eaa484545e53d1a9ef43b0fbe097b7fca025c365c38f166e67d2f7"
pat="ghp_$(printf 'R7xk2Q9mLw4Tz8Vb1Nc6Hy3Jd5Pf0Gs')Ae5i"  # GitHub PAT shape (36 chars after prefix)

# Allowed: vector key name + pure hex value, in a test-vector file.
cat > "$T/packages/vault-crypto/test-vectors/v1.json" <<EOF
{
  "wrapKey": "$hexmix",
  "dataKey": "$hexmix",
  "apiKey": "$hexmix",
  "wrapKey": "${pat}",
  "token": "${pat}"
}
EOF
# Same allowlisted shape, but outside the test-vector directory: must be reported.
cat > "$T/apps/web/src/config.json" <<EOF
{
  "wrapKey": "$hexmix"
}
EOF

set +e
(cd "$T" && "$GITLEAKS" dir . --config "$CONFIG" --no-banner --redact --exit-code 0 \
  --report-format json --report-path "$T/report.json" > /dev/null 2>&1)
code=$?
set -e
[ "$code" -eq 0 ] || { echo "gitleaks failed to run (exit $code)"; exit 1; }

# Expected: v1.json lines 4 (apiKey hex), 5 (PAT in wrapKey), 6 (PAT); config.json line 2. NOT v1.json lines 2-3.
got="$(jq -r '.[] | "\(.File):\(.StartLine)"' "$T/report.json" | sort -u | tr '\n' ' ')"
want="apps/web/src/config.json:2 packages/vault-crypto/test-vectors/v1.json:4 packages/vault-crypto/test-vectors/v1.json:5 packages/vault-crypto/test-vectors/v1.json:6 "
if [ "$got" != "$want" ]; then
  echo "gitleaks allowlist self-test FAILED"
  echo "  want: $want"
  echo "  got:  $got"
  exit 1
fi
echo "gitleaks allowlist self-test: OK (allowlist covers only hex vector keys in test-vector files)"
