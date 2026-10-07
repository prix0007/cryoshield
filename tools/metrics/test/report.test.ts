// Tasks 1.3 and 1.4: aggregate metrics from the known fixture; small-cell protection; no identifiers in the report.
import { describe, expect, it } from 'vitest';
import { collect } from '../src/metrics.ts';
import {
  assertNoIdentifiers,
  buildReport,
  findIdentifiers,
  isoWeek,
  mergeCategories,
  mergeSeries,
  MIN_CELL,
  mirrorReport,
  weekStart,
  type Bucket,
  type GasOp,
  type MirrorOutcome,
  type ReportInput,
} from '../src/report.ts';
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
    expect([r.vaults_pending, r.updates_pending, r.weekly_active_pending]).toEqual([0, 0, 0]);
    expect(r.suppression).toEqual({ min_cell: MIN_CELL, applied: false });
    expect(r.through_week).toBeNull();
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

describe('public network', () => {
  it('reads complete ISO weeks only (stops before the current week)', async () => {
    const r = await run(11155420);
    expect(r.through_week).toBe(W41);
    expect(r.registries.map((x) => x.to_block)).toEqual([59, 59]); // block 60 (W42) is not read
    expect(r.weekly_active).toEqual({ [W41]: 3 });
  });

  it('merges small groups instead of publishing them; small open ranges are only "pending"', async () => {
    const r = await run(11155420);
    expect(r.suppression).toEqual({ min_cell: 3, applied: true });
    expect(r.vaults_total).toBe(3);
    expect(r.created).toEqual({ [W41]: 3 });
    // one vault updated twice: 1 vault, so the week stays open and nothing is counted in the total
    expect(r.updates).toEqual({});
    expect(r.updates_total).toBe(0);
    expect(r.updates_pending).toBe('<3');
    expect(r.keys_per_vault).toEqual({ '2-3': 3 });
    expect(r.vaults_by_registry).toEqual({ 'v1+v2': 3 });
    // sponsored gas of 2 accounts: pending, never a total
    expect(r.sponsored_gas).toMatchObject({ ops: 0, total_wei: '0', per_week: {}, pending: '<3' });
  });
});

