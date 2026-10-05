/**
 * Typed interfaces of the harden-gas-sponsorship contracts (VaultRegistry v2, CryoShieldSmartWalletFactory).
 *
 * These are the ONLY ABI fragments the app uses for them. They follow the change's spec deltas
 * (vault-registry, smart-account). The build checks that every fragment here exists, with the identical
 * signature, in the ABIs the contracts track exports (`contracts/abi/*.json`, see vite-plugins/deployment.ts), so a
 * drift fails the build instead of a write. Swapping to the generated ABIs means editing only this file.
 */
import { encodeAbiParameters, keccak256, parseAbi, type Address, type Hex } from 'viem';

/** VaultRegistry v2: registry-derived vaultId, no per-locator cap, paginated reads (design D9). */
export const registryV2Abi = parseAbi([
  'function createVault(bytes32 salt, bytes blob, bytes32[] locators) returns (bytes32 vaultId)',
  'function updateVault(bytes32 vaultId, bytes blob)',
  'function addLocators(bytes32 vaultId, bytes32[] locators)',
  'function getVault(bytes32 vaultId) view returns (address owner, bytes blob, uint32 version)',
  'function getVaults(bytes32[] vaultIds) view returns ((address owner, bytes blob, uint32 version)[])',
  'function vaultOf(address owner) view returns (bytes32)',
  'function vaultIdFor(address owner, bytes32 salt) pure returns (bytes32)',
  'function locatorLength(bytes32 locator) view returns (uint256)',
  'function resolveLocator(bytes32 locator, uint256 start, uint256 count) view returns (bytes32[])',
  'event LocatorAdded(bytes32 indexed vaultId, bytes32 indexed locator)',
  'error OwnerAlreadyHasVault(address owner)',
  'error TooFewLocators(uint256 count)',
  'error TooManyLocators(uint256 count)',
  'error InvalidBlobSize(uint256 size)',
  'error NotVaultOwner(bytes32 vaultId, address caller)',
  'error DuplicateLocator(bytes32 locator)',
  'error ZeroLocator()',
  'error TooManyIds(uint256 count)',
]);

/**
 * VaultRegistry v1 (legacy, read-only, never on OP Mainnet): only the reads the app makes. Typed fragments instead of
 * the whole exported ABI keep the /app bundle small; the build checks them against contracts/abi/VaultRegistry.json.
 */
export const registryV1Abi = parseAbi([
  'function resolveLocator(bytes32 locator) view returns (bytes32[])',
  'function getVault(bytes32 vaultId) view returns (address, bytes, uint32)',
  'event LocatorAdded(bytes32 indexed vaultId, bytes32 indexed locator)',
]);

/** Largest page `resolveLocator` returns (the registry clamps `count` to this). */
export const PAGE_SIZE = 256;
/** Most ids one `getVaults` call accepts (it reverts above this, so clients batch). */
export const GET_VAULTS_MAX = 32;

/**
 * CryoShieldSmartWalletFactory: CBSW v1.1 factory code with our implementation (design D7). Same ABI as Coinbase's
 * factory, so only the address differs.
 */
export const walletFactoryAbi = parseAbi([
  'function createAccount(bytes[] owners, uint256 nonce) payable returns (address account)',
  'function getAddress(bytes[] owners, uint256 nonce) view returns (address)',
  'function implementation() view returns (address)',
]);

/** The account calls the app uses (CBSW v1.1 ABI; CryoShieldSmartWallet keeps it). */
export const smartWalletAbi = parseAbi([
  'function execute(address target, uint256 value, bytes data) payable',
  'function executeBatch((address target, uint256 value, bytes data)[] calls) payable',
  'function addOwnerPublicKey(bytes32 x, bytes32 y)',
  // CryoShieldSmartWallet: always reverts (P-256 owners only), hence pure. Only encoded to test the allowlist refuses it.
  'function addOwnerAddress(address owner) pure',
  'function removeOwnerAtIndex(uint256 index, bytes owner)',
  'function ownerAtIndex(uint256 index) view returns (bytes)',
  'function nextOwnerIndex() view returns (uint256)',
  'function ownerCount() view returns (uint256)',
  'function isOwnerPublicKey(bytes32 x, bytes32 y) view returns (bool)',
  'function upgradeToAndCall(address newImplementation, bytes data) payable',
]);

/** Owner cap of CryoShieldSmartWallet (MAX_OWNERS), equal to the registry's 8 locators per vault. */
export const MAX_OWNERS = 8;

/**
 * vaultId = keccak256(abi.encode(owner, salt)), as VaultRegistry v2 derives it from msg.sender (spec vault-registry
 * "Vault creation"). The client computes it from the counterfactual account address BEFORE encrypting, because the
 * vaultId is in the blob's AAD.
 */
export function deriveVaultIdV2(owner: Address, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [owner, salt]));
}
