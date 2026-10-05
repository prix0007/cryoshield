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
  expectError('deploy.yml', replaceOnce(deploy, '    permissions:\n      contents: read # checkout, and main', '    env:\n      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}\n    permissions:\n      contents: read # checkout, and main'), /FLY_API_TOKEN/);
  expectError('deploy.yml', replaceOnce(deploy, 'env:\n  NODE_VERSION:', 'env:\n  FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}\n  NODE_VERSION:'), /FLY_API_TOKEN/);
  expectError('deploy.yml', replaceOnce(deploy, '        run: .github/scripts/deploy/rollback.sh\n', '        run: .github/scripts/deploy/rollback.sh "${{ secrets.FLY_API_TOKEN }}"\n'), /FLY_API_TOKEN/);
});

test('deploy.yml: jobs using secrets must run in environment production (or production-build for build config)', () => {
  const noEnv = replaceOnce(deploy, '    environment:\n      name: production\n      url: https://cryoshield.app\n', '');
  expectError('deploy.yml', noEnv, /job 'release'.*environment production/);
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

// ---- Security review (add-continuous-deploy) ----

test('H1: jobs holding FLY_API_TOKEN run no build tooling and no third-party code', () => {
  const tokenJob = parse(deploy).jobs.release;
  assert.ok(JSON.stringify(tokenJob).includes('FLY_API_TOKEN'));
  const withBuild = replaceOnce(deploy, '      - name: Deploy the built context (flyctl only)\n', '      - name: Sneaky install\n        run: pnpm install --frozen-lockfile\n      - name: Deploy the built context (flyctl only)\n');
  expectError('deploy.yml', withBuild, /job 'release'.*no node, npm, pnpm/);
  const withAction = replaceOnce(deploy, '      - name: Deploy the built context (flyctl only)\n', '      - name: Setup\n        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0\n      - name: Deploy the built context (flyctl only)\n');
  expectError('deploy.yml', withAction, /job 'release'.*actions\/setup-node/);
});

test('H1: the build job never sees the Fly token and the deploy job only ships the build artifact', () => {
  const wf = parse(deploy);
  assert.doesNotMatch(JSON.stringify(wf.jobs.build), /FLY_API_TOKEN/);
  assert.match(String(wf.jobs.build.steps.find((s) => s.id === 'build')?.run), /deploy\.sh --build-only/);
  assert.ok(wf.jobs.release.steps.some((s) => String(s.uses).startsWith('actions/download-artifact@')));
});

test('M3: environment names are case-insensitive and may not be expressions', () => {
  expectError('ci.yml', replaceOnce(ci, '  contracts:\n    name: contracts\n', '  contracts:\n    name: contracts\n    environment: Production\n'), /production/i);
  expectError('ci.yml', replaceOnce(ci, '  contracts:\n    name: contracts\n', "  contracts:\n    name: contracts\n    environment: \"${{ 'production' }}\"\n"), /expression/);
  expectError('deploy.yml', deploy.replace('    environment:\n      name: production\n', "    environment:\n      name: ${{ 'production' }}\n"), /expression/);
});

test('M3: deploy.yml allows only exact secret expressions, each in its own step', () => {
  const inject = (expr) => replaceOnce(deploy, '          VITE_RP_NAME: ${{ vars.VITE_RP_NAME }}\n', `          VITE_RP_NAME: \${{ vars.VITE_RP_NAME }}\n          X: \${{ ${expr} }}\n`);
  expectError('deploy.yml', inject("secrets[format('FLY_{0}','API_TOKEN')]"), /secret/);
  expectError('deploy.yml', inject('toJSON(secrets)'), /secret/);
  expectError('deploy.yml', inject('secrets.FLY_API_TOKEN'), /FLY_API_TOKEN/);
  const bundlerElsewhere = replaceOnce(deploy, '          PREVIOUS_IMAGE: ${{ steps.deploy.outputs.previous_image }}\n', '          PREVIOUS_IMAGE: ${{ steps.deploy.outputs.previous_image }}\n          B: ${{ secrets.VITE_BUNDLER_URL }}\n');
  expectError('deploy.yml', bundlerElsewhere, /VITE_BUNDLER_URL/);
});

test('M1/L3/ECC #2: rollback also runs when the release failed OR was cancelled after fly deploy started (same job)', () => {
  const wf = parse(deploy);
  const rollback = wf.jobs.release.steps.find((s) => s.id === 'rollback');
  assert.match(String(rollback.if), /failure\(\) \|\| cancelled\(\)/);
  assert.match(String(rollback.if), /steps\.deploy\.outputs\.fly_started == 'true'/);
});

test('ECC #1: detect treats ANY failed earlier Deploy run of the commit as previously failed', () => {
  const detectRun = String(parse(deploy).jobs.detect.steps.find((s) => s.id === 'detect').run);
  assert.match(detectRun, /--status failure/);
  assert.doesNotMatch(detectRun, /\.name == "deploy"/);
});

test('ECC #3: no || or `or` in any deploy.yml job condition', () => {
  expectError('deploy.yml', replaceOnce(deploy, "    if: github.ref == 'refs/heads/main'\n", "    if: github.ref == 'refs/heads/main' || true\n"), /job 'detect'.*\|\|/);
  expectError('deploy.yml', replaceOnce(deploy, "    if: needs.detect.outputs.deploy == 'true' && needs.config.outputs.configured == 'true'\n    uses:", "    if: needs.detect.outputs.deploy == 'true' && needs.config.outputs.configured == 'true' || true\n    uses:"), /job 'test'.*\|\|/);
});

test('ECC #4: every job with needs must be gated on needs.detect.outputs.deploy', () => {
  const ungated = replaceOnce(deploy, "    needs: [detect, build, supersede]\n    if: needs.detect.outputs.deploy == 'true'\n", "    needs: [detect, build, supersede]\n    if: always()\n");
  expectError('deploy.yml', ungated, /job 'release'.*needs\.detect\.outputs\.deploy == 'true'/);
});

test('ECC #7: token-holding jobs: every run step pinned by digest, no custom shell', () => {
  expectError('deploy.yml', replaceOnce(deploy, '          fly deploy --config fly.toml --remote-only --app cryoshield-web\n', '          fly deploy --config fly.toml --remote-only --app cryoshield-web\n          true\n'), /digest/);
  expectError('deploy.yml', replaceOnce(deploy, '        id: rollback\n', '        id: rollback\n        shell: bash -e {0}\n'), /shell/);
});

test('the privileged workflows may not use the Fly token or environment production either', () => {
  const am = real('auto-merge.yml');
  expectError('auto-merge.yml', am.replace('    runs-on: ubuntu-24.04\n', '    environment: production\n    runs-on: ubuntu-24.04\n'), /production/);
  expectError('auto-merge.yml', am.replace('      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n', '      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n      T: ${{ secrets.FLY_API_TOKEN }}\n'), /FLY_API_TOKEN/);
});

test('ci.yml: `full` (workflow_call) forces every area job and workflow-lint on', () => {
  const wf = parse(ci);
  assert.equal(wf.on.workflow_call.inputs.full.type, 'boolean');
  const forced = Object.entries(wf.jobs).filter(([id]) => !['changes', 'pr-checks', 'ci-ok'].includes(id));
  assert.ok(forced.length >= 7);
  for (const [id, job] of forced) assert.match(String(job.if), /inputs\.full \|\|/, id);
  assert.match(String(wf.concurrency.group), /github\.workflow/);
});

test('zizmor: the only other accepted ignore is self-repository on deploy.yml, pinned to THE reusable-CI line (ECC #8)', () => {
  const base = 'rules:\n  unpinned-uses:\n    config:\n      policies:\n        "*": hash-pin\n';
  assert.deepEqual(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - deploy.yml:74\n`), []);
  assert.deepEqual(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - deploy.yml:74\n`, { selfRepositoryLine: 74 }), []);
  assert.match(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - deploy.yml:12\n`, { selfRepositoryLine: 74 }).join(), /deploy\.yml:74/);
  const line = deploy.split('\n').findIndex((l) => /^\s*uses: \.\/\.github\/workflows\/ci\.yml\b/.test(l)) + 1;
  assert.deepEqual(checkZizmorConfig(readFileSync(new URL('../../zizmor.yml', import.meta.url), 'utf8'), { selfRepositoryLine: line }), []);
  assert.match(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - ci.yml:74\n`).join(), /self-repository/);
  assert.match(checkZizmorConfig(`${base}  self-repository:\n    ignore:\n      - deploy.yml\n`).join(), /self-repository/);
  assert.deepEqual(checkZizmorConfig(readFileSync(new URL('../../zizmor.yml', import.meta.url), 'utf8')), []);
});
