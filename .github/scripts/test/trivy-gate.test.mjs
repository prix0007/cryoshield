import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReadme, evaluateReports, lintIgnoreFile } from '../trivy-gate.mjs';

// Minimal shape of `trivy <fs|image|config> --format json` (v0.76.0, SchemaVersion 2).
const vuln = (id, sev, pkg = 'stdlib', ver = 'v1.26.8', fixed = '1.26.9') => ({
  VulnerabilityID: id, PkgName: pkg, InstalledVersion: ver, FixedVersion: fixed, Severity: sev, Title: `${id} title`,
});
const report = (target, vulns = [], misconfs = []) => ({
  SchemaVersion: 2,
  Results: [{ Target: target, Class: misconfs.length ? 'config' : 'lang-pkgs', Type: 'gobinary', Vulnerabilities: vulns, Misconfigurations: misconfs }],
});
const misconf = (id, sev, status = 'FAIL') => ({ ID: id, AVDID: `AVD-${id}`, Severity: sev, Status: status, Title: `${id} title` });

test('HIGH blocks and names target, package, version, advisory, severity and fix', () => {
  const r = evaluateReports([report('usr/bin/caddy', [vuln('CVE-2026-78667', 'HIGH')])]);
  assert.equal(r.ok, false);
  assert.equal(r.blocking.length, 1);
  assert.match(r.blocking[0], /usr\/bin\/caddy.*stdlib@v1\.26\.8.*CVE-2026-78667.*HIGH.*1\.26\.9/);
});

test('CRITICAL blocks', () => {
  assert.equal(evaluateReports([report('pnpm-lock.yaml', [vuln('CVE-1', 'CRITICAL', 'ws', '7.4.6', '8.0.0')])]).ok, false);
});

test('UNKNOWN severity blocks (fail closed), missing severity too', () => {
  assert.equal(evaluateReports([report('t', [vuln('GO-2026-5932', 'UNKNOWN', 'golang.org/x/crypto', 'v0.57.0', '')])]).ok, false);
  const r = evaluateReports([report('t', [{ VulnerabilityID: 'X-1', PkgName: 'p', InstalledVersion: '1' }])]);
  assert.equal(r.ok, false);
  assert.match(r.blocking[0], /X-1.*UNKNOWN.*none/);
});

test('MEDIUM and LOW only: passes but reports them', () => {
  const r = evaluateReports([report('t', [vuln('CVE-2026-85091', 'MEDIUM', 'zlib', '1.3.2-r0', '1.3.2-r1'), vuln('CVE-2026-56857', 'LOW')])]);
  assert.equal(r.ok, true);
  assert.equal(r.blocking.length, 0);
  assert.equal(r.advisory.length, 2);
});

test('misconfigurations: FAIL at HIGH blocks, LOW is advisory, PASS is ignored', () => {
  const high = evaluateReports([report('Dockerfile', [], [misconf('DS-0002', 'HIGH')])]);
  assert.equal(high.ok, false);
  assert.match(high.blocking[0], /Dockerfile.*DS-0002.*HIGH/);
  const low = evaluateReports([report('Dockerfile', [], [misconf('DS-0026', 'LOW'), misconf('DS-0001', 'CRITICAL', 'PASS')])]);
  assert.equal(low.ok, true);
  assert.equal(low.advisory.length, 1);
});

test('several reports are merged and identical lines appear once', () => {
  const r = evaluateReports([report('t', [vuln('CVE-1', 'HIGH')]), report('t', [vuln('CVE-1', 'HIGH')])]);
  assert.equal(r.blocking.length, 1);
});

test('empty or missing results pass', () => {
  assert.equal(evaluateReports([{ SchemaVersion: 2, Results: [] }, { SchemaVersion: 2 }, {}]).ok, true);
});

const TODAY = new Date('2026-10-16T00:00:00Z');
const ok = `vulnerabilities:
  - id: CVE-2026-78667
    statement: static site behind Fly's proxy; DoS only
    expired_at: 2026-12-31
  - id: GO-2026-5932
    paths:
      - usr/bin/caddy
    statement: openpgp is not reachable from a request
    expired_at: 2026-12-31
misconfigurations:
  - id: DS-0026
    statement: Fly runs its own health check
    expired_at: 2026-12-31
`;

test('a valid ignore file lints clean and returns its ids', () => {
  const r = lintIgnoreFile(ok, TODAY);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.ids, ['CVE-2026-78667', 'GO-2026-5932', 'DS-0026']);
});

test('empty ignore file is fine', () => {
  assert.deepEqual(lintIgnoreFile('', TODAY), { errors: [], ids: [] });
  assert.deepEqual(lintIgnoreFile('# nothing accepted\n', TODAY), { errors: [], ids: [] });
});

const one = (fields) => `vulnerabilities:\n  - ${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n    ')}\n`;

