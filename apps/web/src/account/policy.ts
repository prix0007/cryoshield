/**
 * Client-side sponsorship allowlist (spec sponsored-vault-writes "Sponsorship scope"; security carry-over 2).
 * A sponsored user operation may only:
 *   - call VaultRegistry v2: createVault / updateVault / addLocators, with value 0 (never v1: harden-gas-sponsorship);
 *   - call the account itself: addOwnerPublicKey (add-key flow), with value 0.
 * Anything else throws before the bundler or paymaster is contacted. The paymaster policy server-side is the
 * backstop (see docs/paymaster-policy.md); this check stops our own code from ever asking for more.
 */
import { decodeFunctionData, toFunctionSelector, type Hex } from 'viem';
import { WRITE_REGISTRY } from '../config';
import { smartWalletAbi } from '../chain/contracts';

export { smartWalletAbi };

export const REGISTRY_SELECTORS = new Set([
  toFunctionSelector('createVault(bytes32,bytes,bytes32[])'), // (salt, blob, locators) in v2
  toFunctionSelector('updateVault(bytes32,bytes)'),
  toFunctionSelector('addLocators(bytes32,bytes32[])'),
]);
export const SELF_SELECTORS = new Set([toFunctionSelector('addOwnerPublicKey(bytes32,bytes32)')]);

export class PolicyError extends Error {
  override name = 'PolicyError';
}

export interface Call {
  to: Hex;
  value?: bigint;
  data: Hex;
}

export function assertSponsorableCalls(calls: readonly Call[], account: Hex, registry: Hex = WRITE_REGISTRY.address): void {
  if (calls.length === 0 || calls.length > 4) throw new PolicyError('call count out of range');
  for (const c of calls) {
    if ((c.value ?? 0n) !== 0n) throw new PolicyError('sponsored calls must not transfer value');
    const selector = c.data.slice(0, 10).toLowerCase() as Hex;
    const to = c.to.toLowerCase();
    if (to === registry.toLowerCase()) {
      if (!REGISTRY_SELECTORS.has(selector)) throw new PolicyError(`registry selector ${selector} is not sponsorable`);
    } else if (to === account.toLowerCase()) {
      if (!SELF_SELECTORS.has(selector)) throw new PolicyError(`account selector ${selector} is not sponsorable`);
    } else {
      throw new PolicyError(`target ${c.to} is not sponsorable`);
    }
  }
}

/** Decodes a Coinbase Smart Wallet execute/executeBatch callData and applies the same allowlist. */
export function assertSponsorableCallData(callData: Hex, account: Hex, registry: Hex = WRITE_REGISTRY.address): void {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: smartWalletAbi, data: callData });
  } catch {
    throw new PolicyError('callData is not execute/executeBatch');
  }
  if (decoded.functionName === 'execute') {
    const [to, value, data] = decoded.args;
    return assertSponsorableCalls([{ to, value, data }], account, registry);
  }
  if (decoded.functionName === 'executeBatch') {
    return assertSponsorableCalls(
      decoded.args[0].map((c) => ({ to: c.target, value: c.value, data: c.data })),
      account,
      registry,
    );
  }
  throw new PolicyError(`${decoded.functionName} is not sponsorable`);
}
