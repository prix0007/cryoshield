// @vitest-environment node
/**
 * split-dev-and-release-deploys decision 5: the development Caddyfile (gen-context --noindex) is valid Caddy and sends
 * `X-Robots-Tag: noindex, nofollow` on EVERY response (pages, redirects, /healthz, errors), with the strict CSP
 * unchanged. Runs the pinned Caddy image from deploy/Dockerfile. Skipped when Docker is unavailable; the host port is
 * chosen by Docker (no fixed port to collide with).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..');
const FROM = readFileSync(join(web, 'deploy', 'Dockerfile'), 'utf8').match(/^FROM (caddy:\S+@sha256:[0-9a-f]{64})$/m)![1]!;
const NAME = `cs-web-noindex-${process.pid}`;
const DOCKER = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
let PORT = 0; // assigned by Docker (-p 127.0.0.1::8080)
const HOST = 'cryoshield-web-dev.fly.dev';
const META = "default-src 'none'; script-src 'self'; connect-src 'self' https://rpc.example; require-trusted-types-for 'script'";
let dir = '';

function get(path: string, host = HOST): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
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

describe.skipIf(!DOCKER)('development container (noindex)', () => {
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cs-noindex-'));
  const html = `<html><head><meta http-equiv="Content-Security-Policy" content="${META}"></head><body>x</body></html>`;
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'index.html'), html);
  for (const p of ['app', 'privacy', 'terms', 'cookies', 'architecture', 'devices', 'support']) {
    mkdirSync(join(dir, 'dist', p));
    writeFileSync(join(dir, 'dist', p, 'index.html'), html);
  }
  execFileSync('node', [join(web, 'deploy', 'gen-context.mjs'), '--dist', join(dir, 'dist'), '--out', join(dir, 'out'), '--host', HOST, '--noindex'], { stdio: 'pipe' });
  execFileSync('docker', ['run', '-d', '--rm', '--name', NAME, '-p', '127.0.0.1::8080', '--user', '65534:65534',
    '-e', 'XDG_CONFIG_HOME=/tmp/c', '-e', 'XDG_DATA_HOME=/tmp/d',
    '-v', `${join(dir, 'out', 'Caddyfile')}:/etc/caddy/Caddyfile:ro`, '-v', `${join(dir, 'out', 'site')}:/srv:ro`,
    FROM, 'caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], { stdio: 'pipe' });
  PORT = Number(/:(\d+)\s*$/m.exec(execFileSync('docker', ['port', NAME, '8080/tcp'], { encoding: 'utf8' }))![1]);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await get('/healthz')).status === 200) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`caddy did not start: ${execFileSync('docker', ['logs', NAME], { encoding: 'utf8' })}`);
});

afterAll(() => {
  try {
    execFileSync('docker', ['rm', '-f', NAME], { stdio: 'pipe' });
  } catch {
    /* already gone */
  }
});

  it.each(['/', '/app/', '/privacy', '/healthz', '/robots.txt', '/release.json', '/nope', '/app'])('%s carries X-Robots-Tag: noindex, nofollow', async (p) => {
    const r = await get(p);
    expect(r.headers['x-robots-tag'], `${p} -> ${r.status}`).toBe('noindex, nofollow');
  });

  it('a non-canonical host is redirected to the dev host, also with noindex', async () => {
    const r = await get('/app/', 'dev.cryoshield.app'); // the retired subdomain must never serve the app (T1)
    expect(r.status).toBe(301);
    expect(r.headers.location).toBe('https://cryoshield-web-dev.fly.dev/app/');
    expect(r.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('the strict CSP is unchanged on dev', async () => {
    const r = await get('/app/');
    expect(r.headers['content-security-policy']).toBe(`${META}; frame-ancestors 'none'`);
  });
});
