/**
 * Vault operations (spec §6-§8). Every function that receives PRF outputs
 * zeroizes them, plus every derived key, data key and share, in `finally`.
 */
import { unseal, seal } from './aead.js';
import { ascii, concat, equalPublic, wipe } from './bytes.js';
import {
  KEY_BYTES,
  MAX_KEYS,
  MIN_KEYS,
  MODE_ANY_OF_N,
  MODE_SHAMIR,
  NONCE_BYTES,
  WRAP_SALT_BYTES,
  type VaultMode,
} from './constants.js';
import { assertPrf, deriveLocator, deriveWrapKey } from './derive.js';
import { VaultError } from './errors.js';
import {
  assertCredIds,
  assertVaultId,
  decodeVault,
  fixedHeader,
  maxPayloadForBytes,
  payloadAad,
  rpIdBytes,
  wrapAad,
  type DecodedVault,
} from './format.js';
import { pad, unpad } from './padding.js';
import { webCryptoRng, type Rng } from './rng.js';
import { combineShares, splitKey } from './shamir.js';

/** An enrolled credential at creation time: its credential ID and its PRF output (32 bytes). */
export interface Credential {
  id: Uint8Array;
  prf: Uint8Array;
}

/** A key presented for unlocking. `credId` (optional) limits which entries are tried. */
export interface UnlockKey {
  prf: Uint8Array;
  credId?: Uint8Array | undefined;
}

export interface CreateVaultParams {
  /**
   * 32-byte, non-zero on-chain vaultId the blob will be registered under (client-chosen;
   * see the registry). Bound into every AAD; NOT stored in the blob. If registration
   * reverts (vaultId taken), create again under a fresh vaultId.
   */
  vaultId: Uint8Array;
  rpId: string;
  /** In enrollment order; 2..8 keys. */
  credentials: readonly Credential[];
  /** Plaintext secret, 1..maxPayloadBytes bytes. Not wiped by the library. */
  secret: Uint8Array;
  /** Default MODE_ANY_OF_N. MODE_SHAMIR is experimental. */
  mode?: VaultMode;
  /** Mode 0x02 only: M (2..N). Ignored/must be 1 in mode 0x01. */
  threshold?: number;
}

export interface RngOptions {
  /** Defaults to WebCrypto. Inject only for tests/vectors. */
  rng?: Rng;
}

export interface CreateVaultResult {
  blob: Uint8Array;
  /** One 32-byte locator per credential, in input order. */
  locators: Uint8Array[];
}

/** A blob together with the vaultId it was read under (registry key or Arweave `CryoShield-Vault-Id` tag). */
export interface VaultCandidate {
  vaultId: Uint8Array;
  blob: Uint8Array;
}

export interface SelectVaultResult {
  /** Index of the selected candidate. */
  index: number;
  /** The selected candidate's vaultId: use it for every later update. */
  vaultId: Uint8Array;
  secret: Uint8Array;
}

export interface AddKeyResult {
  blob: Uint8Array;
  /** Locator of the new key; register it on chain. */
  locator: Uint8Array;
}

const prfsOf = (keys: readonly { prf?: unknown }[] | undefined): Uint8Array[] =>
  (keys ?? []).map((k) => k?.prf).filter((p): p is Uint8Array => p instanceof Uint8Array);

const toKeyList = (keys: UnlockKey | readonly UnlockKey[]): readonly UnlockKey[] => (Array.isArray(keys) ? keys : [keys as UnlockKey]);

function assertSecret(secret: unknown): asserts secret is Uint8Array {
  if (!(secret instanceof Uint8Array) || secret.length === 0) {
    throw new VaultError('INVALID_ARGUMENT', { hint: 'secret must be a non-empty Uint8Array' });
  }
}

function draw(rng: Rng, n: number): Uint8Array {
  const b = rng.randomBytes(n);
  if (!(b instanceof Uint8Array) || b.length !== n) throw new Error('RNG returned wrong length');
  return b;
}

/**
 * Draws a payload nonce for re-encryption under an EXISTING data key and
 * refuses one equal to the blob's current nonce (GCM nonce reuse under the
 * same key would leak the XOR of plaintexts and allow forgeries).
 */
