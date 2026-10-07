/**
 * Vault dates from public block data (vault-list-labels-archive 2.3, design D9). Display only: never used for ordering,
 * selection or freshness. Loaded lazily with the vault list (VaultsMenu chunk).
 *
 * Paged eth_getLogs for VaultCreated and VaultUpdated (topic1 = an OR of the listed vault ids), in bounded block ranges
 * from each registry's deploy block, then the timestamps of the blocks found. "Last saved" is shown only when the
 * latest event's blobHash is keccak256 of the blob that decrypted and its version matches the vault's. Any failure
 * leaves that registry's dates unavailable (null); this never throws.
 */
import { decodeAbiParameters, keccak256, toEventSelector, type Hex } from 'viem';
import { toHex } from '../lib/bytes';
import type { RegistryVersion } from '../vault/adapter';

const CREATED = toEventSelector('VaultCreated(bytes32,address,uint32,bytes32)');
const UPDATED = toEventSelector('VaultUpdated(bytes32,uint32,bytes32)');
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
interface Rpc {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}
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

async function datesFor(rpc: Rpc, reg: Contract, vaults: readonly DatedVault[], range: bigint, latest: bigint, ts: (block: bigint) => Promise<number>) {
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
      const [version, blobHash] = decodeAbiParameters([{ type: 'uint32' }, { type: 'bytes32' }], last.data);
      if (version === v.version && blobHash.toLowerCase() === keccak256(toHex(v.blob)).toLowerCase()) saved = await ts(big(last.blockNumber));
    }
    out.set(datesKey(v.registry, v.vaultId), { created: created ? await ts(big(created.blockNumber)) : null, saved });
  }
  return out;
}

/** Dates for every listed vault, keyed by datesKey. `range` is the eth_getLogs page size in blocks. */
export async function vaultDates(rpc: Rpc, vaults: readonly DatedVault[], registries: { v1: Contract | null; v2: Contract }, range: bigint = LOG_RANGE): Promise<Map<string, VaultDates>> {
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
      for (const [k, d] of await datesFor(rpc, reg, listed, range, latest, ts)) out.set(k, d);
    } catch {
      /* refused or failed: "Date unavailable" for this registry's vaults */
    }
  }
  return out;
}
