// Mainnet deployment-record gate (add-privacy-and-compliance 7.6; spec privacy-compliance "Mainnet gate").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  NON_MAINNET_CHAIN_IDS,
  REVIEW_LOG,
  WINDOW_DAYS,
  deploymentChainId,
  evaluate,
  launchRecordPath,
  parseReviewLog,
} from '../mainnet-gate.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../mainnet-gate.mjs', import.meta.url));
const PRESETS = JSON.parse(readFileSync(join(ROOT, 'config/chain-presets.json'), 'utf8'));
const TODAY = '2027-03-01';

const log = (...entries) => `# Compliance review log\n\nIntro text.\n\n${entries.join('\n\nSome notes.\n\n')}\n`;
const GATE_OK = '## 2027-02-20: mainnet-gate (reviewer: @prix0007)';
const run = (over) =>
  evaluate({
    added: [],
    reviewLog: log(GATE_OK),
    presets: PRESETS,
    exists: () => true,
    today: TODAY,
    ...over,
  });

test('deploymentChainId recognises only top-level deployment records', () => {
  assert.equal(deploymentChainId('contracts/deployments/10.json'), 10);
  assert.equal(deploymentChainId('contracts/deployments/42161.json'), 42161);
  assert.equal(deploymentChainId('contracts/deployments/README.md'), null);
  assert.equal(deploymentChainId('contracts/deployments/sub/10.json'), null);
  assert.equal(deploymentChainId('apps/web/test/fixtures/deployments/10.json'), null);
  assert.equal(deploymentChainId('contracts/deployments/010.json'), null);
});

test('no deployment record added: passes without reading anything', () => {
  const r = run({ added: ['README.md', 'apps/web/src/a.ts'], reviewLog: '', exists: () => false });
  assert.equal(r.ok, true);
});

test('testnet and local records never need the gate', () => {
  for (const id of [31337, 11155420, 421614]) {
    const r = run({ added: [`contracts/deployments/${id}.json`], reviewLog: '', exists: () => false });
    assert.equal(r.ok, true, String(id));
  }
});

test('mainnet record without a launch record fails and names the record and the missing file', () => {
  const r = run({ added: ['contracts/deployments/10.json'], exists: (p) => p !== 'docs/reviews/launch-op-mainnet.md' });
  assert.equal(r.ok, false);
  assert.match(r.message, /contracts\/deployments\/10\.json/);
  assert.match(r.message, /docs\/reviews\/launch-op-mainnet\.md/);
});

test('mainnet record with launch record and a recent mainnet-gate entry passes', () => {
  const r = run({ added: ['contracts/deployments/10.json'] });
  assert.equal(r.ok, true, r.message);
});

test('mainnet record without any mainnet-gate entry fails', () => {
  const r = run({ added: ['contracts/deployments/10.json'], reviewLog: log('## 2027-02-28: six-monthly (reviewer: @prix0007)') });
  assert.equal(r.ok, false);
  assert.match(r.message, /mainnet-gate/);
  assert.match(r.message, new RegExp(REVIEW_LOG.replace(/[./]/g, '\\$&')));
});

test(`a mainnet-gate entry older than ${WINDOW_DAYS} days fails; exactly ${WINDOW_DAYS} days passes`, () => {
  const stale = run({ added: ['contracts/deployments/10.json'], reviewLog: log('## 2027-01-29: mainnet-gate (reviewer: @prix0007)') });
  assert.equal(stale.ok, false);
  assert.match(stale.message, /30 days/);
  const edge = run({ added: ['contracts/deployments/10.json'], reviewLog: log('## 2027-01-30: mainnet-gate (reviewer: @prix0007)') });
  assert.equal(edge.ok, true, edge.message);
});

test('a future-dated mainnet-gate entry does not count', () => {
  const r = run({ added: ['contracts/deployments/10.json'], reviewLog: log('## 2027-03-02: mainnet-gate (reviewer: @prix0007)') });
  assert.equal(r.ok, false);
});

test('an entry that only mentions mainnet-gate in its body, or has no reviewer, does not count', () => {
  const body = run({
    added: ['contracts/deployments/10.json'],
    reviewLog: log('## 2027-02-20: six-monthly (reviewer: @prix0007)\n\nNext: mainnet-gate before launch.'),
  });
  assert.equal(body.ok, false);
  const noReviewer = run({ added: ['contracts/deployments/10.json'], reviewLog: log('## 2027-02-20: mainnet-gate') });
  assert.equal(noReviewer.ok, false);
});

