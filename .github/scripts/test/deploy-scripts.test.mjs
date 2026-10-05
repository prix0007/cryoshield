// add-continuous-deploy: detect.sh, previous-image.sh, smoke.sh and rollback.sh, against a local HTTP server
// standing in for https://cryoshield.app and a stub flyctl.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = (n) => fileURLToPath(new URL(`../deploy/${n}`, import.meta.url));
const flyStub = fileURLToPath(new URL('./fixtures/fly-stub.sh', import.meta.url));
chmodSync(flyStub, 0o755);

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const ADDRESS = '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44';
const IMAGE = 'registry.fly.io/cryoshield-web:deployment-01M41Z2MXSZQKZWXR97MSQG02X';
const GOOD_HEADERS = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

// Mutable site state per test.
let site;
const healthySite = () => ({
  release: { status: 200, body: JSON.stringify({ name: 'cryoshield-web', commit: SHA, treeHash: 'sha256:' + 'c'.repeat(64) }) },
  status: {},
  headers: { ...GOOD_HEADERS },
  architecture: `<td class="mono">${ADDRESS.toLowerCase()}</td>`,
  support: `<code id="donation-address">${DONATION}</code>`,
  robots: null, // body of /robots.txt (404 when null)
  hits: {},
  healthyAfter: 0, // number of /healthz-or-page requests before the site turns healthy (rolling deploy)
});

let server;
let base;
before(async () => {
  server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    site.hits[path] = (site.hits[path] ?? 0) + 1;
    const total = Object.values(site.hits).reduce((a, b) => a + b, 0);
    if (total <= site.healthyAfter) {
      res.writeHead(503);
      return res.end('starting');
    }
    if (path === '/release.json') {
      res.writeHead(site.release.status, { 'content-type': 'application/json', ...site.headers });
      return res.end(site.release.body);
    }
    if (path === "/robots.txt" && site.robots !== null) {
      res.writeHead(200, { "content-type": "text/plain", ...site.headers });
      return res.end(site.robots);
    }
    const known = ['/', '/app/', '/architecture', '/devices', '/support', '/privacy', '/healthz'];
    if (!known.includes(path)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(site.status[path] ?? 200, { 'content-type': 'text/html', ...site.headers });
    res.end(path === '/architecture' ? site.architecture : path === '/support' ? site.support : path === '/healthz' ? 'ok' : '<html></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function run(name, env = {}, { path = script(name), timeout = 30_000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-scripts-'));
  const output = join(dir, 'github_output');
  const flyLog = join(dir, 'fly.log');
  writeFileSync(output, '');
  return new Promise((resolve, reject) => {
    execFile('bash', [path], {
      env: { PATH: process.env.PATH, BASE_URL: base, GITHUB_OUTPUT: output, FLY_API_TOKEN: 'test-token', FLY: flyStub, FLY_LOG: flyLog, SMOKE_SLEEP: '0', ROLLBACK_SLEEP: '0', ...env },
      encoding: 'utf8',
      timeout,
    }, (err, stdout, stderr) => {
      // A script that never ran (spawn error) or was killed (timeout/signal) must fail the test, not count as
      // "exited non-zero" (ECC review #11).
      if (err && (typeof err.code !== 'number' || err.signal)) {
        return reject(new Error(`${name} did not exit normally (code ${err.code}, signal ${err.signal})\n${stderr}`));
      }
      resolve({
        status: err ? err.code : 0,
        stdout,
        stderr,
        output: readFileSync(output, 'utf8'),
        fly: existsSync(flyLog) ? readFileSync(flyLog, 'utf8').trim().split('\n') : [],
      });
    });
  });
}

// ---- write-env.sh ----
const FULL_ENV = {
  VITE_CHAIN_ID: '11155420',
  VITE_RPC_URL: 'https://sepolia.optimism.io',
  VITE_BUNDLER_URL: 'https://api.pimlico.io/v2/optimism-sepolia/rpc?apikey=pim_TEST',
  VITE_SPONSORSHIP_POLICY_ID: 'sp_test',
  VITE_TURBO_UPLOAD_URL: 'https://upload.ardrive.io',
  VITE_ARWEAVE_GATEWAY_URL: 'https://arweave.net',
  VITE_RP_ID: 'cryoshield.app',
  VITE_RP_NAME: 'CryoShield',
};

test('write-env: writes every set key in a fixed order, masks the bundler URL, 0600, never echoes values', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
  const r = await run('write-env.sh', { ...FULL_ENV, VITE_CF_BEACON_TOKEN: 'ab'.repeat(16), OUT: out });
  assert.equal(r.status, 0, r.stderr);
  const lines = readFileSync(out, 'utf8').trim().split('\n');
  assert.deepEqual(lines.map((l) => l.split('=')[0]), [...Object.keys(FULL_ENV), 'VITE_CF_BEACON_TOKEN']);
  assert.ok(lines.includes(`VITE_BUNDLER_URL=${FULL_ENV.VITE_BUNDLER_URL}`));
  assert.match(r.stdout, new RegExp(`^::add-mask::${FULL_ENV.VITE_BUNDLER_URL.replace(/[?.]/g, '\\$&')}$`, 'm'));
  const visible = r.stdout.split('\n').filter((l) => !l.startsWith('::add-mask::')).join('\n') + r.stderr;
  assert.doesNotMatch(visible, /pim_TEST|sp_test/);
  assert.equal((await import('node:fs')).statSync(out).mode & 0o777, 0o600);
});

