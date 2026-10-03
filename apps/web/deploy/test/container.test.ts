// @vitest-environment node
/**
 * add-fly-hosting 2.1/2.2: build the real image from a production-mode build and assert what it serves.
 * Requires Docker. Uses a production build for host cryoshield.app against the local chain record (31337).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LANDING_PERMISSIONS_POLICY, SECURITY_HEADERS } from '../../vite-plugins/security-headers';

const web = join(__dirname, '..', '..');
const IMAGE = 'cryoshield-web:test';
const NAME = `cs-web-test-${process.pid}`;
const PORT = 18080;
const DIST = join(web, 'deploy', '.test-dist');
const RELEASE_COMMIT = 'd'.repeat(40);
const ENV = {
  VITE_CHAIN_ID: '31337',
  VITE_RPC_URL: 'https://rpc.verify.invalid',
  VITE_BUNDLER_URL: 'https://bundler.verify.invalid/rpc',
  VITE_SPONSORSHIP_POLICY_ID: 'sp_verify',
  VITE_TURBO_UPLOAD_URL: 'https://upload.ardrive.io',
  VITE_ARWEAVE_GATEWAY_URL: 'https://arweave.net',
  VITE_RP_ID: 'cryoshield.app',
  VITE_RP_NAME: 'CryoShield',
  // Landing analytics on (add-privacy-preserving-analytics 4.4): per-route CSP and Permissions-Policy.
  VITE_CF_BEACON_TOKEN: 'ab'.repeat(16),
};
const sh = (cmd: string, args: string[], opts: object = {}) => execFileSync(cmd, args, { cwd: web, encoding: 'utf8', stdio: 'pipe', ...opts });

function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, base) : [p.slice(base.length + 1)];
  });
}

function get(path: string, host = 'cryoshield.app'): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  sh('pnpm', ['exec', 'vite', 'build', '--mode', 'production', '--outDir', DIST, '--emptyOutDir'], { env: { ...process.env, ...ENV, NODE_ENV: 'production' } });
  sh('node', ['deploy/gen-context.mjs', '--dist', DIST, '--out', 'deploy/.build', '--host', 'cryoshield.app']);
  // As deploy.sh does (add-continuous-deploy 1.2): publish site/release.json for the container to serve.
  const envFile = join(mkdtempSync(join(tmpdir(), 'cs-release-')), '.env');
  writeFileSync(envFile, Object.entries(ENV).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  sh('node', ['deploy/release-manifest.mjs', '--site', 'deploy/.build/site', '--out', 'deploy/.build/release-manifest.json',
    '--commit', RELEASE_COMMIT, '--env', envFile, '--contracts', join(web, '..', '..', 'contracts'), '--site-release']);
  sh('docker', ['build', '-q', '-t', IMAGE, '-f', 'deploy/Dockerfile', '.']);
  sh('docker', ['run', '-d', '--rm', '--name', NAME, '-p', `127.0.0.1:${PORT}:8080`, IMAGE]);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await get('/healthz')).status === 200) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('container did not start');
});

afterAll(() => {
  try {
    sh('docker', ['rm', '-f', NAME]);
  } catch {
    /* already gone */
  }
});

const metaCsp = (html: string) => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)![1]!;

