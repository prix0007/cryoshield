// @vitest-environment jsdom
/** add-donation: the built /support page, the footer link on every page, the landing pill, and the legal sections. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jsQR from 'jsqr';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { qrMatrixFromSvg } from '../../vite-plugins/donation';

const web = join(__dirname, '..', '..');
const ADDRESS = '0xfb4172e26AC8735C06656f1df14151cFe8441481';
const URI = `ethereum:${ADDRESS}@1`;
let out = '';
beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'cs-support-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')));
  execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'e2e', '--outDir', out, '--emptyOutDir'], { cwd: web, stdio: 'pipe', env: { ...env, NODE_ENV: 'production' } });
}, 180_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));
const html = (p: string) => readFileSync(join(out, p), 'utf8');
const doc = (p: string) => new DOMParser().parseFromString(html(p), 'text/html');
const metaCsp = (p: string) => html(p).match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];

describe('/support (built)', () => {
  it('shows exactly the configured address in monospace, with checksum casing', () => {
    const d = doc('support/index.html');
    const code = d.getElementById('donation-address')!;
    expect(code.textContent).toBe(ADDRESS);
    expect(code.classList.contains('mono')).toBe(true);
    expect([...html('support/index.html').matchAll(/0x[0-9a-fA-F]{40}/g)].map((m) => m[0])).toEqual(expect.arrayContaining([ADDRESS]));
    expect(new Set([...html('support/index.html').matchAll(/0x[0-9a-fA-F]{40}/g)].map((m) => m[0]))).toEqual(new Set([ADDRESS]));
  });

  it('the QR code in the built page decodes to exactly the EIP-681 URI', () => {
    const svg = html('support/index.html').match(/<svg [^>]*class="qr"[\s\S]*?<\/svg>/)![0];
    const m = qrMatrixFromSvg(svg);
    const scale = 6;
    const size = m.length * scale;
    const px = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = m[Math.floor(y / scale)]![Math.floor(x / scale)] ? 0 : 255;
        px.set([v, v, v, 255], (y * size + x) * 4);
      }
    expect(jsQR(px, size, size)?.data).toBe(URI);
  });

  it('has "Open in wallet" (EIP-681, no script needed), a hidden-until-JS Copy button, and the warnings', () => {
    const d = doc('support/index.html');
    const wallet = [...d.querySelectorAll('a')].find((a) => a.textContent === 'Open in wallet')!;
    expect(wallet.getAttribute('href')).toBe(URI);
    expect(d.getElementById('copy-address')?.hasAttribute('hidden')).toBe(true);
    const t = d.body.textContent!.replace(/\s+/g, ' ');
    expect(t).toContain('Send only ETH on Ethereum mainnet. Tokens or other networks sent here may be lost.');
    expect(t).toMatch(/also published in our GitHub README\. Check it matches/);
    expect([...d.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('https://github.com/prix0007/cryoshield#support-the-project');
    for (const w of ['Voluntary', 'No perks', 'Non-refundable', 'no tax receipts', 'audit', 'maintainer']) expect(t).toContain(w);
  });

  it('carries the app CSP, loads only its own same-origin module, and has no analytics', () => {
    expect(metaCsp('support/index.html')).toBe(metaCsp('app/index.html'));
    const h = html('support/index.html');
    expect(h).not.toMatch(/cloudflareinsights|cf-beacon/);
    for (const m of h.matchAll(/<script[^>]*src="([^"]+)"/g)) expect(m[1]).toMatch(/^\/assets\//);
    expect(h).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/); // no inline script
  });

  it('no shipped JS touches an injected wallet', () => {
    for (const f of readdirSync(join(out, 'assets')).filter((x) => x.endsWith('.js'))) {
      expect(readFileSync(join(out, 'assets', f), 'utf8'), f).not.toMatch(/window\.ethereum|ethereum\.request\(|eth_requestAccounts/);
    }
  });

  it('no wallet-connect library is a dependency (viem only ships an error-class name for it)', () => {
    const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8')) as Record<string, Record<string, string>>;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /walletconnect|@reown|web3modal|wagmi|connectkit|rainbowkit|web3-onboard|ethers/i.test(d))).toEqual([]);
  });
});

describe('the coffee button everywhere', () => {
  const PAGES = ['index.html', 'privacy/index.html', 'terms/index.html', 'cookies/index.html', 'architecture/index.html', 'devices/index.html', 'support/index.html'];
  it('every page footer has one "Buy me a coffee" link to /support', () => {
    for (const p of PAGES) {
      const links = [...doc(p).querySelectorAll('footer a[href="/support"]')];
      expect(links.map((a) => a.textContent?.replace('☕', '').trim()), p).toContain('Buy me a coffee');
    }
  });
  it('the landing has the coffee pill (cup + steam + sheen, decorative parts hidden from AT)', () => {
    const pill = doc('index.html').querySelector('a.coffee[data-coffee]')!;
    expect(pill.getAttribute('href')).toBe('/support');
    expect(pill.querySelector('.coffee-cup')?.getAttribute('aria-hidden')).toBe('true');
    expect(pill.querySelector('.coffee-sheen')?.getAttribute('aria-hidden')).toBe('true');
    expect(pill.textContent?.trim()).toBe('Buy me a coffee');
  });
});

describe('legal sections', () => {
  it('/terms covers donations: voluntary, non-refundable, nothing in return, tax', () => {
    const t = doc('terms/index.html').getElementById('donations')!.parentElement!.textContent!;
    for (const w of ['Voluntary', 'Non-refundable', 'no goods, services', 'tax']) expect(t).toContain(w);
  });
  it('/privacy says donations are not tracked and the chain is public', () => {
    const t = doc('privacy/index.html').body.textContent!.replace(/\s+/g, ' ');
    expect(t).toMatch(/We don['’]t track donations/);
    expect(t).toMatch(/sending address, the amount and the time are visible to anyone/);
  });
});
