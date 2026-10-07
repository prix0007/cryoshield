/**
 * Flow orchestration (non-visual): ties ceremonies, vault-crypto, sponsored writes and the mirror together.
 * Each function owns the PRF buffers it obtains and wipes them on every path.
 */
import { decodeVault, deriveLocator, VaultError } from '@cryoshield/vault-crypto';
import type { Hex } from 'viem';
import { credentialLabel, enrollKey, ENROLL, evaluatePrf, KeyError, type EnrolledKey } from '../webauthn';
import { addKeyToBlob, createVaultBlob, editVaultBlob } from '../vault/adapter';
import { payloadOf, withItems, type PayloadErrorCode, type SecretItem, type VaultPayloadInput } from '../vault/payload';
import type { RegistryVersion } from '../vault/adapter';
import { notify, WriteError, type ProgressListener } from '../account/errors';
import { loadWriteStack } from '../account/lazy';
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
  const key: PendingKey = await enrollKey({ rpId: svc.rpId, rpName: svc.rpName, label: credentialLabel(n), exclude }, svc.credentials);
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
  /** Payload v2 (vault-list-labels-archive): every write keeps these unless the user changes them (2.1). */
  name?: string;
  archived: boolean;
  /** Payload v2 `z`, only while a cleared vault has no items. */
  pad?: string;
  /** Decrypted but not displayable (made by a newer version, or malformed): listed, never opened or written. */
  payloadError?: PayloadErrorCode;
  /** The locator of the key that opened it (public; used for the Arweave copy). */
  locator?: Hex;
  credIds: Uint8Array[];
  /** Where the vault lives. 'v1' (legacy testnet) is read-only: clients never write to VaultRegistry v1. */
  registry: RegistryVersion;
  /**
   * show-vault-onchain-location D2: the last save's transaction, tagged with the version it produced (shown only while
   * that is still the current version). Never looked up after a plain unlock. The Arweave item lives in App state.
   */
  lastSave?: { version: number; txHash: Hex };
}

/** The Arweave copy this session uploaded or byte-verified, for one version of one vault (public). */
export interface MirrorItem {
  version: number;
  id: string;
}

const lastSaveOf = (r: { version: number; txHash?: Hex }) => (r.txHash ? { lastSave: { version: r.version, txHash: r.txHash } } : {});


/** The session after a write of payload `p`. */
export function withPayload(s: VaultSession, p: VaultPayloadInput, r: { version: number; txHash?: Hex }, blob: Uint8Array): VaultSession {
  const next: VaultSession = { ...s, ...payloadOf(p), version: r.version, blob, ...lastSaveOf(r) };
  if (p.name === undefined) delete next.name;
  if (p.pad === undefined) delete next.pad;
  if (!r.txHash) delete next.lastSave;
  return next;
}

/** harden-gas-sponsorship: only VaultRegistry v2 vaults can be edited or given a new key. */
export const isReadOnly = (s: Pick<VaultSession, 'registry'>) => s.registry === 'v1';

export type MirrorStatus = 'pending' | 'saved' | 'failed';
/** fix-arweave-mirror-status D3: the outcome plus, when known, the Arweave item id or a sanitized failure reference. */
export interface MirrorResult {
  status: 'saved' | 'failed';
  itemId?: string;
  ref?: string;
}

/** `CODE · HTTP nnn · step`: no URLs, keys or contents (same rule as the write-failure reference). */
function mirrorRef(e: unknown): string {
  if (e instanceof MirrorError) return [e.code, ...(e.status ? [`HTTP ${e.status}`] : []), e.step].join(' · ');
  return 'UPLOAD_FAILED · upload';
}

export async function mirrorWrite(svc: Services, s: { vaultId: Hex; version: number; blob: Uint8Array; locators?: readonly Hex[]; registry?: RegistryVersion }): Promise<MirrorResult> {
  // Locators we already know (creation, the unlocking key) come first; chain logs can only add more. A log failure
  // (e.g. public-RPC eth_getLogs range limits) never prevents the upload (fix-arweave-mirror-status D2).
  let locators = s.locators ? [...new Set(s.locators.map((l) => l.toLowerCase() as Hex))] : [];
  try {
    const fromChain = await svc.reader.locatorsOf(s.vaultId, s.registry ?? 'v2');
    locators = [...new Set([...locators, ...fromChain.map((l) => l.toLowerCase() as Hex)])];
  } catch {
    /* logs unavailable: use what we know */
  }
  if (locators.length === 0) return { status: 'failed', ref: 'NO_LOCATORS · lookup' };
  try {
    const itemId = await svc.mirror.upload({ vaultId: s.vaultId, version: s.version, blob: s.blob, locators: locators.slice(0, 8) });
    return { status: 'saved', itemId };
  } catch (e) {
    return { status: 'failed', ref: mirrorRef(e) };
  }
}

