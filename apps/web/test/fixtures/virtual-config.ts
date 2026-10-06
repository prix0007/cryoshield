/**
 * Test stand-in for `virtual:cryoshield-config`. Addresses come from contracts/deployments/31337.json (the local
 * stack deploys exactly those), with the wallet entry for RP ID "localhost". Unit tests never reach a chain, so
 * until the contracts track writes the v2/wallet entries, placeholder addresses keep them runnable; the integration
 * stack fails loudly if the record lacks them (e2e/stack/stack.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import abi from '../../../../contracts/abi/VaultRegistry.json';

const contractsDir = process.env.CRYOSHIELD_CONTRACTS_DIR ?? join(__dirname, '..', '..', '..', '..', 'contracts');
const record = JSON.parse(readFileSync(join(contractsDir, 'deployments', '31337.json'), 'utf8')) as {
  address?: `0x${string}`;
  deployBlock?: number;
  contracts?: {
    vaultRegistryV2?: { address: `0x${string}`; deployBlock: number };
    wallets?: Record<string, { factory: `0x${string}`; implementation: `0x${string}` }>;
  };
};
const v2 = record.contracts?.vaultRegistryV2;
const wallet = record.contracts?.wallets?.localhost;

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
  registryV1: { address: record.address ?? ('0xB43f58cF17e64B603aE5588a1DD17E96a0849e44' as const), deployBlock: record.deployBlock ?? 1 },
  registryV2: { address: v2?.address ?? ('0x00000000000000000000000000000000000000a2' as const), deployBlock: v2?.deployBlock ?? 1 },
  wallet: {
    factory: wallet?.factory ?? ('0x00000000000000000000000000000000000000f1' as const),
    implementation: wallet?.implementation ?? ('0x00000000000000000000000000000000000000e1' as const),
  },
});
/** Test-only: the full exported v1 ABI (the app itself embeds only its typed read fragments). */
export const registryV1AbiFull = abi;
