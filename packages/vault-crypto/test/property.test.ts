/** Task 4.3: fast-check properties for the encoder/decoder (10k runs each). */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeVault, encodeVault, MODE_ANY_OF_N, MODE_SHAMIR, VaultError, type VaultFields } from '../src/index.js';

const RUNS = 10_000;
const TIMEOUT = 120_000;
const visibleAscii = fc.integer({ min: 0x21, max: 0x7e }).map((c) => String.fromCharCode(c));

const fieldsArb: fc.Arbitrary<VaultFields> = fc
  .record({
    mode: fc.constantFrom(MODE_ANY_OF_N, MODE_SHAMIR),
    n: fc.integer({ min: 2, max: 8 }),
    rpId: fc.string({ unit: visibleAscii, minLength: 1, maxLength: 64 }),
    wrapSalt: fc.uint8Array({ minLength: 32, maxLength: 32 }),
    payloadNonce: fc.uint8Array({ minLength: 12, maxLength: 12 }),
    blocks: fc.integer({ min: 1, max: 3 }),
    seed: fc.uint8Array({ minLength: 8, maxLength: 8 }),
    m: fc.integer({ min: 2, max: 8 }),
    credLens: fc.array(fc.integer({ min: 1, max: 24 }), { minLength: 8, maxLength: 8 }),
  })
  .map(({ mode, n, rpId, wrapSalt, payloadNonce, blocks, seed, m, credLens }) => {
    const wl = mode === MODE_ANY_OF_N ? 48 : 49;
    const entries = Array.from({ length: n }, (_, i) => {
      // index byte first guarantees distinct credential IDs
      const credId = new Uint8Array(credLens[i]!).fill(seed[i % 8]!);
      credId[0] = i;
      return { credId, wrapNonce: new Uint8Array(12).fill(i), wrapped: new Uint8Array(wl).fill(i + 1) };
    });
    return {
      mode,
      threshold: mode === MODE_ANY_OF_N ? 1 : Math.min(m, n),
      rpId,
      wrapSalt,
      entries,
      payloadNonce,
      payloadCt: new Uint8Array(64 * blocks + 16).fill(7),
    } satisfies VaultFields;
  });

describe('property: encoder/decoder', () => {
  it('decode(encode(x)) == x for random valid inputs', () => {
    fc.assert(
      fc.property(fieldsArb, (f) => {
        let blob: Uint8Array;
        try {
          blob = encodeVault(f);
        } catch (e) {
          // only the size cap may reject a structurally valid input
          expect(e).toBeInstanceOf(VaultError);
          expect((e as VaultError).code).toBe('VAULT_TOO_LARGE');
          return;
        }
        const d = decodeVault(blob);
        expect(d.mode).toBe(f.mode);
        expect(d.threshold).toBe(f.threshold);
        expect(d.rpId).toBe(f.rpId);
        expect(d.wrapSalt).toEqual(f.wrapSalt);
        expect(d.entries).toEqual(f.entries);
        expect(d.payloadNonce).toEqual(f.payloadNonce);
        expect(d.payloadCt).toEqual(f.payloadCt);
        expect(encodeVault(d)).toEqual(blob);
      }),
      { numRuns: RUNS },
    );
  }, TIMEOUT);

  it('random byte strings never crash the decoder (only VaultError)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 1100 }), (bytes) => {
        try {
          decodeVault(bytes);
        } catch (e) {
          expect(e).toBeInstanceOf(VaultError);
        }
      }),
      { numRuns: RUNS },
    );
  }, TIMEOUT);

  it('random bytes behind a valid prefix never crash the decoder', () => {
    const prefix = Uint8Array.of(0x43, 0x52, 0x59, 0x4f, 1, 1);
    fc.assert(
      fc.property(fc.constantFrom(1, 2), fc.uint8Array({ minLength: 0, maxLength: 1000 }), (mode, rest) => {
        const blob = new Uint8Array(prefix.length + 1 + rest.length);
        blob.set(prefix);
        blob[prefix.length] = mode;
        blob.set(rest, prefix.length + 1);
        try {
          decodeVault(blob);
        } catch (e) {
          expect(e).toBeInstanceOf(VaultError);
        }
      }),
      { numRuns: RUNS },
    );
  }, TIMEOUT);
});
