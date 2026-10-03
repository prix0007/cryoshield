import abi from '../../../../contracts/abi/VaultRegistry.json';

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
  registry: { address: '0xB43f58cF17e64B603aE5588a1DD17E96a0849e44' as const, deployBlock: 1, abiHash: '0x' },
});
export const registryAbi = abi;
