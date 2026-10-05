// gate-production-deploys task 3.1, remove-production-approval-gate: apply.sh --environments (production with no required
// reviewer and no admin bypass; production-build; both main-only) and --founder-hardening (Dependabot security updates, SHA-pinned actions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const applySh = fileURLToPath(new URL('../../rulesets/apply.sh', import.meta.url));
const stub = fileURLToPath(new URL('./fixtures/gh-stub.sh', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(new URL(`../../rulesets/${p}`, import.meta.url), 'utf8'));
const committed = readJson('main.json');
const settings = readJson('repo-settings.json');
const actionsCommitted = readJson('actions-permissions.json');
const labels = readJson('labels.json').map((l) => ({ name: l.name }));
const OWNER_ID = 30095502;

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
const policies = (...names) => ({ total_count: names.length, branch_policies: names.map((n, i) => ({ id: 50 + i, name: n, type: 'branch' })) });
const inSyncEnvs = () => ({
  production: { env: envLive({ name: 'production', bypass: false }), policies: policies('main') },
  'production-build': { env: envLive({ name: 'production-build', bypass: false }), policies: policies('main') },
});

function run({ envs = {}, user = { id: OWNER_ID, login: 'prix0007', type: 'User' }, actionsPerms = { enabled: true, allowed_actions: 'all', sha_pinning_required: false }, asf = { enabled: false, paused: false }, vulnAlerts = false, args = [], env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'apply-env-'));
  const w = (f, v) => writeFileSync(join(dir, f), JSON.stringify(v));
  w('actions.json', actionsCommitted);
  w('rulesets.json', [{ id: 7, name: 'main', target: 'branch' }]);
  w('ruleset.json', liveRuleset());
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
  const r = spawnSync('bash', [applySh, '--repo', 'prix0007/cryoshield', ...args], {
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

test('--environments dry run with both environments missing: diff, exit 3, no write; owner id from users/<owner>', () => {
  const r = run({ args: ['--environments'] });
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.ok(r.calls.some((c) => c.startsWith('api users/prix0007 ')), r.calls.join('\n'));
  assert.match(r.stdout, /environment 'production' does not exist/);
  assert.match(r.stdout, /environment 'production-build' does not exist/);
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
  for (const n of ['production', 'production-build']) {
    assert.ok(r.writes.includes(`api -X POST repos/prix0007/cryoshield/environments/${n}/deployment-branch-policies -f name=main -f type=branch`), n);
    assert.deepEqual(r.read(`policies-${n}.json`).branch_policies.map((p) => p.name), ['main']);
  }
  assert.equal(r.read('env-production.json').can_admins_bypass, false);
});

test("today's live production (admin bypass, no reviewer, an extra branch policy) is fixed; an in-sync production-build is untouched", () => {
  const envs = inSyncEnvs();
  envs.production = { env: envLive({ name: 'production' }), policies: policies('main', 'release/*') };
  const r = run({ envs, args: ['--environments', '--apply'] });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /-.*"can_admins_bypass": true/);
  assert.match(r.stdout, /-.*branch:release\/\*/);
  assert.deepEqual(r.writes.map((c) => c.split(' --input ')[0]), [
    'api -X PUT repos/prix0007/cryoshield/environments/production',
    'api -X DELETE repos/prix0007/cryoshield/environments/production/deployment-branch-policies/51',
  ]);
  assert.match(r.stdout, /environment 'production-build': in sync/);
});

test('--environments is idempotent: in sync means no write, dry run or apply', () => {
  for (const args of [['--environments'], ['--environments', '--apply']]) {
    const r = run({ envs: inSyncEnvs(), args });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /environment 'production': in sync/);
    assert.deepEqual(r.writes, []);
  }
});

test('a wait timer, self-review prevention or a second reviewer are drift', () => {
  for (const env of [
    envLive({ name: 'production', reviewers: [OWNER_ID], bypass: false, wait: 5 }),
    envLive({ name: 'production', reviewers: [OWNER_ID], bypass: false, selfReview: true }),
    envLive({ name: 'production', reviewers: [OWNER_ID, 42], bypass: false }),
    envLive({ name: 'production', reviewers: [OWNER_ID], bypass: false, custom: false }),
  ]) {
    const envs = inSyncEnvs();
    envs.production.env = env;
    const r = run({ envs, args: ['--environments'] });
    assert.equal(r.status, 3, JSON.stringify(env) + r.stdout);
  }
});

test('the owner lookup must yield a numeric User id, else nothing is written', () => {
  for (const user of [null, { id: 'abc', type: 'User' }, { id: 1, type: 'Organization' }]) {
    const r = run({ user, args: ['--environments', '--apply'] });
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
