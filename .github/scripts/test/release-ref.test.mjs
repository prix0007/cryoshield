// split-dev-and-release-deploys decision 3: release-ref.sh resolves a production release tag to its commit through
// the API (lightweight or annotated; never a same-named branch), requires the commit to be reachable from main's
// HEAD, and, with EXPECT_SHA, that the tag still points at the built commit. Used by deploy.yml's detect job
// (before any build) and by the release job's tag-check (right before fly deploy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../deploy/release-ref.sh', import.meta.url));
const stub = fileURLToPath(new URL('./fixtures/gh-git-stub.sh', import.meta.url));
chmodSync(stub, 0o755);
const COMMIT = 'c'.repeat(40);
const MAIN = 'd'.repeat(40);
const TAGOBJ = 'e'.repeat(40);
const TAGOBJ2 = 'f'.repeat(40);

const ref = (tag, type, sha) => ({ ref: `refs/tags/${tag}`, object: { type, sha } });
function run({ tag = 'v1.2.3', refs = { 'v1.2.3': ref('v1.2.3', 'commit', COMMIT) }, tags = {}, compare = { status: 'ahead' }, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-ref-'));
  for (const [name, body] of Object.entries(refs)) writeFileSync(join(dir, `ref-${name}.json`), JSON.stringify(body));
  for (const [sha, body] of Object.entries(tags)) writeFileSync(join(dir, `tag-${sha}.json`), JSON.stringify(body));
  writeFileSync(join(dir, 'main.json'), JSON.stringify({ ref: 'refs/heads/main', object: { type: 'commit', sha: MAIN } }));
  writeFileSync(join(dir, 'compare.json'), JSON.stringify(compare));
  const out = join(dir, 'out');
  const log = join(dir, 'log');
  writeFileSync(out, '');
  const r = spawnSync('bash', [script], {
    env: { PATH: process.env.PATH, GH: stub, GH_LOG: log, STUB_DIR: dir, GITHUB_OUTPUT: out, REPO: 'prix0007/cryoshield', TAG: tag, ...env },
    encoding: 'utf8',
  });
  return { ...r, output: readFileSync(out, 'utf8'), calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [] };
}

test('a lightweight tag on a commit behind main resolves: deploy=true, sha, tag', () => {
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.output, /^deploy=true$/m);
  assert.match(r.output, new RegExp(`^sha=${COMMIT}$`, 'm'));
  assert.match(r.output, /^tag=v1\.2\.3$/m);
  // the explicit tag namespace (never a branch of the same name), and compare <commit>...<main HEAD>
  assert.ok(r.calls.some((c) => /^api repos\/prix0007\/cryoshield\/git\/ref\/tags\/v1\.2\.3( |$)/.test(c)), r.calls.join('\n'));
  assert.ok(r.calls.some((c) => c.startsWith(`api repos/prix0007/cryoshield/compare/${COMMIT}...${MAIN} `)), r.calls.join('\n'));
});

test('the tag on main HEAD itself (identical) is fine; pre-release tags are fine', () => {
  assert.equal(run({ compare: { status: 'identical' } }).status, 0);
  const pre = run({ tag: 'v2.0.0-rc.1', refs: { 'v2.0.0-rc.1': ref('v2.0.0-rc.1', 'commit', COMMIT) } });
  assert.equal(pre.status, 0, pre.stdout + pre.stderr);
  assert.match(pre.output, /^tag=v2\.0\.0-rc\.1$/m);
});

test('an annotated tag is followed to its commit (bounded)', () => {
  const r = run({
    refs: { 'v1.2.3': ref('v1.2.3', 'tag', TAGOBJ) },
    tags: { [TAGOBJ]: { sha: TAGOBJ, object: { type: 'tag', sha: TAGOBJ2 } }, [TAGOBJ2]: { sha: TAGOBJ2, object: { type: 'commit', sha: COMMIT } } },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.output, new RegExp(`^sha=${COMMIT}$`, 'm'));
  const loop = run({ refs: { 'v1.2.3': ref('v1.2.3', 'tag', TAGOBJ) }, tags: { [TAGOBJ]: { sha: TAGOBJ, object: { type: 'tag', sha: TAGOBJ } } } });
  assert.notEqual(loop.status, 0);
  assert.doesNotMatch(loop.output, /deploy=true/);
});

test('a commit that is not reachable from main fails before anything is built', () => {
  for (const status of ['behind', 'diverged']) {
    const r = run({ compare: { status } });
    assert.equal(r.status, 1, status);
    assert.match(r.stdout, /::error title=release ref::.*not reachable from main/);
    assert.doesNotMatch(r.output, /deploy=true/);
  }
});

test('EXPECT_SHA: the tag must still point at the built (or event) commit', () => {
  const moved = run({ env: { EXPECT_SHA: 'a'.repeat(40) } });
  assert.equal(moved.status, 1);
  assert.match(moved.stdout, /::error title=release ref::.*points at/);
  assert.doesNotMatch(moved.output, /deploy=true/);
  assert.equal(run({ env: { EXPECT_SHA: COMMIT } }).status, 0);
  assert.equal(run({ env: { EXPECT_SHA: '' } }).status, 0); // dispatch: nothing to compare
  assert.equal(run({ env: { EXPECT_SHA: 'main' } }).status, 2);
});

test('a missing tag, a mismatched ref answer or a non-commit object fails', () => {
  assert.equal(run({ refs: {} }).status, 1);
  assert.equal(run({ refs: { 'v1.2.3': ref('v1.2.30', 'commit', COMMIT) } }).status, 1);
  assert.equal(run({ refs: { 'v1.2.3': ref('v1.2.3', 'tree', COMMIT) } }).status, 1);
  assert.equal(run({ refs: { 'v1.2.3': ref('v1.2.3', 'commit', 'not-a-sha') } }).status, 1);
});

test('an API error fails (never reads as "reachable")', () => {
  for (const p of ['git/ref/tags', 'git/ref/heads', 'compare']) {
    const r = run({ env: { STUB_FAIL_READS_PATH: p } });
    assert.notEqual(r.status, 0, p);
    assert.doesNotMatch(r.output, /deploy=true/, p);
  }
});

test('only v<major>.<minor>.<patch>[-pre] tags; invalid input exits 2 without calling the API', () => {
  for (const tag of ['', 'main', 'v1', 'v1.2', '1.2.3', 'v1.2.3;id', 'v1.2.3/../x', 'v1.2.3 ', 'refs/tags/v1.2.3', 'v1.2.3-', 'V1.2.3']) {
    const r = run({ tag });
    assert.equal(r.status, 2, JSON.stringify(tag));
    assert.deepEqual(r.calls, [], JSON.stringify(tag));
  }
  assert.equal(run({ env: { REPO: 'a/b/c' } }).status, 2);
});
