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

// pad-to-max-payload (task 2.3): the sections and fields added with the maximum-padding rule.
type LengthGroup = { name: string; vaults: string[]; overhead: number; paddedLength: number; blobLength: number };
type LegacyCase = { name: string; vaultId: string; blob: string; blobLength: number; keys: KeyJson[]; expectedSecret: string };
const V = vectors as unknown as {
  vaults: { name: string; blob: string; blobLength: number; paddedLength: number; maxPayloadBytes: number; paddedPlaintext: string }[];
  lengthHidingCases: LengthGroup[];
  legacyPaddingCases: LegacyCase[];
  addKeyCases: { name: string; expectedBlob?: string; expectedBlobLength?: number; expectedPaddedLength?: number }[];
  updatePayloadCases: { name: string; expectedBlob?: string; expectedBlobLength?: number }[];
  openCases: { name: string; expectedError?: string }[];
};

describe('pad-to-max-payload: maximum padding in the vectors', () => {
  it('every vault is padded to maxPayloadBytes + 2', () => {
    for (const v of V.vaults) {
      expect(v.paddedLength, v.name).toBe(v.maxPayloadBytes + 2);
      expect(v.paddedPlaintext.length / 2, v.name).toBe(v.paddedLength);
      expect(decodeVault(hex(v.blob)).payloadCt.length, v.name).toBe(v.paddedLength + 16);
    }
  });

  it('has the length-hiding groups (N = 2, N = 3, mode 0x02; 12 and 24 words)', () => {
    expect(V.lengthHidingCases.map((g) => g.name)).toEqual(['any-of-2', 'any-of-3', 'shamir-2-of-3']);
    for (const g of V.lengthHidingCases) {
      expect(g.vaults.length, g.name).toBeGreaterThanOrEqual(3);
      expect(g.vaults.some((n) => n.endsWith('12-word')), g.name).toBe(true);
      expect(g.paddedLength).toBe(64 * Math.floor((1024 - g.overhead) / 64));
      expect(g.blobLength).toBe(g.overhead + g.paddedLength);
      for (const name of g.vaults) {
        const v = V.vaults.find((x) => x.name === name)!;
        expect(v, name).toBeDefined();
        expect(hex(v.blob).length, name).toBe(g.blobLength);
        expect(v.blobLength, name).toBe(g.blobLength);
      }
    }
  });

  it('add-key and update successes record their (maximum) lengths', () => {
    for (const name of ['add-C-with-A', 'add-C-to-legacy']) {
      const c = V.addKeyCases.find((x) => x.name === name)!;
      expect(c, name).toBeDefined();
      expect(hex(c.expectedBlob!).length).toBe(c.expectedBlobLength);
      expect(decodeVault(hex(c.expectedBlob!)).payloadCt.length).toBe(c.expectedPaddedLength! + 16);
    }
    for (const name of ['update-with-B', 'update-legacy-to-max']) {
      const c = V.updatePayloadCases.find((x) => x.name === name)!;
      expect(c, name).toBeDefined();
      expect(hex(c.expectedBlob!).length).toBe(c.expectedBlobLength);
    }
    const legacyIn = V.updatePayloadCases.find((x) => x.name === 'update-legacy-to-max') as unknown as { blob: string };
    expect(hex(legacyIn.blob).length).toBeLessThan(V.updatePayloadCases.find((x) => x.name === 'update-legacy-to-max')!.expectedBlobLength!);
  });

  it('has the padding-check open cases', () => {
    for (const name of ['nonzero-pad-byte', 'length-prefix-overrun']) {
      expect(V.openCases.find((x) => x.name === name)?.expectedError, name).toBe('MALFORMED');
    }
  });
});

describe('legacy padding cases (64-byte steps, written before pad-to-max-payload)', () => {
  it('section is present', () => {
    expect(V.legacyPaddingCases.length).toBeGreaterThanOrEqual(6);
  });
  for (const c of V.legacyPaddingCases ?? []) {
    it(`${c.name} decodes and opens`, async () => {
      const blob = hex(c.blob);
      expect(blob.length).toBe(c.blobLength);
      decodeVault(blob);
      expect(toHex(await openVault(blob, c.keys.map(keyOf), hex(c.vaultId)))).toBe(c.expectedSecret);
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
