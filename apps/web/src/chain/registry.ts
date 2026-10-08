/**
 * VaultRegistry reads over a public RPC: plain eth_call, no account, no signature (spec hardware-key-auth).
 *
 * web-registry-versions D2 (generalises harden-gas-sponsorship "Registry versions coexist"): reads query every
 * configured registry, newest first (kind 2: paged `resolveLocator`, batched `getVaults`; kind 1: the legacy v1 views),
 * and treat the candidates as one list. Writes go to the newest only (src/account/writes.ts).
 *
 * The newest registry holding a vaultId is authoritative. Older registries may accept caller-chosen ids (v1), so anyone
 * can plant a newer vault's id there with a stale, still-decryptable copy. Every id an older registry lists is therefore
 * checked against every newer registry, newest first: the first that has it wins. If a newer registry can't be confirmed
 * (an RPC error, or it contradicts itself), the read fails with RegistryUnconfirmedError; it never falls back.
 */
import { createPublicClient, http, type Abi, type Hex, type PublicClient, type Transport } from 'viem';
import { config } from '../config';
import type { Candidate, RegistryVersion } from '../vault/adapter';
import type { RegistryConfig } from '../config/schema';
import { fromHex } from '../lib/bytes';
import { ensureChain } from './guard';
import { GET_VAULTS_MAX, PAGE_SIZE, registryV1Abi, registryV2Abi } from './contracts';

export const MAX_BLOB_BYTES = 1024;
/** v1 capped each locator at 16 entries. */
const V1_LOCATOR_CAP = 16;
const ZERO = '0x0000000000000000000000000000000000000000';