export async function ensureMirror(svc: Services, s: { vaultId: Hex; version: number; blob: Uint8Array; locator: Hex; registry?: RegistryVersion }): Promise<MirrorResult> {
  let locators: Hex[] = [s.locator.toLowerCase() as Hex];
  try {
    locators = [...new Set([...locators, ...(await svc.reader.locatorsOf(s.vaultId, s.registry ?? 'v2')).map((l) => l.toLowerCase() as Hex)])];
  } catch {
    /* keep the known locator */
  }
  try {
    const { id } = await svc.mirror.ensure({ vaultId: s.vaultId, version: s.version, blob: s.blob, locators: locators.slice(0, 8) });
    return { status: 'saved', itemId: id };
  } catch (e) {
    return { status: 'failed', ref: mirrorRef(e) };
  }
}

export async function saveNewVault(
  svc: Services,
  keys: PendingKey[],
  items: SecretItem[],
  onSign: () => void,
  onProgress?: ProgressListener,
  /** Optional vault name (D10: part of the one create write). */
  name?: string,
): Promise<{ session: VaultSession; locators: Hex[] }> {
  const payload: VaultPayloadInput = { archived: false, items, ...(name !== undefined ? { name } : {}) };
  let signerLocator: Uint8Array | undefined;
  try {
    if (keys.some((k) => !k.prf)) throw new KeyError('PRF_UNAVAILABLE');
    const { newVaultAccount, createVaultOnChain } = await loadWriteStack(); // lazy chunk; LOAD_FAILED before any tap
    const owners = keys.map((k) => ({ credId: k.credId, publicKey: k.publicKey }));
    // Locators don't depend on the vaultId (empty-salt HKDF), so the signer's expected locator is known up front.
    signerLocator = deriveLocator(keys[0]!.prf!);
    const account = await newVaultAccount({ client: svc.client, owners, signerIndex: 0, expectedLocator: signerLocator, ...(svc.credentials ? { credentials: svc.credentials } : {}) });
    // The blob is bound to its vaultId, which VaultRegistry v2 derives from the account address and a fresh salt; the
    // write computes it, then this encrypts under it from the PRF outputs held for this setup.
    const build = async (vaultId: Hex) => {
      const r = await createVaultBlob({ vaultId, rpId: svc.rpId, keys: keys.map((k) => ({ credId: k.credId, prf: k.prf!.slice() })), payload });
      return { blob: r.blob, locators: r.locators.map(toHex) };
    };
    const res = await createVaultOnChain({ account, build }, { client: svc.client, sponsor: svc.sponsor, reader: svc.reader, onSign, ...(onProgress ? { onProgress } : {}) });
    return {
      session: { vaultId: res.vaultId, owner: res.owner, version: res.version, blob: res.blob, ...payloadOf(payload), credIds: keys.map((k) => k.credId), registry: 'v2', ...lastSaveOf(res) },
      locators: res.locators,
    };
  } finally {
    wipe(signerLocator);
    for (const k of keys) wipe(k.prf);
  }
}

/**
 * One update of an existing vault: the staleness check (D8, before any key tap), a PRF tap with any key of this vault,
 * `build` re-encrypts (and wipes the PRF it is given), then the sign tap with the same key. `updateVaultOnChain`
 * re-checks staleness right before signing.
 */
/** The update path the lazily loaded name/archive writes run on (vault-meta.ts gets it passed in). */
export type WritePath = { rewrite: typeof rewrite; withPayload: typeof withPayload };

export async function rewrite(svc: Services, s: VaultSession, build: (prf: Uint8Array) => Promise<Uint8Array>, onSign: () => void, onProgress?: ProgressListener) {
  if (isReadOnly(s)) throw new WriteError('READ_ONLY');
  const { assertCurrent, existingVaultAccount, updateVaultOnChain } = await loadWriteStack(); // before the PRF tap: a failed load wastes no tap
  await assertCurrent(svc.reader, s.vaultId, s.blob);
  const { credId, prf } = await evaluatePrf({ rpId: svc.rpId }, svc.credentials);
  let locator: Uint8Array | undefined;
  try {
    const entryIndex = decodeVault(s.blob).entries.findIndex((e) => bytesEqual(e.credId, credId));
    if (entryIndex < 0) throw new KeyError('WRONG_KEY', 'not in vault');
    locator = deriveLocator(prf);
    const blob = await build(prf);
    notify(onProgress, 'encrypted');
    const account = await existingVaultAccount({ client: svc.client, address: s.owner, entryIndex, credId, expectedLocator: locator, ...(svc.credentials ? { credentials: svc.credentials } : {}) });
    const res = await updateVaultOnChain({ account, vaultId: s.vaultId, blob, base: s.blob }, { client: svc.client, sponsor: svc.sponsor, reader: svc.reader, onSign, ...(onProgress ? { onProgress } : {}) });
    return { res, blob };
  } finally {
    wipe(prf, locator);
  }
}

