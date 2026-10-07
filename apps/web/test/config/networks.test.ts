import { describe, expect, it } from 'vitest';
import { addressUrl, arweaveUrl, networkFor, txUrl } from '../../src/config/networks';

const ADDR = '0x' + 'ab'.repeat(20);
const HASH = '0x' + 'cd'.repeat(32);
const AR_ID = 'A'.repeat(21) + '-_' + 'z'.repeat(20);

describe('network table (show-vault-onchain-location D1)', () => {
  it('names the supported chains and their canonical Blockscout explorers', () => {
    expect(networkFor(11155420)).toEqual({ name: 'OP Sepolia testnet', explorerUrl: 'https://testnet-explorer.optimism.io' });
    expect(networkFor(10)).toEqual({ name: 'OP Mainnet', explorerUrl: 'https://explorer.optimism.io' });
    expect(networkFor(421614).explorerUrl).toBe('https://arbitrum-sepolia.blockscout.com');
    expect(networkFor(42161).explorerUrl).toBe('https://arbitrum.blockscout.com');
  });

  it('has no explorer for the local chain, and a fallback for unknown chains', () => {
    expect(networkFor(31337)).toEqual({ name: 'local test chain', explorerUrl: null });
    expect(networkFor(999)).toEqual({ name: 'chain 999', explorerUrl: null });
  });

  it('builds explorer links only for well-formed values', () => {
    const ex = 'https://testnet-explorer.optimism.io';
    expect(addressUrl(ex, ADDR)).toBe(`${ex}/address/${ADDR}`);
    expect(txUrl(ex, HASH)).toBe(`${ex}/tx/${HASH}`);
    expect(addressUrl(null, ADDR)).toBeNull();
    expect(txUrl(null, HASH)).toBeNull();
    for (const bad of ['', '0x12', ADDR + '00', '0x' + 'zz'.repeat(20), `${ADDR}/../x`, 'javascript:alert(1)']) expect(addressUrl(ex, bad)).toBeNull();
    for (const bad of ['', ADDR, HASH + '0', `${HASH}?x`]) expect(txUrl(ex, bad)).toBeNull();
  });

  it('builds the Arweave gateway link only for a 43-character base64url id', () => {
    expect(arweaveUrl('https://arweave.net', AR_ID)).toBe(`https://arweave.net/${AR_ID}`);
    for (const bad of ['', 'short', AR_ID + 'x', '../' + AR_ID.slice(3), AR_ID.slice(1) + '/']) expect(arweaveUrl('https://arweave.net', bad)).toBeNull();
  });
});
