import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(new URL(`../../rulesets/${p}`, import.meta.url), 'utf8'));
const ruleset = load('main.json');
const rule = (type) => ruleset.rules.find((r) => r.type === type);

test('targets the default branch, active, with no bypass actors', () => {
  assert.equal(ruleset.name, 'main');
  assert.equal(ruleset.target, 'branch');
  assert.equal(ruleset.enforcement, 'active');
  assert.deepEqual(ruleset.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  assert.deepEqual(ruleset.bypass_actors, []);
});

test('blocks deletion and force-push, requires linear history', () => {
  assert.ok(rule('deletion'));
  assert.ok(rule('non_fast_forward'));
  assert.ok(rule('required_linear_history'));
});

test('requires a PR: 0 approvals, conversation resolution, squash only', () => {
  const p = rule('pull_request').parameters;
  assert.equal(p.required_approving_review_count, 0);
  assert.equal(p.required_review_thread_resolution, true);
  assert.deepEqual(p.allowed_merge_methods, ['squash']);
});

test('requires ci-ok from GitHub Actions, strict (up to date with main)', () => {
  const p = rule('required_status_checks').parameters;
  assert.equal(p.strict_required_status_checks_policy, false); // relax-strict-up-to-date
  assert.deepEqual(p.required_status_checks, [{ context: 'ci-ok', integration_id: 15368 }]);
});

test('Actions default token is read-only and Actions cannot approve PRs', () => {
  assert.deepEqual(load('actions-permissions.json'), { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false });
});

test('the opt-in ecc-review check is bound to GitHub Actions and not required by default', () => {
  assert.deepEqual(load('ecc-review-check.json'), { context: 'ecc-review', integration_id: 15368 });
  const checks = rule('required_status_checks').parameters.required_status_checks.map((c) => c.context);
  assert.deepEqual(checks, ['ci-ok']);
});

test('repo merge settings allow squash only, titled from the PR, with auto-merge', () => {
  const s = load('repo-settings.json');
  assert.equal(s.allow_auto_merge, true);
  assert.equal(s.allow_squash_merge, true);
  assert.equal(s.allow_merge_commit, false);
  assert.equal(s.allow_rebase_merge, false);
  assert.equal(s.squash_merge_commit_title, 'PR_TITLE');
  assert.equal(s.delete_branch_on_merge, true);
});

// ---- split-dev-and-release-deploys: owner-only release tags, and the four deploy environments ----
test('release-tags: tag ruleset on refs/tags/v*, blocks create/update/delete, admin role is the only bypass', () => {
  const t = load('release-tags.json');
  assert.equal(t.name, 'release-tags');
  assert.equal(t.target, 'tag');
  assert.equal(t.enforcement, 'active');
  assert.deepEqual(t.conditions.ref_name, { include: ['refs/tags/v*'], exclude: [] });
  assert.deepEqual(t.rules.map((r) => r.type).sort(), ['creation', 'deletion', 'update']);
  // RepositoryRole 5 = admin. No Write/Maintain role, no team, no app, no deploy key.
  assert.deepEqual(t.bypass_actors, [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }]);
});

test('environments: production/production-build deploy ONLY from v* tags (ECC HIGH: no branch, not even main); development/development-build from main only; no reviewers, no admin bypass', () => {
  const envs = Object.fromEntries(load('environments.json').map((e) => [e.name, e]));
  assert.deepEqual(Object.keys(envs).sort(), ['development', 'development-build', 'production', 'production-build']);
  for (const e of Object.values(envs)) {
    assert.deepEqual(e.required_reviewers, [], e.name);
    assert.equal(e.can_admins_bypass, false, e.name);
    assert.equal(e.wait_timer, 0, e.name);
    assert.deepEqual(e.branches, e.name.startsWith('production') ? [] : ['main'], e.name);
  }
  assert.deepEqual(envs.production.tags, ['v*']);
  assert.deepEqual(envs['production-build'].tags, ['v*']);
  assert.deepEqual(envs.development.tags ?? [], []);
  assert.deepEqual(envs['development-build'].tags ?? [], []);
});