test('write-env: optional keys may be absent; a missing required key fails naming only the key', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
  assert.equal((await run('write-env.sh', { ...FULL_ENV, OUT: out })).status, 0);
  const { VITE_BUNDLER_URL: _omit, ...rest } = FULL_ENV;
  const r = await run('write-env.sh', { ...rest, OUT: join(mkdtempSync(join(tmpdir(), 'env-')), '.env') });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /VITE_BUNDLER_URL/);
});

test('write-env: refuses newlines (key injection) and an existing file', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
  const r = await run('write-env.sh', { ...FULL_ENV, VITE_RP_NAME: 'x\nVITE_RP_ID=evil.com', OUT: out });
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(out), false);
  writeFileSync(out, 'x');
  assert.notEqual((await run('write-env.sh', { ...FULL_ENV, OUT: out })).status, 0);
});

test('write-env: refuses values dotenv would reinterpret: leading quote/backtick, " #" comments (ECC #6)', async () => {
  for (const bad of ['"CryoShield"', "'CryoShield'", '`CryoShield`', 'CryoShield #1', 'Cryo\tShield #x']) {
    const out = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
    const r = await run('write-env.sh', { ...FULL_ENV, VITE_RP_NAME: bad, OUT: out });
    assert.notEqual(r.status, 0, JSON.stringify(bad));
    assert.match(r.stdout + r.stderr, /VITE_RP_NAME/);
    assert.equal(existsSync(out), false);
  }
  // A '#' that dotenv keeps (no preceding whitespace) is fine, as in URL fragments.
  const ok = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
  assert.equal((await run('write-env.sh', { ...FULL_ENV, VITE_RP_NAME: 'Cryo#Shield', OUT: ok })).status, 0);
});

test('write-env: refuses $ (Vite dotenv expansion would rewrite the value) (review L2)', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
  const r = await run('write-env.sh', { ...FULL_ENV, VITE_RP_NAME: 'Cryo$HOME', OUT: out });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /VITE_RP_NAME/);
  assert.equal(existsSync(out), false);
});

// ---- detect.sh ----
test('detect: live commit equals main -> deploy=false', async () => {
  site = healthySite();
  const r = await run('detect.sh', { TARGET_SHA: SHA });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.output, /^deploy=false$/m);
});

test('detect: different commit, 404, invalid JSON, bad commit field, or unreachable -> deploy=true', async () => {
  for (const release of [
    { status: 200, body: JSON.stringify({ commit: OTHER }) },
    { status: 404, body: '' },
    { status: 200, body: 'not json' },
    { status: 200, body: JSON.stringify({ commit: 'zz' }) },
  ]) {
    site = { ...healthySite(), release };
    const r = await run('detect.sh', { TARGET_SHA: SHA });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.output, /^deploy=true$/m, JSON.stringify(release));
  }
  const r = await run('detect.sh', { TARGET_SHA: SHA, BASE_URL: 'http://127.0.0.1:9' });
  assert.match(r.output, /^deploy=true$/m);
});

