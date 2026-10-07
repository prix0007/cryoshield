// JSON-RPC over public endpoints (task 1.2). Every configured RPC must report the preset's chain ID before anything
// else is read (spec "Chain ID mismatch refused"). eth_getLogs pages adapt to each RPC's block-range limit, as
// tools/recover/chain.py does: start at 10k blocks, halve on a range error, give up below MIN_LOG_CHUNK.
import type { Hex } from 'viem';

export const DEFAULT_LOG_CHUNK = 10_000n;
export const MIN_LOG_CHUNK = 64n;
export const MAX_LOG_PAGES = 20_000;
const TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export class RpcError extends Error {
  override name = 'RpcError';
  readonly code: number | undefined;
  readonly status: number | undefined;
  constructor(message: string, code?: number, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class ChainIdMismatchError extends Error {
  override name = 'ChainIdMismatchError';
}

const RANGE_WORDS = ['range', 'too many', 'limit', 'exceed', 'too large', 'block'];

/** An RPC refusing the eth_getLogs block range (as opposed to failing for another reason). */
export function isRangeError(e: unknown): boolean {
  if (!(e instanceof RpcError)) return false;
  if (e.status === 400 || e.status === 413) return true;
  if (e.code === -32005 || e.code === -32614) return true;
  const text = e.message.toLowerCase();
  if (text.includes('beyond') && text.includes('head')) return false;
  return [-32600, -32602, -32000, -32001].includes(e.code ?? 0) && RANGE_WORDS.some((w) => text.includes(w));
}

export interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
}

export interface LogFilter {
  address: Hex | Hex[];
  topics: (Hex | Hex[] | null)[];
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return '?';
  }
};

export class Rpc {
  readonly warnings: string[] = [];
  private id = 0;
  private readonly timestamps = new Map<bigint, number>();

  readonly urls: string[];
  private readonly fetchFn: typeof fetch;

  private constructor(urls: string[], fetchFn: typeof fetch) {
    this.urls = urls;
    this.fetchFn = fetchFn;
  }

  /** Checks eth_chainId on every URL; any mismatch refuses the run, unreachable URLs are dropped with a warning. */
  static async connect(urls: string[], chainId: number, fetchFn: typeof fetch = fetch): Promise<Rpc> {
    const probe = new Rpc(urls, fetchFn);
    const usable: string[] = [];
    const warnings: string[] = [];
    for (const url of urls) {
      let got: number;
      try {
        got = Number(BigInt((await probe.send(url, 'eth_chainId', [])) as string));
      } catch (e) {
        warnings.push(`RPC ${hostOf(url)} is unreachable (${(e as Error).message.slice(0, 120)}); skipped`);
        continue;
      }
      if (got !== chainId) throw new ChainIdMismatchError(`RPC ${hostOf(url)} reports chain ID ${got}, expected ${chainId}; refusing to read logs`);
      usable.push(url);
    }
    if (usable.length === 0) throw new RpcError(`no usable RPC for chain ${chainId}: ${warnings.join('; ')}`);
    const rpc = new Rpc(usable, fetchFn);
    rpc.warnings.push(...warnings);
    return rpc;
  }

  private async send(url: string, method: string, params: unknown[]): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
        signal: ctrl.signal,
        credentials: 'omit',
        redirect: 'error',
      });
    } catch (e) {
      throw new RpcError(`request failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new RpcError('response too large');
    let body: { result?: unknown; error?: { code?: number; message?: string } };
    try {
      body = JSON.parse(text);
    } catch {
      throw new RpcError(`HTTP ${res.status}: not JSON`, undefined, res.status);
    }
    if (body.error) throw new RpcError(String(body.error.message ?? 'error'), body.error.code, res.status);
    if (!res.ok) throw new RpcError(`HTTP ${res.status}`, undefined, res.status);
    return body.result;
  }

  /** Tries each usable RPC in order; a range error is returned at once so the pager can shrink the page. */
  async request(method: string, params: unknown[]): Promise<unknown> {
    let last: unknown;
    for (const url of this.urls) {
      try {
        return await this.send(url, method, params);
      } catch (e) {
        if (isRangeError(e)) throw e;
        last = e;
      }
    }
    throw last instanceof Error ? last : new RpcError(String(last));
  }

  async blockNumber(): Promise<bigint> {
    return BigInt((await this.request('eth_blockNumber', [])) as string);
  }

  async blockTimestamp(n: bigint): Promise<number> {
    const hit = this.timestamps.get(n);
    if (hit !== undefined) return hit;
    const block = (await this.request('eth_getBlockByNumber', [`0x${n.toString(16)}`, false])) as { timestamp?: string } | null;
    if (!block?.timestamp) throw new RpcError(`block ${n} not found`);
    const ts = Number(BigInt(block.timestamp));
    this.timestamps.set(n, ts);
    return ts;
  }

  async call(to: Hex, data: Hex, block: bigint): Promise<Hex> {
    return (await this.request('eth_call', [{ to, data }, `0x${block.toString(16)}`])) as Hex;
  }

  /** All logs matching `filter` in [from, to], paged adaptively. Sorted by block, then log index. */
  async getLogs(filter: LogFilter, from: bigint, to: bigint, chunk = DEFAULT_LOG_CHUNK): Promise<RawLog[]> {
    const out: RawLog[] = [];
    let start = from;
    let pages = 0;
    while (start <= to) {
      if (++pages > MAX_LOG_PAGES) throw new RpcError('too many eth_getLogs pages');
      const end = start + chunk - 1n < to ? start + chunk - 1n : to;
      let logs: unknown;
      try {
        logs = await this.request('eth_getLogs', [{ ...filter, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }]);
      } catch (e) {
        if (isRangeError(e) && chunk > MIN_LOG_CHUNK) {
          chunk = chunk / 2n > MIN_LOG_CHUNK ? chunk / 2n : MIN_LOG_CHUNK;
          continue;
        }
        throw e;
      }
      if (!Array.isArray(logs)) throw new RpcError('malformed eth_getLogs result');
      for (const l of logs as Record<string, unknown>[]) {
        if (l.removed === true) continue;
        out.push({
          address: String(l.address).toLowerCase() as Hex,
          topics: (Array.isArray(l.topics) ? l.topics : []).map((t) => String(t).toLowerCase() as Hex),
          data: String(l.data ?? '0x') as Hex,
          blockNumber: BigInt(String(l.blockNumber)),
          logIndex: Number(BigInt(String(l.logIndex ?? '0x0'))),
        });
      }
      start = end + 1n;
    }
    return out.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  }
}