function drawFreshPayloadNonce(rng: Rng, current: Uint8Array): Uint8Array {
  const nonce = draw(rng, NONCE_BYTES);
  if (equalPublic(nonce, current)) throw new Error('RNG repeated the payload nonce; refusing to reuse it under the same data key');
  return nonce;
}

interface Opened {
  secret: Uint8Array;
  dataKey: Uint8Array;
  vault: DecodedVault;
}

/** Decode + unwrap + decrypt. Does not wipe caller PRFs; caller wipes secret/dataKey. */
async function openCore(blob: Uint8Array, keys: readonly UnlockKey[], vaultId: Uint8Array): Promise<Opened> {
  assertVaultId(vaultId);
  const v = decodeVault(blob);
  if (keys.length === 0) throw new VaultError('NO_MATCHING_KEY');
  for (const k of keys) assertPrf(k?.prf);
  const rp = ascii(v.rpId);
  const unwrapped = new Map<number, Uint8Array>();
  let dataKey: Uint8Array | null = null;
  try {
    for (const k of keys) {
      const wk = deriveWrapKey(k.prf, v.wrapSalt);
      try {
        for (let i = 0; i < v.entries.length; i++) {
          const e = v.entries[i]!;
          if (k.credId !== undefined && !equalPublic(k.credId, e.credId)) continue;
          if (unwrapped.has(i)) continue;
          const pt = unseal(wk, e.wrapNonce, wrapAad(v.mode, rp, v.wrapSalt, vaultId, i, e.credId), e.wrapped);
          if (pt) {
            unwrapped.set(i, pt);
            if (v.mode === MODE_ANY_OF_N) break;
          }
        }
      } finally {
        wipe(wk);
      }
      if (v.mode === MODE_ANY_OF_N && unwrapped.size > 0) break;
    }
    if (unwrapped.size === 0) throw new VaultError('NO_MATCHING_KEY');
    if (v.mode === MODE_ANY_OF_N) {
      dataKey = [...unwrapped.values()][0]!.slice();
    } else {
      if (unwrapped.size < v.threshold) throw new VaultError('INSUFFICIENT_SHARES');
      const chosen = [...unwrapped.keys()].sort((a, b) => a - b).slice(0, v.threshold);
      dataKey = await combineShares(chosen.map((i) => unwrapped.get(i)!));
    }
    if (dataKey.length !== KEY_BYTES) throw new VaultError('MALFORMED');
    const padded = unseal(dataKey, v.payloadNonce, payloadAad(blob.subarray(0, v.payloadOffset), vaultId), v.payloadCt);
    if (!padded) throw new VaultError('AUTH_FAILED');
    try {
      const secret = unpad(padded);
      const out: Opened = { secret, dataKey, vault: v };
      dataKey = null; // ownership moves to caller
      return out;
    } finally {
      wipe(padded);
    }
  } finally {
    wipe(dataKey, ...unwrapped.values());
  }
}

/**
 * Creates a vault. Mode 0x01 (default): any single key unlocks. Mode 0x02
 * (experimental): Shamir M-of-N. Wipes every credential's PRF buffer.
 */
/**
 * Two credentials with identical PRF outputs are one key enrolled twice (their locators are equal):
 * a vault created that way would only *appear* to have a backup key. Refused with INVALID_ARGUMENT
 * (security audit 2026-10, REC-L2).
 */
function assertDistinctPrfs(prfs: readonly Uint8Array[]): void {
  const seen = new Set<string>();
  for (const p of prfs) {
    const key = Array.from(p, (b) => b.toString(16).padStart(2, '0')).join('');
    if (seen.has(key)) throw new VaultError('INVALID_ARGUMENT', { hint: 'two credentials have the same PRF output' });
    seen.add(key);
  }
}

