/**
 * Runs every case in test-vectors/v1.json against the library.
 * The vectors are the contract with the Python recovery tool.
 */
import { describe, expect, it, vi } from 'vitest';
import vectors from '../test-vectors/v1.json' with { type: 'json' };
import { shamirRandom } from './helpers/shamir-rng.js';
import {
  addKey,
  createVault,
  ctapSalt,
  decodeVault,
  deriveLocator,
  deriveWrapKey,
  locatorSalt,
  openVault,
  selectVault,
  updatePayload,
  webauthnPrfGetOptions,
  VaultError,

  type UnlockKey,
  type VaultMode,
} from '../src/index.js';
import { replayRng } from '../src/testing.js';

// Route the Shamir library's CSPRNG through the vector's `shamirRng` stream.
vi.mock('shamir-secret-sharing/csprng', async () => {
  const { shamirRandom: r } = await import('./helpers/shamir-rng.js');
  return { getRandomBytes: (n: number) => r.next(n) };
});

const hex = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};
const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

type KeyJson = { prf: string; credId: string | null; ctapSalt: string; prfInput: string };
const keyOf = (k: KeyJson): UnlockKey => (k.credId ? { prf: hex(k.prf), credId: hex(k.credId) } : { prf: hex(k.prf) });

async function expectCode(p: Promise<unknown>, code: string): Promise<VaultError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(VaultError);
    expect((e as VaultError).code).toBe(code);
    return e as VaultError;
  }
  throw new Error(`expected VaultError ${code}, but the call succeeded`);
}

describe('constants', () => {
  const c = vectors.constants;
  it('locator salt = SHA-256(locatorSaltInput)', () => {
    expect(toHex(locatorSalt())).toBe(c.locatorSalt);
  });
  it('CTAP salt = SHA-256("WebAuthn PRF" || 0x00 || locatorSalt)', () => {
    expect(toHex(ctapSalt())).toBe(c.ctapSalt);
  });
  it('WebAuthn get options require UV and evaluates only the locator salt', () => {
    const req = webauthnPrfGetOptions();
    expect(req.userVerification).toBe(c.userVerification);
    expect(toHex(req.extensions.prf.eval.first)).toBe(c.locatorSalt);
    expect(Object.keys(req.extensions.prf.eval)).toEqual(['first']);
  });
});

describe('derivations', () => {
  for (const d of vectors.derivations) {
    it(`${d.name}: locator, wrap key, ctapSalt`, () => {
      expect(d.ctapSalt).toBe(vectors.constants.ctapSalt);
      expect(toHex(deriveLocator(hex(d.prf)))).toBe(d.locator);
      expect(toHex(deriveWrapKey(hex(d.prf), hex(d.wrapSalt)))).toBe(d.wrapKey);
    });
  }
});

describe('vaults (byte-identical creation)', () => {
  for (const v of vectors.vaults) {
    it(`${v.name}`, async () => {
      shamirRandom.load(v.shamirRng ? hex(v.shamirRng) : new Uint8Array(0));
      const rng = replayRng(hex(v.rng));
      const res = await createVault(
        {
          vaultId: hex(v.vaultId),
          rpId: v.rpId,
          credentials: v.credentials.map((c) => ({ id: hex(c.id), prf: hex(c.prf) })),
          secret: hex(v.secret),
          mode: v.mode as VaultMode,
          threshold: v.threshold,
        },
        { rng },
      );
      expect(rng.remaining()).toBe(0);
      expect(shamirRandom.remaining()).toBe(0);
      expect(toHex(res.blob)).toBe(v.blob);
      expect(res.blob.length).toBe(v.blobLength);
      expect(res.locators.map(toHex)).toEqual(v.credentials.map((c) => c.locator));
      for (const c of v.credentials) expect(c.ctapSalt).toBe(vectors.constants.ctapSalt);
    });
  }
});

