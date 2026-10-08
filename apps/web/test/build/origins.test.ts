// @vitest-environment node
/** add-privacy-and-compliance 2.2 (spec privacy-compliance "Data-flow inventory matches the build"). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkOrigins, checkRpcDisclosed } from '../../scripts/origins-check.mjs';
import { buildForChain } from '../fixtures/network-build';

const inventory = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'compliance', 'origins.json'), 'utf8'));
const csp = (connect: string, script = "'self'") => `default-src 'none'; script-src ${script}; connect-src 'self' ${connect}; base-uri 'none'`;

describe('origins vs data-flow inventory', () => {
  it('passes for the production origins and lists each with its role', () => {
    const r = checkOrigins(csp('https://sepolia.optimism.io https://api.pimlico.io https://upload.ardrive.io https://arweave.net'), inventory);
    expect(r.missing).toEqual([]);
    expect(r.listed.map((l) => l.origin)).toEqual(['https://sepolia.optimism.io', 'https://api.pimlico.io', 'https://upload.ardrive.io', 'https://arweave.net']);
    expect(r.listed[1]!.role).toMatch(/processor/);
  });

  it('names an origin missing from the inventory (connect-src or script-src)', () => {
    expect(checkOrigins(csp('https://api.pimlico.io https://rpc.unlisted.example'), inventory).missing).toEqual(['https://rpc.unlisted.example']);
    expect(checkOrigins(csp('', "'self' https://cdn.unlisted.example/x.js"), inventory).missing).toEqual(['https://cdn.unlisted.example']);
  });

  it('exempts loopback and .invalid fixture origins', () => {
    expect(checkOrigins(csp('http://127.0.0.1:8545 http://localhost:4337 https://rpc.verify.invalid'), inventory).missing).toEqual([]);
  });
});

/**
 * launch-op-mainnet 4.4 (spec legal-pages "RPC origin must be disclosed"): the privacy sub-processor table names the
 * configured RPC host. A chain-10 build with an RPC that has no inventory row (so no privacy row) fails and names the
 * host; with https://mainnet.optimism.io it passes, and the built /privacy names it (checked again by verify-build).
 */
describe('RPC host disclosed on /privacy (launch-op-mainnet 4.4)', () => {
  const privacy = (rpcCell: string) => `<main><table><tr><td>Blockchain access (RPC)</td><td>${rpcCell}</td></tr></table></main>`;

  it('checkRpcDisclosed names a host the privacy RPC row does not list; loopback and .invalid are exempt', () => {
    expect(checkRpcDisclosed(privacy('OP Labs public RPC (OP Mainnet), <code>mainnet.optimism.io</code>'), 'https://mainnet.optimism.io')).toEqual([]);
    expect(checkRpcDisclosed(privacy('OP Labs public RPC (OP Sepolia), <code>sepolia.optimism.io</code>'), 'https://mainnet.optimism.io')).toEqual(['mainnet.optimism.io']);
    expect(checkRpcDisclosed(privacy('nothing'), 'https://rpc.verify.invalid')).toEqual([]);
    expect(checkRpcDisclosed(privacy('nothing'), 'http://127.0.0.1:8545')).toEqual([]);
    // Only the RPC row counts, not a mention elsewhere on the page.
    expect(checkRpcDisclosed(`<p>mainnet.optimism.io</p>${privacy('other')}`, 'https://mainnet.optimism.io')).toEqual(['mainnet.optimism.io']);
    expect(checkRpcDisclosed('<p>no table</p>', 'https://mainnet.optimism.io')).toEqual(['mainnet.optimism.io']);
  });

  it('a chain-10 build with an unlisted RPC fails and names the host', () => {
    let err = '';
    try {
      buildForChain(10, { VITE_RPC_URL: 'https://rpc.unlisted.example' }).cleanup();
    } catch (e) {
      err = String((e as { stderr?: Buffer }).stderr ?? e);
    }
    expect(err).toMatch(/rpc\.unlisted\.example is not in docs\/compliance\/origins\.json/);
  }, 120_000);

  it('a chain-10 build with https://mainnet.optimism.io passes, lists it on /privacy and in the CSP inventory', () => {
    const b = buildForChain(10);
    try {
      expect(checkRpcDisclosed(b.html('privacy/index.html'), 'https://mainnet.optimism.io')).toEqual([]);
      const appCsp = b.html('app/index.html').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)![1]!;
      const r = checkOrigins(appCsp, inventory);
      expect(r.missing).toEqual([]);
      expect(r.listed.map((l) => l.origin)).toContain('https://mainnet.optimism.io');
    } finally {
      b.cleanup();
    }
  }, 120_000);
});