/** Edit secrets: keeps the name and the archived flag (2.1); drops `z` once there is an item. */
export async function saveEdit(svc: Services, s: VaultSession, items: SecretItem[], onSign: () => void, onProgress?: ProgressListener): Promise<VaultSession> {
  const payload = withItems(payloadOf(s), items);
  const { res, blob } = await rewrite(svc, s, (prf) => editVaultBlob(s.blob, prf, s.vaultId, payload), onSign, onProgress);
  return withPayload(s, payload, res, blob);
}

/** Add key: PRF tap (current key) -> enroll new key (+PRF tap) -> addKey -> sign tap (current key). */
export async function saveAddKey(
  svc: Services,
  s: VaultSession,
  steps: { onInsertNew: () => void | Promise<void>; onNewAgain: () => void; onSign: () => void | Promise<void>; onProgress?: ProgressListener },
): Promise<{ session: VaultSession; newLocator: Hex }> {
  if (isReadOnly(s)) throw new WriteError('READ_ONLY');
  const { assertCurrent, existingVaultAccount, addKeyOnChain } = await loadWriteStack(); // before the PRF tap: a failed load wastes no tap
  await assertCurrent(svc.reader, s.vaultId, s.blob);
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
    notify(steps.onProgress, 'encrypted');
    const account = await existingVaultAccount({ client: svc.client, address: s.owner, entryIndex, credId: current.credId, expectedLocator: locator, ...(svc.credentials ? { credentials: svc.credentials } : {}) });
    const res = await addKeyOnChain(
      { account, vaultId: s.vaultId, blob: added.blob, base: s.blob, newLocator: toHex(added.locator), newPublicKey: fresh.publicKey, keyCountBefore: decoded.keyCount },
      { client: svc.client, sponsor: svc.sponsor, reader: svc.reader, onSign: steps.onSign, ...(steps.onProgress ? { onProgress: steps.onProgress } : {}) },
    );
    return {
      session: { ...s, version: res.version, blob: added.blob, credIds: [...s.credIds, fresh.credId], ...lastSaveOf(res) },
      newLocator: toHex(added.locator),
    };
  } finally {
    wipe(current.prf, locator, fresh?.prf);
  }
}

/** Plain-language message for any failure. Never includes secret material. `create`: no vault exists yet. */
export function messageFor(e: unknown, context: 'create' | 'edit' = 'edit'): string {
  if (e instanceof ChainMismatchError) return S.wrongNetwork;
  if (e instanceof KeyError) {
    if (e.code === 'WRONG_KEY' && e.message === 'not in vault') return S.edit.notInVault;
    if (e.code === 'CANCELLED' && e.message === ENROLL) return S.enrollCancelled;
    return S.keyErrors[e.code] ?? S.save.nothingSaved;
  }
  if (e instanceof WriteError) {
    switch (e.code) {
      case 'SPONSORSHIP_REFUSED':
        return context === 'create' ? S.save.pausedCreate : S.save.paused;
      case 'READ_ONLY':
        return S.vault.legacyReadOnly;
      case 'TOO_MANY_KEYS':
        return S.save.tooMany;
      case 'TOO_LARGE':
        return S.save.tooLarge;
      case 'NOT_CONFIRMED':
        return S.save.notConfirmed;
      case 'LOAD_FAILED':
        return S.save.loadFailed;
      case 'STALE':
        return S.save.stale;
      case 'NONCE_CONFLICT':
        return S.save.nonceConflict;
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

/**
 * Non-secret error reference for the "Details" disclosure (improve-write-failure-feedback): our code plus the
 * bundler/paymaster JSON-RPC code and message. Sanitized: no URLs (the bundler URL carries the API key), no hex longer
 * than 8 characters (keys, signatures, PRF output, calldata, addresses), capped length. Displayed only, never sent.
 */
export function errorReference(e: unknown): string | undefined {
  if (!(e instanceof WriteError)) return undefined;
  const parts: string[] = [e.code];
  let cur: unknown = e.detail.cause;
  for (let i = 0; i < 10 && cur && typeof cur === 'object'; i++) {
    const c = cur as { code?: unknown; details?: unknown; shortMessage?: unknown; message?: unknown; cause?: unknown };
    if (typeof c.code === 'number') {
      const msg = typeof c.details === 'string' ? c.details : typeof c.shortMessage === 'string' ? c.shortMessage : '';
      parts.push(`RPC ${c.code}`);
      if (msg) parts.push(sanitize(msg));
      break;
    }
    cur = c.cause;
  }
  return parts.join(' · ').slice(0, 200);
}

function sanitize(s: string): string {
  return s
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/\b(api[-_]?key|apikey|token|key)=\S+/gi, '[redacted]')
    .replace(/\bpim_\w+/g, '[redacted]')
    .replace(/0x[0-9a-fA-F]{9,}/g, '0x…')
    .replace(/\b[0-9a-fA-F]{20,}\b/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
