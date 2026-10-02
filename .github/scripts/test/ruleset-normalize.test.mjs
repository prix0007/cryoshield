import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, projectOnto } from '../ruleset-normalize.mjs';

const desired = {
  name: 'main',
  enforcement: 'active',
  bypass_actors: [],
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
  rules: [
    { type: 'non_fast_forward' },
    { type: 'deletion' },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [{ context: 'ci-ok', integration_id: 15368 }],
      },
    },
  ],
};

// Shape of GET /repos/{o}/{r}/rulesets/{id}: extra metadata, server defaults, different rule order.
const live = {
  id: 42,
  name: 'main',
  target: 'branch',
  source_type: 'Repository',
  enforcement: 'active',
  bypass_actors: [],
  conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
  rules: [
    { type: 'deletion' },
    {
      type: 'required_status_checks',
      parameters: {
        do_not_enforce_on_create: false,
        required_status_checks: [{ integration_id: 15368, context: 'ci-ok' }],
        strict_required_status_checks_policy: true,
      },
    },
    { type: 'non_fast_forward' },
  ],
  _links: { self: { href: 'x' } },
  created_at: '2026-10-02T00:00:00Z',
};

const same = (a, b) => assert.equal(JSON.stringify(canonical(a)), JSON.stringify(canonical(b)));
const differ = (a, b) => assert.notEqual(JSON.stringify(canonical(a)), JSON.stringify(canonical(b)));

test('matching live ruleset projects to the desired one (metadata, defaults and order ignored)', () => {
  same(projectOnto(live, desired), desired);
});

test('a changed parameter is a difference', () => {
  const l = structuredClone(live);
  l.rules[1].parameters.strict_required_status_checks_policy = false;
  differ(projectOnto(l, desired), desired);
});

test('an extra live rule not in the committed file is a difference', () => {
  const l = structuredClone(live);
  l.rules.push({ type: 'creation' });
  differ(projectOnto(l, desired), desired);
});

test('a missing live rule is a difference', () => {
  const l = structuredClone(live);
  l.rules = l.rules.filter((r) => r.type !== 'deletion');
  differ(projectOnto(l, desired), desired);
});

test('a live bypass actor is a difference', () => {
  const l = structuredClone(live);
  l.bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }];
  differ(projectOnto(l, desired), desired);
});

test('a different status-check integration id is a difference', () => {
  const l = structuredClone(live);
  l.rules[1].parameters.required_status_checks[0].integration_id = 1;
  differ(projectOnto(l, desired), desired);
});

test('canonical sorts keys and order-insensitive arrays', () => {
  assert.deepEqual(
    JSON.stringify(canonical({ b: 1, a: ['squash', 'merge'] })),
    JSON.stringify({ a: ['merge', 'squash'], b: 1 }),
  );
});

test('flat objects (repo settings) project onto declared keys only', () => {
  const want = { allow_squash_merge: true, allow_merge_commit: false };
  same(projectOnto({ allow_squash_merge: true, allow_merge_commit: false, private: true, id: 9 }, want), want);
  differ(projectOnto({ allow_squash_merge: true, allow_merge_commit: true }, want), want);
});
