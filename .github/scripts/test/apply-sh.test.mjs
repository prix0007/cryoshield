import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const applySh = fileURLToPath(new URL('../../rulesets/apply.sh', import.meta.url));
const stub = fileURLToPath(new URL('./fixtures/gh-stub.sh', import.meta.url));
const committed = JSON.parse(readFileSync(new URL('../../rulesets/main.json', import.meta.url), 'utf8'));
const settings = JSON.parse(readFileSync(new URL('../../rulesets/repo-settings.json', import.meta.url), 'utf8'));

// What the API returns for a ruleset matching the committed one: metadata, defaults, other order.
const liveMatching = () => ({
  id: 7,
  source: 'prix0007/cryoshield',
  source_type: 'Repository',
  ...structuredClone(committed),
  rules: structuredClone(committed.rules)
    .reverse()
    .map((r) => (r.type === 'pull_request' ? { ...r, parameters: { ...r.parameters, required_reviewers: [] } } : r)),
  created_at: '2026-10-02T00:00:00Z',
  _links: {},
});

function run({ rulesets = [], ruleset = {}, repo = { ...settings, id: 1, private: true }, labels = [{ name: 'no-spec' }], args = [], env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'apply-sh-'));
  writeFileSync(join(dir, 'rulesets.json'), JSON.stringify(rulesets));
  writeFileSync(join(dir, 'ruleset.json'), JSON.stringify(ruleset));
  writeFileSync(join(dir, 'repo.json'), JSON.stringify(repo));
  writeFileSync(join(dir, 'labels.json'), JSON.stringify(labels));
  const log = join(dir, 'gh.log');
  const r = spawnSync('bash', [applySh, '--repo', 'prix0007/cryoshield', ...args], {
    env: { ...process.env, GH: stub, GH_LOG: log, STUB_DIR: dir, ...env },
    encoding: 'utf8',
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  return { ...r, calls, writes: calls.filter((c) => / -X (POST|PUT|PATCH|DELETE)/.test(c)) };
}

test('dry run with a missing ruleset shows the diff, exits 3, writes nothing', () => {
  const r = run({});
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.match(r.stdout, /ruleset 'main' does not exist/);
  assert.match(r.stdout, /\+.*"ci-ok"/);
  assert.deepEqual(r.writes, []);
});

test('--apply with a missing ruleset POSTs it', () => {
  const r = run({ args: ['--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.writes, ['api -X POST repos/prix0007/cryoshield/rulesets --input ' + fileURLToPath(new URL('../../rulesets/main.json', import.meta.url))]);
});

test('--apply with a drifted ruleset PUTs it by id', () => {
  const live = liveMatching();
  live.bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }];
  const r = run({ rulesets: [{ id: 7, name: 'main', target: 'branch' }], ruleset: live, args: ['--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /-.*"actor_id": 5/);
  assert.equal(r.writes.length, 1);
  assert.match(r.writes[0], /^api -X PUT repos\/prix0007\/cryoshield\/rulesets\/7 --input /);
});

test('matching ruleset, settings and label: no diff, no write (idempotent)', () => {
  for (const args of [[], ['--apply']]) {
    const r = run({ rulesets: [{ id: 7, name: 'main', target: 'branch' }], ruleset: liveMatching(), args });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /ruleset 'main': in sync/);
    assert.match(r.stdout, /repo merge settings: in sync/);
    assert.match(r.stdout, /label 'no-spec': present/);
    assert.deepEqual(r.writes, []);
  }
});

test('drifted merge settings and missing label are applied', () => {
  const r = run({
    rulesets: [{ id: 7, name: 'main', target: 'branch' }],
    ruleset: liveMatching(),
    repo: { ...settings, allow_merge_commit: true },
    labels: [{ name: 'bug' }],
    args: ['--apply'],
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.writes.length, 2);
  assert.match(r.writes[0], /^api -X PATCH repos\/prix0007\/cryoshield --input .*repo-settings\.json$/);
  assert.match(r.writes[1], /^api -X POST repos\/prix0007\/cryoshield\/labels /);
});

test('a failing write call fails the script (no silent success)', () => {
  for (const scenario of [{}, { rulesets: [{ id: 7, name: 'main', target: 'branch' }], ruleset: {} }]) {
    const r = run({ ...scenario, args: ['--apply'], env: { STUB_FAIL_WRITES: '1' } });
    assert.notEqual(r.status, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /^done$/m);
  }
});

test('rejects unknown arguments', () => {
  const r = run({ args: ['--force'] });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
