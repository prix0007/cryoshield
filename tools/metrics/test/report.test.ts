// Tasks 1.3 and 1.4: aggregate metrics from the known fixture; small-cell suppression; no identifiers in the report.
import { describe, expect, it } from 'vitest';
import { collect } from '../src/metrics.ts';
import { assertNoIdentifiers, complement, findIdentifiers, isoWeek, MIN_CELL, suppress } from '../src/report.ts';
import { keyCount } from '../src/blob.ts';
import { fixtureBlob } from './fixtures/blobs.ts';
import { GAS, network, REG1, REG2, RPC, scenario, W41, W42 } from './fixtures/scenario.ts';

const run = (chainId = 31337) => {
  const { chain } = scenario(chainId);
  return collect(network(chainId), { fetchFn: chain.fetchFor([RPC]), mirror: false, gas: GAS, now: new Date('2026-10-20T00:00:00Z') });
};

describe('known fixture (local chain: exact counts)', () => {
  it('reports totals, weekly creates/updates, keys per vault and weekly active vaults', async () => {
    const r = await run();
    expect(r.vaults_total).toBe(3);
    expect(r.vaults_by_registry).toEqual({ v1: 1, v2: 2 });
    expect(r.keys_per_vault).toEqual({ '2': 2, '3': 1 });
    expect(r.created).toEqual({ [W41]: 3 });
    expect(r.updates_total).toBe(2);
    expect(r.updates).toEqual({ [W41]: 2 });
    expect(r.weekly_active).toEqual({ [W41]: 3, [W42]: 1 });
    expect(r.suppression).toEqual({ min_cell: MIN_CELL, applied: false });
  });

  it('records the chain, every registry read and the block range', async () => {
    const r = await run();
    expect(r.network).toBe('anvil');
    expect(r.chain_id).toBe(31337);
    expect(r.registries).toEqual([
      { version: 'v2', address: REG2, from_block: 15, to_block: 70 },
      { version: 'v1', address: REG1, from_block: 5, to_block: 70 },
    ]);
  });
});

describe('public network: small-cell suppression', () => {
  it('reports any weekly or distribution bucket with fewer than 3 vaults as "<3"', async () => {
    const r = await run(11155420);
    expect(r.suppression).toEqual({ min_cell: 3, applied: true });
    expect(r.vaults_total).toBe(3);
    expect(r.created).toEqual({ [W41]: 3 });
    // one vault updated twice: the bucket holds 1 vault, so the count is hidden
    expect(r.updates).toEqual({ [W41]: '<3' });
    expect(r.weekly_active).toEqual({ [W41]: 3, [W42]: '<3' });
    expect(r.keys_per_vault).toEqual({ '2': '<3', '3': '<3' });
    expect(r.vaults_by_registry).toEqual({ v1: '<3', v2: '<3' });
    // totals are buckets too: 2 updates by 1 vault; sponsored gas of 2 accounts
    expect(r.updates_total).toBe('<3');
    expect(r.sponsored_gas?.per_week).toEqual({ [W41]: '<3' });
    expect(r.sponsored_gas?.ops).toBe('<3');
    expect(r.sponsored_gas?.total_wei).toBe('<3');
    expect(r.sponsored_gas?.total_eth).toBe('<3');
  });

  it('suppress() keeps 0 and >= 3, hides 1 and 2', () => {
    expect([0, 1, 2, 3, 10].map((n) => suppress(n, n, true))).toEqual([0, '<3', '<3', 3, 10]);
    expect(suppress(2, 2, false)).toBe(2);
    // the shown value can differ from the vault count it is judged by (updates: events vs vaults)
    expect(suppress(7, 1, true)).toBe('<3');
  });
});

