/**
 * Key-owned smart account (spec sponsored-vault-writes "Key-owned smart account"; design D2).
 * Coinbase Smart Wallet v1.1 (EntryPoint v0.6) via viem. Owners are exactly the enrolled keys' P-256 public keys,
 * in blob credential order, so owner index i == blob entry i. Nothing is stored locally: for an existing vault,
 * the account address is the registry owner and the signer's public key is read back with ownerAtIndex(i).
 */
import { createPublicClient, type Hex, type PublicClient, type Transport } from 'viem';
import { toCoinbaseSmartAccount, toWebAuthnAccount, type WebAuthnAccount } from 'viem/account-abstraction';
import { config } from '../config';
import { chainOf, defaultTransport } from '../chain/registry';
import { prfCapturingGetFn, type CredentialsApi } from '../webauthn';
import { toBase64Url } from '../lib/bytes';
import { smartWalletAbi } from './policy';
import { ensureChain } from '../chain/guard';

export const CBSW_VERSION = '1.1' as const;

export function makePublicClient(transport: Transport = defaultTransport()): PublicClient {
  return createPublicClient({ chain: chainOf(), transport }) as PublicClient;
}

/** A WebAuthn owner whose signing ceremony also proves (via PRF/locator) that the expected key was tapped. */
export function webAuthnOwner(p: {
  credId: Uint8Array;
  publicKey: Hex;
  expectedLocator: Uint8Array;
  credentials?: CredentialsApi;
}): WebAuthnAccount {
  const getFn = prfCapturingGetFn({ expectedLocator: p.expectedLocator, ...(p.credentials ? { credentials: p.credentials } : {}) });
  return toWebAuthnAccount({
    credential: { id: toBase64Url(p.credId), publicKey: p.publicKey },
    getFn: getFn as never,
    rpId: config.rpId,
  });
}

/** A not-yet-deployed account for a new vault: all enrolled keys as owners, signing with `signerIndex`. */
export async function newVaultAccount(p: {
  client: PublicClient;
  owners: readonly { credId: Uint8Array; publicKey: Hex }[];
  signerIndex: number;
  expectedLocator: Uint8Array;
  credentials?: CredentialsApi;
}) {
  await ensureChain(p.client);
  const owners = p.owners.map((o, i) =>
    webAuthnOwner({
      credId: o.credId,
      publicKey: o.publicKey,
      // Only the signer's ceremony runs; others never sign.
      expectedLocator: i === p.signerIndex ? p.expectedLocator : new Uint8Array(32),
      ...(p.credentials ? { credentials: p.credentials } : {}),
    }),
  );
  return toCoinbaseSmartAccount({ client: p.client, owners, ownerIndex: p.signerIndex, version: CBSW_VERSION, nonce: 0n });
}

export class OwnerMismatchError extends Error {
  override name = 'OwnerMismatchError';
}

/** Reads the owner at `index` (64-byte P-256 x||y for WebAuthn owners). */
export async function ownerPublicKeyAt(client: PublicClient, account: Hex, index: number): Promise<Hex> {
  const owner = (await client.readContract({ address: account, abi: smartWalletAbi, functionName: 'ownerAtIndex', args: [BigInt(index)] })) as Hex;
  if (owner.length !== 2 + 128) throw new OwnerMismatchError(`owner ${index} is not a WebAuthn public key`);
  return owner;
}

/** The deployed account that owns an existing vault, signing with the key at blob entry `entryIndex`. */
export async function existingVaultAccount(p: {
  client: PublicClient;
  address: Hex;
  entryIndex: number;
  credId: Uint8Array;
  expectedLocator: Uint8Array;
  credentials?: CredentialsApi;
}) {
  await ensureChain(p.client);
  if (p.entryIndex < 0) throw new OwnerMismatchError('this key is not listed in the vault');
  const publicKey = await ownerPublicKeyAt(p.client, p.address, p.entryIndex);
  const signer = webAuthnOwner({
    credId: p.credId,
    publicKey,
    expectedLocator: p.expectedLocator,
    ...(p.credentials ? { credentials: p.credentials } : {}),
  });
  // owners[] is only used to compute the address/initCode of an undeployed account; this one is deployed and its
  // address is given, so every slot can hold the signer.
  const owners = Array.from({ length: p.entryIndex + 1 }, () => signer);
  return toCoinbaseSmartAccount({ client: p.client, owners, ownerIndex: p.entryIndex, address: p.address, version: CBSW_VERSION });
}

export { createPublicClient };
