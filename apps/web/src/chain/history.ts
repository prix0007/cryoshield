/**
 * Vault dates from public block data (vault-list-labels-archive 2.3, design D9). Display only: never used for ordering,
 * selection or freshness. Loaded lazily with the vault list (VaultsMenu chunk).
 *
 * Paged eth_getLogs for VaultCreated and VaultUpdated (topic1 = an OR of the listed vault ids), in bounded block ranges
 * from each registry's deploy block, then the timestamps of the blocks found. "Last saved" is shown only when the
 * latest event's blobHash is keccak256 of the blob that decrypted and its version matches the vault's. Any failure
 * leaves that registry's dates unavailable (null). It throws only when `signal` aborts (the list was closed or locked).
 *
 * Privacy: one query per page carries every listed vault ID of a registry (topic1 OR). Those IDs are public on-chain,
 * but the RPC learns that they were looked up together, from this client. The unlock reads already tell the RPC as much
 * for the vaults under one locator; "Check another key" adds the second key's vaults to the same lookup (design D9).
 */
import type { Hex } from 'viem';
import type { RegistryVersion } from '../vault/adapter';

/** keccak256 of the event signatures (constants keep viem's ABI coder out of this chunk; history.test.ts checks them). */
export const CREATED = '0xce97d1455c031e2d207f467953389573a1f639ea41eac2279614dea27b5e7322'; // VaultCreated(bytes32,address,uint32,bytes32)
export const UPDATED = '0x708a8b330fade2f32683d342c347557c666ee86d0dc54d7ed55440620b5d9ba2'; // VaultUpdated(bytes32,uint32,bytes32)
/** Base blocks per eth_getLogs query (public RPCs cap the range); pages grow up to MAX_GROWTH times this. */
export const LOG_RANGE = 10_000n;
/** Pages double while the RPC accepts them, up to this factor of the base (1.28M blocks, about 30 days on OP). */
const MAX_GROWTH = 128n;
/** At most this many log queries per registry (refused ones included); a vault not found by then shows no date. */
export const MAX_PAGES = 200;
/** A latest block at or above this is refused as hostile (OP is near 2^27 blocks). */
const MAX_BLOCK = 2n ** 40n;
/** Block timestamps outside 1..4e9 (about year 2096) are refused as hostile. */
const MAX_TS = 4_000_000_000;

export interface DatedVault {
  vaultId: Hex;
  version: number;
  blob: Uint8Array;
  registry: RegistryVersion;
}
/** Unix seconds, or null for "Date unavailable". */
export interface VaultDates {
  created: number | null;
  saved: number | null;
}
/**
 * What the list needs from the app: the public RPC and keccak-256. Passed in (not imported) so this lazy chunk shares no
 * module with the lazily loaded write stack; sharing one makes the bundler split the initial /app chunk.
 */
export interface HistorySource {
  rpc: { request(args: { method: string; params?: unknown }): Promise<unknown> };
  keccak256: (bytes: Uint8Array) => Hex;
  /** Every configured registry (web-registry-versions); each listed vault is looked up in its own. */
  registries: readonly Contract[];
}
type Rpc = HistorySource['rpc'];
interface RawLog {
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  logIndex: Hex;
}
type Contract = { version: RegistryVersion; address: Hex; deployBlock: number };

export const datesKey = (registry: RegistryVersion, vaultId: Hex) => `${registry}:${vaultId.toLowerCase()}`;
const big = (h: Hex | string) => BigInt(h);
const hex = (n: bigint) => `0x${n.toString(16)}`;
const abortIf = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
};

/**
 * web-review-followups 2 (review WB1): walks the logs BACKWARD from `latest`, so the newest event of each vault is found
 * first however old the chain is. A vault drops out of the query once its newest event and its VaultCreated event are
 * both found. Pages start at `range` and double while the RPC accepts them; a refused page is halved and retried, and a
 * refusal at the base size makes this registry's dates unavailable. Logs outside the queried window or for another
 * vault are ignored.
 */
