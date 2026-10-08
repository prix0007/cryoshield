export interface RegistryEntry {
  /** "v1", "v2", "v3", … */
  version: `v${number}`;
  n: number;
  /** Read/write interface: 1 = abi/VaultRegistry.json, 2 = abi/VaultRegistryV2.json. */
  abi: 1 | 2;
  address: `0x${string}`;
  deployBlock: number;
  txHash: string;
  /** keccak256 of the exported ABI of this kind (lower-case). */
  abiHash: `0x${string}`;
  /** Where the entry came from in the record, e.g. "contracts.vaultRegistries.v3". */
  key: string;
}
/** Every registry of a deployment record, newest first. Throws on anything unknown, malformed or conflicting. */
export declare function registryList(record: unknown, where: string, abiHashes: { 1: string; 2: string }): RegistryEntry[];
