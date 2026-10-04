// gate-production-deploys (security review H1): before the owner approves, the run shows what the release changes
// relative to the live commit, and flags every file on the Fly-token path (scripts the release job runs with the
// token, workflows, the policy, fly.toml, the Docker build context).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../deploy/release-diff.sh', import.meta.url));
const stub = fileURLToPath(new URL('./fixtures/gh-compare-stub.sh', import.meta.url));
chmodSync(stub, 0o755);
const LIVE = 'a'.repeat(40);
const TARGET = 'b'.repeat(40);

function run({ live = LIVE, compare = { status: 'ahead', total_commits: 2, files: [] }, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-diff-'));
  if (live) writeFileSync(join(dir, 'release.json'), JSON.stringify({ commit: live, treeHash: 'sha256:x' }));
  writeFileSync(join(dir, 'compare.json'), JSON.stringify(compare));
  const summary = join(dir, 'summary.md');
  const r = spawnSync('bash', [script], {
    env: { PATH: process.env.PATH, GH: stub, CURL: stub, GH_LOG: join(dir, 'log'), STUB_DIR: dir, REPO: 'prix0007/cryoshield', TARGET_SHA: TARGET, BASE_URL: 'https://cryoshield.app', SUMMARY: summary, ...env },
    encoding: 'utf8',
  });
  return { ...r, summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '' };
}
const files = (...names) => names.map((filename) => ({ filename, status: 'modified' }));

test('flags token-path files (deploy scripts, workflows, policy, fly.toml, Docker context) with a warning', () => {
  const r = run({ compare: { status: 'ahead', total_commits: 3, files: files('.github/scripts/deploy/previous-image.sh', 'apps/web/src/App.tsx', 'apps/web/fly.toml', '.github/workflows/deploy.yml', '.github/scripts/workflow-policy.mjs', 'apps/web/deploy/Dockerfile', 'apps/web/.dockerignore') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.summary, /TOKEN-PATH CHANGED/);
  assert.match(r.summary, /https:\/\/github\.com\/prix0007\/cryoshield\/compare\/a{40}\.\.\.b{40}/);
  for (const f of ['.github/scripts/deploy/previous-image.sh', 'apps/web/fly.toml', '.github/workflows/deploy.yml', '.github/scripts/workflow-policy.mjs', 'apps/web/deploy/Dockerfile', 'apps/web/.dockerignore']) {
    assert.ok(r.summary.includes(`\`${f}\``), f);
    assert.ok(r.stdout.includes(`::warning title=TOKEN-PATH CHANGED::${f}`), f);
  }
  assert.doesNotMatch(r.stdout, /::warning[^\n]*App\.tsx/);
  assert.match(r.summary, /7 files? changed/);
});

test('no token-path file: says so, no warning', () => {
  const r = run({ compare: { status: 'ahead', total_commits: 1, files: files('apps/web/src/App.tsx', 'README.md') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.summary, /No token-path file changed/);
  assert.doesNotMatch(r.stdout, /::warning/);
});

test('a release that is behind or diverged from the live commit is called out', () => {
  for (const status of ['behind', 'diverged']) {
    const r = run({ compare: { status, total_commits: 0, files: [] } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /::warning title=NOT NEWER THAN LIVE::/, status);
  }
});

test('live commit unknown or compare failing: loud warning to review the whole commit, never a silent pass', () => {
  for (const scenario of [{ live: null }, { live: 'not-a-sha' }, { env: { STUB_FAIL_READS: '1' } }]) {
    const r = run(scenario);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /::warning title=REVIEW THE WHOLE COMMIT::/, JSON.stringify(scenario));
    assert.match(r.summary, /review the whole commit/i);
  }
});

test('file names are sanitised before reaching the summary or workflow commands', () => {
  const r = run({ compare: { status: 'ahead', total_commits: 1, files: files('.github/workflows/x`y%0A::error::z.yml') } });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /%0A|`y/);
  assert.match(r.stdout, /::warning title=TOKEN-PATH CHANGED::\.github\/workflows\/x\?y\?0A\?\?error\?\?z\.yml/);
});

test('rejects invalid inputs', () => {
  for (const env of [{ TARGET_SHA: 'main' }, { REPO: 'a b/c' }, { BASE_URL: 'http://evil' }]) {
    assert.equal(run({ env }).status, 2, JSON.stringify(env));
  }
});
