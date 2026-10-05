// split-dev-and-release-deploys: what differs between the two targets.
//   deploy.yml      production: published v* release or owner dispatch with `tag`; tag reachable from main; no polling.
//   deploy-dev.yml  development: every main commit (push, 15-minute schedule, dispatch) to https://cryoshield-web-dev.fly.dev.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { checkWorkflow } from '../workflow-policy.mjs';

const real = (name) => readFileSync(new URL(`../../workflows/${name}`, import.meta.url), 'utf8');
const prodText = real('deploy.yml');
const devText = real('deploy-dev.yml');
const prod = parse(prodText);
const dev = parse(devText);
const errs = (file, text) => checkWorkflow(`workflows/${file}`, text);
const expectError = (file, text, re) => {
  const e = errs(file, text);
  assert.ok(e.some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(e, null, 1)}`);
};
const replaceOnce = (text, from, to) => {
  assert.ok(text.includes(from), `fixture drift: ${JSON.stringify(from)} not found`);
  return text.replace(from, to);
};
const step = (wf, job, id) => wf.jobs[job].steps.find((s) => s.id === id);

const OWNER = 'github.triggering_actor == github.repository_owner';
const REF_GATE = "startsWith(github.ref, 'refs/tags/v')";

// ---- production ----
test('production: triggers are exactly release (published) and workflow_dispatch WITHOUT inputs (the tag is the run ref)', () => {
  assert.deepEqual(Object.keys(prod.on).sort(), ['release', 'workflow_dispatch']);
  assert.deepEqual(prod.on.release, { types: ['published'] });
  assert.equal(prod.on.workflow_dispatch, null);
  const withInput = replaceOnce(prodText, '  workflow_dispatch: # run it AT the tag', '  workflow_dispatch:\n    inputs:\n      tag:\n        type: string\n  # run it AT the tag');
  expectError('deploy.yml', withInput, /workflow_dispatch may not take inputs/);
});

test('ECC HIGH: production never runs from a branch: the gate is the v* tag ref for both events; no workflow-level concurrency', () => {
  // the old "dispatch from main" alternative is refused (it does not include the tag-ref conjunct)
  const mainPath = replaceOnce(prodText, `${OWNER} && ${REF_GATE}`, `${OWNER} && ((github.event_name == 'release' && ${REF_GATE}) || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'))`);
  expectError('deploy.yml', mainPath, /refs\/tags\/v/);
  assert.equal(prod.concurrency, undefined);
  const grouped = replaceOnce(prodText, 'permissions:\n  contents: read\n', 'permissions:\n  contents: read\n\nconcurrency:\n  group: deploy-release-${{ github.ref_name }}\n  cancel-in-progress: false\n');
  expectError('deploy.yml', grouped, /no workflow-level concurrency/);
  assert.doesNotMatch(prodText, /inputs\.|refs\/heads\/main/);
  // job groups before the release are per run, so a stranger's run cannot hold or replace them
  for (const id of ['detect', 'config', 'build']) assert.match(String(prod.jobs[id].concurrency.group), /\$\{\{ github\.run_id \}\}$/, id);
  const shared = replaceOnce(prodText, '      group: deploy-production-detect-${{ github.run_id }}\n', '      group: deploy-production-detect\n');
  expectError('deploy.yml', shared, /job 'detect': only the release job may share a concurrency group/);
});

test('production: push, schedule or other release types are refused (releases are not polled)', () => {
  expectError('deploy.yml', replaceOnce(prodText, 'on:\n  release:\n', 'on:\n  push:\n    branches: [main]\n  release:\n'), /trigger 'push'/);
  expectError('deploy.yml', replaceOnce(prodText, 'on:\n  release:\n', 'on:\n  schedule:\n    - cron: "*/15 * * * *"\n  release:\n'), /trigger 'schedule'/);
  expectError('deploy.yml', replaceOnce(prodText, '    types: [published]\n', '    types: [published, edited]\n'), /types/);
  expectError('deploy.yml', replaceOnce(prodText, '    types: [published]\n', '    types: [created]\n'), /types/);
});

test('ECC M-case: a status function in any case is refused in the first job of either workflow', () => {
  for (const fn of ['ALWAYS()', 'Always()', 'always()']) {
    expectError('deploy.yml', replaceOnce(prodText, `    if: ${OWNER} && `, `    if: ${fn} && ${OWNER} && `), /job 'detect'.*always\(\)/);
    expectError('deploy-dev.yml', replaceOnce(devText, "    if: github.ref == 'refs/heads/main'\n", `    if: ${fn} && github.ref == 'refs/heads/main'\n`), /job 'detect'.*always\(\)/);
  }
});