describe('decode cases', () => {
  for (const c of vectors.decodeCases) {
    it(`${c.name}`, async () => {
      if ('expectedError' in c && c.expectedError) {
        await expectCode(Promise.resolve().then(() => decodeVault(hex(c.blob))), c.expectedError);
      } else if ('expected' in c && c.expected) {
        const d = decodeVault(hex(c.blob));
        expect(d.mode).toBe(c.expected.mode);
        expect(d.threshold).toBe(c.expected.threshold);
        expect(d.rpId).toBe(c.expected.rpId);
        expect(toHex(d.wrapSalt)).toBe(c.expected.wrapSalt);
        expect(d.entries.map((e) => toHex(e.credId))).toEqual(c.expected.credIds);
        expect(d.headerLength).toBe(c.expected.headerLength);
        expect(d.payloadOffset).toBe(c.expected.payloadOffset);
      } else throw new Error('vector has no expectation');
    });
  }
});

describe('open cases', () => {
  for (const c of vectors.openCases) {
    it(`${c.name}`, async () => {
      const keys = c.keys.map(keyOf);
      if ('expectedError' in c && c.expectedError) {
        await expectCode(openVault(hex(c.blob), keys, hex(c.vaultId)), c.expectedError);
      } else {
        expect(toHex(await openVault(hex(c.blob), keys, hex(c.vaultId)))).toBe((c as { expectedSecret: string }).expectedSecret);
      }
    });
  }
});

describe('create cases (refusals)', () => {
  for (const c of vectors.createCases) {
    it(`${c.name}`, async () => {
      const e = await expectCode(
        createVault(
          {
            vaultId: hex(c.vaultId),
            rpId: c.rpId,
            credentials: c.credentials.map((k) => ({ id: hex(k.id), prf: hex(k.prf) })),
            secret: hex(c.secret),
            mode: c.mode as VaultMode,
            threshold: c.threshold,
          },
          { rng: replayRng(new Uint8Array(0)) },
        ),
        c.expectedError,
      );
      if ('maxPayloadBytes' in c && typeof c.maxPayloadBytes === 'number') {
        expect(e.maxPayloadBytes).toBe(c.maxPayloadBytes);
        expect(e.message).toContain(String(c.maxPayloadBytes));
      }
    });
  }
});

describe('add-key cases', () => {
  for (const c of vectors.addKeyCases) {
    it(`${c.name}`, async () => {
      const p = addKey(hex(c.blob), keyOf(c.key), hex(c.vaultId), { id: hex(c.newCredential.id), prf: hex(c.newCredential.prf) }, {
        rng: replayRng(hex(c.rng)),
      });
      if ('expectedError' in c && c.expectedError) {
        await expectCode(p, c.expectedError);
      } else {
        const res = await p;
        expect(toHex(res.blob)).toBe((c as { expectedBlob: string }).expectedBlob);
        expect(toHex(res.locator)).toBe(c.newCredential.locator);
      }
    });
  }
});

describe('update-payload cases', () => {
  for (const c of vectors.updatePayloadCases) {
    it(`${c.name}`, async () => {
      const p = updatePayload(hex(c.blob), c.keys.map(keyOf), hex(c.vaultId), hex(c.newSecret), { rng: replayRng(hex(c.rng)) });
      if ('expectedError' in c && c.expectedError) {
        const e = await expectCode(p, c.expectedError);
        if ('maxPayloadBytes' in c && typeof c.maxPayloadBytes === 'number') {
          expect(e.maxPayloadBytes).toBe(c.maxPayloadBytes);
        }
      } else {
        expect(toHex(await p)).toBe((c as { expectedBlob: string }).expectedBlob);
      }
    });
  }
});

describe('select cases', () => {
  for (const c of vectors.selectCases) {
    it(`${c.name}`, async () => {
      const p = selectVault(
        c.candidates.map((x) => ({ vaultId: hex(x.vaultId), blob: hex(x.blob) })),
        hex(c.prf),
      );
      if ('expectedError' in c && c.expectedError) {
        await expectCode(p, c.expectedError);
      } else {
        const r = await p;
        expect(r.index).toBe((c as { expectedIndex: number }).expectedIndex);
        expect(toHex(r.vaultId)).toBe((c as { expectedVaultId: string }).expectedVaultId);
        expect(toHex(r.secret)).toBe((c as { expectedSecret: string }).expectedSecret);
      }
    });
  }
});
