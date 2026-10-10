/**
 * pad-to-max-payload (tasks 2.1/2.2): every encoder pads the payload to the maximum for the key set of the blob it
 * writes, so the blob length depends only on public data (RP ID, credential-ID lengths, N, mode).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addKey, createVault, decodeVault, maxPayloadBytes, MODE_ANY_OF_N, MODE_SHAMIR, openVault, updatePayload, VaultError, type VaultMode } from '../src/index.js';
import { overheadBytes, paddedLengthFor } from '../src/format.js';
import { pad, unpad } from '../src/padding.js';

const rand = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const RP = 'cryoshield.app';
const VID = rand(32);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const cred = (idLen = 64) => ({ id: rand(idLen), prf: rand(32) });
const enc = (s: string) => new TextEncoder().encode(s);
const W12 = enc([...Array(11).fill('abandon'), 'about'].join(' '));
const W24 = enc([...Array(23).fill('abandon'), 'art'].join(' '));

/** Expected blob length for a key set: public data only. */
const expectedLength = (rpId: string, ids: Uint8Array[], mode: VaultMode) => {
  const ov = overheadBytes(ascii(rpId), ids, mode);
  return ov + 64 * Math.floor((1024 - ov) / 64);
};

async function make(creds: { id: Uint8Array; prf: Uint8Array }[], secret: Uint8Array, mode: VaultMode = MODE_ANY_OF_N, threshold?: number, rpId = RP) {
  return createVault({ vaultId: VID, rpId, credentials: creds.map((c) => ({ id: c.id, prf: c.prf.slice() })), secret, mode, ...(threshold ? { threshold } : {}) });
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VaultError) return e.code;
    throw e;
  }
  return 'OK';
}

describe('pad(secret, target)', () => {
  it('writes u16be(len) || secret || zeros of exactly the target length', () => {
    const p = pad(Uint8Array.of(7, 8, 9), 128);
    expect(p.length).toBe(128);
    expect([...p.subarray(0, 5)]).toEqual([0, 3, 7, 8, 9]);
    expect(p.subarray(5).every((b) => b === 0)).toBe(true);
    expect([...unpad(p)]).toEqual([7, 8, 9]);
  });

  it('refuses a target that is too small or not a multiple of 64', () => {
    expect(() => pad(rand(63), 64)).toThrow(VaultError);
    expect(() => pad(rand(10), 100)).toThrow(VaultError);
    expect(() => pad(rand(10), 0)).toThrow(VaultError);
  });

  it('paddedLengthFor = maxPayloadBytes + 2 = 64 * floor((1024 - overhead) / 64)', () => {
    const ids = [rand(64), rand(64)];
    expect(paddedLengthFor(ascii(RP), ids, MODE_ANY_OF_N)).toBe(640);
    expect(paddedLengthFor(ascii(RP), ids, MODE_ANY_OF_N)).toBe(maxPayloadBytes(RP, ids) + 2);
    expect(paddedLengthFor(ascii(RP), [rand(64), rand(64), rand(64)], MODE_SHAMIR)).toBe(512);
  });
});

describe('blob length is a function of public data only', () => {
  it('12-word and 24-word seed phrases give identical blob lengths (N = 2, N = 3, mode 0x02)', async () => {
    const two = [cred(), cred()];
    const three = [cred(), cred(), cred(48)];
    for (const [creds, mode, m] of [[two, MODE_ANY_OF_N, undefined], [three, MODE_ANY_OF_N, undefined], [three, MODE_SHAMIR, 2]] as const) {
      const a = await make([...creds], W12, mode, m);
      const b = await make([...creds], W24, mode, m);
      expect(a.blob.length).toBe(b.blob.length);
      expect(a.blob.length).toBe(expectedLength(RP, creds.map((c) => c.id), mode));
    }
    expect((await make(two, W12)).blob.length).toBe(974);
  });

  it('property: any RP ID, 2..8 credential IDs, either mode, any two secrets that fit', async () => {
    const visible = fc.integer({ min: 0x21, max: 0x7e }).map((c) => String.fromCharCode(c));
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: visible, minLength: 1, maxLength: 64 }),
        fc.array(fc.integer({ min: 1, max: 128 }), { minLength: 2, maxLength: 8 }),
        fc.boolean(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        async (rpId, idLens, shamir, f1, f2) => {
          const mode: VaultMode = shamir ? MODE_SHAMIR : MODE_ANY_OF_N;
          const creds = idLens.map((l) => cred(l));
          const ids = creds.map((c) => c.id);
          const max = maxPayloadBytes(rpId, ids, mode);
          fc.pre(max >= 1);
          const n1 = 1 + Math.floor(f1 * (max - 1));
          const n2 = 1 + Math.floor(f2 * (max - 1));
          const m = shamir ? 2 : undefined;
          const a = await make(creds, rand(n1), mode, m, rpId);
          const b = await make(creds, rand(n2), mode, m, rpId);
          const want = expectedLength(rpId, ids, mode);
          expect(a.blob.length).toBe(want);
          expect(b.blob.length).toBe(want);
          expect(want).toBeLessThanOrEqual(1024);
          expect(want).toBeGreaterThan(960);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('every write path re-pads to the maximum', () => {
  it('updatePayload keeps the maximum when the secret shrinks or grows', async () => {
    const a = cred();
    const b = cred();
    const { blob } = await make([a, b], W24);
    const smaller = await updatePayload(blob, { prf: b.prf.slice() }, VID, enc('x'));
    const larger = await updatePayload(smaller, { prf: a.prf.slice() }, VID, rand(638));
    expect(smaller.length).toBe(974);
    expect(larger.length).toBe(974);
    expect(new TextDecoder().decode(await openVault(smaller, { prf: a.prf.slice() }, VID))).toBe('x');
  });

  it('addKey re-pads to the smaller maximum for N + 1 keys', async () => {
    const a = cred();
    const b = cred();
    const c = cred(48);
    const { blob } = await make([a, b], W12);
    const out = await addKey(blob, { prf: a.prf.slice() }, VID, { id: c.id, prf: c.prf.slice() });
    const ids = [a.id, b.id, c.id];
    expect(out.blob.length).toBe(expectedLength(RP, ids, MODE_ANY_OF_N));
    expect(decodeVault(out.blob).payloadCt.length).toBe(paddedLengthFor(ascii(RP), ids, MODE_ANY_OF_N) + 16);
    expect(await openVault(out.blob, { prf: c.prf.slice() }, VID)).toEqual(W12);
  });

  it('addKey refuses VAULT_TOO_LARGE when the secret no longer fits N + 1 keys', async () => {
    const a = cred();
    const b = cred();
    const max2 = maxPayloadBytes(RP, [a.id, b.id]);
    const max3 = maxPayloadBytes(RP, [a.id, b.id, rand(64)]);
    expect(max3).toBeLessThan(max2);
    const { blob } = await make([a, b], rand(max3 + 1));
    expect(await code(addKey(blob, { prf: a.prf.slice() }, VID, cred()))).toBe('VAULT_TOO_LARGE');
  });
});
