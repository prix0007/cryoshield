import { describe, expect, it } from 'vitest';
import { replayRng, webCryptoRng, RngExhaustedError } from '../src/rng.js';

describe('rng', () => {
  it('replayRng returns supplied bytes in order across draws', () => {
    const rng = replayRng(Uint8Array.from([1, 2, 3, 4, 5, 6]));
    expect(rng.randomBytes(2)).toEqual(Uint8Array.from([1, 2]));
    expect(rng.randomBytes(3)).toEqual(Uint8Array.from([3, 4, 5]));
    expect(rng.randomBytes(1)).toEqual(Uint8Array.from([6]));
    expect(rng.remaining()).toBe(0);
  });

  it('replayRng fails loudly when exhausted (no partial output)', () => {
    const rng = replayRng(Uint8Array.from([9, 9]));
    expect(() => rng.randomBytes(3)).toThrow(RngExhaustedError);
    expect(() => rng.randomBytes(3)).toThrow(/exhausted/);
  });

  it('replayRng copies its input so later mutation of the source has no effect', () => {
    const src = Uint8Array.from([7, 8]);
    const rng = replayRng(src);
    src.fill(0);
    expect(rng.randomBytes(2)).toEqual(Uint8Array.from([7, 8]));
  });

  it('webCryptoRng returns fresh bytes of the requested length', () => {
    const a = webCryptoRng.randomBytes(32);
    const b = webCryptoRng.randomBytes(32);
    expect(a).toHaveLength(32);
    expect(a).not.toEqual(b);
  });

  it('rejects invalid lengths', () => {
    expect(() => webCryptoRng.randomBytes(-1)).toThrow(RangeError);
    expect(() => replayRng(new Uint8Array(4)).randomBytes(1.5)).toThrow(RangeError);
  });
});
