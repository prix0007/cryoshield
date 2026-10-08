/// <reference types="vite/client" />

declare module 'virtual:cryoshield-config' {
  import type { AppEnvConfig, RegistryConfig } from './config/schema';
  export const config: Readonly<
    AppEnvConfig & {
      /** Every VaultRegistry version, newest first (web-registry-versions D1): [0] takes every write, the rest are read-only. */
      registries: readonly [RegistryConfig, ...RegistryConfig[]];
      /** The CryoShield wallet pair for this build's RP ID (contracts.wallets[VITE_RP_ID]). */
      wallet: { factory: `0x${string}`; implementation: `0x${string}` };
      /** Display name and block explorer of the configured chain (src/config/networks.ts). */
      network: { name: string; explorerUrl: string | null };
    }
  >;

}
