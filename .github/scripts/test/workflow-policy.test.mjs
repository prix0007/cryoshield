import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkWorkflow, checkZizmorConfig, checkGithubDir } from '../workflow-policy.mjs';

const clean = `
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  build:
    name: Build
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
`;

const errs = (text) => checkWorkflow('ci.yml', text);
const expectError = (text, re) => {
  const e = errs(text);
  assert.ok(e.some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(e)}`);
};

test('clean workflow passes', () => assert.deepEqual(errs(clean), []));

test('pull_request_target is rejected in every trigger form', () => {
  expectError(clean.replace('  pull_request:\n', '  pull_request_target:\n'), /pull_request_target/);
  expectError(clean.replace(/on:\n  push:\n    branches: \[main\]\n  pull_request:\n/, 'on: pull_request_target\n'), /pull_request_target/);
  expectError(clean.replace(/on:\n  push:\n    branches: \[main\]\n  pull_request:\n/, 'on: [push, pull_request_target]\n'), /pull_request_target/);
  expectError(clean.replace(/on:\n/, '"on":\n').replace('  pull_request:\n', '  pull_request_target:\n'), /pull_request_target/);
});

test('top-level permissions must exist and be exactly contents: read', () => {
  expectError(clean.replace('permissions:\n  contents: read\njobs:', 'jobs:'), /top-level permissions/);
  expectError(clean.replace('permissions:\n  contents: read\njobs:', 'permissions: write-all\njobs:'), /top-level permissions/);
  expectError(clean.replace('permissions:\n  contents: read\njobs:', 'permissions:\n  contents: write\njobs:'), /top-level permissions/);
  expectError(clean.replace('permissions:\n  contents: read\njobs:', 'permissions:\n  contents: read\n  pull-requests: write\njobs:'), /top-level permissions/);
  assert.deepEqual(errs(clean.replace('permissions:\n  contents: read\njobs:', 'permissions: {}\njobs:')), []);
});

test('a job without permissions is rejected and named', () => {
  expectError(clean.replace('    permissions:\n      contents: read\n', ''), /job 'build'.*permissions/);
});

test('a job with write-all permissions is rejected', () => {
  expectError(clean.replace('    permissions:\n      contents: read\n', '    permissions: write-all\n'), /job 'build'.*write-all/);
});

test('a job without timeout-minutes is rejected and named', () => {
  expectError(clean.replace('    timeout-minutes: 10\n', ''), /job 'build'.*timeout-minutes/);
});

test('secrets references are rejected in PR-triggered workflows', () => {
  expectError(clean.replace('          persist-credentials: false', '          token: ${{ secrets.DEPLOY_TOKEN }}'), /secrets/);
  expectError(clean.replace('          persist-credentials: false', '          token: ${{secrets.GITHUB_TOKEN}}'), /secrets/);
  expectError(clean.replace('    steps:', '    env:\n      X: ${{ secrets[format(\'{0}\', \'A\')] }}\n    steps:'), /secrets/);
});

test('secrets evasions are rejected (review MEDIUM-3)', () => {
  const inject = (expr) => clean.replace('          persist-credentials: false', `          token: \${{ ${expr} }}`);
  expectError(inject('toJSON(secrets)'), /secrets/);
  expectError(inject('SECRETS.FOO'), /secrets/);
  expectError(inject('secrets'), /secrets/);
  // The word in plain text (not an expression) is fine.
  assert.deepEqual(errs(clean.replace('name: Build', 'name: Build (no secrets here)')), []);
});

test('workflow_run is forbidden like pull_request_target', () => {
  expectError(clean.replace('  pull_request:\n', '  workflow_run:\n    workflows: [CI]\n'), /workflow_run/);
});

test('job-level write scopes are rejected (review MEDIUM-5)', () => {
  for (const scope of ['contents: write', 'id-token: write', 'pull-requests: write']) {
    expectError(clean.replace('    permissions:\n      contents: read\n', `    permissions:\n      ${scope}\n`), /job 'build'.*write/);
  }
  assert.deepEqual(errs(clean.replace('    permissions:\n      contents: read\n', '    permissions:\n      contents: read\n      pull-requests: read\n')), []);
  assert.deepEqual(errs(clean.replace('    permissions:\n      contents: read\n', '    permissions: {}\n')), []);
});

test('zizmor inline ignores are rejected', () => {
  expectError(clean.replace('# v7.0.1', '# v7.0.1 # zizmor: ignore[unpinned-uses]'), /zizmor: ignore/);
});

test('unparseable YAML is reported, not skipped', () => {
  expectError('on: [push\n', /parse/);
});

const zizmorOk = `rules:\n  unpinned-uses:\n    config:\n      policies:\n        "*": hash-pin\n`;

test('zizmor config must keep hash-pin for all actions and not disable or ignore rules', () => {
  assert.deepEqual(checkZizmorConfig(zizmorOk), []);
  assert.match(checkZizmorConfig(zizmorOk.replace('hash-pin', 'ref-pin')).join(), /hash-pin/);
  assert.match(checkZizmorConfig('rules: {}\n').join(), /hash-pin/);
  assert.match(checkZizmorConfig(`${zizmorOk}  artipacked:\n    disable: true\n`).join(), /disable/);
  assert.match(checkZizmorConfig(`${zizmorOk}  template-injection:\n    ignore:\n      - ci.yml:10\n`).join(), /ignore/);
  assert.match(
    checkZizmorConfig(zizmorOk.replace('"*": hash-pin', '"*": hash-pin\n        "actions/*": any')).join(),
    /policies/,
  );
});

test('directory check: missing zizmor config fails; the real .github passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wfp-'));
  mkdirSync(join(dir, 'workflows'));
  writeFileSync(join(dir, 'workflows', 'ci.yml'), clean);
  assert.match(checkGithubDir(dir).join(), /zizmor\.yml/);
  writeFileSync(join(dir, 'zizmor.yml'), zizmorOk);
  assert.deepEqual(checkGithubDir(dir), []);

  const real = fileURLToPath(new URL('../../', import.meta.url));
  assert.deepEqual(checkGithubDir(real), []);
});

test('CLI exit code', () => {
  const script = fileURLToPath(new URL('../workflow-policy.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'wfp-'));
  mkdirSync(join(dir, 'workflows'));
  writeFileSync(join(dir, 'zizmor.yml'), zizmorOk);
  writeFileSync(join(dir, 'workflows', 'a.yaml'), clean.replace('    timeout-minutes: 10\n', ''));
  const r = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a\.yaml/);
});

// harden-gas-sponsorship security review: the deployments-check failure issue is the only write-scoped job.
const reportJob = `
name: Deployments check
on:
  schedule:
    - cron: '41 5 * * 2'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  deployments-check:
    name: deployments-check
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    permissions:
      contents: read
    steps:
      - name: Check
        run: echo check
  report-failure:
    name: report-failure
    needs: deployments-check
    if: failure()
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      issues: write
    steps:
      - name: Open or update the tracking issue
        run: gh issue list
`;
const dcErrs = (text, file = 'deployments-check.yml') => checkWorkflow(file, text);
const dcExpect = (text, re, file) => {
  const e = dcErrs(text, file);
  assert.ok(e.some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(e)}`);
};

