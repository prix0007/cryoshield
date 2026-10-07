import { config as raw } from 'virtual:cryoshield-config';
import type { RegistryConfig } from './schema';

export const config = raw;
/** Contract interfaces (registry v1 and v2, the wallet and its factory) live in src/chain/contracts.ts. */
export type RuntimeConfig = typeof raw;
/** The newest registry: it takes every write; vaults in older registries are read-only (web-registry-versions D3). */
export const WRITE_REGISTRY: RegistryConfig = raw.registries[0];
/** In an older registry: readable, never written. */
export const isOlder = (registry: string) => registry !== WRITE_REGISTRY.version;