test('detect: a run whose commit is no longer main HEAD is superseded (deploy=false), even when forced', async () => {
  site = { ...healthySite(), release: { status: 404, body: '' } };
  for (const FORCE of ['false', 'true']) {
    const r = await run('detect.sh', { TARGET_SHA: SHA, MAIN_SHA: OTHER, FORCE });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.output, /^deploy=false$/m);
    assert.match(r.stdout, /superseded/);
  }
  assert.equal((await run('detect.sh', { TARGET_SHA: SHA, MAIN_SHA: 'nope' })).status, 2);
});

test('detect: a commit whose earlier deploy or smoke failed is not retried every 15 minutes, unless forced (review M2)', async () => {
  site = { ...healthySite(), release: { status: 200, body: JSON.stringify({ commit: OTHER }) } };
  const skipped = await run('detect.sh', { TARGET_SHA: SHA, PREVIOUSLY_FAILED: 'true' });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.output, /^deploy=false$/m);
  assert.match(skipped.stdout, /previously failed/);
  assert.match((await run('detect.sh', { TARGET_SHA: SHA, PREVIOUSLY_FAILED: 'true', FORCE: 'true' })).output, /^deploy=true$/m);
  assert.match((await run('detect.sh', { TARGET_SHA: SHA, PREVIOUSLY_FAILED: 'false' })).output, /^deploy=true$/m);
});

test('detect: FORCE=true always deploys; an invalid TARGET_SHA exits 2', async () => {
  site = healthySite();
  assert.match((await run('detect.sh', { TARGET_SHA: SHA, FORCE: 'true' })).output, /^deploy=true$/m);
  assert.equal((await run('detect.sh', { TARGET_SHA: 'main' })).status, 2);
});

// ---- previous-image.sh ----
const releases = (list) => {
  const f = join(mkdtempSync(join(tmpdir(), 'rel-')), 'r.json');
  writeFileSync(f, JSON.stringify(list));
  return f;
};

test('previous-image: newest complete release ImageRef', async () => {
  const f = releases([
    { Version: 8, Status: 'failed', ImageRef: 'registry.fly.io/cryoshield-web:deployment-01M41Z2MXSZQKZWXR97MSQG0ZZ' },
    { Version: 7, Status: 'complete', ImageRef: IMAGE },
    { Version: 6, Status: 'complete', ImageRef: 'registry.fly.io/cryoshield-web:deployment-01M419CTD8JK4CP2H2HRG21AF6' },
  ]);
  const r = await run('previous-image.sh', { STUB_RELEASES: f });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.output, new RegExp(`^previous_image=${IMAGE}$`, 'm'));
  assert.deepEqual(r.fly, ['releases --app cryoshield-web --json --image']);
});

