// deploy-skip-when-unconfigured: a Deploy run whose production-build config is missing (or partial) warns, names
// what is missing, and skips the rest of the pipeline successfully; it never fails main. Once configured, unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { checkWorkflow } from '../workflow-policy.mjs';

const script = fileURLToPath(new URL('../deploy/check-config.sh', import.meta.url));
const writeEnv = readFileSync(new URL('../deploy/write-env.sh', import.meta.url), 'utf8');
const REQUIRED = /^REQUIRED=\(([^)]*)\)/m.exec(writeEnv)[1].trim().split(/\s+/);

const allTrue = () => Object.fromEntries(REQUIRED.map((k) => [`HAS_${k}`, 'true']));
function run(env) {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const out = join(dir, 'out');
  const summary = join(dir, 'summary');
  const r = spawnSync('bash', [script], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, SUMMARY: summary, ...env }, encoding: 'utf8' });
  return { ...r, output: existsSync(out) ? readFileSync(out, 'utf8') : '', summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '' };
}

test('fully configured: configured=true, no warning', () => {
  const r = run(allTrue());
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output.trim(), 'configured=true');
  assert.doesNotMatch(r.stdout, /::warning/);
});

test('nothing configured: warns with every missing NAME, points to docs/deploy.md, configured=false, exit 0', () => {
  const r = run(Object.fromEntries(REQUIRED.map((k) => [`HAS_${k}`, 'false'])));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output.trim(), 'configured=false');
  assert.match(r.stdout, /::warning title=deploy not configured::/);
  for (const k of REQUIRED) assert.ok(r.stdout.includes(k) && r.summary.includes(k), k);
  assert.match(r.stdout, /docs\/deploy\.md/);
  assert.match(r.summary, /docs\/deploy\.md/);
});

test('partially configured (only the bundler secret missing): also skips with a warning naming it', () => {
  const r = run({ ...allTrue(), HAS_VITE_BUNDLER_URL: 'false' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output.trim(), 'configured=false');
  assert.match(r.stdout, /::warning title=deploy not configured::[^\n]*VITE_BUNDLER_URL/);
  assert.doesNotMatch(r.stdout, /VITE_RP_ID/);
});

test('a missing or malformed HAS_* flag is a workflow bug: fail loudly instead of skipping forever', () => {
  const { HAS_VITE_RP_ID, ...rest } = allTrue();
  assert.equal(run(rest).status, 2);
  assert.equal(run({ ...allTrue(), HAS_VITE_RP_ID: 'yes' }).status, 2);
});

test('the warning names the build environment and the workflow to re-run (split-dev-and-release-deploys)', () => {
  const r = run({ ...allTrue(), HAS_VITE_RP_ID: 'false', BUILD_ENVIRONMENT: 'development-build', WORKFLOW: 'deploy-dev.yml' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /The development-build environment is missing: VITE_RP_ID/);
  assert.match(r.stdout, /gh workflow run deploy-dev\.yml/);
  const d = run({ ...allTrue(), HAS_VITE_RP_ID: 'false' });
  assert.match(d.stdout, /The production-build environment is missing/);
  for (const bad of [{ BUILD_ENVIRONMENT: 'prod build' }, { WORKFLOW: 'x.yml;true' }]) {
    assert.equal(run({ ...allTrue(), ...bad }).status, 2, JSON.stringify(bad));
  }
});

test('ECC L2: MISSING_IS_ERROR=true fails (exit 1, ::error) and still names only the missing keys; complete config passes', () => {
  const r = run({ ...allTrue(), HAS_VITE_BUNDLER_URL: 'false', MISSING_IS_ERROR: 'true' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error title=deploy not configured::The production-build environment is missing: VITE_BUNDLER_URL\./);
  assert.match(r.summary, /Deploy FAILED: not configured/);
  assert.equal(r.output.trim(), 'configured=false');
  assert.equal(run({ ...allTrue(), MISSING_IS_ERROR: 'true' }).status, 0);
  assert.equal(run({ ...allTrue(), MISSING_IS_ERROR: 'yes' }).status, 2);
});

// ---- workflow structure (both deploy workflows) ----
for (const [file, buildEnv] of [['deploy.yml', 'production-build'], ['deploy-dev.yml', 'development-build']]) {
  const deploy = readFileSync(new URL(`../../workflows/${file}`, import.meta.url), 'utf8');
  const wf = parse(deploy);

  test(`${file}: config job in ${buildEnv}, before the full CI, presence flags only (never a value)`, () => {
    const job = wf.jobs.config;
    assert.equal(String(job.environment?.name ?? job.environment), buildEnv);
    assert.deepEqual([].concat(job.needs), ['detect']);
    const step = job.steps.find((s) => s.id === 'config');
    assert.match(String(step.run), /check-config\.sh/);
    const { BUILD_ENVIRONMENT, WORKFLOW, MISSING_IS_ERROR, ...env } = step.env;
    assert.equal(BUILD_ENVIRONMENT, buildEnv);
    assert.equal(WORKFLOW, file);
    // ECC L2: a production release or dispatch is deliberate, so missing config FAILS it; dev (polled) warns and skips.
    assert.equal(MISSING_IS_ERROR, file === 'deploy.yml' ? 'true' : undefined);
    assert.deepEqual(Object.keys(env).sort(), REQUIRED.map((k) => `HAS_${k}`).sort());
    for (const k of REQUIRED) {
      const src = k === 'VITE_BUNDLER_URL' ? 'secrets' : 'vars';
      assert.equal(env[`HAS_${k}`], `\${{ ${src}.${k} != '' }}`, k);
    }
    assert.equal(job.outputs.configured, '${{ steps.config.outputs.configured }}');
  });

  test(`${file}: test and build run only when configured; release depends on build (so it skips too)`, () => {
    for (const id of ['test', 'build']) {
      assert.ok([].concat(wf.jobs[id].needs).includes('config'), id);
      assert.match(String(wf.jobs[id].if), /needs\.config\.outputs\.configured == 'true'/, id);
    }
    assert.ok([].concat(wf.jobs.release.needs).includes('build'));
  });

  test(`${file}: the bundler secret may appear only as a presence check in config, and in web-env`, () => {
    assert.deepEqual(checkWorkflow(`workflows/${file}`, deploy), []);
    const leak = deploy.replace("HAS_VITE_BUNDLER_URL: ${{ secrets.VITE_BUNDLER_URL != '' }}", 'HAS_VITE_BUNDLER_URL: ${{ secrets.VITE_BUNDLER_URL }}');
    assert.notEqual(leak, deploy);
    assert.ok(checkWorkflow(`workflows/${file}`, leak).some((e) => /VITE_BUNDLER_URL/.test(e)));
    const fly = deploy.replace("HAS_VITE_BUNDLER_URL: ${{ secrets.VITE_BUNDLER_URL != '' }}", "HAS_VITE_BUNDLER_URL: ${{ secrets.FLY_API_TOKEN != '' }}");
    assert.ok(checkWorkflow(`workflows/${file}`, fly).some((e) => /FLY_API_TOKEN/.test(e)));
  });
}

test('development: the analytics beacon is optional, so an unset VITE_CF_BEACON_TOKEN in development-build is fine', () => {
  assert.match(writeEnv, /^OPTIONAL=\([^)]*VITE_CF_BEACON_TOKEN[^)]*\)/m);
  assert.ok(!REQUIRED.includes('VITE_CF_BEACON_TOKEN'));
});
