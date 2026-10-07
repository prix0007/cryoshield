/**
 * The write stack, loaded as ONE lazy chunk on the first save or account action (harden-gas-sponsorship 5.5): viem
 * account abstraction, the Pimlico client, the CryoShield wallet wrapper, the sponsorship allowlist and the write
 * operations. Only lazy.ts imports this module, and only with a dynamic import().
 */
export { existingVaultAccount, newVaultAccount } from './account';
export { addKeyOnChain, assertCurrent, createSponsor, createVaultOnChain, sponsoredOpsUsed, updateVaultOnChain } from './writes';
