import { PAD_BLOCK } from './constants.js';
import { VaultError } from './errors.js';

/**
 * u16be(len) || secret || zeros, to exactly `target` bytes (spec §6.1). Encoders pass the maximum padded length for
 * the key set of the blob they write (`paddedLengthFor`), so the ciphertext length depends on public data only.
 * `target` must be a positive multiple of 64 with room for the prefix and the secret.
 */
export function pad(secret: Uint8Array, target: number): Uint8Array {
  if (secret.length > 0xffff) throw new VaultError('INVALID_ARGUMENT', { hint: 'secret too long' });
  if (!Number.isInteger(target) || target <= 0 || target % PAD_BLOCK !== 0 || target < 2 + secret.length) {
    throw new VaultError('INVALID_ARGUMENT', { hint: 'invalid padded length' });
  }
  const out = new Uint8Array(target);
  out[0] = secret.length >>> 8;
  out[1] = secret.length & 0xff;
  out.set(secret, 2);
  return out;
}

/**
 * Inverse of pad(); accepts any padded length (maximum padding or the earlier 64-byte steps) and rejects a length
 * prefix past the end or any nonzero pad byte with MALFORMED. Returns a copy.
 */
export function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length < 2) throw new VaultError('MALFORMED');
  const len = (padded[0]! << 8) | padded[1]!;
  if (len > padded.length - 2) throw new VaultError('MALFORMED');
  let nonzero = 0;
  for (let i = 2 + len; i < padded.length; i++) nonzero |= padded[i]!;
  if (nonzero !== 0) throw new VaultError('MALFORMED');
  return padded.slice(2, 2 + len);
}