describe('served by the container', () => {
  it('/ carries every security header, CSP = served meta CSP + frame-ancestors, and no Server header', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toBe(`${metaCsp(r.body)}; frame-ancestors 'none'`);
    for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, 'Permissions-Policy': LANDING_PERMISSIONS_POLICY })) expect(r.headers[k.toLowerCase()], k).toBe(v);
    expect(r.headers['server']).toBeUndefined();
    expect(r.headers['cache-control']).toBe('no-cache');
  });

  it.each(['/', '/index.html'])('%s gets the landing CSP (+ analytics sources only) and a Permissions-Policy without WebAuthn (analytics 4.4)', async (p) => {
    const r = await get(p);
    const csp = r.headers['content-security-policy'] as string;
    expect(csp).toBe(`${metaCsp(r.body)}; frame-ancestors 'none'`);
    expect(csp).toContain('https://cloudflareinsights.com');
    expect(csp).toContain("script-src 'self' https://static.cloudflareinsights.com/beacon.min.js;");
    expect(r.headers['permissions-policy']).toContain('publickey-credentials-get=()');
    expect(r.headers['permissions-policy']).toContain('publickey-credentials-create=()');
    expect(r.body).toContain('<template id="cf-beacon" data-host="cryoshield.app">');
  });

  it.each(['/app', '/app/', '/app/index.html', '/privacy', '/terms', '/cookies', '//', '/App/', '/%2F', '/nope', '/app/nope'])(
    '%s gets the app CSP with no Cloudflare origin (analytics 4.4)',
    async (p) => {
      const app = await get('/app/');
      const r = await get(p);
      expect(r.headers['content-security-policy'], p).toBe(app.headers['content-security-policy']);
      expect(r.headers['content-security-policy'], p).not.toMatch(/cloudflareinsights/);
    },
  );

  it.each(['/app/', '/app/index.html', '/privacy', '/nope'])('%s allows WebAuthn for self', async (p) => {
    expect((await get(p)).headers['permissions-policy']).toBe(SECURITY_HEADERS['Permissions-Policy']);
  });

  it('// serves the landing document, so it gets no WebAuthn too (and the app CSP: no beacon can load there)', async () => {
    const r = await get('//');
    expect(r.headers['permissions-policy']).toBe(LANDING_PERMISSIONS_POLICY);
    expect(r.headers['content-security-policy']).not.toMatch(/cloudflareinsights/);
  });

  it('/index.html is no-cache; hashed assets are immutable', async () => {
    const r = await get('/index.html');
    expect(r.headers['cache-control']).toBe('no-cache');
    const asset = r.body.match(/src="(\/assets\/[^"]+\.js)"/)![1]!;
    const a = await get(asset);
    expect(a.status).toBe(200);
    expect(a.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(a.headers['x-frame-options']).toBe('DENY');
  });

  it.each(['/does-not-exist', '/_headers', '/assets/', '/.env'])('%s is 404 with security headers and no Server', async (p) => {
    const r = await get(p);
    expect(r.status).toBe(404);
    expect(r.headers['content-security-policy']).toMatch(/frame-ancestors 'none'$/);
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['strict-transport-security']).toBe(SECURITY_HEADERS['Strict-Transport-Security']);
    expect(r.headers['server']).toBeUndefined();
  });

  it('/app/ serves the vault app with every header, its own app CSP (not the landing one), and no-cache (2.4, analytics 4.4)', async () => {
    const landing = await get('/');
    const app = await get('/app/');
    expect(app.status).toBe(200);
    expect(app.body).toContain('<div id="root">');
    expect(landing.body).toContain('Backups that outlive the drive.');
    expect(app.headers['content-security-policy']).toBe(`${metaCsp(app.body)}; frame-ancestors 'none'`);
    expect(app.headers['content-security-policy']).not.toBe(landing.headers['content-security-policy']);
    expect(app.body).not.toMatch(/cloudflareinsights|cf-beacon/);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(app.headers[k.toLowerCase()], k).toBe(v);
    expect(app.headers['server']).toBeUndefined();
    expect(app.headers['cache-control']).toBe('no-cache');
    const idx = await get('/app/index.html');
    expect(idx.status).toBe(200);
    expect(idx.headers['cache-control']).toBe('no-cache');
  });

  it('/app redirects to /app/ on the same host, with security headers', async () => {
    const r = await get('/app');
    expect([301, 302, 307, 308]).toContain(r.status);
    const loc = new URL(r.headers['location'] as string, 'https://cryoshield.app/');
    expect(loc.host).toBe('cryoshield.app');
    expect(loc.pathname).toBe('/app/');
    expect(r.headers['x-frame-options']).toBe('DENY');
  });

  it.each(['/app/does-not-exist', '/landing', '/app/_headers'])('%s is 404 (no SPA fallback)', async (p) => {
    const r = await get(p);
    expect(r.status).toBe(404);
    expect(r.headers['content-security-policy']).toMatch(/frame-ancestors 'none'$/);
  });

  it.each(['/privacy', '/terms', '/cookies'])('%s serves its legal page with the app CSP, all headers, no-cache (add-privacy-and-compliance 3.2)', async (p) => {
    const app = await get('/app/');
    const r = await get(p);
    expect(r.status).toBe(200);
    expect(r.body).toContain('Written for an open-source project; not legal advice.');
    expect(r.body).not.toMatch(/Draft, pending legal review|@cryoshield\.app/);
    expect(r.body).not.toMatch(/<script/i);
    expect(r.headers['content-security-policy']).toBe(`${metaCsp(r.body)}; frame-ancestors 'none'`);
    expect(r.headers['content-security-policy']).toBe(app.headers['content-security-policy']);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(r.headers[k.toLowerCase()], k).toBe(v);
    expect(r.headers['cache-control']).toBe('no-cache');
    expect((await get(`${p}/`)).status).toBe(200);
  });

  it.each(['/privacyx', '/privacy/x', '/Privacy'])('%s is 404 (exact legal paths only)', async (p) => {
    expect((await get(p)).status).toBe(404);
  });

  it('/.well-known/security.txt is served as text with the canonical line (add-privacy-and-compliance 5.1)', async () => {
    const r = await get('/.well-known/security.txt');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(r.body).toContain('Canonical: https://cryoshield.app/.well-known/security.txt');
    expect(r.body).toContain('Contact: https://github.com/prix0007/cryoshield/security/advisories/new');
    expect(r.body).not.toMatch(/mailto:/);
    expect(r.headers['x-frame-options']).toBe('DENY');
  });

  it('logs nothing identifying: 100 requests with distinct IPs, UAs and query strings leave no trace (6.1)', async () => {
    const markers: string[] = [];
    for (let i = 0; i < 100; i++) {
      const ip = `203.0.113.${i + 1}`;
      const ua = `cs-ua-marker-${i}-${process.pid}`;
      const q = `qmark${i}x${process.pid}`;
      markers.push(ip, ua, q);
      await new Promise<void>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: PORT, path: `/${i % 2 ? 'app/' : ''}?ref=${q}`, headers: { host: 'cryoshield.app', 'fly-client-ip': ip, 'x-forwarded-for': ip, 'user-agent': ua, referer: `https://ref.example/${q}` } }, (res) => {
          res.resume();
          res.on('end', () => resolve());
        });
        req.on('error', reject);
        req.end();
      });
    }
    const out = spawnSync('docker', ['logs', NAME], { encoding: 'utf8' });
    const logs = `${out.stdout}${out.stderr}`; // Caddy logs to stderr
    expect(logs.length, 'container output was captured').toBeGreaterThan(0);
    for (const m of markers) expect(logs.includes(m), m).toBe(false);
    expect(readFileSync(join(web, 'deploy', '.build', 'Caddyfile'), 'utf8')).not.toMatch(/^\s*log\b/m);
  });

  it.each([
    ['/favicon.ico', /^image\/(vnd\.microsoft\.icon|x-icon)$/],
    ['/favicon.svg', /^image\/svg\+xml$/],
    ['/apple-touch-icon.png', /^image\/png$/],
    ['/site.webmanifest', /^application\/manifest\+json$/],
  ])('%s is served with the right content type and every security header (add-brand-icon 1.2)', async (p, type) => {
    const r = await get(p);
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type']).split(';')[0]).toMatch(type);
    expect(r.headers['content-security-policy']).toMatch(/frame-ancestors 'none'$/);
    for (const k of ['X-Frame-Options', 'Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy']) expect(r.headers[k.toLowerCase()], k).toBe(SECURITY_HEADERS[k]);
    expect(r.headers['server']).toBeUndefined();
  });

  it('the Arweave fast index is in the /app/ CSP and NOT in the landing CSP (fix-arweave-mirror-status 1.3)', async () => {
    const app = (await get('/app/')).headers['content-security-policy'] as string;
    const landing = (await get('/')).headers['content-security-policy'] as string;
    expect(app).toMatch(/connect-src [^;]*https:\/\/turbo-gateway\.com/);
    expect(landing).not.toContain('turbo-gateway.com');
  });

  it('/architecture serves the system design page with the app CSP, all headers, no-cache (add-architecture-page 1.2)', async () => {
    const app = await get('/app/');
    const r = await get('/architecture');
    expect(r.status).toBe(200);
    expect(r.body).toContain('CryoShield system map');
    expect(r.body).not.toMatch(/<script|__CS_/);
    expect(r.headers['content-security-policy']).toBe(`${metaCsp(r.body)}; frame-ancestors 'none'`);
    expect(r.headers['content-security-policy']).toBe(app.headers['content-security-policy']);
    for (const k of ['X-Frame-Options', 'Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) expect(r.headers[k.toLowerCase()], k).toBe(SECURITY_HEADERS[k]);
    expect(r.headers['cache-control']).toBe('no-cache');
    expect((await get('/architecture/')).status).toBe(200);
    expect((await get('/architecture/x')).status).toBe(404);
  });

  it('/healthz is 200', async () => {
    const r = await get('/healthz');
    expect(r.status).toBe(200);
    expect(r.body).toBe('ok');
  });

  it('/release.json names the deployed commit, uncached, as JSON, with every security header (add-continuous-deploy 1.2)', async () => {
    const r = await get('/release.json');
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toMatch(/^application\/json/);
    expect(r.headers['cache-control']).toBe('no-store');
    for (const k of Object.keys(SECURITY_HEADERS)) expect(r.headers[k.toLowerCase()], k).toBeDefined();
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    const rel = JSON.parse(r.body);
    expect(rel.commit).toBe(RELEASE_COMMIT);
    expect(rel.treeHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(rel.files).toBeUndefined();
    expect(r.body).not.toMatch(/sp_verify|apikey/);
  });

});

describe('canonical host (review fix 4)', () => {
  it.each([
    ['cryoshield-web.fly.dev', '/', 'https://cryoshield.app/'],
    ['www.cryoshield.app', '/a?b=1', 'https://cryoshield.app/a?b=1'],
    ['evil.example', '/x', 'https://cryoshield.app/x'],
    ['127.0.0.1', '/', 'https://cryoshield.app/'],
    ['cryoshield-web.fly.dev', '//evil.example/%2e%2e', 'https://cryoshield.app//evil.example/%2e%2e'],
  ])('Host %s %s -> 301 %s (target host is fixed: no open redirect)', async (host, path, location) => {
    const r = await get(path, host);
    expect(r.status).toBe(301);
    expect(r.headers['location']).toBe(location);
    expect(new URL(r.headers['location'] as string).host).toBe('cryoshield.app');
    expect(r.headers['x-frame-options']).toBe('DENY');
  });

  it('/healthz is never redirected (Fly checks hit the machine directly)', async () => {
    for (const host of ['cryoshield-web.fly.dev', '172.19.0.2:8080', 'cryoshield.app']) {
      const r = await get('/healthz', host);
      expect(r.status).toBe(200);
    }
  });

  it('the apex is served, not redirected', async () => {
    expect((await get('/', 'cryoshield.app')).status).toBe(200);
  });
});

describe('image contents (2.1)', () => {
  it('runs as non-root and /srv equals the generated site; no .env anywhere', () => {
    expect(sh('docker', ['inspect', '-f', '{{.Config.User}}', IMAGE]).trim()).toBe('65534:65534');
    const listed = sh('docker', ['run', '--rm', '--entrypoint', 'sh', IMAGE, '-c', 'cd /srv && find . -type f | sed s#^./##'])
      .trim()
      .split('\n')
      .sort();
    expect(listed).toEqual(files(join(web, 'deploy', '.build', 'site')).sort());
    expect(listed).not.toContain('_headers');
    expect(sh('docker', ['run', '--rm', '--entrypoint', 'sh', IMAGE, '-c', 'find / -xdev -name ".env*" 2>/dev/null || true']).trim()).toBe('');
    // The built bundle in the image targets the RP ID it is served at.
    const js = listed.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(web, 'deploy', '.build', 'site', f), 'utf8')).join('');
    expect(js).toMatch(/rpId:[`"']cryoshield\.app[`"']/);
    expect(js).not.toMatch(/jsxDEV|\/Users\/|\/home\//);
  });
});
