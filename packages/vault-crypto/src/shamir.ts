/**
 * Share-codec adapter over `shamir-secret-sharing` 0.0.4 (GF(2^8) mod 0x11B).
 * Converts between the library's `y || x` share layout and the vault's
 * `x || y` layout (spec §6.4).
 *
 * Randomness: the library draws only from its own `shamir-secret-sharing/csprng`
 * module (WebCrypto / node:crypto). Tests substitute that module to replay
 * vector streams; production always uses the library's CSPRNG.
 */
import { combine, split } from 'shamir-secret-sharing';
import { KEY_BYTES, SHARE_BYTES } from './constants.js';
import { wipe } from './bytes.js';
import { VaultError } from './errors.js';

/** Splits a 32-byte key into `n` shares (`x || y`, 33 bytes each) with threshold `m`. */
export async function splitKey(key: Uint8Array, n: number, m: number): Promise<Uint8Array[]> {
  if (key.length !== KEY_BYTES) throw new VaultError('INVALID_ARGUMENT', { hint: 'key must be 32 bytes' });
  const native = await split(key, n, m);
  try {
    return native.map((s) => {
      const out = new Uint8Array(SHARE_BYTES);
      out[0] = s[KEY_BYTES]!;
      out.set(s.subarray(0, KEY_BYTES), 1);
      return out;
    });
  } finally {
    wipe(...native);
  }
}

/** Reconstructs the key from `x || y` shares. Distinct, nonzero x required (else MALFORMED). */
export async function combineShares(shares: readonly Uint8Array[]): Promise<Uint8Array> {
  if (shares.length < 2) throw new VaultError('INSUFFICIENT_SHARES');
  const seen = new Set<number>();
  for (const s of shares) {
    if (s.length !== SHARE_BYTES) throw new VaultError('MALFORMED');
    const x = s[0]!;
    if (x === 0 || seen.has(x)) throw new VaultError('MALFORMED');
    seen.add(x);
  }
  const native = shares.map((s) => {
    const out = new Uint8Array(SHARE_BYTES);
    out.set(s.subarray(1), 0);
    out[KEY_BYTES] = s[0]!;
    return out;
  });
  try {
    return await combine(native);
  } finally {
    wipe(...native);
  }
}
