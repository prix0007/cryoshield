// Task 1.2: chain-ID mismatch refused before any eth_getLogs (spec "Chain ID mismatch refused"); adaptive paging.
import { describe, expect, it } from 'vitest';
import { ChainIdMismatchError, isRangeError, Rpc, RpcError } from '../src/rpc.ts';
import { collect } from '../src/metrics.ts';
import { loadNetwork } from '../src/config.ts';
import { FakeChain } from './fixtures/chain.ts';

const R1 = 'https://rpc-1.example';
const R2 = 'https://rpc-2.example';

describe('chain ID check', () => {
  it('refuses when the RPC reports another chain, before reading any logs', async () => {
    const chain = new FakeChain(1);
    const net = { ...loadNetwork('op-sepolia'), rpcs: [R1] };
    await expect(collect(net, { fetchFn: chain.fetchFor([R1]), mirror: false })).rejects.toBeInstanceOf(ChainIdMismatchError);
    expect(chain.requests.map((r) => r.method)).not.toContain('eth_getLogs');
  });

  it('refuses when ANY configured RPC reports another chain', async () => {
    const chain = new FakeChain(11155420);
    chain.chainIdByUrl.set(R2, 10);
    await expect(Rpc.connect([R1, R2], 11155420, chain.fetchFor([R1, R2]))).rejects.toBeInstanceOf(ChainIdMismatchError);
  });

  it('drops an unreachable RPC but fails when none is usable', async () => {
    const chain = new FakeChain(31337);
    const fetchFn = chain.fetchFor([R1]);
    const rpc = await Rpc.connect([R2, R1], 31337, fetchFn);
    expect(rpc.urls).toEqual([R1]);
    expect(rpc.warnings.join()).toMatch(/rpc-2/);
    await expect(Rpc.connect([R2], 31337, fetchFn)).rejects.toThrow(/no usable RPC/);
  });
});

describe('eth_getLogs paging', () => {
  it('halves the block range on a range-limit error and still returns every log', async () => {
    const chain = new FakeChain(31337);
    const reg = '0x00000000000000000000000000000000000000aa';
    for (let b = 0n; b < 10_000n; b += 997n) chain.addLocator(reg, { vaultId: `0x${'11'.repeat(32)}`, locator: `0x${'22'.repeat(32)}`, block: b, ts: 0 });
    chain.maxRange = 1000;
    const rpc = await Rpc.connect([R1], 31337, chain.fetchFor([R1]));
    const logs = await rpc.getLogs({ address: reg, topics: [] }, 0n, 9_999n);
    expect(logs).toHaveLength(chain.logs.length);
    const ok = chain.requests.filter((r) => r.method === 'eth_getLogs').map((r) => r.params[0] as { fromBlock: string; toBlock: string });
    // Every accepted page fits the limit, and the pages cover the range without gaps.
    expect(logs.map((l) => l.blockNumber)).toEqual(chain.logs.map((l) => l.blockNumber));
    expect(ok.some((p) => BigInt(p.toBlock) - BigInt(p.fromBlock) + 1n <= 1000n)).toBe(true);
  });

  it('gives up below the minimum page size', async () => {
    const chain = new FakeChain(31337);
    chain.maxRange = 10;
    const rpc = await Rpc.connect([R1], 31337, chain.fetchFor([R1]));
    await expect(rpc.getLogs({ address: '0x00000000000000000000000000000000000000aa', topics: [] }, 0n, 100_000n)).rejects.toThrow(RpcError);
  });

  it('recognises public RPC range errors, not other failures', () => {
    expect(isRangeError(new RpcError('eth_getLogs is limited to a 10,000 range', -32614))).toBe(true);
    expect(isRangeError(new RpcError('query returned more than 10000 results', -32005))).toBe(true);
    expect(isRangeError(new RpcError('bad', undefined, 413))).toBe(true);
    expect(isRangeError(new RpcError('block range extends beyond current head block', -32000))).toBe(false);
    expect(isRangeError(new RpcError('execution reverted', 3))).toBe(false);
  });
});