test('production: the first job requires the owner AND the v* tag ref', () => {
  const cond = String(prod.jobs.detect.if);
  assert.ok(cond.includes(OWNER), cond);
  assert.ok(cond.includes(REF_GATE), cond);
  expectError('deploy.yml', replaceOnce(prodText, `${OWNER} && `, ''), /triggering_actor/);
  expectError('deploy.yml', replaceOnce(prodText, ` && ${REF_GATE}`, ''), /refs\/tags\/v/);
  expectError('deploy.yml', replaceOnce(prodText, `${OWNER} && `, `${OWNER} || `), /\|\|/);
});

test('production: detect resolves the tag (release-ref.sh) before config, CI or build, and summarises the diff', () => {
  const d = step(prod, 'detect', 'detect');
  assert.match(String(d.run), /release-ref\.sh/);
  // the tag is the run's own ref, and must point at the run's own commit (release event or dispatch alike)
  assert.equal(d.env.TAG, '${{ github.ref_name }}');
  assert.equal(d.env.EXPECT_SHA, '${{ github.sha }}');
  assert.equal(d.env.GH_TOKEN, '${{ github.token }}');
  assert.deepEqual(prod.jobs.detect.outputs, { deploy: '${{ steps.detect.outputs.deploy }}', sha: '${{ steps.detect.outputs.sha }}', tag: '${{ steps.detect.outputs.tag }}' });
  const steps = prod.jobs.detect.steps;
  assert.ok(steps.findIndex((s) => /release-diff\.sh/.test(String(s.run))) > steps.findIndex((s) => s.id === 'detect'));
  for (const id of ['config', 'test', 'build', 'release']) assert.ok([].concat(prod.jobs[id].needs).includes('detect'), id);
});

test('production: the full CI runs on the run\'s own (tagged) commit, then build and release use it', () => {
  assert.deepEqual(prod.jobs.test.with, { full: true });
  assert.equal(prod.jobs.build.steps.find((s) => String(s.uses).startsWith('actions/checkout@')).with.ref, '${{ needs.detect.outputs.sha }}');
  assert.deepEqual(prod.jobs.release.needs, ['detect', 'build']);
});

test('production: the release re-checks the tag and main reachability, not main HEAD (tag-check)', () => {
  const tc = step(prod, 'release', 'tag-check');
  assert.match(String(tc.run), /release-ref\.sh/);
  assert.doesNotMatch(String(tc.run), /commits\/main/);
  assert.equal(tc.env.TAG, '${{ needs.detect.outputs.tag }}');
  assert.equal(tc.env.EXPECT_SHA, '${{ needs.detect.outputs.sha }}');
  assert.equal(tc.env.GH_TOKEN, '${{ github.token }}');
  assert.equal(step(prod, 'release', 'head-check'), undefined);
  // the script must come from the checked-out commit, so checkout precedes it
  const steps = prod.jobs.release.steps;
  assert.ok(steps.findIndex((s) => String(s.uses).startsWith('actions/checkout@')) < steps.findIndex((s) => s.id === 'tag-check'));
});

