// Minimal read ABIs (OpenSpec change add-privacy-preserving-analytics, design D2). Event layouts are shared by every
// VaultRegistry version (contracts/abi/VaultRegistry.json and VaultRegistryV2.json; pinned by test/abi.test.ts).
import { parseAbi, toEventSelector } from 'viem';

export const REGISTRY_EVENTS = parseAbi([
  'event VaultCreated(bytes32 indexed vaultId, address indexed owner, uint32 version, bytes32 blobHash)',
  'event VaultUpdated(bytes32 indexed vaultId, uint32 version, bytes32 blobHash)',
  'event LocatorAdded(bytes32 indexed vaultId, bytes32 indexed locator)',
]);

/** getVault exists in v1 and v2; getVaults (batched) only in the v2 read ABI. */
export const REGISTRY_ABI = parseAbi([
  'function getVault(bytes32 vaultId) view returns (address owner, bytes blob, uint32 version)',
  'struct Vault { address owner; bytes blob; uint32 version; }',
  'function getVaults(bytes32[] vaultIds) view returns (Vault[] vaults)',
]);

/** EntryPoint v0.6 (the web app's entryPoint06Address). */
export const ENTRY_POINT_EVENTS = parseAbi([
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
]);

export const TOPIC = {
  VaultCreated: toEventSelector(REGISTRY_EVENTS[0]),
  VaultUpdated: toEventSelector(REGISTRY_EVENTS[1]),
  LocatorAdded: toEventSelector(REGISTRY_EVENTS[2]),
  UserOperationEvent: toEventSelector(ENTRY_POINT_EVENTS[0]),
} as const;

/** VaultRegistryV2.MAX_BATCH_IDS. */
export const MAX_BATCH_IDS = 32;
