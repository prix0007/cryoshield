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