async function datesFor(
  rpc: Rpc,
  hash: HistorySource['keccak256'],
  reg: Contract,
  vaults: readonly DatedVault[],
  range: bigint,
  latest: bigint,
  ts: (block: bigint) => Promise<number | null>,
  signal?: AbortSignal,
) {
  const deploy = BigInt(reg.deployBlock);
  if (latest < deploy || latest >= MAX_BLOCK) throw new Error('bad latest block'); // unavailable
  const order = (a: RawLog, b: RawLog) => (big(a.blockNumber) === big(b.blockNumber) ? Number(big(a.logIndex) - big(b.logIndex)) : big(a.blockNumber) < big(b.blockNumber) ? -1 : 1);
  const found = vaults.map(() => ({ last: undefined as RawLog | undefined, created: undefined as RawLog | undefined }));
  let pending = vaults.map((_, i) => i);
  let size = range;
  for (let to = latest, pages = 0; pending.length > 0 && to >= deploy && pages < MAX_PAGES; pages++) {
    abortIf(signal);
    const from = to - size + 1n < deploy ? deploy : to - size + 1n;
    const ids = pending.map((i) => vaults[i]!.vaultId.toLowerCase());
    let page: RawLog[];
    try {
      page = (await rpc.request({
        method: 'eth_getLogs',
        params: [{ address: reg.address, topics: [[CREATED, UPDATED], ids], fromBlock: hex(from), toBlock: hex(to) }],
      })) as RawLog[];
    } catch (e) {
      if (signal?.aborted || size <= range) throw e;
      size /= 2n; // the RPC refused the range: retry this window smaller
      continue;
    }
    for (const i of pending) {
      const id = ids[pending.indexOf(i)];
      const own = page
        .filter((l) => l.topics[1]?.toLowerCase() === id && (l.topics[0] === CREATED || l.topics[0] === UPDATED) && big(l.blockNumber) >= from && big(l.blockNumber) <= to)
        .sort(order);
      const f = found[i]!;
      f.last ??= own.at(-1);
      f.created ??= own.find((l) => l.topics[0] === CREATED);
    }
    pending = pending.filter((i) => !found[i]!.last || !found[i]!.created);
    to = from - 1n;
    if (size < range * MAX_GROWTH) size *= 2n;
  }
  abortIf(signal);
  const out = new Map<string, VaultDates>();
  for (const [i, v] of vaults.entries()) {
    const { last, created } = found[i]!;
    let saved: number | null = null;
    if (last) {
      // Both events' data: (uint32 version, bytes32 blobHash), two ABI words.
      const version = Number(big(`0x${last.data.slice(2, 66)}`));
      const blobHash = `0x${last.data.slice(66, 130)}`.toLowerCase();
      if (last.data.length === 130 && version === v.version && blobHash === hash(v.blob).toLowerCase()) saved = await ts(big(last.blockNumber));
    }
    out.set(datesKey(v.registry, v.vaultId), { created: created ? await ts(big(created.blockNumber)) : null, saved });
  }
  return out;
}

/**
 * Dates for every listed vault, keyed by datesKey. Takes only public data ({vaultId, version, blob, registry}), never a
 * decrypted session. `range` is the eth_getLogs page size in blocks.
 */
export async function vaultDates(
  { rpc, keccak256, registries }: HistorySource,
  vaults: readonly DatedVault[],
  opts: { range?: bigint; signal?: AbortSignal } = {},
): Promise<Map<string, VaultDates>> {
  const { range = LOG_RANGE, signal } = opts;
  const out = new Map<string, VaultDates>(vaults.map((v) => [datesKey(v.registry, v.vaultId), { created: null, saved: null }]));
  const blocks = new Map<bigint, Promise<number | null>>();
  const ts = (n: bigint) => {
    let p = blocks.get(n);
    if (!p) {
      p = rpc
        .request({ method: 'eth_getBlockByNumber', params: [hex(n), false] })
        .then((b) => {
          const t = Number(big((b as { timestamp: Hex }).timestamp));
          return Number.isInteger(t) && t >= 1 && t <= MAX_TS ? t : null;
        })
        .catch(() => null);
      blocks.set(n, p);
    }
    return p;
  };
  let latest: bigint;
  try {
    abortIf(signal);
    latest = big((await rpc.request({ method: 'eth_blockNumber' })) as Hex);
  } catch (e) {
    if (signal?.aborted) throw e;
    return out;
  }
  for (const reg of registries) {
    const listed = vaults.filter((v) => v.registry === reg.version);
    if (listed.length === 0) continue;
    try {
      for (const [k, d] of await datesFor(rpc, keccak256, reg, listed, range, latest, ts, signal)) out.set(k, d);
    } catch (e) {
      if (signal?.aborted) throw e;
      /* refused, failed or too long: "Date unavailable" for this registry's vaults */
    }
  }
  abortIf(signal);
  return out;
}
