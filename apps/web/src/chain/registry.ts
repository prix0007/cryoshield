/**
 * VaultRegistry reads over a public RPC: plain eth_call, no account, no signature (spec hardware-key-auth).
 *
 * harden-gas-sponsorship (spec vault-registry "Registry versions coexist"): reads query VaultRegistry v2 (paged
 * `resolveLocator`, batched `getVaults`), then the legacy v1 where the chain has one, and treat the candidates as one
 * list. Writes go to v2 only (src/account/writes.ts).
 *
 * v2 is authoritative per vaultId. v1 accepts caller-chosen ids, so anyone can register a v2 vault's id in v1 with a
 * stale, still-decryptable copy. Every v1 id is therefore checked against v2: if v2 has it, the v1 copy is ignored.
 * If v2 can't be confirmed (an RPC error, or v2 contradicting itself), the read fails with RegistryUnconfirmedError;
 * it never falls back to v1.
 */
import { createPublicClient, http, type Abi, type Hex, type Transport } from 'viem';
import { config, registryV1Abi } from '../config';
import type { Candidate, RegistryVersion } from '../vault/adapter';
import { fromHex } from '../lib/bytes';
import { ensureChain } from './guard';
import { GET_VAULTS_MAX, PAGE_SIZE, registryV2Abi } from './contracts';

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

export class RegistryUnconfirmedError extends Error {
  override name = 'RegistryUnconfirmedError';
}

const lower = (id: Hex) => id.toLowerCase();
const unique = (ids: readonly Hex[]) => [...new Map(ids.map((id) => [id.toLowerCase(), id])).values()];

function candidate(registry: RegistryVersion, vaultId: Hex, owner: Hex, blob: Hex, version: number | bigint): Candidate | null {
  const bytes = fromHex(blob);
  if (owner === ZERO || bytes.length === 0 || bytes.length > MAX_BLOB_BYTES) return null;
  return { vaultId, owner, blob: bytes, version: Number(version), registry };
}

export function createRegistryReader(transport: Transport = defaultTransport()) {
  const client = createPublicClient({ chain: chainOf(), transport });
  const v2 = config.registryV2;
  const v1 = config.registryV1;
  const ready = () => ensureChain(client);
  const target = (r: RegistryVersion): { address: Hex; abi: Abi; deployBlock: number } => {
    if (r === 'v2') return { address: v2.address, abi: registryV2Abi as Abi, deployBlock: v2.deployBlock };
    if (!v1) throw new Error('VaultRegistry v1 is not deployed on this chain');
    return { address: v1.address, abi: registryV1Abi, deployBlock: v1.deployBlock };
  };

  /** Every v2 vaultId under a locator, in insertion order (no cap; pages of PAGE_SIZE). */
  async function resolveV2(locator: Hex): Promise<Hex[]> {
    const length = (await client.readContract({ address: v2.address, abi: registryV2Abi, functionName: 'locatorLength', args: [locator] })) as bigint;
    const out: Hex[] = [];
    for (let start = 0n; start < length; start += BigInt(PAGE_SIZE)) {
      const page = (await client.readContract({
        address: v2.address,
        abi: registryV2Abi,
        functionName: 'resolveLocator',
        args: [locator, start, BigInt(PAGE_SIZE)],
      })) as readonly Hex[];
      if (page.length === 0) break;
      out.push(...page);
    }
    return out;
  }

  async function resolveV1(locator: Hex): Promise<Hex[]> {
    if (!v1) return [];
    const ids = (await client.readContract({ address: v1.address, abi: registryV1Abi, functionName: 'resolveLocator', args: [locator] })) as Hex[];
    return ids.slice(0, V1_LOCATOR_CAP);
  }

  /**
   * v2 records in batches of at most GET_VAULTS_MAX ids (the registry reverts above that). `listed`: the ids came from
   * v2's own index, so each must have a valid record. Otherwise (checking v1 ids), an empty record means "not in v2".
   * Anything v2 can't answer consistently is RegistryUnconfirmedError.
   */
  async function vaultsV2(ids: readonly Hex[], listed: boolean): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for (let i = 0; i < ids.length; i += GET_VAULTS_MAX) {
      const batch = ids.slice(i, i + GET_VAULTS_MAX);
      const rows = (await client.readContract({ address: v2.address, abi: registryV2Abi, functionName: 'getVaults', args: [batch] })) as readonly {
        owner: Hex;
        blob: Hex;
        version: number;
      }[];
      if (rows.length !== batch.length) throw new RegistryUnconfirmedError('VaultRegistry v2 returned a different number of vaults');
      rows.forEach((r, j) => {
        const absent = r.owner === ZERO;
        if (absent && !listed) return;
        const c = candidate('v2', batch[j]!, r.owner, r.blob, r.version);
        if (!c) throw new RegistryUnconfirmedError('VaultRegistry v2 lists a vault it has no valid record for');
        out.push(c);
      });
    }
    return out;
  }

  const confirmV2 = async <T>(f: () => Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      if (e instanceof RegistryUnconfirmedError) throw e;
      throw new RegistryUnconfirmedError('VaultRegistry v2 could not be read', { cause: e });
    }
  };

  async function getVault(vaultId: Hex, registry: RegistryVersion = 'v2'): Promise<Candidate | null> {
    await ready();
    const t = target(registry);
    const [owner, blob, version] = (await client.readContract({ address: t.address, abi: t.abi, functionName: 'getVault', args: [vaultId] })) as [Hex, Hex, number];
    return candidate(registry, vaultId, owner, blob, version);
  }

  /**
   * v2 is queried first, then v1; the list is oldest first (v1 entries predate every v2 entry). A v1 id that v2 also
   * has yields v2's record only (authoritative), whichever locator v2 lists it under.
   */
  async function candidatesFor(locator: Hex): Promise<Candidate[]> {
    await ready();
    const idsV2 = await confirmV2(async () => unique(await resolveV2(locator)));
    const fromV2 = await confirmV2(() => vaultsV2(idsV2, true));
    const idsV1 = unique(await resolveV1(locator));
    const known = new Set(idsV2.map(lower));
    const unseen = idsV1.filter((id) => !known.has(lower(id)));
    const shadowed = await confirmV2(() => vaultsV2(unseen, false));
    const inV2 = new Set(shadowed.map((c) => lower(c.vaultId)));
    const v1Only = unseen.filter((id) => !inV2.has(lower(id)));
    const fromV1 = (await Promise.all(v1Only.map((id) => getVault(id, 'v1')))).filter((c): c is Candidate => c !== null);
    return [...fromV1, ...shadowed, ...fromV2];
  }

  /** The v2 vault an account owns (zero if none). Accounts never write to v1. */
  async function vaultOf(owner: Hex): Promise<Hex> {
    await ready();
    return (await client.readContract({ address: v2.address, abi: registryV2Abi, functionName: 'vaultOf', args: [owner] })) as Hex;
  }

  /** Every locator registered for a vault (LocatorAdded events, indexed by vaultId). Best effort. */
  async function locatorsOf(vaultId: Hex, registry: RegistryVersion = 'v2'): Promise<Hex[]> {
    await ready();
    const t = target(registry);
    const logs = await client.getContractEvents({
      address: t.address,
      abi: t.abi,
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
