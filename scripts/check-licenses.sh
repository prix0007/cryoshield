#!/usr/bin/env bash
# Fails unless every first-party license declaration is MIT (spec: project-licensing).
# Vendored third-party code (contracts/lib, node_modules) is excluded.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0

grep -q '^MIT License$' LICENSE || { echo "LICENSE: missing or not MIT"; fail=1; }

while IFS= read -r f; do
  lic="$(node -e 'const p=require(process.argv[1]);process.stdout.write(String(p.license??""))' "./$f")"
  [ "$lic" = "MIT" ] || { echo "$f: license is '${lic:-<missing>}'"; fail=1; }
done < <(git ls-files '*package.json' | grep -v '^contracts/lib/')

while IFS= read -r f; do
  grep -Eq '^license *= *(\{ *text *= *"MIT" *\}|"MIT")' "$f" || { echo "$f: license is not MIT"; fail=1; }
done < <(git ls-files '*pyproject.toml')

sol_count=0
while IFS= read -r f; do
  sol_count=$((sol_count + 1))
  grep -q 'SPDX-License-Identifier: MIT$' "$f" || { echo "$f: SPDX identifier is not MIT"; fail=1; }
done < <(git ls-files '*.sol' | grep -v '^contracts/lib/')
[ "$sol_count" -gt 0 ] || { echo "no first-party .sol files found (check is misconfigured)"; fail=1; }

[ "$fail" -eq 0 ] && echo "license check: all first-party declarations are MIT"
exit "$fail"
