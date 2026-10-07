/**
 * Single-tap unlock (spec hardware-key-auth "Single-tap unlock ceremony"):
 * one PRF ceremony -> locator -> registry candidates (eth_call) -> vault-crypto selection -> payload v1 or v2.
 * No smart account, signature, or transaction is involved.
 */
import { deriveLocator } from '@cryoshield/vault-crypto';
import { evaluatePrf, type CredentialsApi } from '../webauthn';
import { matchCandidates, type RegistryVersion } from '../vault/adapter';
import { decodeVaultPayload, PayloadError, type SecretItem, type PayloadErrorCode, type VaultPayload } from '../vault/payload';
import { toHex, wipe, type Hex } from '../lib/bytes';
import type { RegistryReader } from './registry';

export class UnlockError extends Error {
  override name = 'UnlockError';
  constructor(readonly code: 'NO_VAULT') {
    super(code);
  }
}

export interface OpenedVault {
  vaultId: Hex;
  owner: Hex;
  version: number;
  blob: Uint8Array;
  /** Decrypted items, or null when the payload can't be shown (see payloadError). */
  items: SecretItem[] | null;
  /** Payload v2 (vault-list-labels-archive): the encrypted vault name, if any. */
  name?: string;
  /** Payload v2: archived vaults are listed, never opened automatically (D13). */
  archived: boolean;
  /** Payload v2 `z` (only after Archive and clear); kept so an unarchive keeps it. */
  pad?: string;
  payloadError?: PayloadErrorCode;
  /** Unlocking credential's index in the blob (= smart-account owner index). */
  entryIndex: number;
  /** The registry it was found in ('v1' is legacy and read-only). */
  registry: RegistryVersion;
}

export interface UnlockResult {
  credId: Uint8Array;
  locator: Uint8Array;
  /** Newest first (later index entries were appended later). Usually exactly one. */
  matches: OpenedVault[];
}

export async function unlock(
  params: { rpId: string },
  deps: { credentials?: CredentialsApi; reader: RegistryReader },
): Promise<UnlockResult> {
  const { credId, prf } = await evaluatePrf({ rpId: params.rpId }, deps.credentials);
  let locator: Uint8Array;
  try {
    locator = deriveLocator(prf);
  } catch (e) {
    wipe(prf);
    throw e;
  }
  let candidates;
  try {
    candidates = await deps.reader.candidatesFor(toHex(locator));
  } catch (e) {
    wipe(prf);
    throw e;
  }
  const matches = await matchCandidates(candidates, prf, credId); // wipes prf
  if (matches.length === 0) throw new UnlockError('NO_VAULT');
  const opened = matches.map((m): OpenedVault => {
    let p: VaultPayload | null = null;
    let payloadError: PayloadErrorCode | undefined;
    try {
      p = decodeVaultPayload(m.secret);
    } catch (e) {
      payloadError = e instanceof PayloadError ? e.code : 'MALFORMED';
    } finally {
      wipe(m.secret);
    }
    const o: OpenedVault = { ...m.candidate, items: p?.items ?? null, archived: p?.archived ?? false, entryIndex: m.entryIndex };
    if (p?.name !== undefined) o.name = p.name;
    if (p?.pad !== undefined) o.pad = p.pad;
    if (payloadError) o.payloadError = payloadError;
    return o;
  });
  return { credId, locator, matches: opened.reverse() };
}
