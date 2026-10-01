/** Fixes from the add-vault-crypto-core security review (docs/reviews/vault-crypto-v1.md). */
import { describe, expect, it } from 'vitest';
import vectors from '../test-vectors/v1.json' with { type: 'json' };
import pkgJson from '../package.json' with { type: 'json' };
import * as api from '../src/index.js';
import {
  addKey,
  assertUserVerified,
  createVault,
  decodeVault,
  updatePayload,
  VaultError,
  webauthnPrfCreateOptions,
  webauthnPrfGetOptions,
} from '../src/index.js';
import * as testing from '../src/testing.js';

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const rand = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const authData = (flags: number): Uint8Array => {
  const a = new Uint8Array(37);
  a[32] = flags;
  return a;
};

describe('MEDIUM: UV must actually be required at create and get', () => {
  it('create options put UV in authenticatorSelection (where create() reads it) with resident keys', () => {
    const o = webauthnPrfCreateOptions();
    expect(o.authenticatorSelection).toEqual({ userVerification: 'required', residentKey: 'required' });
    expect('userVerification' in o).toBe(false);
    expect(toHex(o.extensions.prf.eval.first)).toBe(vectors.constants.locatorSalt);
    expect(Object.keys(o.extensions.prf.eval)).toEqual(['first']);
  });

  it('get options put UV at the top level with the single PRF input', () => {
    const o = webauthnPrfGetOptions();
    expect(o.userVerification).toBe('required');
    expect(toHex(o.extensions.prf.eval.first)).toBe(vectors.constants.locatorSalt);
    expect(Object.keys(o.extensions.prf.eval)).toEqual(['first']);
  });

  it('the old ambiguous helper is gone', () => {
    expect('webauthnPrfRequest' in api).toBe(false);
  });

  it('assertUserVerified accepts authenticator data with the UV flag (bit 2) set', () => {
    expect(() => assertUserVerified(authData(0x05))).not.toThrow(); // UP | UV
    expect(() => assertUserVerified(authData(0x45))).not.toThrow(); // UP | UV | AT
  });

  it('assertUserVerified rejects UP-only data with USER_NOT_VERIFIED', () => {
    for (const flags of [0x00, 0x01, 0x41, 0xfb]) {
      try {
        assertUserVerified(authData(flags));
        throw new Error('expected a throw');
      } catch (e) {
        expect(e).toBeInstanceOf(VaultError);
        expect((e as VaultError).code).toBe('USER_NOT_VERIFIED');
      }
    }
  });

  it('assertUserVerified rejects truncated authenticator data', () => {
    for (const a of [new Uint8Array(0), new Uint8Array(32), new Uint8Array(36)]) {
      expect(() => assertUserVerified(a)).toThrow(VaultError);
    }
  });

  it('authenticator-data vectors give the same results', () => {
    for (const c of vectors.authenticatorDataCases) {
      const data = Uint8Array.from(c.authenticatorData.match(/../g) ?? [], (h) => parseInt(h, 16));
      let got = 'OK';
      try {
        assertUserVerified(data);
      } catch (e) {
        got = (e as VaultError).code;
      }
      expect(got, c.name).toBe(c.expectedError ?? 'OK');
    }
  });
});

describe('LOW: replay RNG only behind the testing subpath', () => {
  it('the production entry point does not export the replay RNG', () => {
    expect('replayRng' in api).toBe(false);
    expect('RngExhaustedError' in api).toBe(false);
    expect('webCryptoRng' in api).toBe(true);
  });
  it('@cryoshield/vault-crypto/testing exports it', () => {
    expect(typeof testing.replayRng).toBe('function');
    expect(typeof testing.RngExhaustedError).toBe('function');
  });
  it('package.json maps ./testing to the testing build', () => {
    const pkg = pkgJson as unknown as { exports: Record<string, unknown> };
    expect(pkg.exports['./testing']).toEqual({ types: './dist/testing.d.ts', import: './dist/testing.js' });
  });
});

describe('LOW: a reused payload nonce is refused under the same data key', () => {
  async function vault() {
    const a = { id: rand(32), prf: rand(32) };
    const b = { id: rand(32), prf: rand(32) };
    const prfA = a.prf.slice();
    const vaultId = rand(32);
    const { blob } = await createVault({ vaultId, rpId: 'cryoshield.app', credentials: [a, b], secret: rand(20) });
    return { blob, prfA, vaultId, oldNonce: decodeVault(blob).payloadNonce };
  }

  it('updatePayload throws when the RNG repeats the current payload nonce', async () => {
    const { blob, prfA, vaultId, oldNonce } = await vault();
    await expect(
      updatePayload(blob, { prf: prfA }, vaultId, rand(5), { rng: testing.replayRng(oldNonce) }),
    ).rejects.toThrow(/nonce/);
  });

  it('addKey throws when the RNG repeats the current payload nonce', async () => {
    const { blob, prfA, vaultId, oldNonce } = await vault();
    const rng = testing.replayRng(new Uint8Array([...rand(12), ...oldNonce]));
    await expect(addKey(blob, { prf: prfA }, vaultId, { id: rand(32), prf: rand(32) }, { rng })).rejects.toThrow(/nonce/);
  });
});
