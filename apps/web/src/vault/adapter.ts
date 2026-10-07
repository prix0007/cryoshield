/**
 * Thin adapter over @cryoshield/vault-crypto (design D7). No cryptography here: this only shapes inputs and
 * outputs and owns PRF-buffer hygiene. Every function wipes the PRF buffers it is given.
 */
import {
  addKey,
  createVault,
  decodeVault,
  maxPayloadBytes,
  MODE_ANY_OF_N,
  selectVault,
  updatePayload,
  VaultError,
} from '@cryoshield/vault-crypto';
import { bytesEqual, fromHex, toHex, wipe, type Hex } from '../lib/bytes';
import { ARCHIVE_RESERVE, writeVaultPayload, type VaultPayloadInput } from './payload';

export interface KeyPrf {
  credId: Uint8Array;
  prf: Uint8Array;
}

/** Which VaultRegistry a vault lives in: v2 takes every write; v1 is legacy and read-only (harden-gas-sponsorship). */
export type RegistryVersion = 'v1' | 'v2';

export interface Candidate {
  vaultId: Hex;
  blob: Uint8Array;
  owner: Hex;
  version: number;
  registry: RegistryVersion;
}

export interface Match {
  candidate: Candidate;
  /** Decrypted payload bytes (payload v1 or v2). Caller wipes after decoding. */
  secret: Uint8Array;
  /** Index of the unlocking credential in the blob's entry list (= smart-account owner index), or -1. */
  entryIndex: number;
}

/** The vault is cryptographically bound to its on-chain vaultId (wrap + payload AAD): a clone under another id never opens. */
export async function createVaultBlob(p: { vaultId: Hex; rpId: string; keys: readonly KeyPrf[]; payload: VaultPayloadInput }) {
  const secret = writeVaultPayload(p.payload);
  try {
    return await createVault({
      vaultId: fromHex(p.vaultId),
      rpId: p.rpId,
      mode: MODE_ANY_OF_N,
      credentials: p.keys.map((k) => ({ id: k.credId, prf: k.prf })),
      secret,
    });
  } finally {
    wipe(secret, ...p.keys.map((k) => k.prf));
  }
}

/**
 * Tries every candidate (bound to ITS on-chain vaultId) with its own copy of the PRF output, so one credential that
 * legitimately opens several vaults is detected (vault-crypto's selectVault returns only the first). Identical
 * (vaultId, blob) candidates are collapsed first. Clones under another vaultId fail to authenticate and are skipped.
 * Wipes `prf` and all copies.
 */
export async function matchCandidates(candidates: readonly Candidate[], prf: Uint8Array, credId: Uint8Array | undefined): Promise<Match[]> {
  const out: Match[] = [];
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const k = `${c.vaultId.toLowerCase()}:${toHex(c.blob)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  try {
    for (const candidate of unique) {
      const copy = prf.slice();
      try {
        const { secret } = await selectVault([{ vaultId: fromHex(candidate.vaultId), blob: candidate.blob }], copy);
        let entryIndex = -1;
        if (credId) entryIndex = decodeVault(candidate.blob).entries.findIndex((e) => bytesEqual(e.credId, credId));
        out.push({ candidate, secret, entryIndex });
      } catch (e) {
        if (!(e instanceof VaultError)) throw e;
      } finally {
        wipe(copy);
      }
    }
    return out;
  } finally {
    wipe(prf);
  }
}

/**
 * Re-encrypts a whole payload (vault-list-labels-archive 2.1): callers pass the session's payload with their change,
 * never items alone, so the name and the archived flag can't be dropped.
 */
export async function editVaultBlob(blob: Uint8Array, prf: Uint8Array, vaultId: Hex, payload: VaultPayloadInput): Promise<Uint8Array> {
  const secret = writeVaultPayload(payload);
  try {
    return await updatePayload(blob, { prf }, fromHex(vaultId), secret);
  } finally {
    wipe(secret, prf);
  }
}

export async function addKeyToBlob(blob: Uint8Array, existingPrf: Uint8Array, vaultId: Hex, newKey: KeyPrf) {
  try {
    return await addKey(blob, { prf: existingPrf }, fromHex(vaultId), { id: newKey.credId, prf: newKey.prf });
  } finally {
    wipe(existingPrf, newKey.prf);
  }
}

/** Space left (D11): counts the encoded name and, while active, reserves `"a":true,` so the vault can be archived. */
export function capacity(rpId: string, credIds: readonly Uint8Array[], payload: VaultPayloadInput) {
  const max = maxPayloadBytes(rpId, [...credIds], MODE_ANY_OF_N);
  let used: number;
  try {
    used = writeVaultPayload(payload).length + (payload.archived ? 0 : ARCHIVE_RESERVE);
  } catch {
    used = 0;
  }
  return { max, used, remaining: max - used, fits: used > 0 && used <= max };
}
