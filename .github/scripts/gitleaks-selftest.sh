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
mkdir -p "$T/packages/vault-crypto/test-vectors" "$T/apps/web/src" "$T/.github/scripts"

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
# Allowed: a 64-hex SHA-256 digest in the privileged-run-steps digest file. Reported: a token there, and the
# same digest line in any other file.
cat > "$T/.github/scripts/privileged-run-steps.json" <<EOF
{
  "review/Require a Claude credential": "$hexmix",
  "review/Require a Claude credential 2": "${pat}"
}
EOF
cat > "$T/.github/scripts/other-digests.json" <<EOF
{
  "review/Require a Claude credential": "$hexmix"
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

# Expected: v1.json lines 4 (apiKey hex), 5 (PAT in wrapKey), 6 (PAT); config.json line 2; the digest file's
# token (line 3) and other-digests.json line 2. NOT v1.json lines 2-3 and NOT the digest file's line 2.
got="$(jq -r '.[] | "\(.File):\(.StartLine)"' "$T/report.json" | sort -u | tr '\n' ' ')"
want=".github/scripts/other-digests.json:2 .github/scripts/privileged-run-steps.json:3 apps/web/src/config.json:2 packages/vault-crypto/test-vectors/v1.json:4 packages/vault-crypto/test-vectors/v1.json:5 packages/vault-crypto/test-vectors/v1.json:6 "
if [ "$got" != "$want" ]; then
  echo "gitleaks allowlist self-test FAILED"
  echo "  want: $want"
  echo "  got:  $got"
  exit 1
fi
echo "gitleaks allowlist self-test: OK (allowlists cover only hex vector keys in test-vector files and SHA-256 digests in the digest file)"

# The exact invocation issue-triage.yml uses (add-issue-triage, security review H1): default rules, JSON report,
# --exit-code 42. Clean text must exit 0 and a leak 42; any other code means the flags are wrong for this version.
triage_scan() {
  set +e
  "$GITLEAKS" dir "$1" --no-banner --redact --log-level error \
    --exit-code 42 --report-format json --report-path "$T/triage-report.json" > /dev/null 2>&1
  echo "$?"
  set -e
}
mkdir -p "$T/triage-clean" "$T/triage-leak"
printf 'Unlock fails on Firefox with my second security key.\n' > "$T/triage-clean/issue.md"
printf 'token = "%s"\n' "$pat" > "$T/triage-leak/issue.md"
clean_rc="$(triage_scan "$T/triage-clean")"
leak_rc="$(triage_scan "$T/triage-leak")"
if [ "$clean_rc" != "0" ] || [ "$leak_rc" != "42" ]; then
  echo "gitleaks triage invocation self-test FAILED (clean exit $clean_rc, want 0; leak exit $leak_rc, want 42)"
  exit 1
fi
echo "gitleaks triage invocation self-test: OK (clean 0, leak 42)"
