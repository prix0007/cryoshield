/**
 * Byte layout of vault v1 (docs/spec/vault-format-v1.md §5). Pure encoding,
 * no cryptography. The decoder bounds-checks every field before reading it.
 */
import { ascii, concat, equalPublic } from './bytes.js';
import {
  FORMAT_VERSION,
  KEY_BYTES,
  MAGIC,
  MAX_BLOB_BYTES,
  MAX_CRED_ID_BYTES,
  MAX_KEYS,
  MAX_RP_ID_BYTES,
  MIN_KEYS,
  MODE_ANY_OF_N,
  MODE_SHAMIR,
  NONCE_BYTES,
  PAD_BLOCK,
  SHARE_BYTES,
  SUITE_HKDF_SHA256_AES256GCM,
  TAG_BYTES,
  VAULT_ID_BYTES,
  WRAP_SALT_BYTES,
  type VaultMode,
} from './constants.js';
import { VaultError } from './errors.js';

export interface VaultEntry {
  credId: Uint8Array;
  wrapNonce: Uint8Array;
  /** AES-GCM ciphertext + tag of the data key (48 B, mode 0x01) or of `x || y` share (49 B, mode 0x02). */
  wrapped: Uint8Array;
}

export interface VaultFields {
  mode: VaultMode;
  /** 1 in mode 0x01; M in mode 0x02. */
  threshold: number;
  rpId: string;
  wrapSalt: Uint8Array;
  entries: VaultEntry[];
  payloadNonce: Uint8Array;
  /** Ciphertext + tag of the padded payload (64k + 16 bytes). */
  payloadCt: Uint8Array;
}

export interface DecodedVault extends VaultFields {
  /** Length of the fixed header (magic through wrapSalt). */
  headerLength: number;
  /** Offset of payloadNonce = length of the payload AAD. */
  payloadOffset: number;
  /** Count N (= entries.length). */
  keyCount: number;
}

export const wrappedLength = (mode: VaultMode): number => (mode === MODE_ANY_OF_N ? KEY_BYTES : SHARE_BYTES) + TAG_BYTES;

const isVisibleAscii = (b: number): boolean => b >= 0x21 && b <= 0x7e;

/** Validates an RP ID string and returns its bytes. */
export function rpIdBytes(rpId: string): Uint8Array {
  if (typeof rpId !== 'string' || rpId.length < 1 || rpId.length > MAX_RP_ID_BYTES) {
    throw new VaultError('INVALID_ARGUMENT', { hint: 'rpId must be 1..64 visible ASCII characters' });
  }
  for (let i = 0; i < rpId.length; i++) {
    if (!isVisibleAscii(rpId.charCodeAt(i))) {
      throw new VaultError('INVALID_ARGUMENT', { hint: 'rpId must be 1..64 visible ASCII characters' });
    }
  }
  return ascii(rpId);
}

/** Validates credential IDs: 1..128 bytes each, pairwise distinct. */
export function assertCredIds(credIds: readonly Uint8Array[]): void {
  for (let i = 0; i < credIds.length; i++) {
    const c = credIds[i];
    if (!(c instanceof Uint8Array) || c.length < 1 || c.length > MAX_CRED_ID_BYTES) {
      throw new VaultError('INVALID_ARGUMENT', { hint: 'credential IDs must be 1..128 bytes' });
    }
    for (let j = 0; j < i; j++) {
      if (equalPublic(c, credIds[j]!)) throw new VaultError('INVALID_ARGUMENT', { hint: 'duplicate credential ID' });
    }
  }
}

export function fixedHeader(mode: VaultMode, threshold: number, count: number, rpId: Uint8Array, wrapSalt: Uint8Array): Uint8Array {
  return concat(MAGIC, Uint8Array.of(FORMAT_VERSION, SUITE_HKDF_SHA256_AES256GCM, mode, threshold, count, rpId.length), rpId, wrapSalt);
}

/**
 * Wrap AAD (spec §6.3): immutable header fields, the vault's vaultId, then the
 * entry's index and credential ID. Excludes N and M so entries can be appended
 * (addKey).
 */