test('production: site, app and config; smoke expects NO noindex; chain is not hardcoded', () => {
  assert.equal(prod.env.SITE_URL, 'https://cryoshield.app');
  assert.equal(prod.env.FLY_APP, 'cryoshield-web');
  assert.equal(prod.env.FLY_CONFIG, 'fly.toml');
  assert.equal(prod.jobs.release.environment.url, 'https://cryoshield.app');
  assert.equal(step(prod, 'release', 'smoke').env.EXPECT_NOINDEX, 'false');
  assert.doesNotMatch(prodText, /11155420|VITE_CHAIN_ID: "?\d/);
});

// ---- development ----
test('development: push to main, the 15-minute schedule and dispatch; first job only on main', () => {
  assert.deepEqual(Object.keys(dev.on).sort(), ['push', 'schedule', 'workflow_dispatch']);
  assert.deepEqual(dev.on.push.branches, ['main']);
  assert.deepEqual(dev.on.schedule, [{ cron: '*/15 * * * *' }]);
  assert.match(String(dev.jobs.detect.if), /github\.ref == 'refs\/heads\/main'/);
  expectError('deploy-dev.yml', replaceOnce(devText, "    if: github.ref == 'refs/heads/main'\n", ''), /job 'detect'.*refs\/heads\/main/);
  expectError('deploy-dev.yml', replaceOnce(devText, '    branches: [main]\n', '    branches: [main, "release/*"]\n'), /push.*main/);
  expectError('deploy-dev.yml', replaceOnce(devText, 'on:\n  push:\n', 'on:\n  release:\n    types: [published]\n  push:\n'), /trigger 'release'/);
});

test('development: detect compares the dev site with main and counts only failed deploy-dev.yml runs', () => {
  const run = String(step(dev, 'detect', 'detect').run);
  assert.match(run, /--workflow deploy-dev\.yml/);
  assert.match(run, /--status failure/);
  assert.equal(step(dev, 'detect', 'detect').env.BASE_URL, '${{ env.SITE_URL }}');
  assert.deepEqual(dev.jobs.test.with, { full: true });
});

test('development: a release that is no longer main HEAD is skipped green with a notice, right before fly deploy (ECC L1)', () => {
  const hc = step(dev, 'release', 'head-check');
  assert.match(String(hc.run), /commits\/main/);
  assert.match(String(hc.run), /::notice title=Superseded::/);
  assert.match(String(hc.run), /current=false/);
  assert.doesNotMatch(String(hc.run), /exit 1|::error/);
  assert.equal(hc.env.GH_TOKEN, '${{ github.token }}');
  assert.deepEqual(dev.jobs.release.needs, ['detect', 'build']);
  const steps = dev.jobs.release.steps;
  assert.equal(steps.findIndex((s) => s.id === 'head-check'), steps.findIndex((s) => s.id === 'deploy') - 1);
  for (const id of ['deploy', 'smoke']) assert.equal(step(dev, 'release', id).if, "steps.head-check.outputs.current == 'true'", id);
  assert.equal(steps.find((s) => s.name === 'Record the release in the job summary').if, "steps.head-check.outputs.current == 'true'");
  expectError('deploy-dev.yml', replaceOnce(devText, "        id: deploy\n        if: steps.head-check.outputs.current == 'true'\n", '        id: deploy\n'), /deploy step's condition/);
  // production fails hard instead (a moved tag is never "superseded"), and its deploy step has no condition
  assert.equal(step(prod, 'release', 'deploy').if, undefined);
  const psteps = prod.jobs.release.steps;
  assert.equal(psteps.findIndex((s) => s.id === 'tag-check'), psteps.findIndex((s) => s.id === 'deploy') - 1);
});

test('development: never references the analytics beacon token (ECC M2)', () => {
  assert.doesNotMatch(devText, /VITE_CF_BEACON_TOKEN/);
  const web = step(dev, 'build', 'web-env');
  assert.equal(web.env.BUILD_ENVIRONMENT, 'development-build');
  expectError('deploy-dev.yml', replaceOnce(devText, '          BUILD_ENVIRONMENT: development-build\n        run: .github/scripts/deploy/write-env.sh', '          VITE_CF_BEACON_TOKEN: ${{ vars.VITE_CF_BEACON_TOKEN }}\n          BUILD_ENVIRONMENT: development-build\n        run: .github/scripts/deploy/write-env.sh'), /VITE_CF_BEACON_TOKEN/);
  // production keeps its optional beacon
  assert.equal(step(prod, 'build', 'web-env').env.VITE_CF_BEACON_TOKEN, '${{ vars.VITE_CF_BEACON_TOKEN }}');
  assert.equal(step(prod, 'build', 'web-env').env.BUILD_ENVIRONMENT, 'production-build');
});

test('development: dev site, dev app and fly.dev.toml; smoke expects noindex; per-commit concurrency', () => {
  assert.equal(dev.env.SITE_URL, 'https://cryoshield-web-dev.fly.dev');
  assert.equal(dev.env.FLY_APP, 'cryoshield-web-dev');
  assert.equal(dev.env.FLY_CONFIG, 'fly.dev.toml');
  assert.equal(dev.jobs.release.environment.url, 'https://cryoshield-web-dev.fly.dev');
  assert.equal(step(dev, 'release', 'smoke').env.EXPECT_NOINDEX, 'true');
  assert.deepEqual(dev.concurrency, { group: 'deploy-dev-${{ github.sha }}', 'cancel-in-progress': false });
  const sparse = String(dev.jobs.release.steps.find((s) => String(s.uses).startsWith('actions/checkout@')).with['sparse-checkout']);
  assert.match(sparse, /apps\/web\/fly\.dev\.toml/);
});

test('development: the token is checked as the development environment, the build config as development-build', () => {
  assert.equal(step(dev, 'release', 'deploy').env.DEPLOY_ENVIRONMENT, 'development');
  assert.equal(step(prod, 'release', 'deploy').env.DEPLOY_ENVIRONMENT, 'production');
  assert.equal(step(dev, 'config', 'config').env.BUILD_ENVIRONMENT, 'development-build');
  assert.equal(step(prod, 'config', 'config').env.BUILD_ENVIRONMENT, 'production-build');
});
