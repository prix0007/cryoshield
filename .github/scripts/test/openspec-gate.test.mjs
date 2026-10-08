import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../openspec-gate.mjs';

const pr = (over) => ({ files: [], labels: [], body: '', author: 'prix0007', ...over });
const noSpec = [{ name: 'no-spec' }];

test('code change without a spec change fails and names the code paths', () => {
  const r = evaluate(pr({ files: ['apps/web/src/main.tsx', 'README.md'] }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.codeFiles, ['apps/web/src/main.tsx']);
  assert.match(r.message, /apps\/web\/src\/main\.tsx/);
  assert.match(r.message, /no-spec/);
});

for (const file of [
  'apps/web/src/main.tsx',
  'packages/vault-crypto/src/index.ts',
  'contracts/src/VaultRegistry.sol',
  'tools/recover/src/cryoshield_recover/cli.py',
  'tools/metrics/src/report.ts',
  'tools/metrics/paymasters.json',
  '.github/workflows/ci.yml',
]) {
  test(`code path detected: ${file}`, () => assert.equal(evaluate(pr({ files: [file] })).ok, false));
}

test('code change with an OpenSpec change passes', () => {
  const r = evaluate(pr({ files: ['contracts/src/VaultRegistry.sol', 'openspec/changes/add-x/tasks.md'] }));
  assert.equal(r.ok, true);
});

test('archiving a change counts as spec evidence', () => {
  const r = evaluate(pr({ files: ['apps/web/src/a.ts', 'openspec/changes/archive/2026-10-02-add-x/tasks.md'] }));
  assert.equal(r.ok, true);
});

test('main specs alone are not change evidence', () => {
  const r = evaluate(pr({ files: ['apps/web/src/a.ts', 'openspec/specs/ci-pipeline/spec.md'] }));
  assert.equal(r.ok, false);
});

test('no-spec label with a justification passes', () => {
  const body = 'Change: \n\nNo-spec justification: typo in a log message\n';
  const r = evaluate(pr({ files: ['packages/vault-crypto/src/x.ts'], labels: noSpec, body }));
  assert.equal(r.ok, true);
  assert.match(r.message, /typo in a log message/);
});

test('no-spec label without a justification fails', () => {
  for (const body of ['', 'No-spec justification: ', 'No-spec justification: short', '<!-- No-spec justification: hidden in a comment -->']) {
    const r = evaluate(pr({ files: ['packages/vault-crypto/src/x.ts'], labels: noSpec, body }));
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.match(r.message, /justification/);
  }
});

test('justification without the label fails', () => {
  const r = evaluate(pr({ files: ['apps/web/src/a.ts'], body: 'No-spec justification: typo in a log message' }));
  assert.equal(r.ok, false);
});

test('label names given as strings are accepted', () => {
  const r = evaluate(pr({ files: ['apps/web/src/a.ts'], labels: ['no-spec'], body: 'No-spec justification: typo in a log message' }));
  assert.equal(r.ok, true);
});

test('docs-only and non-code changes pass without a label', () => {
  for (const files of [['README.md'], ['docs/reviews/x.md'], ['contracts/test/X.t.sol'], ['tools/recover/tests/test_x.py'], ['docs/x/package.json'], []]) {
    assert.equal(evaluate(pr({ files })).ok, true, files.join(','));
  }
});

test('lookalike paths are not code paths', () => {
  assert.equal(evaluate(pr({ files: ['contracts/srcx/a.sol', 'xapps/a.ts', 'docs/apps/a.md'] })).ok, true);
});

test('Dependabot touching only dependency manifests passes', () => {
  const files = ['apps/web/package.json', 'pnpm-lock.yaml', 'tools/recover/uv.lock', 'apps/web/deploy/Dockerfile', '.github/workflows/ci.yml'];
  assert.equal(evaluate(pr({ files, author: 'dependabot[bot]' })).ok, true);
});

test('Dependabot touching source code is not exempt', () => {
  const r = evaluate(pr({ files: ['apps/web/package.json', 'apps/web/src/a.ts'], author: 'dependabot[bot]' }));
  assert.equal(r.ok, false);
});

test('a human touching only manifests in a code path is not exempt', () => {
  assert.equal(evaluate(pr({ files: ['apps/web/package.json'], author: 'someone' })).ok, false);
});

test('CLI reads files, labels, body and author; exit code reflects the result', () => {
  const script = fileURLToPath(new URL('../openspec-gate.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  const files = join(dir, 'files.txt');
  writeFileSync(files, 'apps/web/src/a.ts\nREADME.md\n');
  const env = { PR_LABELS: JSON.stringify(noSpec), PR_BODY: '', PR_AUTHOR: 'prix0007' };
  const bad = spawnSync(process.execPath, [script, files], { env, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  const good = spawnSync(process.execPath, [script, files], {
    env: { ...env, PR_BODY: 'No-spec justification: dependency-free refactor of a comment' },
    encoding: 'utf8',
  });
  assert.equal(good.status, 0, good.stderr);
  const broken = spawnSync(process.execPath, [script, files], { env: { ...env, PR_LABELS: 'not json' }, encoding: 'utf8' });
  assert.equal(broken.status, 2);
});

test('quoted (core.quotePath) paths fail closed (review HIGH-2)', () => {
  const r = evaluate(pr({ files: ['"contracts/src/\\303\\211vil.sol"'] }));
  assert.equal(r.ok, false);
  assert.match(r.message, /quoted/);
});

test('non-ASCII paths are detected as code', () => {
  assert.equal(evaluate(pr({ files: ['contracts/src/Évil.sol'] })).ok, false);
  assert.equal(evaluate(pr({ files: ['.github/workflows/é.yml'] })).ok, false);
});

test('gate and CI-config paths need a spec too (review MEDIUM-4)', () => {
  for (const file of ['.github/scripts/openspec-gate.mjs', '.github/osv-scanner.toml', '.github/rulesets/main.json',
    '.gitleaks.toml', 'scripts/check-licenses.sh', 'package.json', 'pnpm-workspace.yaml', 'contracts/foundry.toml']) {
    assert.equal(evaluate(pr({ files: [file] })).ok, false, file);
  }
});

test('Dependabot exemption is anchored to known manifest paths (review LOW-6)', () => {
  for (const file of ['apps/web/src/package.json', '.github/scripts/Dockerfile', 'apps/web/src/Dockerfile']) {
    assert.equal(evaluate(pr({ files: [file], author: 'dependabot[bot]' })).ok, false, file);
  }
  for (const file of ['.github/scripts/package-lock.json', '.github/openspec-cli/package.json', 'packages/vault-crypto/package.json']) {
    assert.equal(evaluate(pr({ files: [file], author: 'dependabot[bot]' })).ok, true, file);
  }
});

test('CLI splits NUL-separated input (git diff -z)', () => {
  const script = fileURLToPath(new URL('../openspec-gate.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  const files = join(dir, 'files.bin');
  writeFileSync(files, 'README.md\0contracts/src/Évil.sol\0');
  const r = spawnSync(process.execPath, [script, files], { env: { PR_LABELS: '[]', PR_BODY: '', PR_AUTHOR: 'x' }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Évil\.sol/);
});
