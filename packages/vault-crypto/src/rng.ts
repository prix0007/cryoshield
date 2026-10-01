/**
 * Injectable randomness. Every random draw the library makes (wrap salt, data
 * key, nonces) goes through an `Rng`. Production uses WebCrypto; tests and
 * vector reproduction use `replayRng`.
 */
export interface Rng {
  /** Returns `length` fresh random bytes. */
  randomBytes(length: number): Uint8Array;
}

function assertLength(length: number): void {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError(`invalid random byte length: ${length}`);
  }
}

/** Cryptographically secure RNG backed by `crypto.getRandomValues` (browser and Node >= 20). */
export const webCryptoRng: Rng = Object.freeze({
  randomBytes(length: number): Uint8Array {
    assertLength(length);
    const out = new Uint8Array(length);
    // getRandomValues is limited to 65536 bytes per call.
    for (let off = 0; off < length; off += 65536) {
      globalThis.crypto.getRandomValues(out.subarray(off, Math.min(length, off + 65536)));
    }
    return out;
  },
});

export class RngExhaustedError extends Error {
  constructor(requested: number, remaining: number) {
    super(`replay RNG exhausted: requested ${requested} bytes, ${remaining} remaining`);
    this.name = 'RngExhaustedError';
  }
}

export interface ReplayRng extends Rng {
  /** Number of supplied bytes not yet consumed. */
  remaining(): number;
}

/**
 * Deterministic RNG for tests and test vectors: replays `bytes` in order and
 * throws `RngExhaustedError` if a draw would run past the end. NEVER use in
 * production.
 */
export function replayRng(bytes: Uint8Array): ReplayRng {
  const buf = bytes.slice();
  let pos = 0;
  return {
    randomBytes(length: number): Uint8Array {
      assertLength(length);
      if (pos + length > buf.length) throw new RngExhaustedError(length, buf.length - pos);
      const out = buf.slice(pos, pos + length);
      pos += length;
      return out;
    },
    remaining(): number {
      return buf.length - pos;
    },
  };
}