test('an unknown chain id is treated as mainnet and fails closed', () => {
  const r = run({ added: ['contracts/deployments/8453.json'] });
  assert.equal(r.ok, false);
  assert.match(r.message, /8453/);
  assert.match(r.message, /chain-presets\.json/);
});

test('another mainnet preset needs its own launch record', () => {
  assert.equal(launchRecordPath(42161, PRESETS), 'docs/reviews/launch-arbitrum-one.md');
  const r = run({ added: ['contracts/deployments/42161.json'], exists: (p) => p !== 'docs/reviews/launch-arbitrum-one.md' });
  assert.equal(r.ok, false);
  assert.match(r.message, /launch-arbitrum-one\.md/);
});

test('parseReviewLog reads date, kinds and reviewer from level-2 headings only', () => {
  const entries = parseReviewLog(
    log('## 2026-10-08: claims-check, six-monthly (reviewer: security-reviewer agent)', '### 2026-10-09: mainnet-gate (reviewer: x)'),
  );
  assert.deepEqual(entries, [{ date: '2026-10-08', kinds: ['claims-check', 'six-monthly'], reviewer: 'security-reviewer agent' }]);
  assert.deepEqual(parseReviewLog('## 2026-02-30: mainnet-gate (reviewer: x)'), []); // not a real date
});

test('the non-mainnet allow-list equals the local and testnet presets of contracts/script/deploy.sh', () => {
  const sh = readFileSync(join(ROOT, 'contracts/script/deploy.sh'), 'utf8');
  const table = sh.match(/PRESETS="\n([\s\S]*?)\n"/)[1];
  const rows = table.split('\n').filter((l) => l.trim()).map((l) => l.trim().split(/\s+/));
  const nonMainnet = rows.filter((r) => r[4] === 'local' || r[4] === 'testnet').map((r) => Number(r[1]));
  assert.deepEqual([...NON_MAINNET_CHAIN_IDS].sort((a, b) => a - b), nonMainnet.sort((a, b) => a - b));
  for (const r of rows) assert.ok(PRESETS.presets.some((p) => p.chainId === Number(r[1])), `${r[0]} in chain-presets.json`);
});

test('the real review log parses and every entry names a reviewer', () => {
  const entries = parseReviewLog(readFileSync(join(ROOT, REVIEW_LOG), 'utf8'));
  assert.ok(entries.length >= 1);
  for (const e of entries) assert.ok(e.reviewer.length > 0);
});

test('CI runs the gate on pull requests over the files the PR adds', () => {
  const ci = parse(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
  const steps = ci.jobs['pr-checks'].steps;
  const step = steps.find((s) => typeof s.run === 'string' && s.run.includes('.github/scripts/mainnet-gate.mjs'));
  assert.ok(step, 'pr-checks has a mainnet-gate step');
  assert.match(step.run, /--diff-filter=A/);
  assert.match(step.run, /--no-renames/);
  assert.match(step.run, /\$\{BASE_SHA\}\.\.\.\$\{HEAD_SHA\}/);
});

function fixture({ withLaunch = true, logText = log(GATE_OK) } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mainnet-gate-'));
  mkdirSync(join(dir, 'config'), { recursive: true });
  mkdirSync(join(dir, 'docs/compliance'), { recursive: true });
  mkdirSync(join(dir, 'docs/reviews'), { recursive: true });
  writeFileSync(join(dir, 'config/chain-presets.json'), JSON.stringify(PRESETS));
  writeFileSync(join(dir, REVIEW_LOG), logText);
  if (withLaunch) writeFileSync(join(dir, 'docs/reviews/launch-op-mainnet.md'), '# Launch record\n');
  writeFileSync(join(dir, 'added'), 'contracts/deployments/10.json\0README.md\0');
  return dir;
}
const cli = (dir) =>
  spawnSync(process.execPath, [SCRIPT, join(dir, 'added'), '--root', dir, '--today', TODAY], { encoding: 'utf8' });

test('CLI exits 0 with a launch record and a recent gate entry', () => {
  const r = cli(fixture());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /10\.json/);
});

test('CLI exits 1 with an ::error annotation when the launch record is missing', () => {
  const r = cli(fixture({ withLaunch: false }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /::error title=Mainnet gate::/);
});

test('CLI exits 2 on bad input', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  const bad = spawnSync(process.execPath, [SCRIPT, join(fixture(), 'added'), '--today', '2027-13-01'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});