test('previous-image: no complete release -> empty output (first deploy), not an error', async () => {
  const r = await run('previous-image.sh', { STUB_RELEASES: releases([]) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.output, /^previous_image=$/m);
});

test('previous-image: an empty FLY_API_TOKEN fails with a clear "not configured" error before calling fly (deploy-skip-when-unconfigured)', async () => {
  const r = await run('previous-image.sh', { STUB_RELEASES: releases([]), FLY_API_TOKEN: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /::error title=deploy not configured::FLY_API_TOKEN/);
  assert.match(r.stdout, /docs\/deploy\.md/);
  assert.deepEqual(r.fly.filter(Boolean), []);
});

test('previous-image: an unexpected ImageRef or a fly error fails', async () => {
  for (const ref of ['docker.io/evil/image:latest', 'registry.fly.io/other-app:deployment-01M41Z2MXSZQKZWXR97MSQG02X', 'registry.fly.io/cryoshield-web:latest; rm -rf /']) {
    const r = await run('previous-image.sh', { STUB_RELEASES: releases([{ Status: 'complete', ImageRef: ref }]) });
    assert.notEqual(r.status, 0, ref);
  }
  const r = await run('previous-image.sh', { STUB_RELEASES: releases([]), STUB_FLY_FAIL: '1' });
  assert.notEqual(r.status, 0);
});

// ---- smoke.sh ----
const DONATION = '0xfb4172e26AC8735C06656f1df14151cFe8441481';
const smokeEnv = (over = {}) => ({ EXPECT_SHA: SHA, REGISTRY_ADDRESS: ADDRESS, DONATION_ADDRESS: DONATION, SMOKE_ATTEMPTS: '2', ...over });

test('smoke: a healthy release passes', async () => {
  site = healthySite();
  const r = await run('smoke.sh', smokeEnv());
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('smoke: every failure class fails and is named', async () => {
  const cases = [
    [{ status: { '/app/': 500 } }, /\/app\/.*500/],
    [{ status: { '/privacy': 404 } }, /\/privacy.*404/],
    [{ headers: { ...GOOD_HEADERS, 'x-frame-options': 'SAMEORIGIN' } }, /x-frame-options/i],
    [{ headers: Object.fromEntries(Object.entries(GOOD_HEADERS).filter(([k]) => k !== 'strict-transport-security')) }, /strict-transport-security/i],
    [{ headers: { ...GOOD_HEADERS, 'content-security-policy': "default-src 'none'" } }, /frame-ancestors/],
    [{ architecture: '<td>0x0000000000000000000000000000000000000000</td>' }, /registry address/],
    [{ release: { status: 200, body: JSON.stringify({ commit: OTHER }) } }, /release\.json.*bbbb/],
    [{ support: `<code>${DONATION.toLowerCase()}</code>` }, /does not show the donation address/],
    [{ support: `<code>${DONATION}</code><code>0x1111111111111111111111111111111111111111</code>` }, /another address/],
  ];
  for (const [over, why] of cases) {
    site = { ...healthySite(), ...over };
    const r = await run('smoke.sh', smokeEnv());
    assert.notEqual(r.status, 0, JSON.stringify(over));
    assert.match(r.stdout + r.stderr, why, JSON.stringify(over));
  }
});

test('smoke: retries until the rolling deploy is healthy', async () => {
  site = { ...healthySite(), healthyAfter: 3 };
  const r = await run('smoke.sh', smokeEnv({ SMOKE_ATTEMPTS: '3' }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('smoke: rejects malformed inputs', async () => {
  site = healthySite();
  assert.equal((await run('smoke.sh', smokeEnv({ EXPECT_SHA: 'main' }))).status, 2);
  assert.equal((await run('smoke.sh', smokeEnv({ REGISTRY_ADDRESS: '0x12' }))).status, 2);
  assert.equal((await run('smoke.sh', smokeEnv({ DONATION_ADDRESS: '' }))).status, 2);
});

// ---- rollback.sh ----
test('rollback: deploys exactly the recorded image, then waits for /healthz', async () => {
  site = healthySite();
  const r = await run('rollback.sh', { PREVIOUS_IMAGE: IMAGE });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.fly, [`deploy --app cryoshield-web --config apps/web/fly.toml --image ${IMAGE}`]);
  assert.match(r.stdout, /rolled back/);
});

test('rollback: no recorded image fails loudly without calling fly', async () => {
  const r = await run('rollback.sh', { PREVIOUS_IMAGE: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /no previous image/i);
  assert.deepEqual(r.fly, []);
});

test('rollback: refuses an unexpected image ref, and fails if fly or /healthz fails', async () => {
  site = healthySite();
  const bad = await run('rollback.sh', { PREVIOUS_IMAGE: 'docker.io/evil/x:1' });
  assert.notEqual(bad.status, 0);
  assert.deepEqual(bad.fly, []);
  assert.notEqual((await run('rollback.sh', { PREVIOUS_IMAGE: IMAGE, STUB_FLY_FAIL: '1' })).status, 0);
  site = { ...healthySite(), status: { '/healthz': 503 } };
  assert.notEqual((await run('rollback.sh', { PREVIOUS_IMAGE: IMAGE, ROLLBACK_ATTEMPTS: '2' })).status, 0);
});

// ---- split-dev-and-release-deploys: per-target parameters ----
const DEV_IMAGE = 'registry.fly.io/cryoshield-web-dev:deployment-01M41Z2MXSZQKZWXR97MSQG02X';
const NOINDEX = 'noindex, nofollow';
const devSite = () => ({ ...healthySite(), headers: { ...GOOD_HEADERS, 'x-robots-tag': NOINDEX } });

test('smoke: EXPECT_NOINDEX=true (dev) passes only with X-Robots-Tag: noindex, nofollow on every page (robots.txt is not used)', async () => {
  site = devSite();
  const ok = await run('smoke.sh', smokeEnv({ EXPECT_NOINDEX: 'true' }));
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  // whatever robots.txt the build ships (or none) does not matter for dev: the header is the control
  site = { ...devSite(), robots: 'User-agent: *\nAllow: /\n' };
  assert.equal((await run('smoke.sh', smokeEnv({ EXPECT_NOINDEX: 'true' }))).status, 0);
  const cases = [
    [{ headers: { ...GOOD_HEADERS } }, /x-robots-tag/],
    [{ headers: { ...GOOD_HEADERS, 'x-robots-tag': 'nofollow' } }, /x-robots-tag/],
    [{ headers: { ...GOOD_HEADERS, 'x-robots-tag': 'noindex' } }, /x-robots-tag/],
  ];
  for (const [over, why] of cases) {
    site = { ...devSite(), ...over };
    const r = await run('smoke.sh', smokeEnv({ EXPECT_NOINDEX: 'true' }));
    assert.notEqual(r.status, 0, JSON.stringify(over));
    assert.match(r.stdout + r.stderr, why, JSON.stringify(over));
  }
});

test('smoke: production (EXPECT_NOINDEX=false, the default) fails if any page says noindex (dev Caddyfile shipped)', async () => {
  site = devSite();
  for (const env of [{ EXPECT_NOINDEX: 'false' }, {}]) {
    const r = await run('smoke.sh', smokeEnv(env));
    assert.notEqual(r.status, 0, JSON.stringify(env));
    assert.match(r.stdout + r.stderr, /noindex/);
  }
  site = healthySite();
  assert.equal((await run('smoke.sh', smokeEnv({ EXPECT_NOINDEX: 'false' }))).status, 0);
  assert.equal((await run('smoke.sh', smokeEnv({ EXPECT_NOINDEX: 'yes' }))).status, 2);
});

test('previous-image and rollback work for the dev app and config, and refuse the other app\'s images', async () => {
  const f = releases([{ Status: 'complete', ImageRef: DEV_IMAGE }]);
  const prev = await run('previous-image.sh', { STUB_RELEASES: f, APP: 'cryoshield-web-dev' });
  assert.equal(prev.status, 0, prev.stderr);
  assert.match(prev.output, new RegExp(`^previous_image=${DEV_IMAGE}$`, 'm'));
  assert.deepEqual(prev.fly, ['releases --app cryoshield-web-dev --json --image']);
  // a production image never lands on dev, nor a dev image on production
  assert.notEqual((await run('previous-image.sh', { STUB_RELEASES: releases([{ Status: 'complete', ImageRef: IMAGE }]), APP: 'cryoshield-web-dev' })).status, 0);
  assert.notEqual((await run('previous-image.sh', { STUB_RELEASES: f })).status, 0);
  site = healthySite();
  const rb = await run('rollback.sh', { PREVIOUS_IMAGE: DEV_IMAGE, APP: 'cryoshield-web-dev', CONFIG: 'apps/web/fly.dev.toml' });
  assert.equal(rb.status, 0, rb.stdout + rb.stderr);
  assert.deepEqual(rb.fly, [`deploy --app cryoshield-web-dev --config apps/web/fly.dev.toml --image ${DEV_IMAGE}`]);
  assert.notEqual((await run('rollback.sh', { PREVIOUS_IMAGE: IMAGE, APP: 'cryoshield-web-dev', CONFIG: 'apps/web/fly.dev.toml' })).status, 0);
});

test('previous-image: the "not configured" error names the target environment (DEPLOY_ENVIRONMENT)', async () => {
  const r = await run('previous-image.sh', { STUB_RELEASES: releases([]), FLY_API_TOKEN: '', DEPLOY_ENVIRONMENT: 'development' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /add it to the development environment/);
  const bad = await run('previous-image.sh', { STUB_RELEASES: releases([]), DEPLOY_ENVIRONMENT: 'prod;x' });
  assert.equal(bad.status, 2);
});

test('harness: a hung (killed) script fails the test instead of counting as a non-zero exit (ECC #11)', async () => {
  const hang = join(mkdtempSync(join(tmpdir(), 'hang-')), 'hang.sh');
  writeFileSync(hang, 'sleep 5\n');
  await assert.rejects(run('hang.sh', {}, { path: hang, timeout: 300 }), /did not exit normally/);
});
