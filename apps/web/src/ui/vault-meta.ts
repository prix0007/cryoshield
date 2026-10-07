/**
 * Vault name, archive and Archive and clear writes (vault-list-labels-archive D4, D10). They ship in the lazily loaded
 * vault list chunk (with the Edit vault sheet), on top of the shared update path in operations.ts, which the caller
 * passes in (`ops`): importing operations.ts here would make this chunk share modules with the write stack, and the
 * bundler would then split the initial /app chunk (about +6 KB gzip).
 */
import { decodeVault, maxPayloadBytes, openVault, updatePayload } from '@cryoshield/vault-crypto';
import { editVaultBlob } from '../vault/adapter';
import { archiveAndClearPayload } from '../vault/payload-clear';
import { decodeVaultPayload, payloadOf, writeVaultPayload, type VaultPayload, type VaultPayloadInput } from '../vault/payload';
import { fromHex, wipe, type Hex } from '../lib/bytes';
import { WriteError, type ProgressListener } from '../account/errors';
import type { VaultSession, WritePath } from './operations';
import type { Services } from './services';

/**
 * Archive and clear (D4): decrypts the current payload (its exact length sizes `z`), writes the cleared one. Wipes prf.
 * Returns the new blob and the payload it holds.
 */
export async function clearVaultBlob(blob: Uint8Array, prf: Uint8Array, vaultId: Hex): Promise<{ blob: Uint8Array; payload: VaultPayload }> {
  const v = decodeVault(blob);
  const id = fromHex(vaultId);
  let prev: Uint8Array | undefined;
  let secret: Uint8Array | undefined;
  try {
    prev = await openVault(blob, { prf: prf.slice() }, id);
    secret = archiveAndClearPayload(prev, maxPayloadBytes(v.rpId, v.entries.map((e) => e.credId), v.mode));
    const payload = decodeVaultPayload(secret);
    return { blob: await updatePayload(blob, { prf: prf.slice() }, id, secret), payload };
  } finally {
    wipe(prf, prev, secret);
  }
}

/**
 * Edit vault (D10): the name and the archived flag in ONE update. Nothing changed: returns `s` and sends nothing. An
 * invalid name or a payload that can't fit is refused before any key tap.
 */
export async function saveVaultMeta(ops: WritePath, svc: Services, s: VaultSession, meta: { name?: string; archived: boolean }, onSign: () => void, onProgress?: ProgressListener): Promise<VaultSession> {
  if (meta.name === s.name && meta.archived === s.archived) return s;
  const payload: VaultPayloadInput = { ...payloadOf(s), archived: meta.archived };
  if (meta.name === undefined) delete payload.name;
  else payload.name = meta.name;
  if (writeVaultPayload(payload).length > maxPayloadBytes(svc.rpId, s.credIds)) throw new WriteError('TOO_LARGE');
  const { res, blob } = await ops.rewrite(svc, s, (prf) => editVaultBlob(s.blob, prf, s.vaultId, payload), onSign, onProgress);
  return ops.withPayload(s, payload, res, blob);
}

/** Archive and clear (D4): keeps the name and the blob length, no items, one update. */
export async function archiveAndClear(ops: WritePath, svc: Services, s: VaultSession, onSign: () => void, onProgress?: ProgressListener): Promise<VaultSession> {
  let payload: VaultPayloadInput | undefined;
  const { res, blob } = await ops.rewrite(svc, s, async (prf) => {
    const r = await clearVaultBlob(s.blob, prf, s.vaultId);
    payload = r.payload;
    return r.blob;
  }, onSign, onProgress);
  if (!payload) throw new WriteError('NOT_CONFIRMED'); // unreachable: the build step always sets it
  return ops.withPayload(s, payload, res, blob);
}

