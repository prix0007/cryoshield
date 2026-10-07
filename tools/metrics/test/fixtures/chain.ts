// An in-memory JSON-RPC chain for unit tests: serves eth_chainId, eth_blockNumber, eth_getLogs (with an optional
// block-range limit, like public RPCs), eth_getBlockByNumber and the registries' getVault/getVaults views. Every
// request is recorded so tests can assert what was (and was not) asked.
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  keccak256,
  pad,
  toHex,
  type Hex,
} from 'viem';
import { ENTRY_POINT_EVENTS, REGISTRY_ABI, REGISTRY_EVENTS } from '../../src/abi.ts';

export interface FakeLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
}

export interface RpcRequest {
  url: string;
  method: string;
  params: unknown[];
}

interface VaultState {
  owner: Hex;
  blob: Uint8Array;
  version: number;
}

export class FakeChain {
  readonly logs: FakeLog[] = [];
  readonly requests: RpcRequest[] = [];
  readonly timestamps = new Map<bigint, number>();
  readonly vaults = new Map<string, VaultState>(); // `${registry}:${vaultId}`
  head = 0n;
  /** Largest eth_getLogs range (inclusive block count) accepted; larger ranges fail like a public RPC. */
  maxRange = Infinity;
  chainIdByUrl = new Map<string, number>();

  readonly chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  private next(registry: Hex, block: bigint, timestamp: number) {
    if (block > this.head) this.head = block;
    this.timestamps.set(block, timestamp);
    return { address: registry.toLowerCase() as Hex, blockNumber: block, logIndex: this.logs.length };
  }

  create(registry: Hex, p: { vaultId: Hex; owner: Hex; blob: Uint8Array; block: bigint; ts: number; locators?: Hex[] }) {
    const blobHash = keccak256(p.blob);
    const base = this.next(registry, p.block, p.ts);
    this.logs.push({
      ...base,
      topics: encodeEventTopics({ abi: REGISTRY_EVENTS, eventName: 'VaultCreated', args: { vaultId: p.vaultId, owner: p.owner } }) as Hex[],
      data: encodeAbiParameters([{ type: 'uint32' }, { type: 'bytes32' }], [1, blobHash]),
    });
    for (const locator of p.locators ?? []) {
      this.logs.push({
        ...base,
        logIndex: this.logs.length,
        topics: encodeEventTopics({ abi: REGISTRY_EVENTS, eventName: 'LocatorAdded', args: { vaultId: p.vaultId, locator } }) as Hex[],
        data: '0x',
      });
    }
    this.vaults.set(`${registry.toLowerCase()}:${p.vaultId}`, { owner: p.owner, blob: p.blob, version: 1 });
  }

  update(registry: Hex, p: { vaultId: Hex; blob: Uint8Array; block: bigint; ts: number }) {
    const key = `${registry.toLowerCase()}:${p.vaultId}`;
    const v = this.vaults.get(key);
    if (!v) throw new Error('no such vault');
    const version = v.version + 1;
    this.logs.push({
      ...this.next(registry, p.block, p.ts),
      topics: encodeEventTopics({ abi: REGISTRY_EVENTS, eventName: 'VaultUpdated', args: { vaultId: p.vaultId } }) as Hex[],
      data: encodeAbiParameters([{ type: 'uint32' }, { type: 'bytes32' }], [version, keccak256(p.blob)]),
    });
    this.vaults.set(key, { owner: v.owner, blob: p.blob, version });
  }

  addLocator(registry: Hex, p: { vaultId: Hex; locator: Hex; block: bigint; ts: number }) {
    this.logs.push({
      ...this.next(registry, p.block, p.ts),
      topics: encodeEventTopics({ abi: REGISTRY_EVENTS, eventName: 'LocatorAdded', args: { vaultId: p.vaultId, locator: p.locator } }) as Hex[],
      data: '0x',
    });
  }

