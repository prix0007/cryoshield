// @vitest-environment node
/**
 * add-fly-hosting 2.1/2.2: build the real image from a production-mode build and assert what it serves.
 * Requires Docker. Uses a production build for host cryoshield.app against the local chain record (31337).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../../vite-plugins/security-headers';

const web = join(__dirname, '..', '..');
const IMAGE = 'cryoshield-web:test';
const NAME = `cs-web-test-${process.pid}`;
const PORT = 18080;
const DIST = join(web, 'deploy', '.test-dist');
const ENV = {
  VITE_CHAIN_ID: '31337',
  VITE_RPC_URL: 'https://rpc.verify.invalid',
  VITE_BUNDLER_URL: 'https://bundler.verify.invalid/rpc',
  VITE_SPONSORSHIP_POLICY_ID: 'sp_verify',
  VITE_TURBO_UPLOAD_URL: 'https://upload.ardrive.io',
  VITE_ARWEAVE_GATEWAY_URL: 'https://arweave.net',
  VITE_RP_ID: 'cryoshield.app',
  VITE_RP_NAME: 'CryoShield',
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
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(r.headers[k.toLowerCase()], k).toBe(v);
    expect(r.headers['server']).toBeUndefined();
    expect(r.headers['cache-control']).toBe('no-cache');
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

  it('/app/ serves the vault app with every header, the same CSP as /, and no-cache (redesign-landing-and-app-ui 2.4)', async () => {
    const landing = await get('/');
    const app = await get('/app/');
    expect(app.status).toBe(200);
    expect(app.body).toContain('<div id="root">');
    expect(landing.body).toContain('Backups that outlive the drive.');
    expect(app.headers['content-security-policy']).toBe(`${metaCsp(app.body)}; frame-ancestors 'none'`);
    expect(app.headers['content-security-policy']).toBe(landing.headers['content-security-policy']);
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

  it('/healthz is 200', async () => {
    const r = await get('/healthz');
    expect(r.status).toBe(200);
    expect(r.body).toBe('ok');
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
