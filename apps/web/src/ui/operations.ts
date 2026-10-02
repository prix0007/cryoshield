/**
 * Flow orchestration (non-visual): ties ceremonies, vault-crypto, sponsored writes and the mirror together.
 * Each function owns the PRF buffers it obtains and wipes them on every path.
 */
import { decodeVault, deriveLocator, VaultError } from '@cryoshield/vault-crypto';
import type { Hex } from 'viem';
import { enrollKey, evaluatePrf, KeyError, type EnrolledKey } from '../webauthn';
import { addKeyToBlob, createVaultBlob, editVaultBlob } from '../vault/adapter';
import type { SecretItem } from '../vault/payload';
import { existingVaultAccount, newVaultAccount } from '../account/account';
import { addKeyOnChain, createVaultOnChain, updateVaultOnChain, WriteError } from '../account/writes';
import { bytesEqual, toHex, wipe } from '../lib/bytes';
import { MirrorError } from '../mirror/mirror';
import type { Services } from './services';
import { ChainMismatchError } from '../chain/guard';
import { S } from './strings';

export interface PendingKey extends EnrolledKey {
  /** PRF output for vault creation; held in memory only until the vault is created, then wiped. */
  prf?: Uint8Array;
}

/** Enrollment: create (tap) + PRF (second tap unless returned at create). */
export async function enrollWithPrf(svc: Services, n: number, exclude: readonly Uint8Array[], onSecondTap?: () => void): Promise<PendingKey> {
  const key: PendingKey = await enrollKey({ rpId: svc.rpId, rpName: svc.rpName, label: `CryoShield vault (key ${n})`, exclude }, svc.credentials);
  if (!key.prf) {
    onSecondTap?.();
    const r = await evaluatePrf({ rpId: svc.rpId, credId: key.credId }, svc.credentials);
    key.prf = r.prf;
  }
  return key;
}

export interface VaultSession {
  vaultId: Hex;
  owner: Hex;
  version: number;
  blob: Uint8Array;
  items: SecretItem[];
  credIds: Uint8Array[];
}

export type MirrorStatus = 'pending' | 'saved' | 'failed';

export async function mirrorWrite(svc: Services, s: { vaultId: Hex; version: number; blob: Uint8Array; locators?: readonly Hex[] }): Promise<MirrorStatus> {
  try {
    let locators = s.locators ? [...s.locators] : [];
    try {
      const fromChain = await svc.reader.locatorsOf(s.vaultId);
      locators = [...new Set([...locators.map((l) => l.toLowerCase() as Hex), ...fromChain])];
    } catch {
      /* logs unavailable (RPC range limits): use what we know */
    }
    if (locators.length === 0) return 'failed';
    await svc.mirror.upload({ vaultId: s.vaultId, version: s.version, blob: s.blob, locators: locators.slice(0, 8) });
    return 'saved';
  } catch (e) {
    if (e instanceof MirrorError) return 'failed';
    return 'failed';
  }
}

export async function ensureMirror(svc: Services, s: { vaultId: Hex; version: number; blob: Uint8Array; locator: Hex }): Promise<MirrorStatus> {
  try {
    let locators: Hex[] = [s.locator];
    try {
      locators = [...new Set([s.locator.toLowerCase() as Hex, ...(await svc.reader.locatorsOf(s.vaultId))])];
    } catch {
      /* keep the known locator */
    }
    await svc.mirror.ensure({ vaultId: s.vaultId, version: s.version, blob: s.blob, locators: locators.slice(0, 8) });
    return 'saved';
  } catch {
    return 'failed';
  }
}

export async function saveNewVault(
  svc: Services,
  keys: PendingKey[],
  items: SecretItem[],
  onSign: () => void,
  onRetry: () => void = () => undefined,
): Promise<{ session: VaultSession; locators: Hex[] }> {
  let signerLocator: Uint8Array | undefined;
  try {
    if (keys.some((k) => !k.prf)) throw new KeyError('PRF_UNAVAILABLE');
    const owners = keys.map((k) => ({ credId: k.credId, publicKey: k.publicKey }));
    // Locators don't depend on the vaultId (empty-salt HKDF), so the signer's expected locator is known up front.
    signerLocator = deriveLocator(keys[0]!.prf!);
    const account = await newVaultAccount({ client: svc.client, owners, signerIndex: 0, expectedLocator: signerLocator, ...(svc.credentials ? { credentials: svc.credentials } : {}) });
    // The blob is bound to its vaultId: each attempt (a fresh id after VaultIdTaken) re-encrypts from the PRF outputs
    // held for this setup, so a retry costs one more signing touch, not a tap of every key.
    const build = async (vaultId: Hex) => {
      const r = await createVaultBlob({ vaultId, rpId: svc.rpId, keys: keys.map((k) => ({ credId: k.credId, prf: k.prf!.slice() })), items });
      return { blob: r.blob, locators: r.locators.map(toHex) };
    };
    const res = await createVaultOnChain({ account, build }, { client: svc.client, sponsor: svc.sponsor, reader: svc.reader, onSign, onRetry });
    return {
      session: { vaultId: res.vaultId, owner: res.owner, version: res.version, blob: res.blob, items, credIds: keys.map((k) => k.credId) },
      locators: res.locators,
    };
  } finally {
    wipe(signerLocator);
    for (const k of keys) wipe(k.prf);
  }
}

