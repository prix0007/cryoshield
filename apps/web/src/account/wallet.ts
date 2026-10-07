/**
 * CryoShieldSmartWallet accounts (harden-gas-sponsorship design D7, D8).
 *
 * D8 spike result (viem 2.57.2): `toCoinbaseSmartAccount` has NO factory parameter; it always uses Coinbase's
 * factory (`factoryAddress[version]`) for both `getAddress` and the initCode. Our factory is CBSW v1.1 factory code
 * with our implementation, so the ABI, call encoding, owner encoding and signature wrapping are identical; only the
 * factory address differs. This is the D8 "thin wrapper": it keeps viem's audited CBSW encoding and signing and
 * substitutes the factory in exactly the two places it is used:
 *   - the address: read from OUR factory's `getAddress(owners, nonce)` (or given, for a deployed account) and passed
 *     to viem as `address`, so viem never queries Coinbase's factory and signs for the right sender;
 *   - the initCode: `getFactoryArgs` is replaced to return OUR factory and `createAccount(owners, nonce)`.
 * (`toSmartAccount` calls the implementation's own `getFactoryArgs` through a closure, so overriding it on the
 * returned object is required; `sign`/`signMessage` reach it through `this`, so they also see ours.)
 *
 * vault-list-labels-archive D10 amendment: every user operation uses EntryPoint nonce KEY 0 (viem would pick a fresh
 * timestamp key per operation), so `EntryPoint.getNonce(account, 0)` counts the account's operations for the testnet
 * save-budget hint. Operations are therefore sequential per account; a concurrent second save fails validation (AA25)
 * and is reported as NONCE_CONFLICT (writes.ts). Signing (UV, rpIdHash) is unchanged.
 */
import { encodeFunctionData, getAddress, type Address, type Hex, type PublicClient } from 'viem';
import { toCoinbaseSmartAccount, type WebAuthnAccount } from 'viem/account-abstraction';
import { MAX_OWNERS, walletFactoryAbi } from '../chain/contracts';

/** Coinbase's CBSW v1.1 factory: what viem would use. Never used for new accounts (spec deployment-targets). */
export const COINBASE_FACTORY_V11 = '0xba5ed110efdba3d005bfc882d75358acbbb85842' as const;

export class WalletConfigError extends Error {
  override name = 'WalletConfigError';
}

export async function toCryoShieldSmartAccount(p: {
  client: PublicClient;
  /** contracts.wallets[VITE_RP_ID].factory from the deployment record. */
  factory: Address;
  /** Every owner, in blob entry order (owner index == entry index). */
  owners: readonly WebAuthnAccount[];
  ownerIndex: number;
  nonce?: bigint;
  /** A deployed account's address (existing vault): no factory read. */
  address?: Address;
}) {
  const nonce = p.nonce ?? 0n;
  if (p.owners.length === 0 || p.owners.length > MAX_OWNERS) {
    throw new WalletConfigError(`an account has 1 to ${MAX_OWNERS} owners (got ${p.owners.length})`);
  }
  for (const o of p.owners) {
    if (typeof o !== 'object' || o.type !== 'webAuthn' || o.publicKey.length !== 2 + 128) {
      throw new WalletConfigError('owners must be P-256 (WebAuthn) public keys');
    }
  }
  if (!Number.isInteger(p.ownerIndex) || p.ownerIndex < 0 || p.ownerIndex >= p.owners.length) {
    throw new WalletConfigError(`owner index ${p.ownerIndex} is out of range`);
  }
  const factory = getAddress(p.factory);
  if (factory.toLowerCase() === COINBASE_FACTORY_V11) throw new WalletConfigError('the Coinbase factory is not a CryoShield factory');
  const ownerBytes = p.owners.map((o) => o.publicKey as Hex);
  const address =
    p.address ??
    ((await p.client.readContract({ address: factory, abi: walletFactoryAbi, functionName: 'getAddress', args: [ownerBytes, nonce] })) as Address);

  const base = await toCoinbaseSmartAccount({ client: p.client, owners: p.owners, ownerIndex: p.ownerIndex, nonce, version: '1.1', address });
  const factoryData = encodeFunctionData({ abi: walletFactoryAbi, functionName: 'createAccount', args: [ownerBytes, nonce] });
  return {
    ...base,
    factory: { abi: walletFactoryAbi, address: factory },
    getNonce: (parameters?: { key?: bigint }) => base.getNonce({ ...parameters, key: 0n }),
    async getFactoryArgs() {
      if (await base.isDeployed()) return { factory: undefined, factoryData: undefined };
      return { factory, factoryData };
    },
  } as unknown as typeof base;
}
