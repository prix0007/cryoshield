import { PAD_BLOCK } from './constants.js';
import { VaultError } from './errors.js';

/** Length of the padded plaintext for a secret of `len` bytes (spec §6.1). */
export const paddedLength = (len: number): number => Math.ceil((2 + len) / PAD_BLOCK) * PAD_BLOCK;

/** u16be(len) || secret || zeros, to a multiple of 64 bytes. */
export function pad(secret: Uint8Array): Uint8Array {
  if (secret.length > 0xffff) throw new VaultError('INVALID_ARGUMENT', { hint: 'secret too long' });
  const out = new Uint8Array(paddedLength(secret.length));
  out[0] = secret.length >>> 8;
  out[1] = secret.length & 0xff;
  out.set(secret, 2);
  return out;
}

/** Inverse of pad(); rejects non-canonical padding with MALFORMED. Returns a copy. */
export function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length < 2) throw new VaultError('MALFORMED');
  const len = (padded[0]! << 8) | padded[1]!;
  if (len > padded.length - 2) throw new VaultError('MALFORMED');
  let nonzero = 0;
  for (let i = 2 + len; i < padded.length; i++) nonzero |= padded[i]!;
  if (nonzero !== 0) throw new VaultError('MALFORMED');
  return padded.slice(2, 2 + len);
}
