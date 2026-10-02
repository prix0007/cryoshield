import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateReport, lintIgnoreFile } from '../osv-gate.mjs';

// Minimal shape of `osv-scanner scan source --format json` (v2.6.0).
const report = (...pkgs) => ({
  results: [
    {
      source: { path: '/repo/pnpm-lock.yaml', type: 'lockfile' },
      packages: pkgs.map(([name, version, groups]) => ({
        package: { name, version, ecosystem: 'npm' },
        groups: groups.map(([id, sev]) => ({ ids: [id], aliases: [id], max_severity: sev })),
        vulnerabilities: groups.map(([id]) => ({ id })),
      })),
    },
  ],
});

test('HIGH fails and names package, version, advisory and lockfile', () => {
  const r = evaluateReport(report(['ws', '7.4.6', [['GHSA-3h5v-q93c-6h6q', '7.5']]]));
  assert.equal(r.ok, false);
  assert.equal(r.blocking.length, 1);
  assert.match(r.blocking[0], /ws@7\.4\.6.*GHSA-3h5v-q93c-6h6q.*7\.5.*pnpm-lock\.yaml/);
});

test('CRITICAL fails', () => {
  assert.equal(evaluateReport(report(['elliptic', '6.5.4', [['GHSA-vjh7-7g9h-fjfh', '9.0']]])).ok, false);
});

test('exactly 7.0 is HIGH and fails', () => {
  assert.equal(evaluateReport(report(['x', '1.0.0', [['GHSA-aaaa-bbbb-cccc', '7.0']]])).ok, false);
});

test('unscored vulnerability fails (fail closed)', () => {
  for (const sev of ['', undefined, 'n/a']) {
    assert.equal(evaluateReport(report(['x', '1.0.0', [['OSV-2026-1', sev]]])).ok, false, String(sev));
  }
});

test('MEDIUM and LOW only: passes but reports them', () => {
  const r = evaluateReport(report(['elliptic', '6.6.1', [['GHSA-848j-6mx2-7j84', '5.6'], ['GHSA-low', '2.0']]]));
  assert.equal(r.ok, true);
  assert.equal(r.blocking.length, 0);
  assert.equal(r.advisory.length, 2);
});

test('no findings passes', () => {
  assert.equal(evaluateReport({ results: [] }).ok, true);
  assert.equal(evaluateReport({}).ok, true);
});

const TODAY = new Date('2026-10-02T00:00:00Z');
const entry = (over = {}) => {
  const e = { id: '"GHSA-3h5v-q93c-6h6q"', ignoreUntil: '2026-11-01', reason: '"dev-only test oracle; see design"', ...over };
  return ['[[IgnoredVulns]]', ...Object.entries(e).filter(([, v]) => v !== null).map(([k, v]) => `${k} = ${v}`)].join('\n');
};

test('ignore file: valid entries pass', () => {
  assert.deepEqual(lintIgnoreFile(`# header\n\n${entry()}\n\n${entry({ ignoreUntil: '2026-12-31T00:00:00Z' })}\n`, TODAY), []);
  assert.deepEqual(lintIgnoreFile('# nothing ignored\n', TODAY), []);
});

test('ignore file: missing reason, id or expiry is rejected', () => {
  assert.match(lintIgnoreFile(entry({ reason: null }), TODAY).join(), /reason/);
  assert.match(lintIgnoreFile(entry({ reason: '""' }), TODAY).join(), /reason/);
  assert.match(lintIgnoreFile(entry({ id: null }), TODAY).join(), /id/);
  assert.match(lintIgnoreFile(entry({ ignoreUntil: null }), TODAY).join(), /ignoreUntil/);
});

test('ignore file: expiry more than 90 days ahead or unparseable is rejected', () => {
  assert.match(lintIgnoreFile(entry({ ignoreUntil: '2027-01-01' }), TODAY).join(), /90 days/);
  assert.match(lintIgnoreFile(entry({ ignoreUntil: 'soon' }), TODAY).join(), /ignoreUntil/);
});

test('ignore file: package-wide overrides and other tables are rejected', () => {
  assert.match(lintIgnoreFile('[[PackageOverrides]]\nname = "ws"\nignore = true\n', TODAY).join(), /PackageOverrides/);
  assert.match(lintIgnoreFile('GoVersionOverride = "1.22"\n', TODAY).join(), /outside/);
});

test('the committed ignore file is valid today', () => {
  const text = readFileSync(new URL('../../osv-scanner.toml', import.meta.url), 'utf8');
  assert.deepEqual(lintIgnoreFile(text, new Date()), []);
});

test('CLI: exit codes for clean, blocking, scanner error and bad ignore file', () => {
  const script = fileURLToPath(new URL('../osv-gate.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'osv-'));
  const cfg = join(dir, 'osv.toml');
  writeFileSync(cfg, `${entry()}\n`);
  const rep = join(dir, 'r.json');
  const cli = (exit, body, config = cfg) => {
    writeFileSync(rep, JSON.stringify(body));
    return spawnSync(process.execPath, [script, '--config', config, '--report', rep, '--scanner-exit', String(exit), '--today', '2026-10-02'], { encoding: 'utf8' });
  };
  assert.equal(cli(0, { results: [] }).status, 0);
  assert.equal(cli(1, report(['e', '1', [['GHSA-m', '5.0']]])).status, 0);
  const high = cli(1, report(['ws', '7.4.6', [['GHSA-h', '8.7']]]));
  assert.equal(high.status, 1);
  assert.match(high.stderr, /ws@7\.4\.6/);
  assert.equal(cli(127, { results: [] }).status, 1);
  assert.equal(cli(128, { results: [] }).status, 1);
  const badCfg = join(dir, 'bad.toml');
  writeFileSync(badCfg, entry({ reason: null }));
  assert.equal(cli(0, { results: [] }, badCfg).status, 1);
});

test('ignore file: TOML multiline-string smuggling is rejected (review HIGH-1)', () => {
  const smuggle = '[[IgnoredVulns]]\nid = "GHSA-x"\nignoreUntil = 2099-01-01\nreason = """\nignoreUntil = 2026-11-01 # """\n';
  assert.notDeepEqual(lintIgnoreFile(smuggle, TODAY), []);
  assert.notDeepEqual(lintIgnoreFile(entry({ reason: "'''multi" }), TODAY), []);
});

test('ignore file: duplicate keys, unknown keys, trailing comments and odd values are rejected', () => {
  assert.match(lintIgnoreFile(`${entry()}\nignoreUntil = 2026-10-03\n`, TODAY).join(), /duplicate/);
  assert.match(lintIgnoreFile(`${entry()}\neffectiveUntil = 2026-10-03\n`, TODAY).join(), /unknown key/);
  assert.notDeepEqual(lintIgnoreFile(entry({ ignoreUntil: '2026-11-01 # x' }), TODAY), []);
  assert.notDeepEqual(lintIgnoreFile(entry({ id: 'GHSA-bare' }), TODAY), []);
  assert.notDeepEqual(lintIgnoreFile(entry({ reason: '"a\\" b"' }), TODAY), []);
  assert.notDeepEqual(lintIgnoreFile('[[ "IgnoredVulns" ]]\n', TODAY), []);
});
