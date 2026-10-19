/** Dependency container for the UI, so flows can be tested with fakes. Production wires real services. */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Hex, PublicClient } from 'viem';
import { config } from '../config';
import { networkFor } from '../config/networks';
import { createRegistryReader, makePublicClient, type RegistryReader } from '../chain/registry';
import { lazySponsor } from '../account/lazy';
import type { Sponsor } from '../account/writes';
import { createMirror } from '../mirror/mirror';
import type { CredentialsApi } from '../webauthn';
import type { RegistryVersion } from '../vault/adapter';
import { checkBuild, type BuildState } from '../lib/build-check';
import type { ReleaseLabel } from '../lib/release';

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
  /** Registry addresses shown in "Where your vault is stored", newest first (web-registry-versions D5). */
  registries: readonly { version: RegistryVersion; address: Hex }[];
  /** Arweave gateway for the mirror item link. */
  arweaveGatewayUrl: string;
  /** reload-on-new-build: is the site serving a newer app build than this tab runs? Asked before every write. */
  buildCheck: () => Promise<BuildState>;
  /** footer-release-version D4: the footer's Version line ("v1.0.3" or "dev <commit>"), or null while unknown. */
  release: () => Promise<ReleaseLabel | null>;
}

/**
 * Test networks get the testnet + unaudited warning (add-privacy-and-compliance 4.3) and the save-budget hint (D10).
 * launch-op-mainnet D6: the status comes from the network table; an unknown chain counts as a testnet (fail safe).
 */
export const testnetName = (chainId: number): string | undefined => {
  const n = networkFor(chainId);
  return n.status === 'testnet' ? n.shortName : undefined;
};

const Ctx = createContext<Services | null>(null);

export function defaultServices(): Services {
  const client = makePublicClient();
  return {
    rpId: config.rpId,
    rpName: config.rpName,
    chainId: config.chainId,
    reader: createRegistryReader(),
    client,
    // The write stack (viem account abstraction, Pimlico) loads on the first save (harden-gas-sponsorship 5.5).
    sponsor: lazySponsor(client),
    mirror: createMirror({ turboUploadUrl: config.turboUploadUrl, arweaveGatewayUrl: config.arweaveGatewayUrl, fastIndexUrl: config.arweaveFastIndexUrl }),
    fastIndexUrl: config.arweaveFastIndexUrl,
    host: typeof location === 'undefined' ? '' : location.hostname,
    network: config.network,
    registries: config.registries,
    arweaveGatewayUrl: config.arweaveGatewayUrl,
    buildCheck: () => checkBuild(),
    // D5: fetched and parsed in a lazy chunk, so the initial /app JavaScript stays inside its budget.
    release: () => import('../lib/release').then((m) => m.fetchRelease().then((info) => (info ? m.releaseLink(info) : null))),
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