test('deployments-check report-failure may hold exactly issues: write', () => assert.deepEqual(dcErrs(reportJob), []));

test('the issues: write exception is bound to its file and job name', () => {
  dcExpect(reportJob, /requests issues: write; only read\/none/, 'other.yml');
  dcExpect(reportJob.replaceAll('report-failure', 'report-other'), /requests issues: write; only read\/none/);
});

test('the write exception rejects any other scope, trigger, need, condition or action', () => {
  dcExpect(reportJob.replace('      issues: write\n', '      issues: write\n      contents: write\n'), /must request exactly/);
  dcExpect(reportJob.replace('      issues: write\n', '      issues: write\n      contents: read\n'), /must request exactly/);
  dcExpect(reportJob.replace('  workflow_dispatch:\n', '  workflow_dispatch:\n  pull_request:\n'), /schedule\/workflow_dispatch/);
  dcExpect(reportJob.replace('  workflow_dispatch:\n', '  workflow_dispatch:\n  push:\n'), /schedule\/workflow_dispatch/);
  dcExpect(reportJob.replace('    needs: deployments-check\n', ''), /must need exactly/);
  dcExpect(reportJob.replace('    if: failure()\n', '    if: always()\n'), /if: failure\(\)/);
  dcExpect(
    reportJob.replace('        run: gh issue list\n', '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n'),
    /may not use actions/,
  );
});

test('other write scopes on the exception job are still rejected', () => {
  dcExpect(reportJob.replace('      issues: write\n', '      pull-requests: write\n'), /requests pull-requests: write/);
});

test('write-exception workflow: other jobs read-only, no secrets, token only in the exception job, no inputs', () => {
  dcExpect(reportJob.replace('    permissions:\n      contents: read\n    steps:\n      - name: Check', '    permissions:\n      contents: read\n      actions: read\n    steps:\n      - name: Check'), /job 'deployments-check' must hold exactly contents: read/);
  dcExpect(reportJob.replace('        run: echo check\n', '        run: echo check\n        env:\n          T: ${{ github.token }}\n'), /github\.token may only be referenced inside the exception job/);
  dcExpect(reportJob.replace('        run: gh issue list\n', '        run: gh issue list\n        env:\n          S: ${{ secrets.X }}\n'), /secrets must not be referenced/);
  dcExpect(reportJob.replace('  workflow_dispatch:\n', '  workflow_dispatch:\n    inputs:\n      x:\n        type: string\n'), /workflow_dispatch may not take inputs/);
  dcExpect(reportJob.replace('        run: echo check\n', '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n'), /persist-credentials: false/);
});

test('the deployments-check report job holds the ONLY write scope in the repository', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { parse } = await import('yaml');
  const { SCHEDULED_READ_ONLY, WRITE_EXCEPTIONS } = await import('../workflow-policy.mjs');
  const dir = new URL('../../workflows/', import.meta.url);
  const writes = [];
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
    const wf = parse(readFileSync(new URL(f, dir), 'utf8'));
    const tops = Object.entries(wf.permissions ?? {}).filter(([, l]) => l === 'write');
    for (const [scope] of tops) writes.push(`${f}:<top>:${scope}`);
    for (const [id, job] of Object.entries(wf.jobs ?? {})) {
      for (const [scope, level] of Object.entries(job?.permissions ?? {})) if (level === 'write') writes.push(`${f}:${id}:${scope}`);
    }
  }
  // Privileged workflows (PRIVILEGED) carry their own reviewed write scopes; this test is about everything else.
  const { PRIVILEGED } = await import('../workflow-policy.mjs');
  const nonPrivileged = writes.filter((w) => !Object.hasOwn(PRIVILEGED, w.split(':')[0]));
  assert.deepEqual(nonPrivileged, ['deployments-check.yml:report-failure:issues']);
  assert.deepEqual(Object.keys(WRITE_EXCEPTIONS), ['deployments-check.yml']);
  assert.ok(!Object.hasOwn(SCHEDULED_READ_ONLY, 'deployments-check.yml'));
});
