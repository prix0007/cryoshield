// add-continuous-deploy: the deploy workflow's restrictions (spec ci-pipeline "Deployment workflow restrictions")
// and the reusable full CI (spec ci-pipeline "Reusable full CI run"). Mutates the real files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { checkWorkflow, checkZizmorConfig } from '../workflow-policy.mjs';

const real = (name) => readFileSync(new URL(`../../workflows/${name}`, import.meta.url), 'utf8');
const deploy = real('deploy.yml');
const ci = real('ci.yml');
const errs = (file, text) => checkWorkflow(`workflows/${file}`, text);
const expectError = (file, text, re) => {
  const e = errs(file, text);
  assert.ok(e.some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(e, null, 1)}`);
};
const replaceOnce = (text, from, to) => {
  assert.ok(text.includes(from), `fixture drift: ${JSON.stringify(from)} not found`);
  return text.replace(from, to);
};

test('the committed deploy.yml and ci.yml pass', () => {
  assert.deepEqual(errs('deploy.yml', deploy), []);
  assert.deepEqual(errs('ci.yml', ci), []);
});

test('deploy.yml: no pull_request trigger of any kind, push only to main', () => {
  expectError('deploy.yml', replaceOnce(deploy, 'on:\n  push:\n', 'on:\n  pull_request:\n  push:\n'), /deploy\.yml.*trigger 'pull_request'/);
  expectError('deploy.yml', replaceOnce(deploy, '    branches: [main]\n', '    branches: [main, "release/*"]\n'), /push.*main/);
  expectError('deploy.yml', replaceOnce(deploy, 'on:\n  push:\n', 'on:\n  workflow_call:\n  push:\n'), /trigger 'workflow_call'/);
});

test('deploy.yml: the first job only runs on refs/heads/main', () => {
  expectError('deploy.yml', replaceOnce(deploy, "    if: github.ref == 'refs/heads/main'\n", ''), /job 'detect'.*refs\/heads\/main/);
});

test('deploy.yml: FLY_API_TOKEN only in the step-level env of steps `deploy` and `rollback`', () => {
  expectError('deploy.yml', replaceOnce(deploy, '          VITE_RP_NAME: ${{ vars.VITE_RP_NAME }}\n', '          VITE_RP_NAME: ${{ vars.VITE_RP_NAME }}\n          T: ${{ secrets.FLY_API_TOKEN }}\n'), /FLY_API_TOKEN/);
  expectError('deploy.yml', replaceOnce(deploy, '    outputs:\n      previous_image:', '    env:\n      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}\n    outputs:\n      previous_image:'), /FLY_API_TOKEN/);
  expectError('deploy.yml', replaceOnce(deploy, 'env:\n  NODE_VERSION:', 'env:\n  FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}\n  NODE_VERSION:'), /FLY_API_TOKEN/);
  expectError('deploy.yml', replaceOnce(deploy, '        run: .github/scripts/deploy/rollback.sh\n', '        run: .github/scripts/deploy/rollback.sh "${{ secrets.FLY_API_TOKEN }}"\n'), /FLY_API_TOKEN/);
});

test('deploy.yml: jobs using secrets must run in environment production', () => {
  const noEnv = replaceOnce(deploy, '    environment:\n      name: production\n      url: https://cryoshield.app\n    permissions:\n      contents: read # checkout only\n    outputs:', '    permissions:\n      contents: read # checkout only\n    outputs:');
  expectError('deploy.yml', noEnv, /job 'deploy'.*environment production/);
  expectError('deploy.yml', deploy.replaceAll('      name: production\n', '      name: staging\n'), /environment.*production/);
});

test('deploy.yml: never secrets: inherit; concurrency deploy-production and never cancelled', () => {
  expectError('deploy.yml', replaceOnce(deploy, '    with:\n      full: true\n', '    with:\n      full: true\n    secrets: inherit\n'), /secrets/);
  expectError('deploy.yml', replaceOnce(deploy, '  cancel-in-progress: false\n', '  cancel-in-progress: true\n'), /concurrency/);
  expectError('deploy.yml', replaceOnce(deploy, '  group: deploy-production\n', '  group: deploy-${{ github.sha }}\n'), /concurrency/);
});

test('deploy.yml: write scopes are refused like everywhere else', () => {
  expectError('deploy.yml', replaceOnce(deploy, '      contents: read # read main\'s HEAD and the detect script\n', '      contents: write\n'), /write/);
});

test('no other workflow may use FLY_API_TOKEN or environment production', () => {
  const withToken = replaceOnce(ci, '      - name: forge build\n', '      - name: forge build\n        env:\n          T: ${{ secrets.FLY_API_TOKEN }}\n');
  expectError('ci.yml', withToken, /FLY_API_TOKEN/);
  const withEnv = replaceOnce(ci, '  contracts:\n    name: contracts\n', '  contracts:\n    name: contracts\n    environment: production\n');
  expectError('ci.yml', withEnv, /production/);
  expectError('nightly.yml', deploy.replace('name: Deploy', 'name: Nightly'), /only deploy\.yml/);
});

test('ci.yml: `full` (workflow_call) forces every area job and workflow-lint on', () => {
  const wf = parse(ci);
  assert.equal(wf.on.workflow_call.inputs.full.type, 'boolean');
  const forced = Object.entries(wf.jobs).filter(([id]) => !['changes', 'pr-checks', 'ci-ok'].includes(id));
  assert.ok(forced.length >= 7);
  for (const [id, job] of forced) assert.match(String(job.if), /inputs\.full \|\|/, id);
  assert.match(String(wf.concurrency.group), /github\.workflow/);
});

test('zizmor: the only other accepted ignore is self-repository on deploy.yml, pinned to a line', () => {
  const base = 'rules:\n  unpinned-uses:\n    config:\n      policies:\n        "*": hash-pin\n';
  assert.deepEqual(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - deploy.yml:74\n`), []);
  assert.match(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - ci.yml:74\n`).join(), /self-repository/);
  assert.match(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - deploy.yml\n`).join(), /self-repository/);
  assert.deepEqual(checkZizmorConfig(readFileSync(new URL('../../zizmor.yml', import.meta.url), 'utf8')), []);
});
