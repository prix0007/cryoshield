/** vault-list-labels-archive 2.3 (design D9): dates from public block data, display only. */
import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, keccak256, toEventSelector, toHex as hexOf, type Hex } from 'viem';
import { vaultDates as dates } from '../../src/chain/history';

const vaultDates = (rpc: never, vaults: Parameters<typeof dates>[1], registries: Parameters<typeof dates>[0]['registries'], range?: bigint, signal?: AbortSignal) =>
  dates({ rpc, keccak256: (b) => keccak256(toHex(b)), registries }, vaults, { ...(range ? { range } : {}), ...(signal ? { signal } : {}) });
import { toHex } from '../../src/lib/bytes';

const V2 = { address: '0x00000000000000000000000000000000000000a2' as Hex, deployBlock: 0 };
const V1 = { address: '0x00000000000000000000000000000000000000a1' as Hex, deployBlock: 5 };
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

function rpc(logs: Log[], opts: { latest?: number | string; refuse?: boolean; timestamp?: (block: number) => unknown } = {}) {
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
  it('pages eth_getLogs in bounded ranges from deployBlock, ORs the vault ids in topic1, and crosses page boundaries', async () => {
    const r = rpc([created(V2.address, id(1), 99, 1, blobA), updated(V2.address, id(1), 100, 2, blobB), created(V2.address, id(2), 200, 1, blobA)]);
    const out = await vaultDates(r.client, [
      { vaultId: id(1), version: 2, blob: blobB, registry: 'v2' },
      { vaultId: id(2), version: 1, blob: blobA, registry: 'v2' },
    ], { v1: null, v2: V2 }, 100n);
    expect(r.queries.map((q) => [q.from, q.to])).toEqual([[0, 99], [100, 199], [200, 250]]);
    expect(r.queries[0]!.topics).toEqual([[CREATED, UPDATED], [id(1), id(2)]]);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: ts(99), saved: ts(100) });
    expect(out.get(`v2:${id(2)}`)).toEqual({ created: ts(200), saved: ts(200) });
  });

  it('a latest event whose blobHash differs from the current blob: Last saved unavailable', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA), updated(V2.address, id(1), 20, 2, blobA)]);
    const out = await vaultDates(r.client, [{ vaultId: id(1), version: 2, blob: blobB, registry: 'v2' }], { v1: null, v2: V2 }, 1000n);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: ts(10), saved: null });
  });

  it('a version mismatch: Last saved unavailable', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA), updated(V2.address, id(1), 20, 2, blobB)]);
    const out = await vaultDates(r.client, [{ vaultId: id(1), version: 3, blob: blobB, registry: 'v2' }], { v1: null, v2: V2 }, 1000n);
    expect(out.get(`v2:${id(1)}`)!.saved).toBeNull();
  });

  it('a refused log query: every date unavailable, never a throw', async () => {
    const r = rpc([], { refuse: true });
    const out = await vaultDates(r.client, [{ vaultId: id(1), version: 1, blob: blobA, registry: 'v2' }], { v1: null, v2: V2 }, 1000n);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: null, saved: null });
  });

  it('older test vaults are read from VaultRegistry v1, from its own deploy block', async () => {
    const r = rpc([created(V1.address, id(3), 7, 1, blobA)]);
    const out = await vaultDates(r.client, [{ vaultId: id(3), version: 1, blob: blobA, registry: 'v1' }], { v1: V1, v2: V2 }, 1000n);
    expect(r.queries).toEqual([{ address: V1.address, from: 5, to: 250, topics: [[CREATED, UPDATED], [id(3)]] }]);
    expect(out.get(`v1:${id(3)}`)).toEqual({ created: ts(7), saved: ts(7) });
  });

  it('fetches each block timestamp once', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA), created(V2.address, id(2), 10, 1, blobA)]);
    await vaultDates(r.client, [
      { vaultId: id(1), version: 1, blob: blobA, registry: 'v2' },
      { vaultId: id(2), version: 1, blob: blobA, registry: 'v2' },
    ], { v1: null, v2: V2 }, 1000n);
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
    const out = await vaultDates(r.client, one, { v1: null, v2: V2 }, 1000n);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: null, saved: null });
  });

  it('a timestamp at the bounds is accepted', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA)], { timestamp: () => hexOf(4_000_000_000) });
    expect((await vaultDates(r.client, one, { v1: null, v2: V2 }, 1000n)).get(`v2:${id(1)}`)!.created).toBe(4_000_000_000);
  });

  it('more than 200 pages (or an absurd latest block): no query at all, dates unavailable', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA)], { latest: 201 * 100 });
    const out = await vaultDates(r.client, one, { v1: null, v2: V2 }, 100n);
    expect(r.queries).toHaveLength(0);
    expect(out.get(`v2:${id(1)}`)).toEqual({ created: null, saved: null });
    const absurd = rpc([], { latest: '0x' + 'f'.repeat(30) });
    await vaultDates(absurd.client, one, { v1: null, v2: V2 }, 1000n);
    expect(absurd.queries).toHaveLength(0);
  });

  it('exactly 200 pages are still read', async () => {
    const r = rpc([created(V2.address, id(1), 10, 1, blobA)], { latest: 200 * 100 - 1 });
    await vaultDates(r.client, one, { v1: null, v2: V2 }, 100n);
    expect(r.queries).toHaveLength(200);
  });

  it('an aborted lookup stops querying and rejects', async () => {
    const ctl = new AbortController();
    const r = rpc([created(V2.address, id(1), 10, 1, blobA)]);
    const req = r.request.getMockImplementation()!;
    r.request.mockImplementation(async (a) => {
      if (a.method === 'eth_getLogs' && r.queries.length === 1) ctl.abort();
      return req(a);
    });
    await expect(vaultDates(r.client, one, { v1: null, v2: V2 }, 100n, ctl.signal)).rejects.toThrow();
    expect(r.queries).toHaveLength(2); // the in-flight page, then nothing more
  });
});
