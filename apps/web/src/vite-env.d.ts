/// <reference types="vite/client" />

declare module 'virtual:cryoshield-config' {
  import type { AppEnvConfig } from './config/schema';
  type Contract = { address: `0x${string}`; deployBlock: number };
  export const config: Readonly<
    AppEnvConfig & {
      /** VaultRegistry v1: legacy, read-only; null where it was never deployed (OP Mainnet). */
      registryV1: Contract | null;
      /** VaultRegistry v2: every write, and reads first. */
      registryV2: Contract;
      /** The CryoShield wallet pair for this build's RP ID (contracts.wallets[VITE_RP_ID]). */
      wallet: { factory: `0x${string}`; implementation: `0x${string}` };
    }
  >;

}