export async function createVault(params: CreateVaultParams, options: RngOptions = {}): Promise<CreateVaultResult> {
  const prfs = prfsOf(params?.credentials);
  let dataKey: Uint8Array | null = null;
  let plaintexts: Uint8Array[] = [];
  let padded: Uint8Array | null = null;
  try {
    const { vaultId, rpId, credentials, secret } = params;
    const mode = params.mode ?? MODE_ANY_OF_N;
    const n = credentials?.length ?? 0;
    if (n < MIN_KEYS) throw new VaultError('TOO_FEW_KEYS');
    if (n > MAX_KEYS) throw new VaultError('TOO_MANY_KEYS');
    assertVaultId(vaultId);
    if (mode !== MODE_ANY_OF_N && mode !== MODE_SHAMIR) throw new VaultError('INVALID_ARGUMENT', { hint: 'unknown mode' });
    const m = mode === MODE_ANY_OF_N ? (params.threshold ?? 1) : (params.threshold ?? -1);
    if (!Number.isInteger(m) || (mode === MODE_ANY_OF_N ? m !== 1 : m < 2 || m > n)) {
      throw new VaultError('INVALID_ARGUMENT', { hint: 'invalid threshold' });
    }
    const rp = rpIdBytes(rpId);
    const ids = credentials.map((c) => c?.id);
    assertCredIds(ids);
    for (const c of credentials) assertPrf(c.prf);
    assertDistinctPrfs(credentials.map((c) => c.prf));
    assertSecret(secret);
    const max = maxPayloadForBytes(rp, ids, mode);
    if (secret.length > max) throw new VaultError('VAULT_TOO_LARGE', { maxPayloadBytes: max });

    const rng = options.rng ?? webCryptoRng;
    const wrapSalt = draw(rng, WRAP_SALT_BYTES);
    dataKey = draw(rng, KEY_BYTES);
    plaintexts = mode === MODE_ANY_OF_N ? credentials.map(() => dataKey!.slice()) : await splitKey(dataKey, n, m);

    const parts: Uint8Array[] = [fixedHeader(mode, m, n, rp, wrapSalt)];
    for (let i = 0; i < n; i++) {
      const c = credentials[i]!;
      const nonce = draw(rng, NONCE_BYTES);
      const wk = deriveWrapKey(c.prf, wrapSalt);
      try {
        parts.push(Uint8Array.of(c.id.length), c.id, nonce, seal(wk, nonce, wrapAad(mode, rp, wrapSalt, vaultId, i, c.id), plaintexts[i]!));
      } finally {
        wipe(wk);
      }
    }
    const body = concat(...parts);
    const payloadNonce = draw(rng, NONCE_BYTES);
    padded = pad(secret);
    const blob = concat(body, payloadNonce, seal(dataKey, payloadNonce, payloadAad(body, vaultId), padded));
    const locators = credentials.map((c) => deriveLocator(c.prf));
    return { blob, locators };
  } finally {
    wipe(dataKey, padded, ...plaintexts, ...prfs);
  }
}

/**
 * Opens a vault with one key (mode 0x01) or at least M keys (mode 0x02), under
 * the vaultId the blob was read from. A blob under any other vaultId (a clone)
 * fails with NO_MATCHING_KEY. Returns the secret. Wipes every supplied PRF buffer.
 */
export async function openVault(
  blob: Uint8Array,
  keys: UnlockKey | readonly UnlockKey[],
  vaultId: Uint8Array,
): Promise<Uint8Array> {
  const list = toKeyList(keys);
  try {
    const { secret, dataKey } = await openCore(blob, list, vaultId);
    wipe(dataKey);
    return secret;
  } finally {
    wipe(...prfsOf(list));
  }
}

/**
 * Squatting-tolerant lookup (spec §8). Tries `candidates` ({ vaultId, blob }
 * pairs) in the given order (the on-chain index order) and returns the FIRST
 * one that opens completely with this PRF output under its own vaultId,
 * together with its `index` and `vaultId`. Malformed or forged candidates, and
 * blobs cloned under a foreign vaultId, are skipped silently. Later candidates are not tried,
 * so if the same key legitimately opens several vaults (duplicates), only the
 * first is returned, and the caller (frontend) decides how to handle duplicates.
 * Wipes `prf`, on success and on failure.
 */
export async function selectVault(candidates: readonly VaultCandidate[], prf: Uint8Array): Promise<SelectVaultResult> {
  try {
    assertPrf(prf);
    for (let i = 0; i < (candidates?.length ?? 0); i++) {
      try {
        const c = candidates[i];
        const { secret, dataKey } = await openCore(c?.blob as Uint8Array, [{ prf }], c?.vaultId as Uint8Array);
        wipe(dataKey);
        return { index: i, vaultId: c!.vaultId.slice(), secret };
      } catch (e) {
        if (!(e instanceof VaultError)) throw e;
      }
    }
    throw new VaultError('NO_MATCHING_VAULT');
  } finally {
    wipe(prf);
  }
}

