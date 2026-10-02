import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkTitle } from '../pr-title.mjs';

const valid = [
  'feat(web): add key enrolment screen',
  'fix(recover): handle empty log page',
  'fix!: drop v0 vault format',
  'feat(vault-crypto)!: bind vault id to ciphertext',
  'chore(deps): bump the npm group with 3 updates',
  'ci: bump the github-actions group with 2 updates',
  'docs(openspec): archive add-ci',
  'revert: feat(web): add key enrolment screen',
  'build(deps-dev): bump vite from 8.3.1 to 8.3.2',
  'test(contracts/registry): add invariant',
];

const invalid = [
  ['Update stuff', /Conventional Commits/],
  ['feat:no space', /Conventional Commits/],
  ['feature(web): wrong type', /Conventional Commits/],
  ['Feat(web): capital type', /Conventional Commits/],
  ['feat(Web): capital scope', /Conventional Commits/],
  ['feat(): empty scope', /Conventional Commits/],
  ['feat(web):  ', /Conventional Commits/],
  ['', /empty/],
  [`feat(web): ${'x'.repeat(100)}`, /100 characters/],
  ['fix(web): ok\nsecond line', /single line/],
];

for (const title of valid) {
  test(`accepts: ${title}`, () => assert.deepEqual(checkTitle(title), { ok: true }));
}

for (const [title, why] of invalid) {
  test(`rejects: ${JSON.stringify(title.slice(0, 40))}`, () => {
    const r = checkTitle(title);
    assert.equal(r.ok, false);
    assert.match(r.message, why);
  });
}

test('CLI reads PR_TITLE from the environment and sets the exit code', () => {
  const script = fileURLToPath(new URL('../pr-title.mjs', import.meta.url));
  const ok = spawnSync(process.execPath, [script], { env: { PR_TITLE: 'ci: add pr-checks' }, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const bad = spawnSync(process.execPath, [script], { env: { PR_TITLE: 'Update stuff' }, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Conventional Commits/);
  const unset = spawnSync(process.execPath, [script], { env: {}, encoding: 'utf8' });
  assert.equal(unset.status, 1);
});