describe('merging (no hidden cell recoverable by subtraction)', () => {
  const weeks = (counts: number[]) => {
    const m = new Map<string, Bucket<number>>();
    let v = 0;
    counts.forEach((n, i) => {
      const members = new Set<string>();
      for (let j = 0; j < n; j++) members.add(`v${v++}`);
      m.set(`2026-W${String(39 + i).padStart(2, '0')}`, { value: n, members });
    });
    return m;
  };
  const add = (a: number, b: number) => a + b;

  it('joins consecutive weeks until a range covers MIN_CELL members', () => {
    expect(mergeSeries(weeks([5, 1, 1]), add, true)).toMatchObject({ cells: { '2026-W39': 5 }, pending: '<3' });
    expect(mergeSeries(weeks([5, 1, 1, 1]), add, true).cells).toEqual({ '2026-W39': 5, '2026-W40..2026-W42': 3 });
    expect(mergeSeries(weeks([1, 1, 1, 4]), add, true).cells).toEqual({ '2026-W39..2026-W41': 3, '2026-W42': 4 });
    expect(mergeSeries(weeks([5, 1, 1]), add, false)).toMatchObject({ cells: { '2026-W39': 5, '2026-W40': 1, '2026-W41': 1 }, pending: 0 });
  });

  it('every published range is identical in every later report (no differencing across weeks)', () => {
    const series = [1, 2, 5, 1, 1, 0, 2, 1, 4, 1, 1, 1, 2].map((n) => n);
    const published = new Map<string, number>();
    for (let k = 1; k <= series.length; k++) {
      const { cells } = mergeSeries(weeks(series.slice(0, k).filter((n) => n > 0)), add, true);
      for (const [range, v] of Object.entries(cells)) {
        expect(v).toBeGreaterThanOrEqual(MIN_CELL);
        if (published.has(range)) expect(published.get(range)).toBe(v);
        published.set(range, v);
      }
    }
  });

  it('counts distinct members across a range (a vault active in two weeks counts once)', () => {
    const m = new Map<string, Bucket<number>>([
      ['2026-W40', { value: 1, members: new Set(['a']) }],
      ['2026-W41', { value: 1, members: new Set(['a']) }],
      ['2026-W42', { value: 2, members: new Set(['b', 'c']) }],
    ]);
    expect(mergeSeries(m, add, true).cells).toEqual({ '2026-W40..2026-W42': 4 });
  });

  it('merges ordered categories; a short remainder joins the last group', () => {
    expect(mergeCategories([['2', 2], ['3', 1]], true, (a, b) => `${a}-${b}`)).toEqual({ '2-3': 3 });
    expect(mergeCategories([['2', 5], ['3', 1]], true, (a, b) => `${a}-${b}`)).toEqual({ '2-3': 6 });
    expect(mergeCategories([['2', 1], ['3', 5], ['4', 3]], true, (a, b) => `${a}-${b}`)).toEqual({ '2-3': 6, '4': 3 });
    expect(mergeCategories([['2', 4], ['5', 3], ['unknown', 1]], true, (a, b) => `${a}-${b}`)).toEqual({ '2': 4, '5-unknown': 4 });
    expect(mergeCategories([['2', 2], ['3', 1]], false, (a, b) => `${a}-${b}`)).toEqual({ '2': 2, '3': 1 });
  });

  it('mirror coverage shows only bounds when 1 or 2 vaults are not mirrored', () => {
    const o = (m: number, n: number, f: number): MirrorOutcome[] => [
      ...Array<MirrorOutcome>(m).fill('mirrored'),
      ...Array<MirrorOutcome>(n).fill('not_mirrored'),
      ...Array<MirrorOutcome>(f).fill('lookup_failed'),
    ];
    expect(mirrorReport(o(10, 1, 0), true)).toEqual({ vaults: 11, mirrored: '>=9', not_mirrored: '<3', lookup_failed: '<3' });
    expect(mirrorReport(o(5, 4, 1), true)).toEqual({ vaults: 10, mirrored: 5, not_mirrored: '>=3', lookup_failed: '<3' });
    expect(mirrorReport(o(5, 1, 4), true)).toEqual({ vaults: 10, mirrored: 5, not_mirrored: '<3', lookup_failed: '>=3' });
    expect(mirrorReport(o(5, 3, 3), true)).toEqual({ vaults: 11, mirrored: 5, not_mirrored: 3, lookup_failed: 3 });
    expect(mirrorReport(o(2, 1, 0), false)).toEqual({ vaults: 3, mirrored: 2, not_mirrored: 1, lookup_failed: 0 });
  });

  it('gas: a week with fewer than 3 accounts is merged forward, so no total minus a week is one account', () => {
    const W = (iso: string) => Date.parse(iso) / 1000;
    const op = (sender: string, wei: bigint, at: string): GasOp => ({ sender, sponsored: true, otherPaymaster: false, wei, ts: W(at) });
    const input: ReportInput = {
      network: 'op-sepolia',
      chainId: 11155420,
      public: true,
      registries: [],
      throughWeek: '2026-W42',
      events: [],
      vaults: new Map(),
      mirror: null,
      gas: {
        ops: [op('a', 10n, '2026-09-29T00:00:00Z'), op('b', 20n, '2026-09-29T00:00:00Z'), op('c', 30n, '2026-09-30T00:00:00Z'), op('d', 123456789n, '2026-10-06T00:00:00Z')],
        paymasters: 1,
      },
      notes: [],
      now: new Date(0),
    };
    const r = buildReport(input);
    expect(r.sponsored_gas).toMatchObject({ ops: 3, total_wei: '60', per_week: { '2026-W40': { ops: 3, wei: '60' } }, pending: '<3' });
    expect(JSON.stringify(r)).not.toContain('123456789');
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
  it('ISO weeks, including year boundaries, and week starts', () => {
    const w = (iso: string) => isoWeek(Date.parse(iso) / 1000);
    expect(w('2026-10-05T00:00:00Z')).toBe('2026-W41');
    expect(w('2026-10-11T23:59:59Z')).toBe('2026-W41');
    expect(w('2026-01-01T00:00:00Z')).toBe('2026-W01');
    expect(w('2027-01-01T00:00:00Z')).toBe('2026-W53');
    expect(w('2024-12-30T00:00:00Z')).toBe('2025-W01');
    expect(weekStart(Date.parse('2026-10-08T13:00:00Z') / 1000)).toBe(Date.parse('2026-10-05T00:00:00Z') / 1000);
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