export function chainOf() {
  return {
    id: config.chainId,
    name: `chain-${config.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  } as const;
}

export function defaultTransport(): Transport {
  return http(config.rpcUrl, { timeout: 15_000, retryCount: 2 });
}

/** The public read client for the configured chain (also used by the lazily loaded write stack). */
export function makePublicClient(transport: Transport = defaultTransport()): PublicClient {
  return createPublicClient({ chain: chainOf(), transport }) as PublicClient;
}

/** The message is the registry version that couldn't be confirmed (the UI maps the class, never the message). */
export class RegistryUnconfirmedError extends Error {
  override name = 'RegistryUnconfirmedError';
}
/** Review W1: a locator's pages don't add up to its locatorLength, so the list would be silently short. */
export class RegistryIncompleteError extends RegistryUnconfirmedError {
  override name = 'RegistryIncompleteError';
}

const lower = (id: Hex) => id.toLowerCase();
const unique = (ids: readonly Hex[]) => [...new Map(ids.map((id) => [id.toLowerCase(), id])).values()];

function candidate(registry: RegistryVersion, vaultId: Hex, owner: Hex, blob: Hex, version: number | bigint): Candidate | null {
  const bytes = fromHex(blob);
  if (owner === ZERO || bytes.length === 0 || bytes.length > MAX_BLOB_BYTES) return null;
  return { vaultId, owner, blob: bytes, version: Number(version), registry };
}

export function createRegistryReader(transport: Transport = defaultTransport(), registries: readonly RegistryConfig[] = config.registries) {
  const client = createPublicClient({ chain: chainOf(), transport });
  const ready = () => ensureChain(client);
  const abiOf = (r: RegistryConfig) => (r.abi === 1 ? registryV1Abi : registryV2Abi) as Abi;
  const read = (r: RegistryConfig, functionName: string, args: readonly unknown[]) => client.readContract({ address: r.address, abi: abiOf(r), functionName, args });
  const target = (version = registries[0]!.version): RegistryConfig => {
    const r = registries.find((x) => x.version === version);
    if (!r) throw new Error(`no VaultRegistry ${version}`);
    return r;
  };

  /** Every vaultId under a locator: kind 2 in insertion order (no cap; pages of PAGE_SIZE), kind 1 capped at 16. */
  async function resolve(r: RegistryConfig, locator: Hex): Promise<Hex[]> {
    if (r.abi === 1) return ((await read(r, 'resolveLocator', [locator])) as Hex[]).slice(0, V1_LOCATOR_CAP);
    const length = (await read(r, 'locatorLength', [locator])) as bigint;
    const out: Hex[] = [];
    for (let start = 0n; start < length; start += BigInt(PAGE_SIZE)) {
      const page = (await read(r, 'resolveLocator', [locator, start, BigInt(PAGE_SIZE)])) as readonly Hex[];
      // locatorLength is the source of truth: an empty, short or long page never ends the list quietly.
      if (BigInt(page.length) !== (length - start < PAGE_SIZE ? length - start : BigInt(PAGE_SIZE))) throw new RegistryIncompleteError(r.version);
      out.push(...page);
    }
    return out;
  }

  /**
   * Records of `ids` in `r` (kind 2: batches of at most GET_VAULTS_MAX ids; kind 1: one getVault each). `listed`: the
   * ids came from r's own index. Otherwise (checking an older registry's ids), an empty record means "not here".
   * Kind 2 must answer consistently (a listed id with no valid record is RegistryUnconfirmedError); legacy kind-1
   * records that aren't valid are skipped when listed, and unconfirmed when r is asked as the newer registry.
   */
  async function records(r: RegistryConfig, ids: readonly Hex[], listed: boolean): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const add = (id: Hex, owner: Hex, blob: Hex, version: number) => {
      const c = candidate(r.version, id, owner, blob, version);
      if (c) out.push(c);
      else if (listed ? r.abi === 2 : owner !== ZERO) throw new RegistryUnconfirmedError(r.version); // an invalid record
    };
    if (r.abi === 1) {
      const rows = await Promise.all(ids.map((id) => read(r, 'getVault', [id]) as Promise<[Hex, Hex, number]>));
      rows.forEach(([owner, blob, version], j) => add(ids[j]!, owner, blob, version));
      return out;
    }
    for (let i = 0; i < ids.length; i += GET_VAULTS_MAX) {
      const batch = ids.slice(i, i + GET_VAULTS_MAX);
      const rows = (await read(r, 'getVaults', [batch])) as readonly { owner: Hex; blob: Hex; version: number }[];
      if (rows.length !== batch.length) throw new RegistryUnconfirmedError(r.version);
      rows.forEach((row, j) => add(batch[j]!, row.owner, row.blob, row.version));
    }
    return out;
  }

  const confirm = async <T>(r: RegistryConfig, f: () => Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      if (e instanceof RegistryUnconfirmedError) throw e;
      throw new RegistryUnconfirmedError(r.version, { cause: e });
    }
  };

  async function getVault(vaultId: Hex, registry?: RegistryVersion): Promise<Candidate | null> {
    await ready();
    const t = target(registry);
    const [owner, blob, version] = (await read(t, 'getVault', [vaultId])) as [Hex, Hex, number];
    return candidate(t.version, vaultId, owner, blob, version);
  }

  /**
   * Every registry, newest first. An id one registry lists is first checked against every newer registry (newest
   * first); the first that holds it yields its record instead, whichever locator lists it there. Reads of any registry
   * that is newer than another must be confirmed (RegistryUnconfirmedError). The list is oldest first (unlock reverses
   * it): each registry's own entries, then the newer records of ids it listed, before every newer registry's.
   */
  async function candidatesFor(locator: Hex): Promise<Candidate[]> {
    await ready();
    let out: Candidate[] = [];
    const seen = new Set<string>();
    for (const [i, r] of registries.entries()) {
      const guard = <T>(f: () => Promise<T>) => (i < registries.length - 1 ? confirm(r, f) : f());
      let ids = unique(await guard(() => resolve(r, locator))).filter((id) => !seen.has(lower(id)));
      ids.forEach((id) => seen.add(lower(id)));
      const shadowed: Candidate[] = [];
      // `records` of no ids makes no request.
      for (const newer of registries.slice(0, i)) {
        const pending = ids;
        const held = await confirm(newer, () => records(newer, pending, false));
        const found = new Set(held.map((c) => lower(c.vaultId)));
        ids = ids.filter((id) => !found.has(lower(id)));
        shadowed.push(...held);
      }
      out = [...(await guard(() => records(r, ids, true))), ...shadowed, ...out];
    }
    return out;
  }

  /** The vault an account owns in the newest registry (zero if none). Accounts never write to older ones. */
  async function vaultOf(owner: Hex): Promise<Hex> {
    await ready();
    return (await read(target(), 'vaultOf', [owner])) as Hex;
  }

  /** Every locator registered for a vault (LocatorAdded events, indexed by vaultId). Best effort. */
  async function locatorsOf(vaultId: Hex, registry?: RegistryVersion): Promise<Hex[]> {
    await ready();
    const t = target(registry);
    const logs = await client.getContractEvents({
      address: t.address,
      abi: abiOf(t),
      eventName: 'LocatorAdded',
      args: { vaultId },
      fromBlock: BigInt(t.deployBlock),
      toBlock: 'latest',
    });
    const out = new Set<Hex>();
    for (const l of logs) {
      const loc = (l as unknown as { args: { locator?: Hex } }).args.locator;
      if (loc) out.add(loc.toLowerCase() as Hex);
    }
    return [...out].slice(0, 8);
  }

  return { client, getVault, candidatesFor, vaultOf, locatorsOf };
}

export type RegistryReader = ReturnType<typeof createRegistryReader>;