/**
 * Adds a key to a mode 0x01 vault using ONE enrolled key (spec §6.6). Existing
 * entries are copied byte for byte; the payload is re-encrypted under the same
 * data key with a fresh nonce. Wipes both PRF buffers.
 */
export async function addKey(
  blob: Uint8Array,
  existingKey: UnlockKey,
  vaultId: Uint8Array,
  newCredential: Credential,
  options: RngOptions = {},
): Promise<AddKeyResult> {
  let opened: Opened | null = null;
  let padded: Uint8Array | null = null;
  let wk: Uint8Array | null = null;
  try {
    assertVaultId(vaultId);
    const v = decodeVault(blob);
    if (v.mode !== MODE_ANY_OF_N) throw new VaultError('INVALID_ARGUMENT', { hint: 'addKey supports mode 0x01 only' });
    const n = v.keyCount + 1;
    if (n > MAX_KEYS) throw new VaultError('TOO_MANY_KEYS');
    const ids = [...v.entries.map((e) => e.credId), newCredential?.id];
    assertCredIds(ids);
    assertPrf(newCredential.prf);
    opened = await openCore(blob, [existingKey], vaultId);
    const rp = ascii(v.rpId);
    const max = maxPayloadForBytes(rp, ids as Uint8Array[], v.mode);
    if (opened.secret.length > max) throw new VaultError('VAULT_TOO_LARGE', { maxPayloadBytes: max });

    const rng = options.rng ?? webCryptoRng;
    const nonce = draw(rng, NONCE_BYTES);
    wk = deriveWrapKey(newCredential.prf, v.wrapSalt);
    const wrapped = seal(wk, nonce, wrapAad(v.mode, rp, v.wrapSalt, vaultId, n - 1, newCredential.id), opened.dataKey);
    const body = concat(
      fixedHeader(v.mode, v.threshold, n, rp, v.wrapSalt),
      blob.subarray(v.headerLength, v.payloadOffset),
      Uint8Array.of(newCredential.id.length),
      newCredential.id,
      nonce,
      wrapped,
    );
    const payloadNonce = drawFreshPayloadNonce(rng, v.payloadNonce);
    padded = pad(opened.secret);
    const out = concat(body, payloadNonce, seal(opened.dataKey, payloadNonce, payloadAad(body, vaultId), padded));
    return { blob: out, locator: deriveLocator(newCredential.prf) };
  } finally {
    wipe(wk, padded, opened?.dataKey, opened?.secret, existingKey?.prf, newCredential?.prf);
  }
}

/**
 * Replaces the secret (spec §6.7): same data key, fresh payload nonce, header
 * and entries unchanged. One key in mode 0x01, M keys in mode 0x02. Wipes PRFs.
 */
export async function updatePayload(
  blob: Uint8Array,
  keys: UnlockKey | readonly UnlockKey[],
  vaultId: Uint8Array,
  newSecret: Uint8Array,
  options: RngOptions = {},
): Promise<Uint8Array> {
  const list = toKeyList(keys);
  let opened: Opened | null = null;
  let padded: Uint8Array | null = null;
  try {
    opened = await openCore(blob, list, vaultId);
    assertSecret(newSecret);
    const v = opened.vault;
    const max = maxPayloadForBytes(ascii(v.rpId), v.entries.map((e) => e.credId), v.mode);
    if (newSecret.length > max) throw new VaultError('VAULT_TOO_LARGE', { maxPayloadBytes: max });
    const rng = options.rng ?? webCryptoRng;
    const payloadNonce = drawFreshPayloadNonce(rng, v.payloadNonce);
    const body = blob.slice(0, v.payloadOffset);
    padded = pad(newSecret);
    return concat(body, payloadNonce, seal(opened.dataKey, payloadNonce, payloadAad(body, vaultId), padded));
  } finally {
    wipe(padded, opened?.dataKey, opened?.secret, ...prfsOf(list));
  }
}