test('missing statement, missing expiry, far expiry, past-format expiry and bad id fail and name the line', () => {
  const cases = [
    [one({ id: 'CVE-1', expired_at: '2026-12-31' }), /line 2.*statement/],
    [one({ id: 'CVE-1', statement: 'x' }), /line 2.*expired_at/],
    [one({ id: 'CVE-1', statement: 'x', expired_at: '2027-03-01' }), /line 4.*90 days/],
    [one({ id: 'CVE-1', statement: 'x', expired_at: '31/12/2026' }), /line 4.*YYYY-MM-DD/],
    [one({ id: '"CVE 1"', statement: 'x', expired_at: '2026-12-31' }), /line 2.*id/],
    [one({ id: 'CVE-1', statement: '""', expired_at: '2026-12-31' }), /line 3.*statement/],
  ];
  for (const [text, re] of cases) {
    const { errors } = lintIgnoreFile(text, TODAY);
    assert.ok(errors.some((e) => re.test(e)), `${text}\n-> ${errors.join(' | ')}`);
  }
});

test('exactly 90 days ahead is accepted', () => {
  assert.deepEqual(lintIgnoreFile(one({ id: 'CVE-1', statement: 'x', expired_at: '2027-01-14' }), TODAY).errors, []);
});

test('unknown top-level keys (secrets, licenses) and unknown entry keys fail', () => {
  assert.match(lintIgnoreFile(`${ok}secrets:\n  - id: aws-access-key-id\n`, TODAY).errors.join(), /line 14.*secrets/);
  assert.match(lintIgnoreFile(one({ id: 'CVE-1', statement: 'x', expired_at: '2026-12-31', purls: '[]' }), TODAY).errors.join(), /line 5.*purls/);
});

test('anchors, aliases, explicit tags, several documents and non-list sections fail', () => {
  const anchor = `vulnerabilities:\n  - &a\n    id: CVE-1\n    statement: x\n    expired_at: 2026-12-31\n  - *a\n`;
  assert.match(lintIgnoreFile(anchor, TODAY).errors.join(), /anchor|alias/i);
  const tag = `vulnerabilities:\n  - id: !!str CVE-1\n    statement: x\n    expired_at: 2026-12-31\n`;
  assert.match(lintIgnoreFile(tag, TODAY).errors.join(), /tag/i);
  const docs = `${ok}---\nvulnerabilities: []\n`;
  assert.match(lintIgnoreFile(docs, TODAY).errors.join(), /one document/i);
  assert.match(lintIgnoreFile('vulnerabilities:\n  id: CVE-1\n', TODAY).errors.join(), /line 1.*list/);
  assert.match(lintIgnoreFile('vulnerabilities:\n  - CVE-1\n', TODAY).errors.join(), /line 2.*mapping/);
  assert.match(lintIgnoreFile('- id: CVE-1\n', TODAY).errors.join(), /mapping/);
});

test('paths must be a list of strings', () => {
  assert.match(lintIgnoreFile(one({ id: 'CVE-1', statement: 'x', expired_at: '2026-12-31', paths: 'usr/bin/caddy' }), TODAY).errors.join(), /line 5.*paths/);
});

test('duplicate ids fail', () => {
  assert.match(lintIgnoreFile(`${one({ id: 'CVE-1', statement: 'x', expired_at: '2026-12-31' })}  - id: CVE-1\n    statement: y\n    expired_at: 2026-12-31\n`, TODAY).errors.join(), /line 5.*duplicate/);
});

test('README check: every id must appear as a whole word', () => {
  assert.deepEqual(checkReadme('| CVE-2026-78667 | ... |\nGO-2026-5932 too', ['CVE-2026-78667', 'GO-2026-5932']), []);
  const errs = checkReadme('CVE-2026-786670 is not CVE-2026-78667', ['CVE-2026-78667', 'DS-0026']);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /DS-0026/);
});

const script = fileURLToPath(new URL('../trivy-gate.mjs', import.meta.url));
const run = ({ ignore = ok, readme = 'CVE-2026-78667 GO-2026-5932 DS-0026', reports = [report('t')] } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'trivy-gate-'));
  writeFileSync(join(dir, 'ignore.yaml'), ignore);
  writeFileSync(join(dir, 'README.md'), readme);
  const files = reports.map((r, i) => {
    const f = join(dir, `r${i}.json`);
    writeFileSync(f, JSON.stringify(r));
    return f;
  });
  return spawnSync(process.execPath, [script, '--ignore', join(dir, 'ignore.yaml'), '--readme', join(dir, 'README.md'), '--today', '2026-10-16', ...files], { encoding: 'utf8' });
};

test('CLI: clean reports and a listed ignore file pass', () => {
  const r = run({ reports: [report('t', [vuln('CVE-2026-85091', 'MEDIUM', 'zlib', '1.3.2-r0', '1.3.2-r1')])] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /zlib@1\.3\.2-r0/);
  assert.match(r.stdout, /no CRITICAL\/HIGH\/unknown/);
});

test('CLI: a HIGH finding exits 1 with an ::error annotation', () => {
  const r = run({ reports: [report('usr/bin/caddy', [vuln('CVE-2026-78667', 'HIGH')])] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /::error title=trivy::/);
  assert.match(r.stderr, /CVE-2026-78667/);
});

test('CLI: an excepted id missing from the README exits 1', () => {
  const r = run({ readme: 'CVE-2026-78667 only' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GO-2026-5932/);
});

test('CLI: an invalid ignore file exits 1 even with clean reports', () => {
  const r = run({ ignore: one({ id: 'CVE-1', statement: 'x' }), readme: 'CVE-1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /expired_at/);
});

test('CLI: missing arguments exit 2', () => {
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
