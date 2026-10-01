import { config as raw, registryAbi as rawAbi } from 'virtual:cryoshield-config';
import type { Abi } from 'viem';

export const config = raw;
export const registryAbi = rawAbi as Abi;
export type RuntimeConfig = typeof raw;
