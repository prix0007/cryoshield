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

const actionsCommitted = JSON.parse(readFileSync(new URL('../../rulesets/actions-permissions.json', import.meta.url), 'utf8'));

function run({ rulesets = [], ruleset = {}, repo = { ...settings, id: 1, private: true }, labels = [{ name: 'no-spec' }, { name: 'hold' }], actions = actionsCommitted, args = [], env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'apply-sh-'));
  writeFileSync(join(dir, 'actions.json'), JSON.stringify(actions));
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
    assert.match(r.stdout, /label 'hold': present/);
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
  assert.equal(r.writes.length, 3);
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

test('Actions workflow permissions drift (write token, PR approval) is applied (review LOW-8)', () => {
  const r = run({
    rulesets: [{ id: 7, name: 'main', target: 'branch' }],
    ruleset: liveMatching(),
    actions: { default_workflow_permissions: 'write', can_approve_pull_request_reviews: true },
    args: ['--apply'],
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.writes.length, 1);
  assert.match(r.writes[0], /^api -X PUT repos\/prix0007\/cryoshield\/actions\/permissions\/workflow --input /);
});

test('--apply re-checks afterwards and fails if the live state still differs', () => {
  const ok = run({ args: ['--apply'], labels: [], repo: { allow_merge_commit: true } });
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.match(ok.stdout, /re-check: in sync/);
  const sticky = run({ args: ['--apply'], env: { STUB_STICKY: '1' } });
  assert.notEqual(sticky.status, 0);
  assert.match(sticky.stderr, /still differs/);
});

test('two rulesets with the same name are refused', () => {
  const r = run({ rulesets: [{ id: 7, name: 'main', target: 'branch' }, { id: 8, name: 'main', target: 'branch' }], args: ['--apply'] });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /more than one ruleset/);
  assert.deepEqual(r.writes, []);
});

test('--repo must be OWNER/NAME without dot segments', () => {
  for (const repo of ['../x', 'a/..', 'a', 'a/b/c', '-x/y']) {
    const r = run({ args: ['--repo', repo] });
    assert.equal(r.status, 2, repo);
  }
});

test('missing hold label is created (owner veto for auto-merge)', () => {
  const r = run({ rulesets: [{ id: 7, name: 'main', target: 'branch' }], ruleset: liveMatching(), labels: [{ name: 'no-spec' }], args: ['--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.writes.length, 1);
  assert.match(r.writes[0], /^api -X POST repos\/prix0007\/cryoshield\/labels -f name=hold /);
});

const withEcc = () => {
  const live = liveMatching();
  live.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks.push({ context: 'ecc-review', integration_id: 15368 });
  return live;
};

test('--with-ecc-review adds the ecc-review required check and PUTs it', () => {
  const r = run({ rulesets: [{ id: 7, name: 'main', target: 'branch' }], ruleset: liveMatching(), args: ['--with-ecc-review', '--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /\+.*"context": "ecc-review"/);
  assert.equal(r.writes.length, 1);
  assert.match(r.writes[0], /^api -X PUT repos\/prix0007\/cryoshield\/rulesets\/7 --input /);
  assert.doesNotMatch(r.writes[0], /main\.json$/); // the merged ruleset, not the bare file
});

test('--with-ecc-review is idempotent once applied', () => {
  const r = run({ rulesets: [{ id: 7, name: 'main', target: 'branch' }], ruleset: withEcc(), args: ['--with-ecc-review', '--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.writes, []);
});

test('without the flag, a live ecc-review requirement is never silently dropped', () => {
  const r = run({ rulesets: [{ id: 7, name: 'main', target: 'branch' }], ruleset: withEcc(), args: ['--apply'] });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--with-ecc-review/);
  assert.deepEqual(r.writes, []);
});

test('rejects unknown arguments', () => {
  const r = run({ args: ['--force'] });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
