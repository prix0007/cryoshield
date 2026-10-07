// Read-only scheduled workflows (OpenSpec change add-privacy-preserving-analytics, task 2.2; spec product-metrics
// "Read-only scheduled run"): metrics.yml and beacon-drift.yml run only on schedule/dispatch, reference no secrets,
// hold only contents: read, never persist credentials, and never commit, push or deploy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkWorkflow, SCHEDULED_READ_ONLY } from '../workflow-policy.mjs';

const real = (f) => readFileSync(new URL(`../../workflows/${f}`, import.meta.url), 'utf8');
const metrics = real('metrics.yml');
const errs = (text, file = 'metrics.yml') => checkWorkflow(`workflows/${file}`, text);
const expectError = (text, re, file) => {
  const e = errs(text, file);
  assert.ok(e.some((m) => re.test(m)), `expected ${re} in ${JSON.stringify(e)}`);
};

test('the profile covers metrics.yml and beacon-drift.yml', () => {
  assert.deepEqual(Object.keys(SCHEDULED_READ_ONLY).sort(), ['beacon-drift.yml', 'metrics.yml']);
});

test('the committed metrics.yml and beacon-drift.yml pass', () => {
  assert.deepEqual(errs(metrics), []);
  assert.deepEqual(errs(real('beacon-drift.yml'), 'beacon-drift.yml'), []);
});

test('metrics.yml: weekly schedule and manual dispatch, read-only, no secrets, 90-day artifact', () => {
  assert.match(metrics, /^\s+- cron: '/m);
  assert.match(metrics, /^\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(metrics, /secrets\./);
  assert.match(metrics, /^permissions:\n\s+contents: read/m);
  assert.match(metrics, /uses: actions\/upload-artifact@[0-9a-f]{40} /);
  assert.match(metrics, /retention-days: 90\b/);
  assert.match(metrics, /pnpm --filter @cryoshield\/metrics metrics --network op-sepolia/);
});

test('any secrets reference is rejected, GITHUB_TOKEN included, even though it is not PR-triggered', () => {
  expectError(metrics.replace('          persist-credentials: false', '          persist-credentials: false\n          token: ${{ secrets.GITHUB_TOKEN }}'), /secrets/);
  expectError(metrics.replace('    steps:', '    env:\n      X: ${{ toJSON(secrets) }}\n    steps:'), /secrets/);
});

test('only schedule and workflow_dispatch triggers; dispatch takes no inputs', () => {
  expectError(metrics.replace('  workflow_dispatch:\n', '  workflow_dispatch:\n  push:\n    branches: [main]\n'), /trigger 'push'/);
  expectError(metrics.replace('  workflow_dispatch:\n', '  workflow_dispatch:\n    inputs:\n      network:\n        type: string\n'), /inputs/);
});

test('no write scope, no other read scope, no environment', () => {
  expectError(metrics.replace('    permissions:\n      contents: read # checkout only', '    permissions:\n      contents: read\n      actions: read'), /only contents: read/);
  expectError(metrics.replace('    timeout-minutes:', '    environment: production\n    timeout-minutes:'), /environment/);
});

test('checkout must not persist credentials', () => {
  expectError(metrics.replace('persist-credentials: false', 'persist-credentials: true'), /persist-credentials/);
});

test('never commits, pushes, calls the GitHub API or deploys', () => {
  for (const cmd of ['git push origin HEAD', 'git commit -m x', 'gh pr create', 'flyctl deploy', 'curl -X POST https://api.github.com']) {
    expectError(metrics.replace('      - name: Compute the metrics', `      - name: Sneaky\n        run: ${cmd}\n      - name: Compute the metrics`), /never commit/);
  }
});

test('metrics.yml must keep its 90-day artifact (at most 90 days)', () => {
  expectError(metrics.replace('retention-days: 90', 'retention-days: 400'), /retention-days/);
  expectError(metrics.replace(/uses: actions\/upload-artifact@\S+/, 'uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830'), /upload-artifact/);
});
