// @vitest-environment node
/**
 * redesign-landing-and-app-ui 2.1 (spec landing-page "Landing at the root, app at /app/",
 * "Same security headers and CSP on every page"): a real build emits two pages with the identical strict CSP;
 * the landing page never loads the vault app.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..');
let out = '';

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'cs-pages-'));
  execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'e2e', '--outDir', out, '--emptyOutDir'], {
    cwd: web,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'production' },
  });
}, 180_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

const html = (p: string) => readFileSync(join(out, p), 'utf8');
const metaCsp = (h: string) => [...h.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/g)].map((m) => m[1]);
const scripts = (h: string) => [...h.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]!);

describe('two pages', () => {
  it('emits index.html (landing) and app/index.html (vault app)', () => {
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'app', 'index.html'))).toBe(true);
  });

  it('both carry exactly one, byte-identical, strict CSP meta and no inline script or style', () => {
    const [a, b] = [html('index.html'), html('app/index.html')];
    expect(metaCsp(a)).toHaveLength(1);
    expect(metaCsp(a)).toEqual(metaCsp(b));
    expect(metaCsp(a)[0]).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(metaCsp(a)[0]).toContain("trusted-types 'none'");
    for (const h of [a, b]) {
      expect(h).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(h).not.toMatch(/\sstyle=|<style[\s>]/i);
      for (const s of scripts(h)) expect(s).toMatch(/^\/assets\//);
    }
  });

  it('the landing page does not load React, viem or the vault app; the app page does', () => {
    const landingJs = scripts(html('index.html')).map((s) => readFileSync(join(out, s), 'utf8')).join('\n');
    const appJs = scripts(html('app/index.html')).map((s) => readFileSync(join(out, s), 'utf8')).join('\n');
    expect(landingJs).not.toMatch(/react\.element|react-dom|viem|rpId:/);
    expect(appJs).toMatch(/rpId:/);
    // The hero headline is in the HTML itself (LCP needs no JS).
    expect(html('index.html')).toContain('Backups that outlive the drive.');
  });

  it('every emitted font is a same-origin hashed asset', () => {
    const fonts = readdirSync(join(out, 'assets')).filter((f) => f.endsWith('.woff2'));
    expect(fonts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('brand icon on every page (add-brand-icon 1.2)', () => {
  it.each(['index.html', 'app/index.html', 'privacy/index.html', 'terms/index.html', 'cookies/index.html'])('%s links the icons, the manifest and both theme colours', (p) => {
    const h = html(p);
    expect(h).toMatch(/<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/);
    expect(h).toMatch(/<link rel="icon" href="\/favicon\.ico" sizes="48x48"/);
    expect(h).toMatch(/<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
    expect(h).toMatch(/<link rel="manifest" href="\/site\.webmanifest"/);
    expect(h).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: light\)"/);
    expect(h).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: dark\)"/);
    expect(h).not.toContain('href="data:,"');
  });

  it('the icon files and manifest are emitted to the site root', () => {
    for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'site.webmanifest']) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
  });
});
