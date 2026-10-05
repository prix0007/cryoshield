import { config as raw } from 'virtual:cryoshield-config';

export const config = raw;
/** Contract interfaces (registry v1 and v2, the wallet and its factory) live in src/chain/contracts.ts. */
export type RuntimeConfig = typeof raw;
