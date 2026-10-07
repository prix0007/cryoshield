/** Dependency container for the UI, so flows can be tested with fakes. Production wires real services. */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Hex, PublicClient } from 'viem';
import { config } from '../config';
import { createRegistryReader, type RegistryReader } from '../chain/registry';
import { makePublicClient } from '../account/account';
import { createSponsor, type Sponsor } from '../account/writes';
import { createMirror } from '../mirror/mirror';
import type { CredentialsApi } from '../webauthn';

export interface Services {
  rpId: string;
  rpName: string;
  /** Configured chain (testnet warning in the shell). */
  chainId: number;
  credentials?: CredentialsApi;
  reader: RegistryReader;
  client: PublicClient;
  sponsor: Sponsor;
  mirror: ReturnType<typeof createMirror>;
  /** Turbo's fast-finality index (fix-arweave-mirror-status): item links right after upload. */
  fastIndexUrl: string;
  /** Hostname check for the RP ID guard (overridable in tests). */
  host: string;
  /** show-vault-onchain-location: the configured chain's display name and block explorer (null: no explorer). */
  network: { name: string; explorerUrl: string | null };
  /** Registry addresses shown in "Where your vault is stored" (v1 is legacy, read-only, absent on OP Mainnet). */
  registries: { v1: Hex | null; v2: Hex };
  /** Arweave gateway for the mirror item link. */
  arweaveGatewayUrl: string;
}

const Ctx = createContext<Services | null>(null);

export function defaultServices(): Services {
  const client = makePublicClient();
  return {
    rpId: config.rpId,
    rpName: config.rpName,
    chainId: config.chainId,
    reader: createRegistryReader(),
    client,
    sponsor: createSponsor(client),
    mirror: createMirror({ turboUploadUrl: config.turboUploadUrl, arweaveGatewayUrl: config.arweaveGatewayUrl, fastIndexUrl: config.arweaveFastIndexUrl }),
    fastIndexUrl: config.arweaveFastIndexUrl,
    host: typeof location === 'undefined' ? '' : location.hostname,
    network: config.network,
    registries: { v1: config.registryV1?.address ?? null, v2: config.registryV2.address },
    arweaveGatewayUrl: config.arweaveGatewayUrl,
  };
}

export function ServicesProvider({ value, children }: { value?: Services; children: ReactNode }) {
  const v = useMemo(() => value ?? defaultServices(), [value]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useServices(): Services {
  const v = useContext(Ctx);
  if (!v) throw new Error('ServicesProvider missing');
  return v;
}