export function wrapAad(
  mode: VaultMode,
  rpId: Uint8Array,
  wrapSalt: Uint8Array,
  vaultId: Uint8Array,
  index: number,
  credId: Uint8Array,
): Uint8Array {
  return concat(
    MAGIC,
    Uint8Array.of(FORMAT_VERSION, SUITE_HKDF_SHA256_AES256GCM, mode, rpId.length),
    rpId,
    wrapSalt,
    vaultId,
    Uint8Array.of(index, credId.length),
    credId,
  );
}

/** Payload AAD (spec §6.2): every blob byte before the payload nonce, then the vaultId. */
export function payloadAad(blobBeforePayload: Uint8Array, vaultId: Uint8Array): Uint8Array {
  return concat(blobBeforePayload, vaultId);
}

/** Spec §4.1: a vaultId is exactly 32 bytes and not all zeros (INVALID_ARGUMENT otherwise). */
export function assertVaultId(vaultId: unknown): asserts vaultId is Uint8Array {
  if (!(vaultId instanceof Uint8Array) || vaultId.length !== VAULT_ID_BYTES || vaultId.every((b) => b === 0)) {
    throw new VaultError('INVALID_ARGUMENT', { hint: 'vaultId must be 32 bytes and non-zero' });
  }
}

/** Bytes of a blob that are not secret payload (header, entries, nonce, tag). */
export function overheadBytes(rpId: Uint8Array, credIds: readonly Uint8Array[], mode: VaultMode): number {
  let n = 10 + rpId.length + WRAP_SALT_BYTES;
  for (const c of credIds) n += 1 + c.length + NONCE_BYTES + wrappedLength(mode);
  return n + NONCE_BYTES + TAG_BYTES;
}

/** Largest secret (bytes) that fits in a 1024-byte blob for these keys (spec §7). 0 if none fits. */
export function maxPayloadBytes(rpId: string, credIds: readonly Uint8Array[], mode: VaultMode = MODE_ANY_OF_N): number {
  if (mode !== MODE_ANY_OF_N && mode !== MODE_SHAMIR) throw new VaultError('INVALID_ARGUMENT', { hint: 'unknown mode' });
  assertCredIds(credIds);
  return maxPayloadForBytes(rpIdBytes(rpId), credIds, mode);
}

/**
 * Padded plaintext length every encoder writes for this key set (spec §6.1, §7): 64 * floor((1024 - overhead) / 64),
 * i.e. maxPayloadBytes + 2. Depends only on public data (RP ID, credential-ID lengths, N, mode). 0 if nothing fits.
 */
export function paddedLengthFor(rpId: Uint8Array, credIds: readonly Uint8Array[], mode: VaultMode): number {
  const avail = MAX_BLOB_BYTES - overheadBytes(rpId, credIds, mode);
  return Math.max(0, Math.floor(avail / PAD_BLOCK) * PAD_BLOCK);
}

export function maxPayloadForBytes(rpId: Uint8Array, credIds: readonly Uint8Array[], mode: VaultMode): number {
  return Math.max(0, paddedLengthFor(rpId, credIds, mode) - 2);
}

function validThreshold(mode: number, m: number, n: number): boolean {
  return mode === MODE_ANY_OF_N ? m === 1 : m >= 2 && m <= n;
}

