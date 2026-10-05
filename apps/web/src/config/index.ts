import { config as raw, registryV1Abi as rawV1Abi } from 'virtual:cryoshield-config';
import type { Abi } from 'viem';

export const config = raw;
/** VaultRegistry v1 (legacy reads only). The v2 and wallet interfaces live in src/chain/contracts.ts. */
export const registryV1Abi = rawV1Abi as Abi;
export type RuntimeConfig = typeof raw;
