// gate-production-deploys: one approved `production` job per release (deploy + smoke + rollback), build config in
// `production-build`, per-commit workflow concurrency, job-level deploy-production, supersede-only actions: write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { checkWorkflow } from '../workflow-policy.mjs';

const real = (name) => readFileSync(new URL(`../../workflows/${name}`, import.meta.url), 'utf8');
const deploy = real('deploy.yml');
const wf = parse(deploy);
const errs = (file, text) => checkWorkflow(`workflows/${file}`, text);
const expectError = (file, text, re) => {
  const e = errs(file, text);
  assert.ok(e.some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(e, null, 1)}`);
};
const replaceOnce = (text, from, to) => {
  assert.ok(text.includes(from), `fixture drift: ${JSON.stringify(from)} not found`);
  return text.replace(from, to);
};
const envOf = (j) => String((typeof j.environment === 'object' ? j.environment?.name : j.environment) ?? '');

test('structure: exactly one production job (release), holding the token; build in production-build without it', () => {
  const prodJobs = Object.entries(wf.jobs).filter(([, j]) => envOf(j) === 'production').map(([id]) => id);
  assert.deepEqual(prodJobs, ['release']);
  assert.equal(envOf(wf.jobs.build), 'production-build');
  assert.doesNotMatch(JSON.stringify(wf.jobs.build), /FLY_API_TOKEN/);
  for (const [id, j] of Object.entries(wf.jobs)) {
    if (id !== 'release') assert.doesNotMatch(JSON.stringify(j), /FLY_API_TOKEN/, id);
  }
});

test('structure: release deploys, smoke-tests and rolls back (on failure or cancellation) in one approved job', () => {
  const ids = wf.jobs.release.steps.map((s) => s.id).filter(Boolean);
  assert.deepEqual(ids, ['head-check', 'deploy', 'smoke', 'rollback']);
  const rollback = wf.jobs.release.steps.find((s) => s.id === 'rollback');
  assert.match(String(rollback.if), /failure\(\) \|\| cancelled\(\)/);
  assert.match(String(rollback.if), /steps\.deploy\.outputs\.fly_started == 'true'/);
  assert.deepEqual(wf.jobs.release.needs, ['detect', 'build', 'supersede']);
  assert.equal(wf.jobs.smoke, undefined);
  assert.equal(wf.jobs.deploy, undefined);
});

test('structure: per-commit workflow concurrency; deploy-production only on release, never cancelled', () => {
  assert.deepEqual(wf.concurrency, { group: 'deploy-${{ github.sha }}', 'cancel-in-progress': false });
  assert.deepEqual(wf.jobs.release.concurrency, { group: 'deploy-production', 'cancel-in-progress': false });
});

test('the committed deploy.yml passes the policy', () => {
  assert.deepEqual(errs('deploy.yml', deploy), []);
});

test('policy: a second production job is refused (it would need a second approval)', () => {
  expectError('deploy.yml', replaceOnce(deploy, '      name: production-build # build config only; never the Fly token; no approval needed\n', '      name: production\n'), /production/);
});

test('policy: the token outside a production job, or a production job without the token, is refused', () => {
  const tokenInBuild = replaceOnce(deploy, '          VITE_RP_NAME: ${{ vars.VITE_RP_NAME }}\n', '          VITE_RP_NAME: ${{ vars.VITE_RP_NAME }}\n          T: ${{ secrets.FLY_API_TOKEN }}\n');
  expectError('deploy.yml', tokenInBuild, /FLY_API_TOKEN/);
  const supersedeProd = replaceOnce(deploy, '    permissions:\n      contents: read # the supersede script\n', '    environment: production\n    permissions:\n      contents: read # the supersede script\n');
  expectError('deploy.yml', supersedeProd, /production/);
});

test('policy: the release job must keep job-level deploy-production concurrency, never cancelled', () => {
  expectError('deploy.yml', replaceOnce(deploy, '    concurrency:\n      group: deploy-production\n      cancel-in-progress: false\n', ''), /deploy-production/);
  expectError('deploy.yml', replaceOnce(deploy, '      group: deploy-production\n      cancel-in-progress: false\n', '      group: deploy-production\n      cancel-in-progress: true\n'), /deploy-production/);
});

test('policy: workflow concurrency is per commit and never cancelled', () => {
  expectError('deploy.yml', replaceOnce(deploy, '  group: deploy-${{ github.sha }}\n', '  group: deploy-all\n'), /concurrency/);
});

test('policy: only supersede may have actions: write; it holds no secrets', () => {
  expectError('deploy.yml', replaceOnce(deploy, '      actions: read # earlier Deploy runs', '      actions: write # earlier Deploy runs'), /job 'detect'.*actions: write/);
  expectError('deploy.yml', replaceOnce(deploy, '          GH_TOKEN: ${{ github.token }}\n          REPO:', '          GH_TOKEN: ${{ secrets.FLY_API_TOKEN }}\n          REPO:'), /FLY_API_TOKEN|secret/);
  assert.equal(wf.jobs.supersede.permissions.actions, 'write');
});

test('security review M1: the release refuses to deploy a commit that is no longer main HEAD (checked after approval)', () => {
  const steps = wf.jobs.release.steps;
  const idx = (id) => steps.findIndex((s) => s.id === id);
  assert.ok(idx('head-check') >= 0, 'head-check step missing');
  assert.ok(idx('head-check') < idx('deploy'));
  const head = steps[idx('head-check')];
  assert.match(String(head.run), /commits\/main/);
  assert.equal(head.env.GH_TOKEN, '${{ github.token }}');
  assert.doesNotMatch(JSON.stringify(head), /secrets\./);
});

test('security review H1: before the approval, a no-secret job summarises the diff against the live commit', () => {
  const steps = wf.jobs.supersede.steps;
  const diff = steps.findIndex((s) => /release-diff\.sh/.test(String(s.run)));
  const sup = steps.findIndex((s) => /supersede\.sh/.test(String(s.run)));
  assert.ok(diff >= 0 && diff < sup, 'release-diff.sh must run before supersede.sh');
  assert.doesNotMatch(JSON.stringify(wf.jobs.supersede), /secrets\./);
});

test('policy: no other workflow may use production-build either', () => {
  const ci = real('ci.yml');
  expectError('ci.yml', replaceOnce(ci, '  contracts:\n    name: contracts\n', '  contracts:\n    name: contracts\n    environment: production-build\n'), /production-build/);
});