/** Serializes fields. Validates every length; refuses blobs over 1024 bytes. */
export function encodeVault(v: VaultFields): Uint8Array {
  const rp = rpIdBytes(v.rpId);
  const n = v.entries.length;
  if (v.mode !== MODE_ANY_OF_N && v.mode !== MODE_SHAMIR) throw new VaultError('INVALID_ARGUMENT', { hint: 'unknown mode' });
  if (n < MIN_KEYS) throw new VaultError('TOO_FEW_KEYS');
  if (n > MAX_KEYS) throw new VaultError('TOO_MANY_KEYS');
  if (!Number.isInteger(v.threshold) || !validThreshold(v.mode, v.threshold, n)) {
    throw new VaultError('INVALID_ARGUMENT', { hint: 'invalid threshold' });
  }
  if (v.wrapSalt.length !== WRAP_SALT_BYTES) throw new VaultError('INVALID_ARGUMENT', { hint: 'wrap salt must be 32 bytes' });
  assertCredIds(v.entries.map((e) => e.credId));
  const wl = wrappedLength(v.mode);
  for (const e of v.entries) {
    if (e.wrapNonce.length !== NONCE_BYTES || e.wrapped.length !== wl) {
      throw new VaultError('INVALID_ARGUMENT', { hint: 'bad entry lengths' });
    }
  }
  if (v.payloadNonce.length !== NONCE_BYTES) throw new VaultError('INVALID_ARGUMENT', { hint: 'payload nonce must be 12 bytes' });
  const ctLen = v.payloadCt.length;
  if (ctLen < PAD_BLOCK + TAG_BYTES || (ctLen - TAG_BYTES) % PAD_BLOCK !== 0) {
    throw new VaultError('INVALID_ARGUMENT', { hint: 'payload ciphertext must be 64k + 16 bytes' });
  }
  const parts: Uint8Array[] = [fixedHeader(v.mode, v.threshold, n, rp, v.wrapSalt)];
  for (const e of v.entries) parts.push(Uint8Array.of(e.credId.length), e.credId, e.wrapNonce, e.wrapped);
  parts.push(v.payloadNonce, v.payloadCt);
  const blob = concat(...parts);
  if (blob.length > MAX_BLOB_BYTES) {
    throw new VaultError('VAULT_TOO_LARGE', {
      maxPayloadBytes: maxPayloadForBytes(rp, v.entries.map((e) => e.credId), v.mode),
    });
  }
  return blob;
}

/**
 * Decodes and validates a blob in the order fixed by spec §5.1. Never throws
 * anything but VaultError. Returned byte fields are copies.
 */
export function decodeVault(blob: Uint8Array): DecodedVault {
  if (!(blob instanceof Uint8Array)) throw new VaultError('MALFORMED');
  let pos = 0;
  const take = (k: number): Uint8Array => {
    if (pos + k > blob.length) throw new VaultError('MALFORMED');
    const out = blob.slice(pos, pos + k);
    pos += k;
    return out;
  };
  const byte = (): number => take(1)[0]!;

  if (blob.length < MAGIC.length) throw new VaultError('MALFORMED');
  if (!equalPublic(take(4), MAGIC)) throw new VaultError('BAD_MAGIC');
  if (byte() !== FORMAT_VERSION) throw new VaultError('UNSUPPORTED_VERSION');
  if (byte() !== SUITE_HKDF_SHA256_AES256GCM) throw new VaultError('UNSUPPORTED_SUITE');
  const mode = byte();
  if (mode !== MODE_ANY_OF_N && mode !== MODE_SHAMIR) throw new VaultError('UNSUPPORTED_MODE');
  if (blob.length > MAX_BLOB_BYTES) throw new VaultError('MALFORMED');
  const threshold = byte();
  const n = byte();
  if (n < MIN_KEYS || n > MAX_KEYS || !validThreshold(mode, threshold, n)) throw new VaultError('MALFORMED');
  const rpLen = byte();
  if (rpLen < 1 || rpLen > MAX_RP_ID_BYTES) throw new VaultError('MALFORMED');
  const rp = take(rpLen);
  if (!rp.every(isVisibleAscii)) throw new VaultError('MALFORMED');
  const wrapSalt = take(WRAP_SALT_BYTES);
  const headerLength = pos;
  const wl = wrappedLength(mode);
  const entries: VaultEntry[] = [];
  for (let i = 0; i < n; i++) {
    const cl = byte();
    if (cl < 1 || cl > MAX_CRED_ID_BYTES) throw new VaultError('MALFORMED');
    const credId = take(cl);
    if (entries.some((e) => equalPublic(e.credId, credId))) throw new VaultError('MALFORMED');
    entries.push({ credId, wrapNonce: take(NONCE_BYTES), wrapped: take(wl) });
  }
  const payloadOffset = pos;
  const rem = blob.length - pos;
  if (rem < NONCE_BYTES + PAD_BLOCK + TAG_BYTES || (rem - NONCE_BYTES - TAG_BYTES) % PAD_BLOCK !== 0) {
    throw new VaultError('MALFORMED');
  }
  const payloadNonce = take(NONCE_BYTES);
  const payloadCt = take(blob.length - pos);
  return {
    mode,
    threshold,
    rpId: String.fromCharCode(...rp),
    wrapSalt,
    entries,
    payloadNonce,
    payloadCt,
    headerLength,
    payloadOffset,
    keyCount: n,
  };
}
