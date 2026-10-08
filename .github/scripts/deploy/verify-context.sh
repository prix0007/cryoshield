#!/usr/bin/env bash
# Verifies a deploy context (site/, Caddyfile, release-manifest.json) and publishes its hashes (OpenSpec change
# harden-release-path, design D2/D3; pre-production review L4).
#
#   tree hash      sha256 over the `sha256sum` lines of every file under site/ except release.json, paths sorted in C
#                  order (the algorithm of apps/web/deploy/release-manifest.mjs)
#   Caddyfile hash sha256 of Caddyfile
#
# Always: manifest commit == SHA, site/release.json commit == SHA, manifest treeHash/caddyfile == the computed hashes.
# ROLE=build   (the build job, step context-hash): no expectations allowed; the hashes become the job's outputs.
# ROLE=release (the release job, step verify-context): EXPECT_TREE_HASH and EXPECT_CADDYFILE_HASH are REQUIRED (the
#              build job's outputs, which cross jobs through GitHub, not through the artifact) and must equal the
#              computed hashes. A missing or malformed expectation is a usage error, never a skipped check.
#
# env: ROLE (build|release), SHA (40-hex), CONTEXT_DIR (default apps/web/deploy/.build),
#      EXPECT_TREE_HASH, EXPECT_CADDYFILE_HASH (sha256:<64 hex>; release only), GITHUB_OUTPUT (optional).
# Exit: 0 ok, 1 verification failed, 2 usage. Uses bash, coreutils, find, sed and jq only (it runs in the token job).
set -euo pipefail

ROLE="${ROLE:-}"
SHA="${SHA:-}"
CONTEXT_DIR="${CONTEXT_DIR:-apps/web/deploy/.build}"
HASH_RE='^sha256:[0-9a-f]{64}$'
usage() { echo "verify-context: $1" >&2; exit 2; }

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || usage "SHA must be a full 40-hex commit"
case "$ROLE" in
  build)
    [ -z "${EXPECT_TREE_HASH+x}" ] && [ -z "${EXPECT_CADDYFILE_HASH+x}" ] \
      || usage "ROLE=build takes no EXPECT_* values (it publishes the hashes)"
    ;;
  release)
    [[ "${EXPECT_TREE_HASH:-}" =~ $HASH_RE ]] || usage "ROLE=release requires EXPECT_TREE_HASH = sha256:<64 hex> (the build job's tree_hash output)"
    [[ "${EXPECT_CADDYFILE_HASH:-}" =~ $HASH_RE ]] || usage "ROLE=release requires EXPECT_CADDYFILE_HASH = sha256:<64 hex> (the build job's caddyfile_hash output)"
    ;;
  *) usage "ROLE must be build or release" ;;
esac

fail() { echo "::error title=deploy context::$1"; exit 1; }
m="$CONTEXT_DIR/release-manifest.json"
[ -f "$m" ] && [ -d "$CONTEXT_DIR/site" ] && [ -f "$CONTEXT_DIR/Caddyfile" ] || fail "incomplete deploy context in $CONTEXT_DIR"

[ "$(jq -r .commit "$m")" = "$SHA" ] || fail "manifest commit differs from the tested commit $SHA"
[ "$(jq -r .commit "$CONTEXT_DIR/site/release.json")" = "$SHA" ] || fail "release.json names another commit than $SHA"
tree="sha256:$(cd "$CONTEXT_DIR/site" && find . -type f ! -path ./release.json | sed 's#^\./##' | LC_ALL=C sort \
  | while IFS= read -r f; do sha256sum "$f"; done | sha256sum | cut -d' ' -f1)"
caddy="sha256:$(sha256sum "$CONTEXT_DIR/Caddyfile" | cut -d' ' -f1)"
[ "$tree" = "$(jq -r .treeHash "$m")" ] || fail "site tree hash $tree differs from the manifest"
[ "$caddy" = "$(jq -r .caddyfile "$m")" ] || fail "Caddyfile hash $caddy differs from the manifest"

if [ "$ROLE" = "release" ]; then
  [ "$tree" = "$EXPECT_TREE_HASH" ] || fail "site tree hash $tree differs from the build job's output $EXPECT_TREE_HASH"
  [ "$caddy" = "$EXPECT_CADDYFILE_HASH" ] || fail "Caddyfile hash $caddy differs from the build job's output $EXPECT_CADDYFILE_HASH"
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "tree_hash=$tree"; echo "caddyfile_hash=$caddy"; } >> "$GITHUB_OUTPUT"
fi
echo "verify-context ($ROLE): $SHA tree $tree caddyfile $caddy"
