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
const tagsCommitted = JSON.parse(readFileSync(new URL('../../rulesets/release-tags.json', import.meta.url), 'utf8'));
const TAGS_PATH = fileURLToPath(new URL('../../rulesets/release-tags.json', import.meta.url));
// What the API returns for the tag ruleset matching release-tags.json (split-dev-and-release-deploys).
const liveTags = () => ({ id: 8, source: 'prix0007/cryoshield', source_type: 'Repository', ...structuredClone(tagsCommitted), rules: structuredClone(tagsCommitted.rules).reverse(), _links: {} });
const TAGS_ENTRY = { id: 8, name: 'release-tags', target: 'tag' };

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
// gate-external-pr-automation: the fork PR workflow approval policy (fork-pr-approval.json).
const FORK_PATH = fileURLToPath(new URL('../../rulesets/fork-pr-approval.json', import.meta.url));
const forkCommitted = JSON.parse(readFileSync(FORK_PATH, 'utf8'));

const MANAGED = JSON.parse(readFileSync(new URL('../../rulesets/labels.json', import.meta.url), 'utf8'));
const allLabels = () => MANAGED.map((l) => ({ name: l.name }));

function run({ rulesets = [], ruleset = {}, tags = liveTags(), repo = { ...settings, id: 1, private: true }, labels = allLabels(), actions = actionsCommitted, forkApproval = forkCommitted, args = [], env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'apply-sh-'));
  writeFileSync(join(dir, 'actions.json'), JSON.stringify(actions));
  if (forkApproval) writeFileSync(join(dir, 'fork-approval.json'), JSON.stringify(forkApproval));
  writeFileSync(join(dir, 'rulesets.json'), JSON.stringify(tags ? [...rulesets, TAGS_ENTRY] : rulesets));
  if (tags) writeFileSync(join(dir, 'ruleset-8.json'), JSON.stringify(tags));
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
    labels: [{ name: 'bug' }, ...allLabels().filter((l) => l.name !== 'bug' && l.name !== 'hold')],
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
  const r = run({ rulesets: [{ id: 7, name: 'main', target: 'branch' }], ruleset: liveMatching(), labels: allLabels().filter((l) => l.name !== 'hold'), args: ['--apply'] });
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

