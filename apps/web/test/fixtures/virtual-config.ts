/**
 * Test stand-in for `virtual:cryoshield-config`. Addresses come from contracts/deployments/31337.json (the local
 * stack deploys exactly those), with the wallet entry for RP ID "localhost". Registries come from the build's own parser
 * (vite-plugins/registries.mjs), newest first. The integration stack fails loudly if the record lacks an entry
 * (e2e/stack/stack.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keccak256, toHex } from 'viem';
import abi from '../../../../contracts/abi/VaultRegistry.json';
import { registryList } from '../../vite-plugins/registries.mjs';
import type { RegistryConfig } from '../../src/config/schema';

const contractsDir = process.env.CRYOSHIELD_CONTRACTS_DIR ?? join(__dirname, '..', '..', '..', '..', 'contracts');
const record = JSON.parse(readFileSync(join(contractsDir, 'deployments', '31337.json'), 'utf8')) as {
  address?: `0x${string}`;
  deployBlock?: number;
  contracts?: {
    vaultRegistryV2?: { address: `0x${string}`; deployBlock: number };
    wallets?: Record<string, { factory: `0x${string}`; implementation: `0x${string}` }>;
  };
};
const wallet = record.contracts?.wallets?.localhost;
const abiHash = (f: string) => keccak256(toHex(new Uint8Array(readFileSync(join(contractsDir, 'abi', f)))));
// web-registry-versions D1: the same parser as the build, newest first.
const registries = registryList(record, '31337.json', { 1: abiHash('VaultRegistry.json'), 2: abiHash('VaultRegistryV2.json') }).map(
  ({ version, abi, address, deployBlock }): RegistryConfig => ({ version, abi, address, deployBlock }),
) as unknown as readonly [RegistryConfig, ...RegistryConfig[]];

export const config = Object.freeze({
  chainId: 31337,
  rpcUrl: 'http://127.0.0.1:8545',
  bundlerUrl: 'http://127.0.0.1:4337',
  sponsorshipPolicyId: 'sp_e2e_local',
  turboUploadUrl: 'https://upload.ardrive.io',
  arweaveGatewayUrl: 'https://arweave.net',
  arweaveFastIndexUrl: 'https://turbo-gateway.com',
  rpId: 'localhost',
  rpName: 'CryoShield (test)',
  connectOrigins: ['http://127.0.0.1:8545', 'http://127.0.0.1:4337', 'https://upload.ardrive.io', 'https://arweave.net', 'https://turbo-gateway.com'],
  appOnlyOrigins: [] as string[],
  registries,
  network: { name: 'local test chain', explorerUrl: null as string | null },
  wallet: {
    factory: wallet?.factory ?? ('0x00000000000000000000000000000000000000f1' as const),
    implementation: wallet?.implementation ?? ('0x00000000000000000000000000000000000000e1' as const),
  },
});
/** Test-only: the full exported v1 ABI (the app itself embeds only its typed read fragments). */
export const registryV1AbiFull = abi;
/** Test-only: a configured registry by version (throws when the record has none). */
export const registryOf = (version: string): RegistryConfig => {
  const r = registries.find((x) => x.version === version);
  if (!r) throw new Error(`no registry ${version} in 31337.json`);
  return r;
};
