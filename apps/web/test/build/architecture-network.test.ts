// @vitest-environment jsdom
/**
 * launch-op-mainnet 4.7 (spec architecture-page "Networks without VaultRegistry v1"): a chain-10 build (from the
 * TEST-ONLY fixture record, which has no v1) states that VaultRegistry v1 does not exist there, and shows OP Mainnet,
 * chain 10 and the record's v2, factory and implementation. The OP Sepolia build is unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildForChain, type NetworkBuild } from '../fixtures/network-build';
import { architectureValues } from '../../vite-plugins/cryoshield';
// @ts-expect-error plain ESM helper without types
import { FIXTURE_DEPLOY_BLOCK, mainnetRecord } from '../fixtures/mainnet-contracts.mjs';
import { join } from 'node:path';

const contracts = join(__dirname, '..', '..', '..', '..', 'contracts');
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

const rows = (b: NetworkBuild) =>
  [...b.doc('architecture/index.html').querySelectorAll('section[aria-labelledby="s5"] tr')].map((tr) => [tr.querySelector('th')?.textContent?.trim(), tr.querySelector('td')?.textContent?.replace(/\s+/g, ' ').trim()]);
const value = (b: NetworkBuild, label: string) => rows(b).find(([th]) => th === label)?.[1];

describe('/architecture on OP Mainnet (fixture record without v1)', () => {
  it('names OP Mainnet and chain 10, with no forward-looking note', () => {
    expect(value(mainnet, 'Network')).toBe('OP Mainnet, chain 10');
  });

  it('says VaultRegistry v1 is none on this network, and shows v2, the deploy block, the factory and implementation from the record', () => {
    const rec = mainnetRecord(contracts);
    const regs = rows(mainnet).filter(([th]) => th?.startsWith('VaultRegistry'));
    expect(regs).toEqual([
      ['VaultRegistry v2', rec.contracts.vaultRegistryV2.address],
      ['VaultRegistry v1', 'none on this network'],
    ]);
    expect(value(mainnet, 'Deploy block')).toBe(String(FIXTURE_DEPLOY_BLOCK));
    expect(value(mainnet, 'Account factory')).toBe(rec.contracts.wallets['cryoshield.app'].factory);
    expect(value(mainnet, 'Account implementation')).toBe(rec.contracts.wallets['cryoshield.app'].implementation);
    expect(mainnet.html('architecture/index.html')).not.toMatch(/__CS_[A-Z_]+__|<!--\/?net/);
  });

  it('the diagram description names the build network', () => {
    const label = mainnet.doc('architecture/index.html').querySelector('main svg[role="img"]')?.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/VaultRegistry on OP Mainnet/);
    expect(mainnet.html('architecture/index.html')).not.toMatch(/sepolia|testnet/i);
  });
});

describe('/architecture on OP Sepolia (unchanged)', () => {
  it('lists v2 and the read-only v1 and keeps the mainnet note', () => {
    expect(value(testnet, 'Network')).toBe('OP Sepolia testnet, chain 11155420 (mainnet will be OP Mainnet)');
    const regs = rows(testnet).filter(([th]) => th?.startsWith('VaultRegistry')).map(([th]) => th);
    expect(regs).toEqual(['VaultRegistry v2', 'VaultRegistry v1']);
    expect(value(testnet, 'VaultRegistry v1')).toMatch(/^0x[0-9a-fA-F]{40} \(read-only\)$/);
    expect(testnet.doc('architecture/index.html').querySelector('main svg[role="img"]')?.getAttribute('aria-label')).toMatch(/VaultRegistry on OP Sepolia/);
  });
});

describe('architectureValues without a v1 registry', () => {
  it('adds the "none on this network" row only when the record has no v1', () => {
    const wallet = { rpId: 'cryoshield.app', factory: ('0x' + 'f1'.repeat(20)) as `0x${string}`, implementation: ('0x' + 'e1'.repeat(20)) as `0x${string}`, rpIdHash: '0x' as const, deployBlock: 1 };
    const reg = (n: 1 | 2) => ({ version: `v${n}` as const, n, abi: n, address: ('0x' + `a${n}`.repeat(20)) as `0x${string}`, deployBlock: 5, txHash: '', abiHash: '0x' as const, key: '' });
    const page = '<table>__CS_REGISTRY_ROWS__</table>';
    const cells = (h: string) => [...new DOMParser().parseFromString(h, 'text/html').querySelectorAll('tr')].map((tr) => tr.textContent);
    expect(cells(architectureValues(page, 10, { registries: [reg(2)], wallet }, 'cryoshield.app'))).toEqual([`VaultRegistry v2${'0x' + 'a2'.repeat(20)}`, 'VaultRegistry v1none on this network']);
    expect(cells(architectureValues(page, 11155420, { registries: [reg(2), reg(1)], wallet }, 'cryoshield.app'))).toEqual([
      `VaultRegistry v2${'0x' + 'a2'.repeat(20)}`,
      `VaultRegistry v1${'0x' + 'a1'.repeat(20)} (read-only)`,
    ]);
  });
});
