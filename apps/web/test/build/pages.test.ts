// jsdom environment (improve-landing-seo): the SEO checks parse the built pages with DOMParser.
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
import { stripJsonLd } from '../../scripts/csp-check.mjs';
import { PUBLIC_PAGES, SITE } from '../../vite-plugins/seo';

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

  it('both carry exactly one strict CSP meta (the app adds only the Arweave fast index) and no inline script or style', () => {
    const [a, b] = [html('index.html'), html('app/index.html')];
    expect(metaCsp(a)).toHaveLength(1);
    expect(metaCsp(b)).toHaveLength(1);
    // fix-arweave-mirror-status D4: the fast index is app-only; otherwise the two policies are identical.
    expect(metaCsp(b)[0]).toBe(metaCsp(a)[0]!.replace(/(connect-src [^;]*)/, '$1 https://turbo-gateway.com'));
    expect(metaCsp(a)[0]).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(metaCsp(a)[0]).toContain("trusted-types 'none'");
    // improve-landing-seo D6: the only inline script is the landing page's JSON-LD data block.
    for (const h of [stripJsonLd(a).html, b]) {
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
    expect(html('index.html')).toContain('Seed phrase backups that outlive the drive.');
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

/** improve-landing-seo (spec landing-page "Search metadata on public pages" and following). */
describe('search metadata in the built pages', () => {
  const file = (path: string) => (path === '/' ? 'index.html' : `${path.slice(1)}/index.html`);
  const dom = (p: string) => new DOMParser().parseFromString(html(p), 'text/html');
  const meta = (d: Document, sel: string) => [...d.querySelectorAll(sel)].map((m) => m.getAttribute('content'));

  it.each(PUBLIC_PAGES.map((p) => [p.path]))('%s has one title, description and canonical, and matching OG and Twitter tags', (path) => {
    const d = dom(file(path));
    expect(d.querySelectorAll('head > title')).toHaveLength(1); // (an inline SVG may carry its own <title>)
    const title = d.title;
    expect(title.length).toBeGreaterThan(0);
    expect(title.length).toBeLessThanOrEqual(60);
    const [desc] = meta(d, 'meta[name="description"]');
    expect(meta(d, 'meta[name="description"]')).toHaveLength(1);
    expect(desc!.length).toBeGreaterThanOrEqual(150);
    expect(desc!.length).toBeLessThanOrEqual(160);
    const canon = [...d.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute('href'));
    expect(canon).toEqual([`${SITE}${path}`]);
    expect(meta(d, 'meta[property="og:title"]')).toEqual([title]);
    expect(meta(d, 'meta[property="og:description"]')).toEqual([desc]);
    expect(meta(d, 'meta[property="og:url"]')).toEqual([`${SITE}${path}`]);
    expect(meta(d, 'meta[property="og:type"]')).toEqual(['website']);
    expect(meta(d, 'meta[property="og:image"]')).toEqual([`${SITE}/og-image.png`]);
    expect(meta(d, 'meta[property="og:image:width"]')).toEqual(['1200']);
    expect(meta(d, 'meta[property="og:image:height"]')).toEqual(['630']);
    expect(meta(d, 'meta[name="twitter:card"]')).toEqual(['summary_large_image']);
    expect(meta(d, 'meta[name="twitter:title"]')).toEqual([title]);
    expect(meta(d, 'meta[name="twitter:description"]')).toEqual([desc]);
    expect(meta(d, 'meta[name="robots"]')).toEqual([]);
  });

  it('the landing JSON-LD parses, has the three types, and its FAQ equals the visible FAQ', () => {
    const { blocks, errors } = stripJsonLd(html('index.html'));
    expect(errors).toEqual([]);
    expect(blocks).toHaveLength(1);
    const graph = (blocks[0] as { '@graph': Record<string, unknown>[] })['@graph'];
    expect(graph.map((n) => n['@type'])).toEqual(['Organization', 'SoftwareApplication', 'FAQPage']);
    const faq = (graph[2]!.mainEntity as { '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }[]);
    const visible = [...dom('index.html').querySelectorAll('#faq details')].map((d) => [
      d.querySelector('summary')!.textContent!.replace(/\s+/g, ' ').trim(),
      d.querySelector('p')!.textContent!.replace(/\s+/g, ' ').trim(),
    ]);
    expect(visible.length).toBeGreaterThanOrEqual(5);
    expect(faq.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(visible);
    for (const q of faq) expect([q['@type'], q.acceptedAnswer['@type']]).toEqual(['Question', 'Answer']);
  });

  it('no other page carries a script element for structured data', () => {
    for (const p of [...PUBLIC_PAGES.map((x) => file(x.path)), 'app/index.html'].filter((f) => f !== 'index.html')) {
      expect(html(p), p).not.toContain('application/ld+json');
    }
  });

  it('robots.txt, sitemap.xml and og-image.png are in the build output; /app/ is noindex and not in the sitemap', () => {
    for (const f of ['robots.txt', 'sitemap.xml', 'og-image.png']) expect(existsSync(join(out, f)), f).toBe(true);
    expect(html('robots.txt')).toContain('Disallow: /app/');
    expect(html('robots.txt')).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    const sm = new DOMParser().parseFromString(html('sitemap.xml'), 'application/xml');
    expect(sm.querySelector('parsererror')).toBeNull();
    expect([...sm.getElementsByTagName('loc')].map((l) => l.textContent)).toEqual(PUBLIC_PAGES.map((p) => `${SITE}${p.path}`));
    expect(html('sitemap.xml')).not.toContain('/app');
    const app = dom('app/index.html');
    expect(meta(app, 'meta[name="robots"]')).toEqual(['noindex']);
    expect(app.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('llms.txt is in the build output, lists the seven canonical URLs and never /app/ (add-llms-txt)', () => {
    const t = html('llms.txt');
    expect(t.startsWith('# CryoShield\n')).toBe(true);
    const links = [...t.matchAll(/^- \[[^\]]+\]\((https:\/\/cryoshield\.app\/[^)]*)\): /gm)].map((m) => m[1]);
    expect(links.slice(0, PUBLIC_PAGES.length)).toEqual(PUBLIC_PAGES.map((p) => `${SITE}${p.path}`));
    expect(t).not.toContain('/app');
  });
});