test('labels with spaces and regex characters are matched literally and created from labels.json (add-issue-triage)', () => {
  const names = MANAGED.map((l) => l.name);
  for (const n of ['sensitive-content', 'security', 'needs-triage', 'duplicate?', 'good first issue', 'recovery-tool']) assert.ok(names.includes(n), n);
  // 'duplicat' must not satisfy 'duplicate?' (grep -x would treat ? as a regex).
  const present = allLabels().filter((l) => l.name !== 'duplicate?').concat([{ name: 'duplicat' }]);
  const r = run({ rulesets: [{ id: 7, name: 'main', target: 'branch' }], ruleset: liveMatching(), labels: present, args: ['--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.writes.length, 1);
  assert.match(r.writes[0], /-f name=duplicate\? -f color=cfd3d7 -f description=Triage: possibly a duplicate$/);
  const spaced = run({ rulesets: [{ id: 7, name: 'main', target: 'branch' }], ruleset: liveMatching(), labels: allLabels().filter((l) => l.name !== 'good first issue'), args: ['--apply'] });
  assert.match(spaced.writes[0], /-f name=good first issue -f color=7057ff/);
});

// ---- split-dev-and-release-deploys: the owner-only release tag ruleset (release-tags.json) ----
const MAIN_IN_SYNC = { rulesets: [{ id: 7, name: 'main', target: 'branch' }], ruleset: liveMatching() };

test('release-tags: a missing tag ruleset is drift in the dry run (exit 3), with no write', () => {
  const r = run({ ...MAIN_IN_SYNC, tags: null });
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.match(r.stdout, /ruleset 'release-tags' does not exist/);
  assert.match(r.stdout, /\+.*"refs\/tags\/v\*"/);
  assert.match(r.stdout, /ruleset 'main': in sync/);
  assert.deepEqual(r.writes, []);
});

test('release-tags: --apply POSTs release-tags.json, then the re-check is in sync', () => {
  const r = run({ ...MAIN_IN_SYNC, tags: null, args: ['--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.writes, [`api -X POST repos/prix0007/cryoshield/rulesets --input ${TAGS_PATH}`]);
  assert.match(r.stdout, /re-check: in sync/);
});

test('release-tags: a drifted tag ruleset (extra bypass actor, missing rule) is PUT by its id, never main\'s', () => {
  for (const mutate of [
    (t) => t.bypass_actors.push({ actor_id: 2, actor_type: 'RepositoryRole', bypass_mode: 'always' }),
    (t) => { t.rules = t.rules.filter((x) => x.type !== 'update'); },
    (t) => { t.conditions.ref_name.include = ['refs/tags/release-*']; },
  ]) {
    const live = liveTags();
    mutate(live);
    const r = run({ ...MAIN_IN_SYNC, tags: live, args: ['--apply'] });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(r.writes, [`api -X PUT repos/prix0007/cryoshield/rulesets/8 --input ${TAGS_PATH}`]);
  }
});

test('release-tags: in sync means no write (dry run and apply); a BRANCH ruleset with that name does not count', () => {
  for (const args of [[], ['--apply']]) {
    const r = run({ ...MAIN_IN_SYNC, args });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /ruleset 'release-tags': in sync/);
    assert.deepEqual(r.writes, []);
  }
  const branchNamed = run({ rulesets: [{ id: 7, name: 'main', target: 'branch' }, { id: 9, name: 'release-tags', target: 'branch' }], ruleset: liveMatching(), tags: null });
  assert.equal(branchNamed.status, 3);
  assert.match(branchNamed.stdout, /ruleset 'release-tags' does not exist/);
});

test('release-tags: --with-ecc-review only changes main, never the tag ruleset', () => {
  const r = run({ ...MAIN_IN_SYNC, args: ['--with-ecc-review', '--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.writes.map((w) => w.split(' --input ')[0]), ['api -X PUT repos/prix0007/cryoshield/rulesets/7']);
});

// ---- gate-external-pr-automation: fork PR workflow approval for all external contributors ----

test('fork approval: the committed policy is all_external_contributors', () => {
  assert.deepEqual(forkCommitted, { approval_policy: 'all_external_contributors' });
});

test('fork approval: drift is shown in the dry run (exit 3) with no write', () => {
  const r = run({ ...MAIN_IN_SYNC, forkApproval: { approval_policy: 'first_time_contributors' } });
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.match(r.stdout, /-.*"approval_policy": "first_time_contributors"/);
  assert.match(r.stdout, /\+.*"approval_policy": "all_external_contributors"/);
  assert.ok(r.calls.includes('api repos/prix0007/cryoshield/actions/permissions/fork-pr-contributor-approval'), r.calls.join('\n'));
  assert.deepEqual(r.writes, []);
});

test('fork approval: --apply PUTs fork-pr-approval.json, then the re-check is in sync', () => {
  const r = run({ ...MAIN_IN_SYNC, forkApproval: { approval_policy: 'first_time_contributors_new_to_github' }, args: ['--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.writes, [`api -X PUT repos/prix0007/cryoshield/actions/permissions/fork-pr-contributor-approval --input ${FORK_PATH}`]);
  assert.match(r.stdout, /fork PR workflow approval: updated/);
  assert.match(r.stdout, /re-check: in sync/);
});

test('fork approval: in sync means no write (dry run and apply)', () => {
  for (const args of [[], ['--apply']]) {
    const r = run({ ...MAIN_IN_SYNC, args });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /fork PR workflow approval: in sync/);
    assert.deepEqual(r.writes, []);
  }
});

test('fork approval: a failed read aborts instead of reading as in sync', () => {
  const r = run({ ...MAIN_IN_SYNC, env: { STUB_FAIL_READS_PATH: 'fork-pr-contributor-approval' } });
  assert.notEqual(r.status, 0);
  assert.notEqual(r.status, 3);
  assert.doesNotMatch(r.stdout, /fork PR workflow approval: in sync/);
  assert.deepEqual(r.writes, []);
});