/** Edit: PRF tap with any key of this vault, re-encrypt payload, sign tap with the same key. */
export async function saveEdit(svc: Services, s: VaultSession, items: SecretItem[], onSign: () => void): Promise<VaultSession> {
  const { credId, prf } = await evaluatePrf({ rpId: svc.rpId }, svc.credentials);
  let locator: Uint8Array | undefined;
  try {
    const entryIndex = decodeVault(s.blob).entries.findIndex((e) => bytesEqual(e.credId, credId));
    if (entryIndex < 0) throw new KeyError('WRONG_KEY', 'not in vault');
    locator = deriveLocator(prf);
    const blob = await editVaultBlob(s.blob, prf, s.vaultId, items); // wipes prf
    const account = await existingVaultAccount({ client: svc.client, address: s.owner, entryIndex, credId, expectedLocator: locator, ...(svc.credentials ? { credentials: svc.credentials } : {}) });
    const res = await updateVaultOnChain({ account, vaultId: s.vaultId, blob }, { client: svc.client, sponsor: svc.sponsor, reader: svc.reader, onSign });
    return { ...s, version: res.version, blob, items };
  } finally {
    wipe(prf, locator);
  }
}

/** Add key: PRF tap (current key) -> enroll new key (+PRF tap) -> addKey -> sign tap (current key). */
export async function saveAddKey(
  svc: Services,
  s: VaultSession,
  steps: { onInsertNew: () => void | Promise<void>; onNewAgain: () => void; onSign: () => void | Promise<void> },
): Promise<{ session: VaultSession; newLocator: Hex }> {
  const current = await evaluatePrf({ rpId: svc.rpId }, svc.credentials);
  let locator: Uint8Array | undefined;
  let fresh: PendingKey | undefined;
  try {
    const decoded = decodeVault(s.blob);
    const entryIndex = decoded.entries.findIndex((e) => bytesEqual(e.credId, current.credId));
    if (entryIndex < 0) throw new KeyError('WRONG_KEY', 'not in vault');
    locator = deriveLocator(current.prf);
    await steps.onInsertNew();
    fresh = await enrollWithPrf(svc, decoded.keyCount + 1, decoded.entries.map((e) => e.credId), steps.onNewAgain);
    const added = await addKeyToBlob(s.blob, current.prf, s.vaultId, { credId: fresh.credId, prf: fresh.prf! }); // wipes both
    const account = await existingVaultAccount({ client: svc.client, address: s.owner, entryIndex, credId: current.credId, expectedLocator: locator, ...(svc.credentials ? { credentials: svc.credentials } : {}) });
    const res = await addKeyOnChain(
      { account, vaultId: s.vaultId, blob: added.blob, newLocator: toHex(added.locator), newPublicKey: fresh.publicKey, keyCountBefore: decoded.keyCount },
      { client: svc.client, sponsor: svc.sponsor, reader: svc.reader, onSign: steps.onSign },
    );
    return {
      session: { ...s, version: res.version, blob: added.blob, credIds: [...s.credIds, fresh.credId] },
      newLocator: toHex(added.locator),
    };
  } finally {
    wipe(current.prf, locator, fresh?.prf);
  }
}

/** Plain-language message for any failure. Never includes secret material. */
export function messageFor(e: unknown): string {
  if (e instanceof ChainMismatchError) return S.wrongNetwork;
  if (e instanceof KeyError) {
    if (e.code === 'WRONG_KEY' && e.message === 'not in vault') return S.edit.notInVault;
    return S.keyErrors[e.code] ?? S.save.nothingSaved;
  }
  if (e instanceof WriteError) {
    switch (e.code) {
      case 'SPONSORSHIP_REFUSED':
        return S.save.paused;
      case 'LOCATOR_FULL':
        return S.create.freshKeys;
      case 'TOO_MANY_KEYS':
        return S.save.tooMany;
      case 'TOO_LARGE':
        return S.save.tooLarge;
      case 'NOT_CONFIRMED':
        return S.save.notConfirmed;
      case 'KEY':
        return e.detail.keyError ? (S.keyErrors[e.detail.keyError.code] ?? S.save.nothingSaved) : S.save.nothingSaved;
      default:
        return S.save.nothingSaved;
    }
  }
  if (e instanceof VaultError) {
    if (e.code === 'VAULT_TOO_LARGE') return S.save.tooLarge;
    if (e.code === 'TOO_MANY_KEYS') return S.save.tooMany;
    return S.save.nothingSaved;
  }
  return S.save.nothingSaved;
}