describe('complementary suppression (no recovering a hidden cell from a published total)', () => {
  it('hides the next-smallest cell when exactly one cell is hidden', () => {
    expect(complement({ a: '<3', b: 5, c: 4 }, { a: 1, b: 5, c: 4 })).toEqual({ a: '<3', b: 5, c: '<3' });
    expect(complement({ a: '<3', b: '<3', c: 4 }, { a: 1, b: 2, c: 4 })).toEqual({ a: '<3', b: '<3', c: 4 });
    expect(complement({ a: 3, b: 4 }, { a: 3, b: 4 })).toEqual({ a: 3, b: 4 });
    expect(complement({ a: '<3' }, { a: 1 })).toEqual({ a: '<3' });
  });

  it('applies to every cell family that sums to a published total', async () => {
    const { chain } = scenario(11155420);
    // a 4th vault in W42 with 4 keys: keys {2:2, 3:1, 4:1} -> 2, 3 and 4 all hidden; created {W41:3, W42:1}
    chain.create(REG2, { vaultId: `0x${'44'.repeat(32)}`, owner: '0x00000000000000000000000000000000000000d4', blob: fixtureBlob(4, { seed: 9 }), block: 65n, ts: Date.UTC(2026, 9, 13) / 1000 });
    chain.head = 70n;
    const r = await collect(network(11155420), { fetchFn: chain.fetchFor([RPC]), mirror: false, gas: GAS });
    expect(r.vaults_total).toBe(4);
    expect(r.created).toEqual({ [W41]: '<3', [W42]: '<3' });
    expect(r.vaults_by_registry).toEqual({ v1: '<3', v2: '<3' }); // v1 = total - v2 otherwise
    expect(r.keys_per_vault).toEqual({ '2': '<3', '3': '<3', '4': '<3' });
  });
});

describe('no identifiers in the report', () => {
  it('the fixture report has no 20- or 32-byte hex value except the registry addresses', async () => {
    for (const chainId of [31337, 11155420]) {
      const r = await run(chainId);
      expect(findIdentifiers(JSON.stringify(r), [REG1, REG2])).toEqual([]);
      expect(() => assertNoIdentifiers(r)).not.toThrow();
    }
  });

  it('the scanner catches addresses, vault ids and tx hashes, in any case, even unprefixed', () => {
    const id = `0x${'ab'.repeat(32)}`;
    expect(findIdentifiers(`{"x":"${id}"}`, [])).toEqual([id]);
    expect(findIdentifiers(`{"x":"0x${'CD'.repeat(20)}"}`, [])).toHaveLength(1);
    expect(findIdentifiers(`{"x":"${'ef'.repeat(32)}"}`, [])).toHaveLength(1);
    expect(findIdentifiers(`{"r":"${REG1.toUpperCase().replace('0X', '0x')}"}`, [REG1])).toEqual([]);
    const leaky = { registries: [], leak: id };
    expect(() => assertNoIdentifiers(leaky)).toThrow(/identifier/);
  });
});

describe('helpers', () => {
  it('ISO weeks, including year boundaries', () => {
    const w = (iso: string) => isoWeek(Date.parse(iso) / 1000);
    expect(w('2026-10-05T00:00:00Z')).toBe('2026-W41');
    expect(w('2026-10-11T23:59:59Z')).toBe('2026-W41');
    expect(w('2026-01-01T00:00:00Z')).toBe('2026-W01');
    expect(w('2027-01-01T00:00:00Z')).toBe('2026-W53');
    expect(w('2024-12-30T00:00:00Z')).toBe('2025-W01');
  });

  it('reads the cleartext key count N from a blob header, or null for anything else', () => {
    expect(keyCount(fixtureBlob(2))).toBe(2);
    expect(keyCount(fixtureBlob(8, { mode: 2 }))).toBe(8);
    const bad = fixtureBlob(3);
    bad[0] = 0x58;
    expect(keyCount(bad)).toBeNull();
    expect(keyCount(new Uint8Array([0x43, 0x52, 0x59, 0x4f, 1, 1, 1, 1, 9]))).toBeNull(); // N > 8
    expect(keyCount(new Uint8Array(3))).toBeNull();
    expect(keyCount(new Uint8Array(1025))).toBeNull();
  });

  it('a vault whose blob header is unreadable is counted as "unknown"', async () => {
    const { chain } = scenario();
    for (const [k, v] of chain.vaults) chain.vaults.set(k, { ...v, blob: new Uint8Array([1, 2, 3]) });
    const r = await collect(network(), { fetchFn: chain.fetchFor([RPC]), mirror: false, gas: false });
    expect(r.keys_per_vault).toEqual({ unknown: 3 });
  });
});
