import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

test('only the deployments-check report job and the recover-release publish job hold write scopes', async () => {
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
  assert.deepEqual(nonPrivileged.sort(), [
    'deployments-check.yml:report-failure:issues',
    'recover-release.yml:publish:attestations',
    'recover-release.yml:publish:contents',
    'recover-release.yml:publish:id-token',
  ]);
  assert.deepEqual(Object.keys(WRITE_EXCEPTIONS), ['deployments-check.yml']);
  assert.ok(!Object.hasOwn(SCHEDULED_READ_ONLY, 'deployments-check.yml'));
  const { RELEASE_ASSETS } = await import('../workflow-policy.mjs');
  assert.deepEqual(Object.keys(RELEASE_ASSETS), ['recover-release.yml']);
});

// release-recovery-tool-assets (design D4): the release asset workflow's profile, tested on the real file.
// Read lazily: only these tests fail (not the whole file) if the workflow is missing.
let releaseText;
const realRelease = () =>
  (releaseText ??= readFileSync(fileURLToPath(new URL('../../workflows/recover-release.yml', import.meta.url)), 'utf8'));
const raErrs = (text, file = 'recover-release.yml') => checkWorkflow(file, text);
const raExpect = (text, re) => {
  const e = raErrs(text);
  assert.ok(e.some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(e)}`);
};
const swap = (from, to) => {
  assert.ok(realRelease().includes(from), `fixture drift: ${from}`);
  return realRelease().replace(from, to);
};

test('recover-release.yml passes as committed', () => assert.deepEqual(raErrs(realRelease()), []));

test('the release-asset profile is bound to its file name', () => {
  assert.ok(checkWorkflow('other.yml', realRelease()).some((m) => /publish' requests contents: write/.test(m)));
});

test('release-asset triggers: published releases and an input-less dispatch only', () => {
  raExpect(swap('    types: [published]\n', '    types: [published, edited]\n'), /release must be limited to types: \[published\]/);
  raExpect(swap('on:\n  release:\n', 'on:\n  push:\n    branches: [main]\n  release:\n'), /trigger 'push' is not allowed/);
  raExpect(
    swap('  workflow_dispatch: # owner dry run', '  workflow_dispatch:\n    inputs:\n      tag:\n        type: string\n  x_unused: # owner dry run'),
    /workflow_dispatch may not take inputs/,
  );
});

test('release-asset gate: owner and (release at v* | dispatch on main) on the first job', () => {
  raExpect(swap('github.triggering_actor == github.repository_owner && ((', '(('), /job 'detect' has no needs, so its condition must include "github\.triggering_actor == github\.repository_owner"/);
  raExpect(swap(" || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'))", ')'), /job 'detect' has no needs, so its condition must include/);
  raExpect(swap("    if: needs.detect.outputs.deploy == 'true' && github.event_name == 'release'\n", "    if: github.event_name == 'release'\n"), /job 'publish' .*needs\.detect\.outputs\.deploy == 'true'/);
  raExpect(swap("    if: needs.detect.outputs.deploy == 'true' && github.event_name == 'release'\n", "    if: needs.detect.outputs.deploy == 'true'\n"), /job 'publish' condition must include "github\.event_name == 'release'"/);
  raExpect(swap("    if: needs.detect.outputs.deploy == 'true' && github.event_name == 'release'\n", "    if: always() && needs.detect.outputs.deploy == 'true' && github.event_name == 'release'\n"), /always\(\), failure\(\) and cancelled\(\)/);
  raExpect(swap("    if: needs.detect.outputs.deploy == 'true' && github.event_name == 'release'\n", "    if: needs.detect.outputs.deploy == 'true' && github.event_name == 'release' || true\n"), /no top-level \|\|/);
});

test('release-asset permissions: only publish writes, exactly its three scopes', () => {
  raExpect(swap('      contents: read # checkout only; nothing is published\n', '      contents: write\n'), /job 'dry-run' must hold exactly contents: read/);
  raExpect(swap('      attestations: write # store', '      packages: write\n      attestations: write # store'), /job 'publish' must request exactly/);
  raExpect(swap('      id-token: write # build provenance (Sigstore)\n', ''), /job 'publish' must request exactly/);
});

test('release-asset publish job: allow-listed pinned actions, pinned run steps, no release or tag mutation', () => {
  raExpect(swap('      - name: Attest build provenance\n        uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2\n', '      - name: Attest build provenance\n        uses: actions/attest-build-provenance@v4\n'), /publish.*action 'actions\/attest-build-provenance@v4' is not allowed/);
  raExpect(swap('      - name: Attest build provenance\n        uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2\n', '      - name: Attest build provenance\n        uses: astral-sh/setup-uv@c18668ad3cf93ea998bef934396af7bb5c839dc7 # v10.2.0\n'), /publish.*action 'astral-sh\/setup-uv@.*' is not allowed/);
  raExpect(swap('gh release upload "$TAG" "$DIR"/* --repo "$REPO"\n', 'gh release upload "$TAG" "$DIR"/* --repo "$REPO" --clobber\n'), /--clobber/);
  raExpect(swap('gh release upload "$TAG" "$DIR"/* --repo "$REPO"\n', 'gh release upload "$TAG" "$DIR"/* --repo "$REPO"\n          gh release edit "$TAG" --draft\n'), /gh release edit/);
  raExpect(swap('gh release upload "$TAG" "$DIR"/* --repo "$REPO"\n', 'gh release upload "$TAG" "$DIR"/* --repo "$REPO"\n          git push origin HEAD\n'), /git push/);
  raExpect(swap('gh release upload "$TAG" "$DIR"/* --repo "$REPO"\n', 'gh release upload "$TAG" "$DIR"/* --repo "$REPO"\n          gh release delete-asset "$TAG" x\n'), /gh release delete-asset/);
  raExpect(swap('        run: node .github/scripts/recover-release.mjs "$DIR" --tag "$TAG"\n', '        run: node .github/scripts/recover-release.mjs "$DIR"\n'), /run step .* is not pinned/);
  raExpect(swap('        run: node .github/scripts/recover-release.mjs "$DIR" --tag "$TAG"\n', '        run: npx something && node .github/scripts/recover-release.mjs "$DIR" --tag "$TAG"\n'), /build tooling/);
});

test('release-asset token, secrets, environments and checkout credentials', () => {
  raExpect(swap('          DOCKER: ${{ matrix.docker }}\n', '          DOCKER: ${{ matrix.docker }}\n          GH_TOKEN: ${{ github.token }}\n'), /job 'binaries': github\.token may only be referenced in detect and publish/);
  raExpect(swap('          DOCKER: ${{ matrix.docker }}\n', '          DOCKER: ${{ matrix.docker }}\n          X: ${{ secrets.ANYTHING }}\n'), /secrets must not be referenced/);
  raExpect(swap('    timeout-minutes: 15\n', '    timeout-minutes: 15\n    environment: release\n'), /may not use an environment/);
  // The first such checkout is publish's.
  raExpect(
    swap('          persist-credentials: false\n          ref: ${{ needs.detect.outputs.sha }}\n          sparse-checkout: .github/scripts\n', '          persist-credentials: true\n          ref: ${{ needs.detect.outputs.sha }}\n          sparse-checkout: .github/scripts\n'),
    /job 'publish' step 'Checkout \(release scripts only\)': checkout must set persist-credentials: false/,
  );
});
