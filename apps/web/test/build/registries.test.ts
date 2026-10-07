// @vitest-environment node
/**
 * web-registry-versions 1.1 (design D1): one registry-list parser for the build and the release manifest. Every version
 * in the record, newest first, with an explicit ABI kind; an unknown version fails ("update the app"), never guessed.
 */
import { describe, expect, it } from 'vitest';
import { registryList } from '../../vite-plugins/registries.mjs';

const H1 = '0x' + '11'.repeat(32);
const H2 = '0x' + '22'.repeat(32);
const HASHES = { 1: H1, 2: H2 };
const A1 = '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44';
const A2 = '0x00000000000000000000000000000000000000a2';
const A3 = '0x00000000000000000000000000000000000000a3';
const W = 'deployments/1.json';

const v1 = { address: A1, deployBlock: 7, txHash: '0x', abiHash: H1 };
const v2 = { address: A2, deployBlock: 9, txHash: '0x', abiHash: H2 };
const v3 = { address: A3, deployBlock: 12, txHash: '0x', abiHash: H2 };
const rec = (contracts: Record<string, unknown>, top: Record<string, unknown> | null = v1) => ({ chainId: 1, ...(top ?? {}), contracts });
const list = (r: unknown) => registryList(r, W, HASHES);
const brief = (r: unknown) => list(r).map((e) => [e.version, e.abi, e.address, e.deployBlock]);

describe('registryList: an ordered list of every registry version', () => {
  it('reads today\'s record: v2 then v1, with fixed ABI kinds', () => {
    expect(brief(rec({ vaultRegistryV2: v2 }))).toEqual([
      ['v2', 2, A2, 9],
      ['v1', 1, A1, 7],
    ]);
  });

  it('a record without v1 (OP Mainnet) lists only v2', () => {
    expect(brief(rec({ vaultRegistryV2: v2 }, null))).toEqual([['v2', 2, A2, 9]]);
  });

  it('3-registry fixture: a fake v3 under contracts.vaultRegistries.v3 with v2\'s abiHash is read with the v2 interface', () => {
    const r = list(rec({ vaultRegistryV2: v2, vaultRegistries: { v3 } }));
    expect(r.map((e) => [e.version, e.n, e.abi, e.address, e.deployBlock, e.abiHash])).toEqual([
      ['v3', 3, 2, A3, 12, H2],
      ['v2', 2, 2, A2, 9, H2],
      ['v1', 1, 1, A1, 7, H1],
    ]);
    expect(r[0]!.key).toBe('contracts.vaultRegistries.v3');
  });

  it('also accepts contracts.vaultRegistryV3, and the same entry under both keys', () => {
    expect(brief(rec({ vaultRegistryV2: v2, vaultRegistryV3: v3 }))[0]).toEqual(['v3', 2, A3, 12]);
    expect(brief(rec({ vaultRegistryV2: v2, vaultRegistryV3: v3, vaultRegistries: { v3 } }))).toHaveLength(3);
  });

  it('a v3 whose abiHash is v1\'s gets kind 1, but the newest registry must have the write interface', () => {
    expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistries: { v3: { ...v3, abiHash: H1 } } }))).toThrow(/v3.*write|write.*v3/);
    const r = list(rec({ vaultRegistryV2: v2, vaultRegistries: { v3: { ...v3, abiHash: H1 }, v4: { ...v3, address: '0x' + 'a4'.repeat(20), abiHash: H2 } } }));
    expect(r.map((e) => [e.version, e.abi])).toEqual([['v4', 2], ['v3', 1], ['v2', 2], ['v1', 1]]);
  });

  it('refuses an unknown version: "update the app", never a guess', () => {
    for (const abiHash of ['0x' + '99'.repeat(32), undefined]) {
      expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistries: { v3: { ...v3, abiHash } } }))).toThrow(/doesn't know VaultRegistry v3.*update the app/);
    }
  });

  it('refuses v1/v2 ABI drift, naming both hashes', () => {
    expect(() => list(rec({ vaultRegistryV2: { ...v2, abiHash: H1 } }))).toThrow(new RegExp(`VaultRegistryV2 ABI drift.*abiHash.*${H1}.*${H2}`));
    expect(() => list(rec({ vaultRegistryV2: v2 }, { ...v1, abiHash: H2 }))).toThrow(/VaultRegistry ABI drift/);
    expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistries: { v2: { ...v2, abiHash: H1 } } }))).toThrow(/ABI drift|listed twice/);
  });

  it('refuses a conflicting duplicate version and one address under two versions', () => {
    expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistryV3: v3, vaultRegistries: { v3: { ...v3, deployBlock: 13 } } }))).toThrow(/v3 is listed twice/);
    expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistries: { v3: { ...v3, address: A2 } } }))).toThrow(/same address/);
    expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistries: { v3: { ...v3, address: A2.toUpperCase().replace('0X', '0x') } } }))).toThrow(/same address/);
  });

  it('refuses bad keys, non-object entries, bad addresses and blocks', () => {
    for (const reg of [{ v03: v3 }, { v0: v3 }, { v1000: v3 }, { V3: v3 }, { 'v3\n': v3 }, { three: v3 }]) {
      expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistries: reg })), JSON.stringify(Object.keys(reg))).toThrow(/version key/);
    }
    expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistries: [v3] }))).toThrow(/vaultRegistries must be an object/);
    expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistries: { v3: 'x' } }))).toThrow(/v3 must be an object/);
    expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistries: { v3: { ...v3, address: '0x1234' } } }))).toThrow(/v3.*address/);
    expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistries: { v3: { ...v3, address: `${A3}\n` } } }))).toThrow(/v3.*address/);
    for (const deployBlock of [-1, 1.5, '12', undefined, 2 ** 53]) {
      expect(() => list(rec({ vaultRegistryV2: v2, vaultRegistries: { v3: { ...v3, deployBlock } } })), String(deployBlock)).toThrow(/v3.*deployBlock/);
    }
    expect(() => list(rec({ vaultRegistryV2: v2 }, { ...v1, address: 'nope' }))).toThrow(/v1.*address/);
  });

  it('refuses a record with no registry, and one whose newest registry is v1 (no write interface)', () => {
    expect(() => list(rec({}, null))).toThrow(/no VaultRegistry/);
    expect(() => list(rec({}))).toThrow(/vaultRegistryV2/);
    expect(() => list('nope')).toThrow(/not a deployment record/);
    expect(() => list(rec('x' as never))).toThrow(/contracts must be an object/);
  });

  it('ignores unrelated contracts keys (wallets)', () => {
    expect(brief(rec({ vaultRegistryV2: v2, wallets: { 'cryoshield.app': {} }, vaultRegistryFoo: 1 }))).toHaveLength(2);
  });
});