  userOp(entryPoint: Hex, p: { sender: Hex; paymaster: Hex; gasCost: bigint; block: bigint; ts: number; success?: boolean }) {
    this.logs.push({
      ...this.next(entryPoint, p.block, p.ts),
      topics: encodeEventTopics({
        abi: ENTRY_POINT_EVENTS,
        eventName: 'UserOperationEvent',
        args: { userOpHash: keccak256(toHex(`op-${this.logs.length}`)), sender: p.sender, paymaster: p.paymaster },
      }) as Hex[],
      data: encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }],
        [0n, p.success ?? true, p.gasCost, 100_000n],
      ),
    });
  }

  private matches(log: FakeLog, filter: { address?: Hex | Hex[]; topics?: (Hex | Hex[] | null)[] }): boolean {
    const addrs = filter.address === undefined ? null : ([] as Hex[]).concat(filter.address).map((a) => a.toLowerCase());
    if (addrs && !addrs.includes(log.address)) return false;
    return (filter.topics ?? []).every((t, i) => {
      if (t === null) return true;
      const want = ([] as Hex[]).concat(t).map((x) => x.toLowerCase());
      const got = log.topics[i]?.toLowerCase();
      return got !== undefined && want.includes(got);
    });
  }

  private rpc(url: string, method: string, params: unknown[]): unknown {
    this.requests.push({ url, method, params });
    switch (method) {
      case 'eth_chainId':
        return toHex(this.chainIdByUrl.get(url) ?? this.chainId);
      case 'eth_blockNumber':
        return toHex(this.head);
      case 'eth_getBlockByNumber': {
        const n = BigInt(params[0] as string);
        const ts = this.timestamps.get(n) ?? 0;
        return { number: toHex(n), timestamp: toHex(ts) };
      }
      case 'eth_getLogs': {
        const f = params[0] as { address?: Hex | Hex[]; topics?: (Hex | Hex[] | null)[]; fromBlock: Hex; toBlock: Hex };
        const from = BigInt(f.fromBlock);
        const to = BigInt(f.toBlock);
        if (Number(to - from + 1n) > this.maxRange) {
          throw Object.assign(new Error(`eth_getLogs is limited to a ${this.maxRange} range`), { code: -32614 });
        }
        return this.logs
          .filter((l) => l.blockNumber >= from && l.blockNumber <= to && this.matches(l, f))
          .map((l) => ({
            address: l.address,
            topics: l.topics,
            data: l.data,
            blockNumber: toHex(l.blockNumber),
            logIndex: toHex(l.logIndex),
            transactionHash: pad(toHex(l.logIndex), { size: 32 }),
          }));
      }
      case 'eth_call': {
        const tx = params[0] as { to: Hex; data: Hex };
        const call = decodeFunctionData({ abi: REGISTRY_ABI, data: tx.data });
        const read = (id: Hex) => {
          const v = this.vaults.get(`${tx.to.toLowerCase()}:${id}`);
          return v
            ? { owner: v.owner, blob: toHex(v.blob), version: v.version }
            : { owner: '0x0000000000000000000000000000000000000000' as Hex, blob: '0x' as Hex, version: 0 };
        };
        if (call.functionName === 'getVault') {
          const r = read(call.args[0]);
          return encodeFunctionResult({ abi: REGISTRY_ABI, functionName: 'getVault', result: [r.owner, r.blob, r.version] });
        }
        if (call.functionName === 'getVaults') {
          return encodeFunctionResult({ abi: REGISTRY_ABI, functionName: 'getVaults', result: call.args[0].map(read) });
        }
        throw new Error('unsupported call');
      }
      default:
        throw new Error(`unsupported method ${method}`);
    }
  }

  /** A fetch() that answers JSON-RPC POSTs to any of `urls`; anything else is a test failure. */
  fetchFor(urls: string[]): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!urls.includes(url)) throw new Error(`unexpected request to ${url}`);
      const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
      try {
        const result = this.rpc(url, body.method, body.params);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
      } catch (e) {
        const err = e as Error & { code?: number };
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: err.code ?? -32000, message: err.message } }), {
          headers: { 'content-type': 'application/json' },
        });
      }
    }) as typeof fetch;
  }
}
