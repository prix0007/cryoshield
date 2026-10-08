/** vault-list-labels-archive 2.3 (design D9): dates from public block data, display only. */
import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, keccak256, toEventSelector, toHex as hexOf, type Hex } from 'viem';
import { vaultDates as dates } from '../../src/chain/history';

const vaultDates = (rpc: never, vaults: Parameters<typeof dates>[1], registries: Parameters<typeof dates>[0]['registries'], range?: bigint, signal?: AbortSignal) =>
  dates({ rpc, keccak256: (b) => keccak256(toHex(b)), registries }, vaults, { ...(range ? { range } : {}), ...(signal ? { signal } : {}) });
import { toHex } from '../../src/lib/bytes';

const V3 = { version: 'v3' as const, address: '0x00000000000000000000000000000000000000a3' as Hex, deployBlock: 20 };
const V2 = { version: 'v2' as const, address: '0x00000000000000000000000000000000000000a2' as Hex, deployBlock: 0 };
const V1 = { version: 'v1' as const, address: '0x00000000000000000000000000000000000000a1' as Hex, deployBlock: 5 };
const CREATED = toEventSelector('VaultCreated(bytes32,address,uint32,bytes32)');
const UPDATED = toEventSelector('VaultUpdated(bytes32,uint32,bytes32)');
const id = (n: number) => ('0x' + n.toString(16).padStart(2, '0').repeat(32)) as Hex;
const blobA = new Uint8Array([1, 2, 3]);
const blobB = new Uint8Array([4, 5, 6]);
const owner = ('0x' + '00'.repeat(12) + '34'.repeat(20)) as Hex;

interface Log {
  address: Hex;
  block: number;
  topics: Hex[];
  data: Hex;
}
const created = (address: Hex, vaultId: Hex, block: number, version: number, blob: Uint8Array): Log => ({
  address,
  block,
  topics: [CREATED, vaultId, owner],
  data: encodeAbiParameters([{ type: 'uint32' }, { type: 'bytes32' }], [version, keccak256(toHex(blob))]),
});
const updated = (address: Hex, vaultId: Hex, block: number, version: number, blob: Uint8Array): Log => ({
  address,
  block,
  topics: [UPDATED, vaultId],
  data: encodeAbiParameters([{ type: 'uint32' }, { type: 'bytes32' }], [version, keccak256(toHex(blob))]),
});

function rpc(logs: Log[], opts: { latest?: number | string; refuse?: boolean; maxSpan?: number; timestamp?: (block: number) => unknown } = {}) {
  const queries: { address: Hex; from: number; to: number; topics: unknown }[] = [];
  const request = vi.fn(async ({ method, params }: { method: string; params: any[] }) => {
    if (method === 'eth_blockNumber') return typeof opts.latest === 'string' ? opts.latest : hexOf(opts.latest ?? 250);
    if (method === 'eth_getBlockByNumber') {
      const n = Number(BigInt(params[0]));
      return { timestamp: opts.timestamp ? opts.timestamp(n) : hexOf(1_790_000_000 + n * 2) };
    }
    if (method === 'eth_getLogs') {
      if (opts.refuse) throw new Error('query returned more than 10000 results');
      const f = params[0];
      const from = Number(BigInt(f.fromBlock));
      const to = Number(BigInt(f.toBlock));
      queries.push({ address: f.address, from, to, topics: f.topics });
      if (opts.maxSpan !== undefined && to - from + 1 > opts.maxSpan) throw new Error('block range too large');
      const ids = (f.topics[1] as Hex[]).map((x) => x.toLowerCase());
      return logs
        .filter((l) => l.address === f.address && l.block >= from && l.block <= to && (f.topics[0] as Hex[]).includes(l.topics[0]!) && ids.includes(l.topics[1]!.toLowerCase()))
        .map((l, i) => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: hexOf(l.block), logIndex: hexOf(i), transactionHash: '0x' + '00'.repeat(32), blockHash: '0x' + '00'.repeat(32), transactionIndex: '0x0', removed: false }));
    }
    throw new Error(`unexpected ${method}`);
  });
  return { client: { request } as never, queries, request };
}
const ts = (block: number) => 1_790_000_000 + block * 2;

describe('event topics', () => {
  it('the hardcoded topics are the event selectors', async () => {
    const h = await import('../../src/chain/history');
    expect(h.CREATED).toBe(CREATED);
    expect(h.UPDATED).toBe(UPDATED);
  });
});

