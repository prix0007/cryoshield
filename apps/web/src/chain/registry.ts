/** VaultRegistry reads over a public RPC: plain eth_call, no account, no signature (spec hardware-key-auth). */
import { createPublicClient, http, type Hex, type Transport } from 'viem';
import { config, registryAbi } from '../config';
import type { Candidate } from '../vault/adapter';
import { fromHex } from '../lib/bytes';
import { ensureChain } from './guard';

export const MAX_BLOB_BYTES = 1024;
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

export function createRegistryReader(transport: Transport = defaultTransport()) {
  const client = createPublicClient({ chain: chainOf(), transport });
  const address = config.registry.address;
  const ready = () => ensureChain(client);

  async function resolveLocator(locator: Hex): Promise<Hex[]> {
    await ready();
    const ids = (await client.readContract({ address, abi: registryAbi, functionName: 'resolveLocator', args: [locator] })) as Hex[];
    return ids.slice(0, 16);
  }

  async function getVault(vaultId: Hex): Promise<Candidate | null> {
    await ready();
    const [owner, blob, version] = (await client.readContract({
      address,
      abi: registryAbi,
      functionName: 'getVault',
      args: [vaultId],
    })) as [Hex, Hex, number];
    const bytes = fromHex(blob);
    if (owner === ZERO || bytes.length === 0 || bytes.length > MAX_BLOB_BYTES) return null;
    return { vaultId, owner, blob: bytes, version: Number(version) };
  }

  async function candidatesFor(locator: Hex): Promise<Candidate[]> {
    const ids = [...new Map((await resolveLocator(locator)).map((id) => [id.toLowerCase(), id])).values()];
    const out = await Promise.all(ids.map(getVault));
    return out.filter((c): c is Candidate => c !== null);
  }

  async function vaultOf(owner: Hex): Promise<Hex> {
    await ready();
    return (await client.readContract({ address, abi: registryAbi, functionName: 'vaultOf', args: [owner] })) as Hex;
  }

  /** Every locator registered for a vault (LocatorAdded events, indexed by vaultId). Best effort. */
  async function locatorsOf(vaultId: Hex): Promise<Hex[]> {
    await ready();
    const logs = await client.getContractEvents({
      address,
      abi: registryAbi,
      eventName: 'LocatorAdded',
      args: { vaultId },
      fromBlock: BigInt(config.registry.deployBlock),
      toBlock: 'latest',
    });
    const out = new Set<Hex>();
    for (const l of logs) {
      const loc = (l as unknown as { args: { locator?: Hex } }).args.locator;
      if (loc) out.add(loc.toLowerCase() as Hex);
    }
    return [...out].slice(0, 8);
  }

  return { client, resolveLocator, getVault, candidatesFor, vaultOf, locatorsOf };
}

export type RegistryReader = ReturnType<typeof createRegistryReader>;
