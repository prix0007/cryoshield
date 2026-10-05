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
const deploy = readFileSync(new URL('../../workflows/deploy.yml', import.meta.url), 'utf8');
const wf = parse(deploy);
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

test('security review MEDIUM: config missing while a site is live says new commits are NOT released (still no failure: design D6)', () => {
  const r = run({ ...allTrue(), HAS_VITE_RP_ID: 'false', LIVE: 'true' });
  assert.equal(r.status, 0);
  assert.equal(r.output.trim(), 'configured=false');
  assert.match(r.stdout, /::warning title=deploy not configured::A release is live, but NEW COMMITS ARE NOT BEING RELEASED[^\n]*VITE_RP_ID/);
  assert.match(r.summary, /NEW COMMITS ARE NOT BEING RELEASED/);
  assert.doesNotMatch(run({ ...allTrue(), HAS_VITE_RP_ID: 'false', LIVE: 'false' }).stdout, /NOT BEING RELEASED/);
  assert.equal(run({ ...allTrue(), HAS_VITE_RP_ID: 'false', LIVE: 'false' }).status, 0);
  assert.equal(run({ ...allTrue(), HAS_VITE_RP_ID: 'false', LIVE: '' }).status, 0);
  assert.equal(run({ ...allTrue(), LIVE: 'maybe' }).status, 2);
});

test('a missing or malformed HAS_* flag is a workflow bug: fail loudly instead of skipping forever', () => {
  const { HAS_VITE_RP_ID, ...rest } = allTrue();
  assert.equal(run(rest).status, 2);
  assert.equal(run({ ...allTrue(), HAS_VITE_RP_ID: 'yes' }).status, 2);
});

// ---- workflow structure ----
test('config job: production-build, before the full CI, presence flags only (never a value)', () => {
  const job = wf.jobs.config;
  assert.equal(String(job.environment?.name ?? job.environment), 'production-build');
  assert.deepEqual([].concat(job.needs), ['detect']);
  const step = job.steps.find((s) => s.id === 'config');
  assert.match(String(step.run), /check-config\.sh/);
  const env = step.env;
  assert.deepEqual(Object.keys(env).sort(), ['LIVE', ...REQUIRED.map((k) => `HAS_${k}`)].sort());
  assert.equal(env.LIVE, '${{ needs.detect.outputs.live }}');
  for (const k of REQUIRED) {
    const src = k === 'VITE_BUNDLER_URL' ? 'secrets' : 'vars';
    assert.equal(env[`HAS_${k}`], `\${{ ${src}.${k} != '' }}`, k);
  }
  assert.equal(job.outputs.configured, '${{ steps.config.outputs.configured }}');
});

test('test and build run only when configured; supersede and release depend on build (so they skip too)', () => {
  for (const id of ['test', 'build']) {
    assert.ok([].concat(wf.jobs[id].needs).includes('config'), id);
    assert.match(String(wf.jobs[id].if), /needs\.config\.outputs\.configured == 'true'/, id);
  }
  assert.ok([].concat(wf.jobs.supersede.needs).includes('build'));
  assert.ok([].concat(wf.jobs.release.needs).includes('build'));
});

test('policy: the bundler secret may appear only as a presence check in the config step, and in web-env', () => {
  assert.deepEqual(checkWorkflow('workflows/deploy.yml', deploy), []);
  const leak = deploy.replace("HAS_VITE_BUNDLER_URL: ${{ secrets.VITE_BUNDLER_URL != '' }}", 'HAS_VITE_BUNDLER_URL: ${{ secrets.VITE_BUNDLER_URL }}');
  assert.notEqual(leak, deploy);
  assert.ok(checkWorkflow('workflows/deploy.yml', leak).some((e) => /VITE_BUNDLER_URL/.test(e)));
  const fly = deploy.replace("HAS_VITE_BUNDLER_URL: ${{ secrets.VITE_BUNDLER_URL != '' }}", "HAS_VITE_BUNDLER_URL: ${{ secrets.FLY_API_TOKEN != '' }}");
  assert.ok(checkWorkflow('workflows/deploy.yml', fly).some((e) => /FLY_API_TOKEN/.test(e)));
});

test('detect counts only failed runs as "previously failed": a skipped (unconfigured) run concludes success', () => {
  const detectRun = String(wf.jobs.detect.steps.find((s) => s.id === 'detect').run);
  assert.match(detectRun, /--status failure/);
});

test('security review LOW: secret-expression variants are refused (presence form only, config step only, production-build only)', () => {
  const line = "HAS_VITE_BUNDLER_URL: ${{ secrets.VITE_BUNDLER_URL != '' }}";
  assert.ok(deploy.includes(line));
  for (const variant of [
    "HAS_VITE_BUNDLER_URL: ${{ secrets.VITE_BUNDLER_URL != '' && secrets.VITE_BUNDLER_URL }}",
    "HAS_VITE_BUNDLER_URL: ${{ format('{0}', secrets.VITE_BUNDLER_URL) != '' }}",
    "HAS_VITE_BUNDLER_URL: ${{ toJSON(secrets) != '' }}",
    "HAS_VITE_BUNDLER_URL: ${{ secrets.VITE_BUNDLER_URL == 'guess' }}",
    "HAS_VITE_BUNDLER_URL: ${{ secrets['VITE_BUNDLER_URL'] != '' }}",
    "HAS_VITE_BUNDLER_URL: ${{ secrets.VITE_BUNDLER_URL != '' }}${{ secrets.VITE_BUNDLER_URL }}",
    // A `}}` inside a quoted string must not end the expression early (pre-existing scanner bug).
    "HAS_VITE_BUNDLER_URL: ${{ 'a}}' != '' || secrets.VITE_BUNDLER_URL }}",
  ]) {
    const e = checkWorkflow('workflows/deploy.yml', deploy.replace(line, variant));
    assert.ok(e.some((m) => /secret/i.test(m)), variant);
  }
  const otherStep = deploy.replace('        id: config\n', '        id: probe\n');
  assert.notEqual(otherStep, deploy);
  assert.ok(checkWorkflow('workflows/deploy.yml', otherStep).some((m) => /VITE_BUNDLER_URL/.test(m)));
});

test('security review LOW: a quoted }} cannot smuggle a secret past the scanner in any workflow', () => {
  const ci = readFileSync(new URL('../../workflows/ci.yml', import.meta.url), 'utf8');
  const bad = ci.replace('\nenv:\n', "\nenv:\n  X: ${{ 'a}}' != '' || secrets.SOME_SECRET }}\n");
  assert.notEqual(bad, ci);
  assert.ok(checkWorkflow('workflows/ci.yml', bad).some((m) => /secret/i.test(m)), 'quoted }} must not hide a secret');
});
