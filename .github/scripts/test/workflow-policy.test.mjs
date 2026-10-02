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
