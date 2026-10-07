/**
 * Vault dates from public block data (vault-list-labels-archive 2.3, design D9). Display only: never used for ordering,
 * selection or freshness. Loaded lazily with the vault list (VaultsMenu chunk).
 *
 * Paged eth_getLogs for VaultCreated and VaultUpdated (topic1 = an OR of the listed vault ids), in bounded block ranges
 * from each registry's deploy block, then the timestamps of the blocks found. "Last saved" is shown only when the
 * latest event's blobHash is keccak256 of the blob that decrypted and its version matches the vault's. Any failure
 * leaves that registry's dates unavailable (null); this never throws.
 */
import type { Hex } from 'viem';
import type { RegistryVersion } from '../vault/adapter';

/** keccak256 of the event signatures (constants keep viem's ABI coder out of this chunk; history.test.ts checks them). */
export const CREATED = '0xce97d1455c031e2d207f467953389573a1f639ea41eac2279614dea27b5e7322'; // VaultCreated(bytes32,address,uint32,bytes32)
export const UPDATED = '0x708a8b330fade2f32683d342c347557c666ee86d0dc54d7ed55440620b5d9ba2'; // VaultUpdated(bytes32,uint32,bytes32)
/** Blocks per eth_getLogs query (public RPCs cap the range). */
export const LOG_RANGE = 10_000n;

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
  registries: { v1: Contract | null; v2: Contract };
}
type Rpc = HistorySource['rpc'];
interface RawLog {
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  logIndex: Hex;
}
type Contract = { address: Hex; deployBlock: number };

export const datesKey = (registry: RegistryVersion, vaultId: Hex) => `${registry}:${vaultId.toLowerCase()}`;
const big = (h: Hex | string) => BigInt(h);
const hex = (n: bigint) => `0x${n.toString(16)}`;

async function datesFor(rpc: Rpc, hash: HistorySource['keccak256'], reg: Contract, vaults: readonly DatedVault[], range: bigint, latest: bigint, ts: (block: bigint) => Promise<number>) {
  const ids = vaults.map((v) => v.vaultId.toLowerCase() as Hex);
  const logs: RawLog[] = [];
  for (let from = BigInt(reg.deployBlock); from <= latest; from += range) {
    const to = from + range - 1n < latest ? from + range - 1n : latest;
    const page = (await rpc.request({
      method: 'eth_getLogs',
      params: [{ address: reg.address, topics: [[CREATED, UPDATED], ids], fromBlock: hex(from), toBlock: hex(to) }],
    })) as RawLog[];
    logs.push(...page);
  }
  const out = new Map<string, VaultDates>();
  for (const v of vaults) {
    const own = logs
      .filter((l) => l.topics[1]?.toLowerCase() === v.vaultId.toLowerCase() && (l.topics[0] === CREATED || l.topics[0] === UPDATED))
      .sort((a, b) => (big(a.blockNumber) === big(b.blockNumber) ? Number(big(a.logIndex) - big(b.logIndex)) : big(a.blockNumber) < big(b.blockNumber) ? -1 : 1));
    const created = own.find((l) => l.topics[0] === CREATED);
    const last = own.at(-1);
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

/** Dates for every listed vault, keyed by datesKey. `range` is the eth_getLogs page size in blocks. */
export async function vaultDates({ rpc, keccak256, registries }: HistorySource, vaults: readonly DatedVault[], range: bigint = LOG_RANGE): Promise<Map<string, VaultDates>> {
  const out = new Map<string, VaultDates>(vaults.map((v) => [datesKey(v.registry, v.vaultId), { created: null, saved: null }]));
  const blocks = new Map<bigint, Promise<number>>();
  const ts = (n: bigint) => {
    let p = blocks.get(n);
    if (!p) {
      p = rpc.request({ method: 'eth_getBlockByNumber', params: [hex(n), false] }).then((b) => Number(big((b as { timestamp: Hex }).timestamp)));
      blocks.set(n, p);
    }
    return p;
  };
  let latest: bigint;
  try {
    latest = big((await rpc.request({ method: 'eth_blockNumber' })) as Hex);
  } catch {
    return out;
  }
  for (const r of ['v2', 'v1'] as const) {
    const reg = registries[r];
    const listed = vaults.filter((v) => v.registry === r);
    if (!reg || listed.length === 0) continue;
    try {
      for (const [k, d] of await datesFor(rpc, keccak256, reg, listed, range, latest, ts)) out.set(k, d);
    } catch {
      /* refused or failed: "Date unavailable" for this registry's vaults */
    }
  }
  return out;
}