describe('vaultDates', () => {
  it('walks eth_getLogs BACKWARD from latest in growing pages, ORs the pending vault ids in topic1, and stops when every date is found', async () => {
    const r = rpc([created(V2.address, id(1), 99, 1, blobA), updated(V2.address, id(1), 100, 2, blobB), created(V2.address, id(2), 200, 1, blobA)]);
    const out = await vaultDates(r.client, [
      { vaultId: id(1), version: 2, blob: blobB, registry: 'v2' },
      { vaultId: id(2), version: 1, blob: blobA, registry: 'v2' },
    ], [V2], 100n);
    expect(r.queries.map((q) => [q.from, q.to])).toEqual([[151, 250], [0, 150]]);
    expect(r.queries[0]!.topics).toEqual([[CREATED, UPDATED], [id(1), id(2)]]);
    expect(r.queries[1]!.topics).toEqual([[CREATED, UPDATED], [id(1)]]); // id(2) is fully dated: no longer asked for
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: ts(99), saved: ts(100) });
    expect(out.get(`v2:${id(2)}`)).toEqual({ created: ts(200), saved: ts(200) });
  });

  it('a latest event whose blobHash differs from the current blob: Last saved unavailable', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA), updated(V2.address, id(1), 20, 2, blobA)]);
    const out = await vaultDates(r.client, [{ vaultId: id(1), version: 2, blob: blobB, registry: 'v2' }], [V2], 1000n);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: ts(10), saved: null });
  });

  it('a version mismatch: Last saved unavailable', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA), updated(V2.address, id(1), 20, 2, blobB)]);
    const out = await vaultDates(r.client, [{ vaultId: id(1), version: 3, blob: blobB, registry: 'v2' }], [V2], 1000n);
    expect(out.get(`v2:${id(1)}`)!.saved).toBeNull();
  });

  it('a refused log query: every date unavailable, never a throw', async () => {
    const r = rpc([], { refuse: true });
    const out = await vaultDates(r.client, [{ vaultId: id(1), version: 1, blob: blobA, registry: 'v2' }], [V2], 1000n);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: null, saved: null });
  });

  it('older test vaults are read from VaultRegistry v1, from its own deploy block', async () => {
    const r = rpc([created(V1.address, id(3), 7, 1, blobA)]);
    const out = await vaultDates(r.client, [{ vaultId: id(3), version: 1, blob: blobA, registry: 'v1' }], [V2, V1], 1000n);
    expect(r.queries).toEqual([{ address: V1.address, from: 5, to: 250, topics: [[CREATED, UPDATED], [id(3)]] }]);
    expect(out.get(`v1:${id(3)}`)).toEqual({ created: ts(7), saved: ts(7) });
  });

  it('web-registry-versions: every registry in the list, each from its own deploy block (v3, v2, v1)', async () => {
    const r = rpc([created(V3.address, id(4), 30, 1, blobA), created(V2.address, id(1), 10, 1, blobA), created(V1.address, id(3), 7, 1, blobA)]);
    const out = await vaultDates(r.client, [
      { vaultId: id(4), version: 1, blob: blobA, registry: 'v3' },
      { vaultId: id(1), version: 1, blob: blobA, registry: 'v2' },
      { vaultId: id(3), version: 1, blob: blobA, registry: 'v1' },
    ], [V3, V2, V1], 1000n);
    expect(r.queries.map((q) => [q.address, q.from])).toEqual([[V3.address, 20], [V2.address, 0], [V1.address, 5]]);
    expect([out.get(`v3:${id(4)}`)!.created, out.get(`v2:${id(1)}`)!.created, out.get(`v1:${id(3)}`)!.created]).toEqual([ts(30), ts(10), ts(7)]);
  });

  it('fetches each block timestamp once', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA), created(V2.address, id(2), 10, 1, blobA)]);
    await vaultDates(r.client, [
      { vaultId: id(1), version: 1, blob: blobA, registry: 'v2' },
      { vaultId: id(2), version: 1, blob: blobA, registry: 'v2' },
    ], [V2], 1000n);
    expect(r.request.mock.calls.filter((c) => c[0].method === 'eth_getBlockByNumber')).toHaveLength(1);
  });
});

