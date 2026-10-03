// @vitest-environment jsdom
/** add-privacy-and-compliance 3.2 (spec legal-pages): built legal pages, required sections, links, no third parties. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..');
let out = '';
beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'cs-legal-'));
  execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'e2e', '--outDir', out, '--emptyOutDir'], { cwd: web, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } });
}, 180_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

const page = (p: string) => new DOMParser().parseFromString(readFileSync(join(out, p), 'utf8'), 'text/html');
const headings = (d: Document) => [...d.querySelectorAll('main h2')].map((h) => h.textContent?.trim());
const metaCsp = (p: string) => readFileSync(join(out, p), 'utf8').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
const LEGAL = ['privacy/index.html', 'terms/index.html', 'cookies/index.html'];

describe('legal pages', () => {
  it('are emitted as static pages', () => {
    for (const p of LEGAL) expect(existsSync(join(out, p)), p).toBe(true);
  });

  it('/privacy has the required sections and an effective date', () => {
    const d = page('privacy/index.html');
    expect(headings(d)).toEqual(expect.arrayContaining(['Who we are', 'What we never see', 'Data held by third parties', 'Public and permanent data', 'Analytics', 'Your rights', 'Grievance Officer', 'Children', 'Changes']));
    expect(d.body.textContent).toMatch(/Effective date:\s*\d{4}-\d{2}-\d{2}/);
  });

  it('/privacy discloses the analytics: vendor, landing only, data read, no cookies, GPC/DNT', () => {
    const d = page('privacy/index.html');
    const h = [...d.querySelectorAll('main h2')].find((x) => x.textContent?.trim() === 'Analytics')!;
    let text = '';
    for (let n = h.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) text += ' ' + n.textContent;
    expect(text).toMatch(/Cloudflare Web Analytics/);
    expect(text).toMatch(/home page|landing page/);
    expect(text).toMatch(/user agent/);
    expect(text).toMatch(/performance timings/);
    expect(text).toMatch(/no cookies/i);
    expect(text).toMatch(/Global Privacy Control/);
    expect(text).toMatch(/Do Not Track/);
    expect(text).toMatch(/\/app\//);
  });

  it('/privacy reflects the data-flow inventory, the permanence caveat and crypto-shredding', () => {
    const t = page('privacy/index.html').body.textContent!.replace(/\s+/g, ' ');
    for (const v of ['Fly.io', 'Pimlico', 'OP Sepolia', 'Arweave', 'sepolia.optimism.io', 'ArDrive Turbo', 'Cloudflare', 'GitHub']) expect(t, v).toContain(v);
    expect(t).toMatch(/cannot be deleted by us or by anyone else/);
    expect(t).toMatch(/unreadable only until the encryption method is broken/);
    expect(t).toMatch(/crypto-shredding/);
    expect(t).toMatch(/DPDP/);
    expect(t).toMatch(/GDPR/);
    expect(t).toMatch(/CCPA/);
    expect(t).toMatch(/18 or over/);
  });

  it('/cookies has the required sections, an effective date and the generated storage inventory', () => {
    const d = page('cookies/index.html');
    expect(headings(d)).toEqual(expect.arrayContaining(['What we store on your device', 'Analytics on the landing page', 'Your choices', 'When this would change']));
    expect(d.body.textContent).toMatch(/Effective date:\s*\d{4}-\d{2}-\d{2}/);
    const rows = [...d.querySelectorAll('[data-testid="storage-inventory"] tbody tr')].map((r) => r.querySelector('th')?.textContent?.trim());
    expect(rows).toEqual(expect.arrayContaining(['/', '/app/', '/privacy', '/terms', '/cookies']));
  });

  it('/terms covers testnet/unaudited, no recovery, permanence, sponsorship, eligibility and the licence', () => {
    const t = page('terms/index.html').body.textContent!.replace(/\s+/g, ' ');
    for (const s of ['test network', 'not been independently audited', 'nobody', 'cannot be removed', 'paused, limited or withdrawn', '18 or over', 'sanctions', 'MIT license', 'Limitation of liability', 'Governing law']) expect(t, s).toMatch(new RegExp(s, 'i'));
  });

  it('every legal page shows the draft banner first and keeps the placeholders', () => {
    for (const p of LEGAL) {
      const d = page(p);
      const art = d.querySelector('main article')!;
      expect(art.firstElementChild?.classList.contains('draft-banner'), p).toBe(true);
      expect(art.firstElementChild?.textContent).toMatch(/Draft, pending legal review/);
      expect(d.querySelectorAll('mark.placeholder').length, p).toBeGreaterThan(0);
    }
  });

  it('the landing page and every legal page link to /privacy, /terms and /cookies', () => {
    for (const p of ['index.html', ...LEGAL]) {
      const hrefs = [...page(p).querySelectorAll('a')].map((a) => a.getAttribute('href'));
      for (const l of ['/privacy', '/terms', '/cookies']) expect(hrefs, `${p} -> ${l}`).toContain(l);
    }
  });

  it('legal pages load no script and no third-party resource, and carry the app CSP', () => {
    for (const p of LEGAL) {
      const html = readFileSync(join(out, p), 'utf8');
      expect(html, p).not.toMatch(/<script/i);
      for (const m of html.matchAll(/<(?:link|img|source|iframe)[^>]+(?:href|src)="([^"]+)"/g)) expect(m[1], p).toMatch(/^(\/|data:)/);
      expect(metaCsp(p), p).toBe(metaCsp('app/index.html'));
    }
  });
});
