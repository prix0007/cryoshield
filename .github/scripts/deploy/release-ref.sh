#!/usr/bin/env bash
# Resolve and check a production release tag (OpenSpec change split-dev-and-release-deploys, design decision 3).
# Used by deploy.yml twice: in `detect`, before anything is configured, tested or built; and in the release job's
# `tag-check`, right before `fly deploy`, with EXPECT_SHA = the commit that was built.
#   1. TAG must be v<major>.<minor>.<patch>[-<pre>]: stricter than `v*`, so it is safe in logs and concurrency groups.
#   2. refs/tags/<TAG> is read through the explicit tag namespace (a branch named like the tag can never shadow it) and
#      followed through annotated tag objects (at most 5) to a commit.
#   3. With EXPECT_SHA, the tag must still point at exactly that commit (a release event's github.sha, or the build).
#   4. The commit must be reachable from main: compare <commit>...<main HEAD> is `identical` or `ahead`.
# Read-only: GET requests with the job's read-only GITHUB_TOKEN; never writes.
#
# env: TAG, REPO (owner/name), EXPECT_SHA (optional 40-hex), GH (default gh); GH_TOKEN for real runs.
# out: deploy=true, sha=<40-hex>, tag=<TAG> to $GITHUB_OUTPUT (and stdout). Exit 2 = invalid input, 1 = refused.
set -euo pipefail

GH="${GH:-gh}"
TAG="${TAG:-}"
REPO="${REPO:-}"
EXPECT_SHA="${EXPECT_SHA:-}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] \
  || { echo "release-ref: TAG must look like v1.2.3 or v1.2.3-rc.1 (got '${TAG//[^A-Za-z0-9._-]/?}')" >&2; exit 2; }
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "release-ref: invalid REPO" >&2; exit 2; }
[ -z "$EXPECT_SHA" ] || [[ "$EXPECT_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "release-ref: EXPECT_SHA must be empty or a 40-hex commit" >&2; exit 2; }

refuse() {
  echo "::error title=release ref::$1"
  exit 1
}
emit() {
  echo "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >> "$GITHUB_OUTPUT"; fi
}

answer="$("$GH" api "repos/${REPO}/git/ref/tags/${TAG}" --jq '[.ref, .object.type, .object.sha] | join(" ")')" \
  || refuse "tag ${TAG} not found (or the API failed)"
read -r ref type sha <<<"$answer"
[ "$ref" = "refs/tags/${TAG}" ] || refuse "the API answered ${ref:-nothing} for refs/tags/${TAG}"
hops=0
while [ "$type" = "tag" ]; do
  hops=$((hops + 1))
  [ "$hops" -le 5 ] || refuse "tag ${TAG}: more than 5 nested annotated tags"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || refuse "tag ${TAG}: unexpected tag object id"
  answer="$("$GH" api "repos/${REPO}/git/tags/${sha}" --jq '[.object.type, .object.sha] | join(" ")')" \
    || refuse "tag ${TAG}: cannot read annotated tag object ${sha}"
  read -r type sha <<<"$answer"
done
[ "$type" = "commit" ] || refuse "tag ${TAG} points at a ${type:-unknown object}, not a commit"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || refuse "tag ${TAG}: unexpected commit id"

if [ -n "$EXPECT_SHA" ] && [ "$sha" != "$EXPECT_SHA" ]; then
  refuse "tag ${TAG} now points at ${sha}, not ${EXPECT_SHA} (moved, or not the commit this run built); nothing deployed"
fi

main="$("$GH" api "repos/${REPO}/git/ref/heads/main" --jq '.object.sha')" || refuse "cannot read main's HEAD"
[[ "$main" =~ ^[0-9a-f]{40}$ ]] || refuse "unexpected main HEAD"
status="$("$GH" api "repos/${REPO}/compare/${sha}...${main}" --jq '.status')" || refuse "cannot compare ${sha} with main"
case "$status" in
  identical | ahead) ;;
  *) refuse "tag ${TAG} (${sha}) is not reachable from main (${main}: ${status:-unknown}); release only commits that are on main" ;;
esac

echo "release-ref: ${TAG} -> ${sha}, reachable from main (${status})"
emit "deploy=true"
emit "sha=${sha}"
emit "tag=${TAG}"