describe('review M2/M3: bounded, abortable, and hostile-RPC-proof', () => {
  const one = [{ vaultId: id(1), version: 1, blob: blobA, registry: 'v2' as const }];

  it.each([
    ['zero', () => '0x0'],
    ['beyond 4e9', () => hexOf(5_000_000_000)],
    ['huge', () => '0x' + 'f'.repeat(40)],
    ['not hex', () => 'yesterday'],
    ['missing', () => undefined],
  ])('a %s block timestamp is "Date unavailable", never a crash', async (_, timestamp) => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA)], { timestamp });
    const out = await vaultDates(r.client, one, [V2], 1000n);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: null, saved: null });
  });

  it('a timestamp at the bounds is accepted', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA)], { timestamp: () => hexOf(4_000_000_000) });
    expect((await vaultDates(r.client, one, [V2], 1000n)).get(`v2:${id(1)}`)!.created).toBe(4_000_000_000);
  });

  it('an absurd latest block: no query at all, dates unavailable', async () => {
    const absurd = rpc([], { latest: '0x' + 'f'.repeat(30) });
    const out = await vaultDates(absurd.client, one, [V2], 1000n);
    expect(absurd.queries).toHaveLength(0);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: null, saved: null });
  });

  it('WB1: a vault whose events are far more than 46 days before latest is still dated (default page size)', async () => {
    // OP: 2 s blocks, so 46 days is about 2M blocks; these events are 5M blocks (~116 days) before latest.
    const r = rpc([created(V2.address, id(1), 1_000, 1, blobA), updated(V2.address, id(1), 2_000, 2, blobB)], { latest: 5_002_000 });
    const out = await vaultDates(r.client, [{ vaultId: id(1), version: 2, blob: blobB, registry: 'v2' }], [V2]);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: ts(1_000), saved: ts(2_000) });
    expect(r.queries.length).toBeLessThanOrEqual(20);
    // Pages grow (10k, 20k, … up to 1.28M blocks), are contiguous and never overlap.
    for (let i = 1; i < r.queries.length; i++) expect(r.queries[i]!.to).toBe(r.queries[i - 1]!.from - 1);
    expect(Math.max(...r.queries.map((q) => q.to - q.from + 1))).toBe(1_280_000);
  });

  it('an RPC that refuses wide ranges: the page is halved and retried, down to the base size', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA)], { latest: 5_000, maxSpan: 300 });
    const out = await vaultDates(r.client, one, [V2], 100n);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: ts(10), saved: ts(10) });
    expect(r.queries.every((q, i) => q.to - q.from + 1 <= 300 || r.queries[i + 1]!.to === q.to)).toBe(true);
  });

  it('a refusal at the base page size: dates unavailable', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA)], { latest: 5_000, maxSpan: 50 });
    const out = await vaultDates(r.client, one, [V2], 100n);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: null, saved: null });
  });

  it('at most 200 accepted (and 8 refused) log queries per registry; a vault not found by then is "Date unavailable"', async () => {
    const r = rpc([], { latest: 2 ** 39, maxSpan: 100 });
    const out = await vaultDates(r.client, one, [V2], 100n);
    const refused = r.queries.filter((q) => q.to - q.from + 1 > 100).length;
    expect(r.queries.length - refused).toBe(200);
    expect(refused).toBeLessThanOrEqual(8);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: null, saved: null });
  });

  it('ECC review of 88255e2: an RPC capped at 10k blocks: after one refusal the size stays at the cap, and 200 queries cover at least the old 2M blocks', async () => {
    const r = rpc([], { latest: 50_000_000, maxSpan: 10_000 });
    await vaultDates(r.client, one, [V2]);
    const accepted = r.queries.filter((q) => q.to - q.from + 1 <= 10_000);
    const refused = r.queries.length - accepted.length;
    expect(refused).toBe(1); // 20k once, then never doubled back above the refused size
    const covered = accepted.reduce((n, q) => n + (q.to - q.from + 1), 0);
    expect(covered).toBeGreaterThanOrEqual(200 * 10_000);
  });

  it('a log outside the queried window or for another vault is ignored (hostile RPC)', async () => {
    const r = rpc([], { latest: 250 });
    const req = r.request.getMockImplementation()!;
    r.request.mockImplementation(async (a) => {
      if (a.method !== 'eth_getLogs') return req(a);
      await req(a);
      const f = (a.params as any[])[0];
      const bogus = [updated(V2.address, id(1), 9_999, 1, blobA), created(V2.address, id(7), 200, 1, blobA)];
      return bogus.map((l, i) => ({ ...l, blockNumber: hexOf(l.block), logIndex: hexOf(i), from: f.fromBlock })) as never;
    });
    const out = await vaultDates(r.client, one, [V2], 1000n);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: null, saved: null });
  });

  it('an aborted lookup stops querying and rejects', async () => {
    const ctl = new AbortController();
    const r = rpc([created(V2.address, id(1), 10, 1, blobA)]);
    const req = r.request.getMockImplementation()!;
    r.request.mockImplementation(async (a) => {
      if (a.method === 'eth_getLogs' && r.queries.length === 1) ctl.abort();
      return req(a);
    });
    await expect(vaultDates(r.client, one, [V2], 100n, ctl.signal)).rejects.toThrow();
    expect(r.queries).toHaveLength(2); // the in-flight page, then nothing more
  });
});
