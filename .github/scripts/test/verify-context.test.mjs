// harden-release-path D2/D3 (pre-production review L4): verify-context.sh hashes a deploy context (site tree without
// release.json, and the Caddyfile), checks them against the manifest and the commit, and writes tree_hash and
// caddyfile_hash to $GITHUB_OUTPUT. ROLE=build publishes them as job outputs; ROLE=release REQUIRES the build job's
// outputs (EXPECT_TREE_HASH, EXPECT_CADDYFILE_HASH) and refuses a context that differs, even with a consistent manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../deploy/verify-context.sh', import.meta.url));
const SHA = 'a'.repeat(40);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// The algorithm of apps/web/deploy/release-manifest.mjs: sha256 over "<sha256>  <path>\n" lines, paths byte-sorted.
const treeHashOf = (files) =>
  'sha256:' +
  sha256(
    Object.keys(files)
      .sort((a, b) => (Buffer.from(a) < Buffer.from(b) ? -1 : Buffer.from(a) > Buffer.from(b) ? 1 : 0))
      .map((p) => `${sha256(files[p])}  ${p}\n`)
      .join(''),
  );

const SITE = {
  'index.html': '<html>landing</html>',
  'app/index.html': '<html>app</html>',
  'assets/app-x.js': 'console.log(1)',
  '.well-known/security.txt': 'Contact: https://example.invalid\n',
  'Z.txt': 'upper-case sorts first in C order',
};
const CADDY = ':8080 { respond "ok" }\n';

function context({ site = SITE, caddy = CADDY, manifest = {}, release = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-context-'));
  for (const [p, body] of Object.entries(site)) {
    mkdirSync(dirname(join(dir, 'site', p)), { recursive: true });
    writeFileSync(join(dir, 'site', p), body);
  }
  writeFileSync(join(dir, 'Caddyfile'), caddy);
  const m = { name: 'cryoshield-web', commit: SHA, treeHash: treeHashOf(SITE), caddyfile: `sha256:${sha256(CADDY)}`, config: {}, ...manifest };
  writeFileSync(join(dir, 'release-manifest.json'), JSON.stringify(m));
  writeFileSync(join(dir, 'site', 'release.json'), JSON.stringify({ commit: SHA, treeHash: m.treeHash, ...release }));
  return dir;
}

const TREE = treeHashOf(SITE);
const CADDY_HASH = `sha256:${sha256(CADDY)}`;

function run(dir, env) {
  const out = join(dir, 'gh-output');
  writeFileSync(out, '');
  const r = spawnSync('bash', [script], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, CONTEXT_DIR: dir, SHA, ...env }, encoding: 'utf8' });
  return { ...r, output: readFileSync(out, 'utf8') };
}
const RELEASE = { ROLE: 'release', EXPECT_TREE_HASH: TREE, EXPECT_CADDYFILE_HASH: CADDY_HASH };

test('build: a consistent context passes and publishes tree_hash and caddyfile_hash', () => {
  const r = run(context(), { ROLE: 'build' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.output, `tree_hash=${TREE}\ncaddyfile_hash=${CADDY_HASH}\n`);
});

test('release: the build job\'s outputs match, so it passes (release.json itself is excluded from the tree)', () => {
  const r = run(context({ release: { extra: 'release.json is not part of the tree' } }), RELEASE);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.output, new RegExp(`tree_hash=${TREE}`));
});

test('release: a context altered after the build fails even though its manifest is consistent (review L4)', () => {
  const site = { ...SITE, 'assets/app-x.js': 'evil()' };
  const forgedTree = treeHashOf(site);
  const caddy = ':8080 { respond "evil" }\n';
  const cases = [
    [context({ site, manifest: { treeHash: forgedTree } }), /tree hash .* differs from the build job/],
    [context({ caddy, manifest: { caddyfile: `sha256:${sha256(caddy)}` } }), /Caddyfile hash .* differs from the build job/],
  ];
  for (const [dir, why] of cases) {
    const r = run(dir, RELEASE);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, why);
  }
});

test('both roles: a context inconsistent with its manifest or commit fails and is named', () => {
  const cases = [
    [context({ site: { ...SITE, 'index.html': 'changed' } }), /tree hash .* differs from the manifest/],
    [context({ site: { ...SITE, 'new.html': 'added' } }), /tree hash .* differs from the manifest/],
    [context({ caddy: 'changed' }), /Caddyfile hash .* differs from the manifest/],
    [context({ manifest: { commit: 'b'.repeat(40) } }), /manifest commit/],
    [context({ release: { commit: 'b'.repeat(40) } }), /release\.json names another commit/],
  ];
  for (const [dir, why] of cases) {
    for (const env of [{ ROLE: 'build' }, RELEASE]) {
      const r = run(dir, env);
      assert.equal(r.status, 1, JSON.stringify(env) + r.stdout + r.stderr);
      assert.match(r.stdout + r.stderr, why, JSON.stringify(env));
      assert.equal(r.output, '', 'no outputs on failure');
    }
  }
});

test('release: a missing, empty or malformed expectation is a usage error (exit 2), never a skipped check', () => {
  const dir = context();
  const bad = ['', 'c'.repeat(64), 'sha256:' + 'c'.repeat(63), 'sha256:' + 'C'.repeat(64), `${TREE}\n`];
  for (const v of bad) {
    assert.equal(run(dir, { ...RELEASE, EXPECT_TREE_HASH: v }).status, 2, JSON.stringify(v));
    assert.equal(run(dir, { ...RELEASE, EXPECT_CADDYFILE_HASH: v }).status, 2, JSON.stringify(v));
  }
  assert.equal(run(dir, { ROLE: 'release', EXPECT_CADDYFILE_HASH: CADDY_HASH }).status, 2);
});

test('usage: build takes no expectations; the role and SHA are required', () => {
  const dir = context();
  assert.equal(run(dir, { ROLE: 'build', EXPECT_TREE_HASH: TREE }).status, 2);
  assert.equal(run(dir, { ROLE: 'build', EXPECT_CADDYFILE_HASH: CADDY_HASH }).status, 2);
  assert.equal(run(dir, {}).status, 2);
  assert.equal(run(dir, { ROLE: 'deploy' }).status, 2);
  assert.equal(run(dir, { ROLE: 'build', SHA: 'main' }).status, 2);
});
