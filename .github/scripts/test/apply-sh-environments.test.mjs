// gate-production-deploys task 3.1, split-dev-and-release-deploys: apply.sh --environments
// (production/production-build from main and v* tags; development/development-build from main only; no required reviewer,
// no admin bypass; the owner is looked up only when an environment names "@owner") and --founder-hardening (Dependabot
// security updates, SHA-pinned actions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const applySh = fileURLToPath(new URL('../../rulesets/apply.sh', import.meta.url));
const stub = fileURLToPath(new URL('./fixtures/gh-stub.sh', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(new URL(`../../rulesets/${p}`, import.meta.url), 'utf8'));
const committed = readJson('main.json');
const tagsCommitted = readJson('release-tags.json');
const settings = readJson('repo-settings.json');
const actionsCommitted = readJson('actions-permissions.json');
const labels = readJson('labels.json').map((l) => ({ name: l.name }));
const OWNER_ID = 30095502;

// A copy of apply.sh with its own environments.json (apply.sh reads the files next to it), for "@owner" cases.
function applyWithEnvironments(mutate) {
  // realpath: ruleset-normalize.mjs runs its CLI only when argv[1] is its real path (macOS /var is a symlink)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'apply-copy-')));
  cpSync(fileURLToPath(new URL('../../rulesets', import.meta.url)), join(root, 'rulesets'), { recursive: true });
  mkdirSync(join(root, 'scripts'));
  cpSync(fileURLToPath(new URL('../ruleset-normalize.mjs', import.meta.url)), join(root, 'scripts', 'ruleset-normalize.mjs'));
  const file = join(root, 'rulesets', 'environments.json');
  writeFileSync(file, JSON.stringify(mutate(JSON.parse(readFileSync(file, 'utf8'))), null, 2));
  return join(root, 'rulesets', 'apply.sh');
}
const withOwnerReviewer = () => applyWithEnvironments((envs) => envs.map((e) => (e.name === 'production' ? { ...e, required_reviewers: ['@owner'] } : e)));

const liveRuleset = () => ({ id: 7, ...structuredClone(committed) });

// GitHub's GET shape for an environment.
const envLive = ({ name, reviewers = [], bypass = true, selfReview = false, wait = 0, custom = true }) => ({
  id: 1,
  name,
  can_admins_bypass: bypass,
  deployment_branch_policy: { protected_branches: !custom, custom_branch_policies: custom },
  protection_rules: [
    ...(reviewers.length ? [{ id: 2, type: 'required_reviewers', prevent_self_review: selfReview, reviewers: reviewers.map((id) => ({ type: 'User', reviewer: { id, login: 'x' } })) }] : []),
    ...(wait ? [{ id: 3, type: 'wait_timer', wait_timer: wait }] : []),
    { id: 4, type: 'branch_policy' },
  ],
});
// "main" is a branch policy, "tag:v*" a tag policy (split-dev-and-release-deploys).
const policies = (...keys) => ({
  total_count: keys.length,
  branch_policies: keys.map((k, i) => (k.startsWith('tag:') ? { id: 50 + i, name: k.slice(4), type: 'tag' } : { id: 50 + i, name: k, type: 'branch' })),
});
const inSyncEnvs = () => ({
  production: { env: envLive({ name: 'production', bypass: false }), policies: policies('main', 'tag:v*') },
  'production-build': { env: envLive({ name: 'production-build', bypass: false }), policies: policies('main', 'tag:v*') },
  development: { env: envLive({ name: 'development', bypass: false }), policies: policies('main') },
  'development-build': { env: envLive({ name: 'development-build', bypass: false }), policies: policies('main') },
});

function run({ envs = {}, user = { id: OWNER_ID, login: 'prix0007', type: 'User' }, actionsPerms = { enabled: true, allowed_actions: 'all', sha_pinning_required: false }, asf = { enabled: false, paused: false }, vulnAlerts = false, args = [], env = {}, script = applySh }) {
  const dir = mkdtempSync(join(tmpdir(), 'apply-env-'));
  const w = (f, v) => writeFileSync(join(dir, f), JSON.stringify(v));
  w('actions.json', actionsCommitted);
  w('rulesets.json', [{ id: 7, name: 'main', target: 'branch' }, { id: 8, name: 'release-tags', target: 'tag' }]);
  w('ruleset.json', liveRuleset());
  w('ruleset-8.json', { id: 8, ...structuredClone(tagsCommitted) });
  w('repo.json', { ...settings, id: 1 });
  w('labels.json', labels);
  if (user) w('user.json', user);
  w('actions-perms.json', actionsPerms);
  if (asf) w('asf.json', asf);
  if (vulnAlerts) writeFileSync(join(dir, 'va.on'), '');
  for (const [name, { env: e, policies: p }] of Object.entries(envs)) {
    if (e) w(`env-${name}.json`, e);
    if (p) w(`policies-${name}.json`, p);
  }
  const log = join(dir, 'gh.log');
  const r = spawnSync('bash', [script, '--repo', 'prix0007/cryoshield', ...args], {
    env: { ...process.env, GH: stub, GH_LOG: log, STUB_DIR: dir, ...env },
    encoding: 'utf8',
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return { ...r, dir, read, calls, writes: calls.filter((c) => / -X (POST|PUT|PATCH|DELETE)/.test(c)) };
}
const inputOf = (call) => JSON.parse(readFileSync(call.split(' --input ')[1], 'utf8'));

test('off by default: without the flags no environment, Dependabot or actions/permissions call is made', () => {
  const r = run({});
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.calls.filter((c) => /environments|users\/|automated-security-fixes|vulnerability-alerts|actions\/permissions( |$)/.test(c)), []);
  assert.match(r.stdout, /environments: skipped/);
  assert.match(r.stdout, /founder hardening: skipped/);
});

test('--environments dry run with all four environments missing: diff, exit 3, no write; no owner lookup (no "@owner" reviewer)', () => {
  const r = run({ args: ['--environments'] });
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.deepEqual(r.calls.filter((c) => c.startsWith('api users/')), []);
  assert.match(r.stdout, /environment 'production' does not exist/);
  assert.match(r.stdout, /environment 'production-build' does not exist/);
  assert.match(r.stdout, /environment 'development' does not exist/);
  assert.match(r.stdout, /environment 'development-build' does not exist/);
  assert.match(r.stdout, /\+.*"tag:v\*"/);
  assert.doesNotMatch(r.stdout, /User:30095502/);
  assert.deepEqual(r.writes, []);
});

test('--environments --apply creates both: no reviewer, no admin bypass, self-approval allowed, main only', () => {
  const r = run({ args: ['--environments', '--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /re-check: in sync/);
  const put = r.writes.find((c) => c.startsWith('api -X PUT repos/prix0007/cryoshield/environments/production '));
  assert.ok(put, r.writes.join('\n'));
  assert.deepEqual(r.read('body-PUT-production.json'), {
    wait_timer: 0,
    prevent_self_review: false,
    can_admins_bypass: false,
    reviewers: [],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  });
  const putBuild = r.writes.find((c) => c.startsWith('api -X PUT repos/prix0007/cryoshield/environments/production-build '));
  assert.ok(putBuild);
  assert.deepEqual(r.read('body-PUT-production-build.json').reviewers, []);
  for (const n of ['production', 'production-build', 'development', 'development-build']) {
    assert.ok(r.writes.includes(`api -X POST repos/prix0007/cryoshield/environments/${n}/deployment-branch-policies -f name=main -f type=branch`), n);
    assert.equal(r.read(`env-${n}.json`).can_admins_bypass, false, n);
    assert.deepEqual(r.read(`body-PUT-${n}.json`).reviewers, [], n);
  }
  // split-dev-and-release-deploys: production deploys from main (dispatch) and v* tags (release event); dev from main only.
  for (const n of ['production', 'production-build']) {
    assert.ok(r.writes.includes(`api -X POST repos/prix0007/cryoshield/environments/${n}/deployment-branch-policies -f name=v* -f type=tag`), n);
    assert.deepEqual(r.read(`policies-${n}.json`).branch_policies.map((p) => `${p.type}:${p.name}`).sort(), ['branch:main', 'tag:v*'], n);
  }
  for (const n of ['development', 'development-build']) {
    assert.deepEqual(r.read(`policies-${n}.json`).branch_policies.map((p) => `${p.type}:${p.name}`), ['branch:main'], n);
  }
});

test("today's live production (admin bypass, no reviewer, an extra branch policy) is fixed; an in-sync production-build is untouched", () => {
  const envs = inSyncEnvs();
  envs.production = { env: envLive({ name: 'production' }), policies: policies('main', 'tag:v*', 'release/*') };
  const r = run({ envs, args: ['--environments', '--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /-.*"can_admins_bypass": true/);
  assert.match(r.stdout, /-.*branch:release\/\*/);
  assert.deepEqual(r.writes.map((c) => c.split(' --input ')[0]), [
    'api -X PUT repos/prix0007/cryoshield/environments/production',
    'api -X DELETE repos/prix0007/cryoshield/environments/production/deployment-branch-policies/52',
  ]);
  assert.match(r.stdout, /environment 'production-build': in sync/);
});

test('--environments is idempotent: in sync means no write, dry run or apply', () => {
  for (const args of [['--environments'], ['--environments', '--apply']]) {
    const r = run({ envs: inSyncEnvs(), args });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /environment 'production': in sync/);
    assert.match(r.stdout, /environment 'development-build': in sync/);
    assert.deepEqual(r.writes, []);
  }
});

test('split-dev-and-release-deploys: a missing v* tag policy on production is added; a v* tag policy on development is removed', () => {
  const envs = inSyncEnvs();
  envs.production.policies = policies('main');
  envs.development.policies = policies('main', 'tag:v*');
  const r = run({ envs, args: ['--environments', '--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.writes, [
    'api -X POST repos/prix0007/cryoshield/environments/production/deployment-branch-policies -f name=v* -f type=tag',
    'api -X DELETE repos/prix0007/cryoshield/environments/development/deployment-branch-policies/51',
  ]);
  assert.match(r.stdout, /re-check: in sync/);
});

test('a wait timer, a reviewer, admin bypass or protected-branch mode are each drift on their own', () => {
  // PR #32 review: each case differs from the committed state in exactly ONE property, so each proves its own drift.
  const PROPS = {
    wait: /wait_timer/,
    reviewers: /reviewers|User:/,
    bypass: /can_admins_bypass/,
    policy: /protected_branches|custom_branch_policies/,
    branches: /branch:|tag:/,
    self: /prevent_self_review/,
  };
  const cases = {
    'wait timer': { prop: 'wait', env: envLive({ name: 'production', bypass: false, wait: 5 }), diff: /-\s+"wait_timer": 5/ },
    'a reviewer': { prop: 'reviewers', env: envLive({ name: 'production', bypass: false, reviewers: [42] }), diff: /-\s+"User:42"/ },
    'admin bypass': { prop: 'bypass', env: envLive({ name: 'production', bypass: true }), diff: /-\s+"can_admins_bypass": true/ },
    'protected branches instead of custom policies': { prop: 'policy', env: envLive({ name: 'production', bypass: false, custom: false }), diff: /-\s+"protected_branches": true/ },
  };
  for (const [what, { prop, env, diff }] of Object.entries(cases)) {
    const envs = inSyncEnvs();
    envs.production.env = env;
    const r = run({ envs, args: ['--environments'] });
    assert.equal(r.status, 3, what + r.stdout);
    assert.match(r.stdout, diff, what);
    // only production differs; the other three are in sync
    for (const n of ['production-build', 'development', 'development-build']) assert.match(r.stdout, new RegExp(`environment '${n}': in sync`), what);
    // and within production, only this one property changed
    const changed = r.stdout.split('\n').filter((l) => /^[-+]\s/.test(l)).join('\n');
    for (const [other, re] of Object.entries(PROPS)) {
      if (other !== prop) assert.doesNotMatch(changed, re, `${what}: unexpected ${other} drift\n${changed}`);
    }
  }
});

test('PR #32 review: a live required reviewer is REMOVED when environments.json has none (--apply clears it)', () => {
  const envs = inSyncEnvs();
  envs.production.env = envLive({ name: 'production', bypass: false, reviewers: [OWNER_ID] });
  const r = run({ envs, args: ['--environments', '--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /-\s+"User:30095502"/);
  assert.deepEqual(r.writes.map((c) => c.split(' --input ')[0]), ['api -X PUT repos/prix0007/cryoshield/environments/production']);
  assert.deepEqual(r.read('body-PUT-production.json').reviewers, []);
  assert.deepEqual(r.read('env-production.json').protection_rules.filter((x) => x.type === 'required_reviewers'), []);
  assert.match(r.stdout, /re-check: in sync/);
});

test('PR #32 review: the owner is looked up only when an environment names "@owner"', () => {
  // committed files: no "@owner" anywhere, so no users/ call, even when the lookup would fail
  const none = run({ user: null, args: ['--environments', '--apply'] });
  assert.equal(none.status, 0, none.stderr + none.stdout);
  assert.deepEqual(none.calls.filter((c) => c.startsWith('api users/')), []);
  // with "@owner" on production: looked up once, and resolved to the numeric user id
  const withOwner = run({ script: withOwnerReviewer(), args: ['--environments', '--apply'] });
  assert.equal(withOwner.status, 0, withOwner.stderr + withOwner.stdout);
  assert.equal(withOwner.calls.filter((c) => c.startsWith('api users/prix0007 ')).length, 1);
  assert.deepEqual(withOwner.read('body-PUT-production.json').reviewers, [{ type: 'User', id: OWNER_ID }]);
});

test('with "@owner", the owner lookup must yield a numeric User id, else nothing is written', () => {
  const script = withOwnerReviewer();
  for (const user of [null, { id: 'abc', type: 'User' }, { id: 1, type: 'Organization' }]) {
    const r = run({ script, user, args: ['--environments', '--apply'] });
    assert.notEqual(r.status, 0, JSON.stringify(user));
    assert.match(r.stderr, /owner/);
    assert.deepEqual(r.writes.filter((c) => /environments/.test(c)), []);
  }
});

test('--environments: a failing write fails the script; a write that does not stick fails the re-check', () => {
  const failing = run({ args: ['--environments', '--apply'], env: { STUB_FAIL_WRITES: '1' } });
  assert.notEqual(failing.status, 0);
  assert.doesNotMatch(failing.stdout, /^done$/m);
  const sticky = run({ args: ['--environments', '--apply'], env: { STUB_STICKY: '1' } });
  assert.notEqual(sticky.status, 0);
  assert.match(sticky.stderr, /still differs/);
});

test('--founder-hardening dry run reports SHA pinning and Dependabot security updates as drift, writes nothing', () => {
  const r = run({ args: ['--founder-hardening'] });
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.match(r.stdout, /\+.*"sha_pinning_required": true/);
  assert.match(r.stdout, /dependabot security updates: off/);
  assert.deepEqual(r.writes, []);
});

test('--founder-hardening --apply enables alerts, then security updates, then requires SHA-pinned actions; idempotent after', () => {
  const r = run({ args: ['--founder-hardening', '--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.writes.map((c) => c.split(' --input ')[0]), [
    'api -X PUT repos/prix0007/cryoshield/vulnerability-alerts',
    'api -X PUT repos/prix0007/cryoshield/automated-security-fixes',
    'api -X PUT repos/prix0007/cryoshield/actions/permissions',
  ]);
  assert.deepEqual(inputOf(r.writes[2]), { enabled: true, allowed_actions: 'all', sha_pinning_required: true });
  const again = run({ actionsPerms: { enabled: true, allowed_actions: 'all', sha_pinning_required: true }, asf: { enabled: true, paused: false }, vulnAlerts: true, args: ['--founder-hardening', '--apply'] });
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.deepEqual(again.writes, []);
  assert.match(again.stdout, /dependabot security updates: on/);
});

test('--founder-hardening: an unexpected API error (not 404) fails instead of reading as "off"', () => {
  const r = run({ args: ['--founder-hardening'], env: { STUB_FAIL_READS_PATH: 'automated-security-fixes' } });
  assert.notEqual(r.status, 0);
  assert.notEqual(r.status, 3);
});
