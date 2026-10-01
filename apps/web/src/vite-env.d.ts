/// <reference types="vite/client" />

declare module 'virtual:cryoshield-config' {
  import type { AppEnvConfig } from './config/schema';
  export const config: Readonly<
    AppEnvConfig & { registry: { address: `0x${string}`; deployBlock: number; abiHash: string } }
  >;
  export const registryAbi: readonly unknown[];
}
