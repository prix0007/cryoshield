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
    // The network and RPC rows follow the build's chain and RPC (launch-op-mainnet 4.3: test/legal/network.test.ts).
    for (const v of ['Fly.io', 'Pimlico', 'Arweave', 'ArDrive Turbo', 'Cloudflare', 'GitHub']) expect(t, v).toContain(v);
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

  it('/cookies and /privacy disclose the theme preference honestly (add-theme-switch D5)', () => {
    const d = page('cookies/index.html');
    const prefs = [...d.querySelectorAll('[data-testid="storage-preferences"] tbody tr')].map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent?.replace(/\s+/g, ' ').trim()));
    expect(prefs).toHaveLength(1);
    expect(prefs[0]![0]).toBe('cryoshield-theme');
    expect(prefs[0]!.join(' | ')).toMatch(/localStorage/);
    expect(prefs[0]!.join(' | ')).toMatch(/light.*dark/);
    expect(prefs[0]!.join(' | ')).toMatch(/only when you choose Light or Dark/i);
    for (const p of ['cookies/index.html', 'privacy/index.html']) {
      const html = readFileSync(join(out, p), 'utf8');
      const t = page(p).body.textContent!.replace(/\s+/g, ' ');
      expect(t, p).toContain('cryoshield-theme');
      expect(t, p).toMatch(/never sent anywhere/i);
      expect(t, p).toMatch(/clear(ing)? this site's data/i);
      expect(t, p).toMatch(/Choosing System deletes it/);
      // The old absolute promise is gone everywhere on the page, including the meta description.
      expect(html, p).not.toMatch(/stores nothing on your device|No page stores anything|nothing on your device/i);
    }
  });

  it('/terms covers testnet/unaudited, no recovery, permanence, sponsorship, eligibility and the licence', () => {
    const t = page('terms/index.html').body.textContent!.replace(/\s+/g, ' ');
    for (const s of ['test network', 'not been independently audited', 'nobody', 'cannot be removed', 'paused, limited or withdrawn', '18 or over', 'sanctions', 'MIT license', 'Limitation of liability', 'Governing law']) expect(t, s).toMatch(new RegExp(s, 'i'));
  });

  it('every legal page shows the not-legal-advice note right under the effective date, and no draft banner (adopt-oss 1.2)', () => {
    for (const p of LEGAL) {
      const d = page(p);
      const date = [...d.querySelectorAll('main article p')].find((x) => /Effective date:/.test(x.textContent ?? ''))!;
      const note = date.nextElementSibling!;
      expect(note.classList.contains('legal-note'), p).toBe(true);
      expect(note.textContent?.replace(/\s+/g, ' ').trim(), p).toBe('Written for an open-source project; not legal advice. Suggestions welcome via GitHub.');
      const html = readFileSync(join(out, p), 'utf8');
      expect(html, p).not.toMatch(/Draft, pending legal review|draft-banner|mark class="placeholder"/);
      expect(html, p).not.toMatch(/\[[A-Z][A-Z ]{2,}\]|@cryoshield\.app/);
    }
  });

  it('/privacy and /terms name the open-source operator and no company or registered address', () => {
    for (const p of ['privacy/index.html', 'terms/index.html']) {
      const d = page(p);
      const t = d.body.textContent!.replace(/\s+/g, ' ');
      expect(t, p).toContain('CryoShield, an open-source project maintained by its contributors (github.com/prix0007/cryoshield)');
      expect(t, p).not.toMatch(/registered address|registered office/i);
      expect([...d.querySelectorAll('main a')].map((a) => a.getAttribute('href')), p).toContain('https://github.com/prix0007/cryoshield');
    }
    expect(page('privacy/index.html').body.textContent!.replace(/\s+/g, ' ')).toMatch(/maintainers act as the data controller .*only for the correspondence/i);
  });

  it('/privacy routes requests to GitHub (privacy-request issue or private advisory) and names the maintainer as Grievance Officer', () => {
    const d = page('privacy/index.html');
    const hrefs = [...d.querySelectorAll('main a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://github.com/prix0007/cryoshield/issues/new?template=privacy-request.yml');
    expect(hrefs).toContain('https://github.com/prix0007/cryoshield/security/advisories/new');
    const h = [...d.querySelectorAll('main h2')].find((x) => x.textContent?.trim() === 'Grievance Officer')!;
    let text = '';
    for (let n = h.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) text += ' ' + n.textContent;
    expect(text).toMatch(/the project maintainer/);
    expect(text).toMatch(/24 hours/);
    expect(text).toMatch(/15 days/);
    expect(text).toMatch(/private security advisory/);
  });

  it('/terms mirrors the MIT licence disclaimer and keeps the honest framing', () => {
    const t = page('terms/index.html').body.textContent!.replace(/\s+/g, ' ');
    expect(t).toContain('WITHOUT WARRANTY OF ANY KIND');
    expect(t).toContain('IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE');
    for (const s of ['test network', 'not been independently audited', 'nobody', 'cannot be removed']) expect(t).toMatch(new RegExp(s, 'i'));
  });

  it('the landing page and every legal page link to /privacy, /terms and /cookies', () => {
    for (const p of ['index.html', ...LEGAL]) {
      const hrefs = [...page(p).querySelectorAll('a')].map((a) => a.getAttribute('href'));
      for (const l of ['/privacy', '/terms', '/cookies']) expect(hrefs, `${p} -> ${l}`).toContain(l);
    }
  });

  it('legal pages load no script but the theme script, no third-party resource, and carry the app CSP', () => {
    for (const p of LEGAL) {
      const html = readFileSync(join(out, p), 'utf8');
      // add-theme-switch D1: the one same-origin classic theme script, nothing else.
      expect([...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]), p).toEqual([expect.stringMatching(/^<script src="\/assets\/theme-[0-9a-f]{8}\.js">$/)]);
      for (const m of html.matchAll(/<(?:link(?! rel="canonical")|img|source|iframe)[^>]+(?:href|src)="([^"]+)"/g)) expect(m[1], p).toMatch(/^(\/|data:)/);
      // improve-landing-seo D7: the one absolute href, the canonical link, names the production origin only.
      expect([...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map((m) => m[1]), p).toEqual([`https://cryoshield.app/${p.split('/')[0]}`]);
      expect(metaCsp(p), p).toBe(metaCsp('app/index.html'));
    }
  });
});
