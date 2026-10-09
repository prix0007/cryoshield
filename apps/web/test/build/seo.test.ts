// @vitest-environment node
/**
 * improve-landing-seo (spec landing-page "Search metadata on public pages", "Structured data and visible FAQ",
 * "Crawl files", "The app is not indexed", "Share image"; add-llms-txt "Crawl files"): unit tests of vite-plugins/seo.ts
 * and the static files.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OG_IMAGE, PUBLIC_PAGES, SITE, extractFaq, llmsTxt, publicPageMetas, sitemapXml, transformSeo } from '../../vite-plugins/seo';
import { BANNED, bannedFor } from '../landing/banned';
import { llmsStatus, type CopyContext } from '../../vite-plugins/network-copy';
import { stripJsonLd } from '../../scripts/csp-check.mjs';

const web = join(__dirname, '..', '..');
const DESC = 'D'.repeat(150);
const page = (head: string, body = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8" />${head}</head><body>${body}</body></html>`;
const ok = (title = 'Title &amp; more · CryoShield', desc = DESC) => page(`<meta name="description" content="${desc}" /><title>${title}</title>`);
const attr = (h: string, sel: RegExp) => h.match(sel)?.[1];

describe('head tags on public pages', () => {
  it('adds canonical, Open Graph and Twitter tags derived from the title and description', () => {
    const h = transformSeo(ok(), '/architecture/index.html');
    expect(h).toContain(`<link rel="canonical" href="${SITE}/architecture">`);
    expect(attr(h, /<meta property="og:url" content="([^"]+)">/)).toBe(`${SITE}/architecture`);
    expect(attr(h, /<meta property="og:title" content="([^"]+)">/)).toBe('Title &amp; more · CryoShield');
    expect(attr(h, /<meta property="og:description" content="([^"]+)">/)).toBe(DESC);
    expect(attr(h, /<meta property="og:type" content="([^"]+)">/)).toBe('website');
    expect(attr(h, /<meta property="og:site_name" content="([^"]+)">/)).toBe('CryoShield');
    expect(attr(h, /<meta property="og:image" content="([^"]+)">/)).toBe(`${SITE}/og-image.png`);
    expect(attr(h, /<meta property="og:image:width" content="([^"]+)">/)).toBe('1200');
    expect(attr(h, /<meta property="og:image:height" content="([^"]+)">/)).toBe('630');
    expect(attr(h, /<meta property="og:image:alt" content="([^"]+)">/)).toBeTruthy();
    expect(attr(h, /<meta name="twitter:card" content="([^"]+)">/)).toBe('summary_large_image');
    expect(attr(h, /<meta name="twitter:title" content="([^"]+)">/)).toBe('Title &amp; more · CryoShield');
    expect(attr(h, /<meta name="twitter:description" content="([^"]+)">/)).toBe(DESC);
    expect(attr(h, /<meta name="twitter:image" content="([^"]+)">/)).toBe(`${SITE}/og-image.png`);
    expect(attr(h, /<meta name="twitter:image:alt" content="([^"]+)">/)).toBeTruthy();
    // Tags land in <head>, and nothing is added to pages other than the landing page's JSON-LD.
    expect(h.indexOf('rel="canonical"')).toBeLessThan(h.indexOf('</head>'));
    expect(h).not.toContain('<script');
  });

  it('the landing page is canonical at the site root', () => {
    const landing = ok().replace('</body>', '<section id="faq"><details><summary>Q?</summary><p>A.</p></details></section></body>');
    expect(transformSeo(landing, '/index.html')).toContain(`<link rel="canonical" href="${SITE}/">`);
  });

  it.each([
    ['no description', page('<title>T</title>'), /description/],
    ['no title', page(`<meta name="description" content="${DESC}" />`), /title/],
    ['a 120-character description', ok(undefined, 'D'.repeat(120)), /description.*150/],
    ['a 161-character description', ok(undefined, 'D'.repeat(161)), /description.*160/],
    ['a 61-character title', ok('T'.repeat(61)), /title.*60/],
    ['a noindex robots meta', ok().replace('</head>', '<meta name="robots" content="noindex" /></head>'), /noindex/],
  ])('fails the build on %s, naming the page', (_n, html, msg) => {
    expect(() => transformSeo(html, '/terms/index.html')).toThrow(msg);
    expect(() => transformSeo(html, '/terms/index.html')).toThrow(/\/terms\/index\.html/);
  });

  it('/app/ must carry noindex; it gets no canonical or share tags', () => {
    const app = page('<meta name="robots" content="noindex" /><title>Your vault · CryoShield</title>');
    const h = transformSeo(app, '/app/index.html');
    expect(h).toBe(app);
    expect(() => transformSeo(page('<title>Your vault</title>'), '/app/index.html')).toThrow(/noindex/);
  });

  it('refuses a page it does not know (every page must be classified public or noindex)', () => {
    expect(() => transformSeo(ok(), '/new/index.html')).toThrow(/not classified/);
  });
});

describe('landing structured data', () => {
  const FAQ = `<section id="faq"><h2>Q</h2><div class="faq-list">
    <details><summary>How do I back up my seed phrase forever?</summary><p>No backup lasts forever &amp; that’s fine. See <a href="/devices">devices</a>.</p></details>
    <details id="faq-lose">
      <summary>What if I lose a key?</summary>
      <p>Use   another
        one.</p>
    </details></div></section>`;
  const landing = page(`<meta name="description" content="${DESC}" /><title>T</title>`, FAQ);

  it('extracts the visible FAQ: summary text and answer text (tags stripped, entities decoded, whitespace collapsed)', () => {
    expect(extractFaq(landing)).toEqual([
      { question: 'How do I back up my seed phrase forever?', answer: 'No backup lasts forever & that’s fine. See devices.' },
      { question: 'What if I lose a key?', answer: 'Use another one.' },
    ]);
  });

  it('emits one CSP-safe JSON-LD block with SoftwareApplication, Organization and the FAQPage', () => {
    const h = transformSeo(landing, '/index.html');
    const { blocks, errors, html } = stripJsonLd(h);
    expect(errors).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    const graph = (blocks[0] as { '@graph': Record<string, unknown>[] })['@graph'];
    const byType = (t: string) => graph.find((n) => n['@type'] === t)!;
    const app = byType('SoftwareApplication');
    expect(app).toMatchObject({ name: 'CryoShield', applicationCategory: 'SecurityApplication', isAccessibleForFree: true, url: `${SITE}/` });
    expect(app.offers).toMatchObject({ '@type': 'Offer', price: '0' });
    expect(String(app.license)).toMatch(/LICENSE$/);
    const org = byType('Organization');
    expect(org.sameAs).toEqual(['https://github.com/prix0007/cryoshield']);
    expect(String(org.description)).toMatch(/open-source project/i);
    const faq = byType('FAQPage').mainEntity as { name: string; acceptedAnswer: { text: string } }[];
    expect(faq.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(extractFaq(landing).map((f) => [f.question, f.answer]));
  });

  it('escapes "<" so the data block can never close early', () => {
    const evil = landing.replace('Use   another', 'Use </script><script>alert(1)</script> another');
    const h = transformSeo(evil, '/index.html');
    const block = h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!;
    expect(block).not.toContain('<');
    expect(stripJsonLd(h).errors).toEqual([]);
  });

  it('fails the build if the landing page has no FAQ', () => {
    expect(() => transformSeo(ok(), '/index.html')).toThrow(/FAQ/);
  });
});

describe('crawl files', () => {
  it('sitemap.xml lists exactly the public canonical URLs and never /app/', () => {
    const xml = sitemapXml();
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(PUBLIC_PAGES.map((p) => `${SITE}${p.path}`));
    expect(locs).toEqual(['/', '/architecture', '/devices', '/support', '/privacy', '/terms', '/cookies'].map((p) => `${SITE}${p}`));
    expect(xml).not.toContain('/app');
    expect(xml).not.toContain('lastmod'); // reproducible builds
  });

  it('robots.txt allows everything but /app/ and names the sitemap', () => {
    const r = readFileSync(join(web, 'public', 'robots.txt'), 'utf8');
    const lines = r.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(lines).toEqual(['User-agent: *', 'Allow: /', 'Disallow: /app/', `Sitemap: ${SITE}/sitemap.xml`]);
    expect(r).not.toMatch(/^Disallow:\s*\/\s*$/m);
  });

  it('robots.txt points to llms.txt in a comment (no non-standard directive)', () => {
    const r = readFileSync(join(web, 'public', 'robots.txt'), 'utf8');
    expect(r).toMatch(new RegExp(`^# .*${SITE}/llms\\.txt`, 'm'));
  });
});

const ctx = (chainId: number): CopyContext => ({ chainId, rpId: 'cryoshield.app', now: Date.parse('2026-10-09T00:00:00Z'), rpc: { host: 'rpc.example', vendor: 'Example', policy: 'Not published' } });

describe('llms.txt (add-llms-txt)', () => {
  const metas = publicPageMetas(web, ctx(11155420));
  const out = llmsTxt(metas, llmsStatus(ctx(11155420)));

  it('reads every public page title and description from its source HTML, in sitemap order', () => {
    expect(metas.map((m) => m.path)).toEqual(PUBLIC_PAGES.map((p) => p.path));
    for (const m of metas) {
      expect(m.title.length, m.path).toBeGreaterThan(0);
      expect(m.description.length, m.path).toBeGreaterThanOrEqual(150);
    }
  });

  it('follows the llmstxt.org layout: H1, summary blockquote, status, then H2 link sections', () => {
    const lines = out.split('\n');
    expect(lines[0]).toBe('# CryoShield');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe(`> ${metas[0]!.description}`);
    expect([...out.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(['Pages', 'Source and specification', 'Optional']);
    expect(out).toMatch(/testnet preview/i);
    expect(out).toMatch(/OP Sepolia/);
    expect(out).toMatch(/not been independently audited/);
    expect(out.endsWith('\n')).toBe(true);
    expect(out).not.toMatch(/\n{3,}/);
  });

  it('links every public page with its canonical URL, title and description', () => {
    for (const m of metas) expect(out).toContain(`- [${m.title}](${SITE}${m.path}): ${m.description}\n`);
  });

  it('links the source, the vault format spec, the system design and the recovery tool', () => {
    const repo = 'https://github.com/prix0007/cryoshield';
    for (const u of [repo, `${repo}/blob/main/docs/spec/vault-format-v1.md`, `${repo}/blob/main/docs/system-design.md`, `${repo}/tree/main/tools/recover`]) {
      expect(out).toContain(`](${u})`);
    }
    for (const f of ['docs/spec/vault-format-v1.md', 'docs/system-design.md', 'tools/recover/README.md']) {
      expect(existsSync(join(web, '..', '..', f)), f).toBe(true);
    }
    expect(out).toContain(`](${SITE}/.well-known/security.txt)`);
    expect(out).toContain(`](${SITE}/sitemap.xml)`);
  });

  it('never lists the app and passes the honesty denylist', () => {
    expect(out).not.toContain('/app');
    for (const b of BANNED) expect(out, String(b)).not.toMatch(b);
  });

  it('carries a changed title or description without another edit', () => {
    const changed = llmsTxt(metas.map((m) => (m.path === '/devices' ? { ...m, title: 'New devices title' } : m)), llmsStatus(ctx(11155420)));
    expect(changed).toContain(`- [New devices title](${SITE}/devices): `);
  });
});

describe('llms.txt on an OP Mainnet build (launch-op-mainnet 4.2)', () => {
  const metas = publicPageMetas(web, ctx(10));
  const out = llmsTxt(metas, llmsStatus(ctx(10)));

  it('restates the mainnet status: OP Mainnet, unaudited, all keys lost; no testnet wording anywhere', () => {
    expect(out).toMatch(/OP Mainnet/);
    expect(out).toMatch(/not been independently audited/);
    expect(out).toMatch(/lose every key/);
    expect(out).not.toMatch(/testnet|OP Sepolia|test network/i);
    expect(metas[0]!.description).toMatch(/unaudited\.$/);
    for (const b of bannedFor(10)) expect(out, String(b)).not.toMatch(b);
  });
});

describe('share image', () => {
  it('has neutral alt text that matches the card on every chain', () => {
    expect(OG_IMAGE.alt).toBe('CryoShield: seed phrase backups that outlive the drive. Free and open source, not independently audited.');
    expect(OG_IMAGE.alt).not.toMatch(/testnet|mainnet|sepolia|preview/i);
  });

  it('is a 1200×630 PNG matching the recorded hash, built from the committed SVG', () => {
    const png = readFileSync(join(web, 'public', 'og-image.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([OG_IMAGE.width, OG_IMAGE.height]);
    const sum = readFileSync(join(web, 'brand', 'og-image.sha256'), 'utf8').trim();
    expect(sum).toBe(`${createHash('sha256').update(png).digest('hex')}  og-image.png`);
    expect(png.length).toBeLessThan(300 * 1024);
  });

  // launch-op-mainnet 4.2: one neutral card for every chain. It makes no network claim (the same PNG ships on OP Sepolia
  // and OP Mainnet), keeps "Not independently audited", and its alt text describes exactly that.
  it('the source SVG is 1200×630, self-contained, in brand colours, neutral about the network, and says it is unaudited', () => {
    const svg = readFileSync(join(web, 'brand', 'og-image.svg'), 'utf8');
    expect(svg).toMatch(/viewBox="0 0 1200 630" width="1200" height="630"/);
    expect(svg).not.toMatch(/href=|url\(|<image|<script|<(linear|radial)Gradient|<filter/i);
    const visible = [...svg.matchAll(/<(?:text|tspan)[^>]*>([^<]*)/g)].map((m) => m[1]).join(' ');
    expect(visible).not.toMatch(/testnet|mainnet|sepolia|preview|yet/i);
    expect(visible).toContain('Not independently audited');
    for (const b of [...BANNED, ...bannedFor(10)]) expect(visible, String(b)).not.toMatch(b);
    const colours = new Set((svg.match(/#[0-9a-f]{6}/gi) ?? []).map((c) => c.toLowerCase()));
    for (const c of colours) expect(['#ffffff', '#f5f5f7', '#0066cc', '#1d1d1f', '#333333', '#7a7a7a', '#e0e0e0']).toContain(c);
  });
});
