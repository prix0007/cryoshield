// gate-production-deploys: supersede.sh cancels only OLDER deploy.yml runs that are still WAITING for the production
// approval, for another commit; never a run that is deploying, itself, the same commit, or a newer run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../deploy/supersede.sh', import.meta.url));
const stub = fileURLToPath(new URL('./fixtures/gh-runs-stub.sh', import.meta.url));
chmodSync(stub, 0o755);
const SHA_NEW = 'b'.repeat(40);
const SHA_OLD = 'a'.repeat(40);
const ME = 900;
const pendingProd = [{ environment: { name: 'production' }, wait_timer: 0 }];

function run({ runs, pending = {}, env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'supersede-'));
  writeFileSync(join(dir, `run-${ME}.json`), JSON.stringify({ id: ME, created_at: '2026-10-05T10:00:00Z', head_sha: SHA_NEW, status: 'in_progress' }));
  writeFileSync(join(dir, 'runs.json'), JSON.stringify({ workflow_runs: runs }));
  for (const [id, p] of Object.entries(pending)) writeFileSync(join(dir, `pending-${id}.json`), JSON.stringify(p));
  const log = join(dir, 'gh.log');
  return new Promise((resolve, reject) => {
    execFile('bash', [script], {
      env: { PATH: process.env.PATH, GH: stub, GH_LOG: log, STUB_DIR: dir, REPO: 'prix0007/cryoshield', RUN_ID: String(ME), TARGET_SHA: SHA_NEW, ...env },
      encoding: 'utf8',
      timeout: 30_000,
    }, (err, stdout, stderr) => {
      if (err && (typeof err.code !== 'number' || err.signal)) return reject(err);
      const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
      resolve({ status: err ? err.code : 0, stdout, stderr, cancels: calls.filter((c) => c.includes('-X POST')) });
    });
  });
}

const r = (id, sha, created, status = 'waiting') => ({ id, head_sha: sha, created_at: created, status });

test('cancels an older waiting run for another commit that still has a pending production deployment', async () => {
  const res = await run({ runs: [r(800, SHA_OLD, '2026-10-05T09:00:00Z')], pending: { 800: pendingProd } });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.cancels, ['api -X POST repos/prix0007/cryoshield/actions/runs/800/cancel']);
  assert.match(res.stdout, /superseded run 800/);
});

test('never cancels: itself, the same commit, a newer run, a run without a pending production deployment', async () => {
  const runs = [
    r(ME, SHA_NEW, '2026-10-05T10:00:00Z'),
    r(810, SHA_NEW, '2026-10-05T09:30:00Z'), // same commit
    r(950, SHA_OLD, '2026-10-05T11:00:00Z'), // newer
    r(820, SHA_OLD, '2026-10-05T09:10:00Z'), // waiting, but no pending deployment (e.g. just approved)
    r(830, SHA_OLD, '2026-10-05T09:20:00Z'), // pending on another environment
  ];
  const res = await run({ runs, pending: { [ME]: pendingProd, 810: pendingProd, 950: pendingProd, 830: [{ environment: { name: 'staging' } }] } });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.cancels, []);
});

test('never lists or cancels a run that is deploying (in_progress)', async () => {
  const res = await run({ runs: [r(700, SHA_OLD, '2026-10-05T08:00:00Z', 'in_progress')], pending: { 700: pendingProd } });
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.cancels, []);
});

test('equal creation time: only a lower run id counts as older', async () => {
  const runs = [r(899, SHA_OLD, '2026-10-05T10:00:00Z'), r(901, SHA_OLD, '2026-10-05T10:00:00Z')];
  const res = await run({ runs, pending: { 899: pendingProd, 901: pendingProd } });
  assert.deepEqual(res.cancels, ['api -X POST repos/prix0007/cryoshield/actions/runs/899/cancel']);
});

test('fails on API errors and on invalid inputs', async () => {
  assert.notEqual((await run({ runs: [], env: { STUB_FAIL_READS: '1' } })).status, 0);
  assert.notEqual((await run({ runs: [r(800, SHA_OLD, '2026-10-05T09:00:00Z')], pending: { 800: pendingProd }, env: { STUB_FAIL_WRITES: '1' } })).status, 0);
  assert.equal((await run({ runs: [], env: { RUN_ID: 'x' } })).status, 2);
  assert.equal((await run({ runs: [], env: { TARGET_SHA: 'main' } })).status, 2);
});
