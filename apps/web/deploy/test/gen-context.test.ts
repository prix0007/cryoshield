// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../../vite-plugins/security-headers';

const GEN = join(__dirname, '..', 'gen-context.mjs');
const META = "default-src 'none'; script-src 'self'; connect-src 'self' https://rpc.example; require-trusted-types-for 'script'";

function fixture(html: string, appHtml: string | null = html) {
  const d = mkdtempSync(join(tmpdir(), 'cs-gen-'));
  mkdirSync(join(d, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(d, 'dist', 'index.html'), html);
  if (appHtml !== null) {
    mkdirSync(join(d, 'dist', 'app'));
    writeFileSync(join(d, 'dist', 'app', 'index.html'), appHtml);
  }
  writeFileSync(join(d, 'dist', 'assets', 'index-abc.js'), 'x');
  writeFileSync(join(d, 'dist', '_headers'), '/*\n');
  return d;
}
const run = (d: string, host = 'cryoshield.app') =>
  execFileSync('node', [GEN, '--dist', join(d, 'dist'), '--out', join(d, 'out'), '--host', host], { encoding: 'utf8', stdio: 'pipe' });

describe('deploy context generator (1.2)', () => {
  it('copies dist minus _headers and writes a Caddyfile whose CSP = meta + frame-ancestors', () => {
    const d = fixture(`<html><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="${META}"></head></html>`);
    run(d);
    expect(existsSync(join(d, 'out', 'site', 'index.html'))).toBe(true);
    expect(existsSync(join(d, 'out', 'site', 'assets', 'index-abc.js'))).toBe(true);
    expect(existsSync(join(d, 'out', 'site', '_headers'))).toBe(false);
    const caddy = readFileSync(join(d, 'out', 'Caddyfile'), 'utf8');
    expect(caddy).toContain(`Content-Security-Policy \`${META}; frame-ancestors 'none'\``);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(caddy).toContain(`${k} \`${v}\``);
    expect(caddy).toContain('-Server');
    expect(caddy).toMatch(/admin off/);
    expect(caddy).toMatch(/auto_https off/);
    expect(caddy).toContain('@noncanonical {');
    expect(caddy).toContain('not host cryoshield.app');
    expect(caddy).toContain('not path /healthz');
    expect(caddy).toContain('redir @noncanonical https://cryoshield.app{uri} permanent');
    expect(caddy).toContain('Cache-Control `no-cache`');
    expect(caddy).toContain('Cache-Control `public, max-age=31536000, immutable`');
    expect(caddy).toContain('handle /healthz');
    expect(caddy).toContain(':8080');
  });

  it('fails without a meta CSP, or when it already has frame-ancestors, or with a bad host', () => {
    expect(() => run(fixture('<html><head></head></html>'))).toThrow(/meta Content-Security-Policy/);
    expect(() => run(fixture(`<html><head><meta http-equiv="Content-Security-Policy" content="${META}; frame-ancestors 'self'"></head></html>`))).toThrow(/frame-ancestors/);
    expect(() => run(fixture(`<html><head><meta http-equiv="Content-Security-Policy" content="${META}"></head></html>`), 'evil.com/x')).toThrow(/host/);
  });

  it('serves the landing page and the app page no-cache (redesign-landing-and-app-ui 2.3)', () => {
    const d = fixture(`<html><head><meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="${META}"></head></html>`);
    run(d);
    expect(existsSync(join(d, 'out', 'site', 'app', 'index.html'))).toBe(true);
    const caddy = readFileSync(join(d, 'out', 'Caddyfile'), 'utf8');
    expect(caddy).toContain('@html path / /index.html /app/ /app/index.html');
    expect(caddy).not.toMatch(/try_files|rewrite/); // no SPA fallback
  });

  it('refuses pages whose CSPs differ, or a missing app page', () => {
    const page = (csp: string) => `<html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head></html>`;
    expect(() => run(fixture(page(META), page(`${META}; img-src *`)))).toThrow(/differ/);
    expect(() => run(fixture(page(META), null))).toThrow(/app\/index\.html/);
  });

  it('refuses a CSP containing a backtick (cannot be quoted safely)', () => {
    expect(() => run(fixture('<html><head><meta http-equiv="Content-Security-Policy" content="default-src `x`"></head></html>'))).toThrow(/backtick/);
  });
});
