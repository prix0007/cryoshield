// @vitest-environment jsdom
/**
 * launch-op-mainnet 4.3 (spec legal-pages "Network and audit status in legal text"): /terms and /privacy name the
 * build's network, say on every network that CryoShield has not been independently audited and that nobody can open a
 * vault after all its keys are lost; the privacy sub-processor table names the configured RPC host. Built for real,
 * once per chain (chain 10 from the test-only fixture record).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildForChain, type NetworkBuild } from '../fixtures/network-build';
import { bannedFor } from '../landing/banned';

let testnet: NetworkBuild;
let mainnet: NetworkBuild;
beforeAll(() => {
  testnet = buildForChain(11155420);
  mainnet = buildForChain(10);
}, 240_000);
afterAll(() => {
  testnet?.cleanup();
  mainnet?.cleanup();
});

const section = (d: Document, heading: string) => {
  const h = [...d.querySelectorAll('main h2')].find((x) => x.textContent?.trim() === heading);
  let t = '';
  for (let n = h?.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) t += ' ' + n.textContent;
  return t.replace(/\s+/g, ' ');
};
const rpcRow = (b: NetworkBuild) =>
  [...b.doc('privacy/index.html').querySelectorAll('main tr')].find((tr) => tr.querySelector('td')?.textContent?.trim() === 'Blockchain access (RPC)')?.textContent?.replace(/\s+/g, ' ') ?? '';
const chainRow = (b: NetworkBuild) =>
  [...b.doc('privacy/index.html').querySelectorAll('main tr')].find((tr) => tr.querySelector('td')?.textContent?.trim() === 'Public blockchain')?.textContent?.replace(/\s+/g, ' ') ?? '';
const KEYS_LOST = /If you lose every security key enrolled for a vault, the vault cannot be opened by anyone, including us\./;

describe('/terms names the network and keeps the honest statements', () => {
  it('OP Sepolia: a test network, not independently audited, all keys lost', () => {
    const t = testnet.text('terms/index.html');
    expect(section(testnet.doc('terms/index.html'), 'Network and audit status')).toMatch(/runs on OP Sepolia, a test network, and its code has not been independently audited/);
    expect(t).toMatch(/testnet preview/);
    expect(t).toMatch(KEYS_LOST);
  });

  it('OP Mainnet: names OP Mainnet, not independently audited, all keys lost; no testnet wording', () => {
    const d = mainnet.doc('terms/index.html');
    const t = mainnet.text('terms/index.html');
    expect(section(d, 'Network and audit status')).toMatch(/runs on OP Mainnet, and its code has not been independently audited/);
    expect(d.querySelector('.summary-box')?.textContent?.replace(/\s+/g, ' ')).toMatch(/runs on OP Mainnet and has not been independently audited/);
    expect(t).toMatch(KEYS_LOST);
    expect(mainnet.html('terms/index.html')).not.toMatch(/OP Sepolia|testnet|test network/i);
  });
});

describe('/privacy names the network and the configured RPC host', () => {
  it('OP Sepolia: the blockchain and RPC rows name OP Sepolia and sepolia.optimism.io', () => {
    expect(chainRow(testnet)).toMatch(/OP Sepolia test network/);
    expect(rpcRow(testnet)).toMatch(/OP Labs public RPC \(OP Sepolia\).*sepolia\.optimism\.io/);
    expect(section(testnet.doc('privacy/index.html'), 'Security')).toMatch(/testnet preview.*not been independently audited/);
  });

  it('OP Mainnet: the rows name OP Mainnet and mainnet.optimism.io; no OP Sepolia or testnet preview anywhere', () => {
    expect(chainRow(mainnet)).toMatch(/OP Mainnet, run by independent node operators/);
    expect(rpcRow(mainnet)).toMatch(/OP Labs public RPC \(OP Mainnet\).*mainnet\.optimism\.io/);
    expect(rpcRow(mainnet)).not.toMatch(/sepolia/i);
    // Review L7: the policy link is the one recorded for that origin in docs/compliance/origins.json.
    const link = [...mainnet.doc('privacy/index.html').querySelectorAll('main tr')].find((tr) => tr.querySelector('td')?.textContent?.trim() === 'Blockchain access (RPC)')?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://www.optimism.io/data-privacy-policy');
    expect(link?.textContent).toBe('Optimism privacy');
    const sec = section(mainnet.doc('privacy/index.html'), 'Security');
    expect(sec).toMatch(/runs on OP Mainnet and has not been independently audited/);
    expect(mainnet.html('privacy/index.html')).not.toMatch(/OP Sepolia|testnet|test network/i);
  });

  it.each(['testnet', 'mainnet'] as const)('%s: states that nobody can open a vault after all its keys are lost', (k) => {
    const b = k === 'testnet' ? testnet : mainnet;
    expect(section(b.doc('privacy/index.html'), 'Security')).toMatch(/If you lose every security key enrolled for a vault, nobody, including us, can open it\./);
  });
});

describe('legal header, footer and metadata follow the chain', () => {
  it('the header chip and the footer line', () => {
    for (const p of ['terms/index.html', 'privacy/index.html', 'cookies/index.html', 'architecture/index.html', 'devices/index.html', 'support/index.html']) {
      expect(testnet.doc(p).querySelector('.sub-nav .chip')?.textContent?.trim(), p).toBe('Testnet preview');
      expect(mainnet.doc(p).querySelector('.sub-nav .chip')?.textContent?.trim(), p).toBe('Unaudited');
      expect(testnet.doc(p).querySelector('footer .legal')?.textContent, p).toMatch(/Testnet preview on OP Sepolia, not independently audited\./);
      expect(mainnet.doc(p).querySelector('footer .legal')?.textContent, p).toMatch(/Runs on OP Mainnet, not independently audited\./);
    }
  });

  it('no page of the mainnet build says testnet or OP Sepolia, and llms.txt matches', () => {
    for (const p of ['index.html', 'terms/index.html', 'privacy/index.html', 'cookies/index.html', 'architecture/index.html', 'devices/index.html', 'support/index.html']) {
      expect(mainnet.html(p), p).not.toMatch(/OP Sepolia|testnet|test network/i);
    }
    const llms = readFileSync(join(mainnet.out, 'llms.txt'), 'utf8');
    expect(llms).toMatch(/OP Mainnet/);
    expect(llms).not.toMatch(/testnet|OP Sepolia/i);
    for (const b of bannedFor(10)) expect(llms, String(b)).not.toMatch(b);
  });

  it('the mainnet terms description is chain-specific and within the SEO limits', () => {
    const desc = mainnet.doc('terms/index.html').querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    expect(desc).toMatch(/unaudited: no warranty, no custody, only your keys can open it\.$/);
  });
});

describe('versioned legal text (check-legal-dates.mjs)', () => {
  const web = join(__dirname, '..', '..');
  it.each(['terms', 'privacy'])('%s.md has a new effective date and a matching change entry', (name) => {
    const md = readFileSync(join(web, 'legal', `${name}.md`), 'utf8');
    const date = md.match(/^\*\*Effective date:\*\*\s*(\d{4}-\d{2}-\d{2})/m)?.[1];
    expect(date! >= '2026-10-09').toBe(true);
    const changes = md.slice(md.indexOf('## Changes'));
    expect(changes).toMatch(new RegExp(`^- ${date}[^\\n]*:`, 'm'));
  });
});
