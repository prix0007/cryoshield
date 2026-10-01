import { describe, expect, it } from 'vitest';
import vectors from '../test-vectors/v1.json' with { type: 'json' };
import {
  addKey,
  createVault,
  decodeVault,
  encodeVault,
  maxPayloadBytes,
  MODE_ANY_OF_N,
  MODE_SHAMIR,
  openVault,
  selectVault,
  updatePayload,
  VaultError,
} from '../src/index.js';
import { wrapAad } from '../src/format.js';
import { combineShares, splitKey } from '../src/shamir.js';

const hex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const rand = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const isZero = (b: Uint8Array): boolean => b.every((x) => x === 0);
const RP = 'cryoshield.app';
const cred = (idLen = 64) => ({ id: rand(idLen), prf: rand(32) });
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof VaultError) return e.code;
    throw e;
  }
  return 'OK';
}

/** Creates a vault without consuming the given credentials' PRFs (copies them). */
async function make(creds: { id: Uint8Array; prf: Uint8Array }[], secret: Uint8Array, mode: 1 | 2 = 1, threshold?: number) {
  const params = { rpId: RP, credentials: creds.map((c) => ({ id: c.id, prf: c.prf.slice() })), secret, mode, ...(threshold ? { threshold } : {}) };
  return createVault(params);
}

describe('task 3.3: zeroization of caller PRF buffers', () => {
  it('createVault wipes every PRF on success and on failure', async () => {
    const a = cred();
    const b = cred();
    await createVault({ rpId: RP, credentials: [a, b], secret: enc('s') });
    expect(isZero(a.prf) && isZero(b.prf)).toBe(true);
    const c = cred();
    expect(await code(createVault({ rpId: RP, credentials: [c], secret: enc('s') }))).toBe('TOO_FEW_KEYS');
    expect(isZero(c.prf)).toBe(true);
  });

  it('openVault wipes the PRF on success and on failure', async () => {
    const a = cred();
    const b = cred();
    const { blob } = await make([a, b], enc('hello'));
    const p1 = a.prf.slice();
    expect(dec(await openVault(blob, { prf: p1 }))).toBe('hello');
    expect(isZero(p1)).toBe(true);
    const wrong = rand(32);
    expect(await code(openVault(blob, { prf: wrong }))).toBe('NO_MATCHING_KEY');
    expect(isZero(wrong)).toBe(true);
    const p2 = b.prf.slice();
    expect(await code(openVault(blob.subarray(0, 10), [{ prf: p2 }]))).toBe('MALFORMED');
    expect(isZero(p2)).toBe(true);
  });

  it('selectVault, addKey and updatePayload wipe PRFs on success and on failure', async () => {
    const a = cred();
    const b = cred();
    const { blob } = await make([a, b], enc('x'));
    const s1 = a.prf.slice();
    await selectVault([blob], s1);
    expect(isZero(s1)).toBe(true);
    const s2 = rand(32);
    expect(await code(selectVault([blob], s2))).toBe('NO_MATCHING_VAULT');
    expect(isZero(s2)).toBe(true);

    const e1 = a.prf.slice();
    const n1 = cred();
    await addKey(blob, { prf: e1 }, n1);
    expect(isZero(e1) && isZero(n1.prf)).toBe(true);
    const e2 = rand(32);
    const n2 = cred();
    expect(await code(addKey(blob, { prf: e2 }, n2))).toBe('NO_MATCHING_KEY');
    expect(isZero(e2) && isZero(n2.prf)).toBe(true);

    const u1 = b.prf.slice();
    await updatePayload(blob, { prf: u1 }, enc('y'));
    expect(isZero(u1)).toBe(true);
    const u2 = rand(32);
    expect(await code(updatePayload(blob, { prf: u2 }, enc('y')))).toBe('NO_MATCHING_KEY');
    expect(isZero(u2)).toBe(true);
  });

  it('grep: library source never logs, stores, or transmits anything', () => {
    const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    const forbidden = /\bconsole\.|localStorage|sessionStorage|indexedDB|\bfetch\(|XMLHttpRequest|WebSocket|document\.cookie|postMessage/;
    for (const [file, text] of Object.entries(sources)) expect(forbidden.test(text), file).toBe(false);
  });
});

describe('task 4.2: encoder, cap, maxPayloadBytes', () => {
  it('decode(encode(fields)) round-trips metadata in enrollment order', async () => {
    const creds = [cred(64), cred(16), cred(128)];
    const { blob } = await make(creds, enc('round trip'));
    const d = decodeVault(blob);
    expect(d.rpId).toBe(RP);
    expect(d.entries.map((e) => toHex(e.credId))).toEqual(creds.map((c) => toHex(c.id)));
    expect(toHex(encodeVault(d))).toBe(toHex(blob));
  });

  it('maxPayloadBytes matches the spec budget table', () => {
    const ids = (n: number) => Array.from({ length: n }, () => rand(64));
    expect(maxPayloadBytes(RP, ids(2), MODE_ANY_OF_N)).toBe(638);
    expect(maxPayloadBytes(RP, ids(3), MODE_ANY_OF_N)).toBe(510);
    expect(maxPayloadBytes(RP, ids(3), MODE_SHAMIR)).toBe(510);
  });

  it('secret of exactly maxPayloadBytes fits; one more is refused with the max in the message', async () => {
    const creds = [cred(), cred()];
    const max = maxPayloadBytes(RP, creds.map((c) => c.id));
    const ok = await make(creds, rand(max));
    expect(ok.blob.length).toBeLessThanOrEqual(1024);
    const err = await make(creds, rand(max + 1)).catch((e: VaultError) => e);
    expect(err).toBeInstanceOf(VaultError);
    expect((err as VaultError).code).toBe('VAULT_TOO_LARGE');
    expect((err as VaultError).message).toContain(`${max}`);
  });

  it('encodeVault refuses blobs over 1024 bytes', async () => {
    const { blob } = await make([cred(), cred()], enc('a'));
    const d = decodeVault(blob);
    const big = { ...d, payloadCt: new Uint8Array(64 * 12 + 16) };
    expect(() => encodeVault(big)).toThrow(VaultError);
  });
});

describe('task 5.1: padding hides length; header AAD', () => {
  it('10-byte and 40-byte secrets give equal ciphertext length', async () => {
    const creds = [cred(), cred()];
    const a = decodeVault((await make(creds, rand(10))).blob);
    const b = decodeVault((await make(creds, rand(40))).blob);
    expect(a.payloadCt.length).toBe(b.payloadCt.length);
    expect(a.payloadCt.length).toBe(64 + 16);
  });

  it('every single-byte flip before the payload is detected', async () => {
    const a = cred();
    const b = cred();
    const { blob } = await make([a, b], enc('tamper me'));
    const d = decodeVault(blob);
    for (let i = 0; i < d.payloadOffset; i++) {
      const t = blob.slice();
      t[i]! ^= 0x01;
      const c = await code(openVault(t, { prf: b.prf.slice() }));
      expect(c, `byte ${i}`).not.toBe('OK');
    }
  });
});

describe('spec scenarios', () => {
  it('wrap salts and wrapped keys differ between two vaults with the same keys', async () => {
    const creds = [cred(), cred()];
    const v1 = decodeVault((await make(creds, enc('s'))).blob);
    const v2 = decodeVault((await make(creds, enc('s'))).blob);
    expect(toHex(v1.wrapSalt)).not.toBe(toHex(v2.wrapSalt));
    expect(toHex(v1.entries[0]!.wrapped)).not.toBe(toHex(v2.entries[0]!.wrapped));
  });

  it('each key gets its own locator', async () => {
    const { locators } = await make([cred(), cred()], enc('s'));
    expect(locators).toHaveLength(2);
    expect(toHex(locators[0]!)).not.toBe(toHex(locators[1]!));
  });

  it('wrap AAD recomputed from each vector blob equals the vector and excludes M and N', () => {
    for (const v of vectors.vaults) {
      const d = decodeVault(hex(v.blob));
      v.credentials.forEach((c, i) => {
        const aad = wrapAad(d.mode, new TextEncoder().encode(d.rpId), d.wrapSalt, i, d.entries[i]!.credId);
        expect(toHex(aad)).toBe(c.wrapAad);
        // bytes 4..6 are version, suite, mode; M/N would sit at 7..8 in the header but not here
        expect(aad[7]).toBe(d.rpId.length);
      });
    }
  });
});

describe('task 5.5: addKey', () => {
  it('adds key C with only key A; A, B, C each open; existing entries byte-identical', async () => {
    const [a, b, c] = [cred(), cred(), cred(48)];
    const { blob } = await make([a, b], enc('seed words'));
    const res = await addKey(blob, { prf: a.prf.slice() }, { id: c.id, prf: c.prf.slice() });
    const before = decodeVault(blob);
    const after = decodeVault(res.blob);
    expect(after.keyCount).toBe(3);
    expect(toHex(res.blob.subarray(before.headerLength, before.payloadOffset))).toBe(
      toHex(blob.subarray(before.headerLength, before.payloadOffset)),
    );
    for (const k of [a, b, c]) expect(dec(await openVault(res.blob, { prf: k.prf.slice() }))).toBe('seed words');
  });

  it('refuses mode 0x02 vaults', async () => {
    const [a, b, c] = [cred(), cred(), cred()];
    const { blob } = await make([a, b, c], enc('s'), 2, 2);
    expect(await code(addKey(blob, { prf: a.prf.slice() }, cred()))).toBe('INVALID_ARGUMENT');
  });
});

describe('task 5.6: updatePayload', () => {
  it('one key edits; every enrolled key opens and gets the new secret', async () => {
    const [a, b, c] = [cred(), cred(), cred()];
    const { blob } = await make([a, b, c], enc('old'));
    const out = await updatePayload(blob, { prf: b.prf.slice() }, enc('new secret'));
    const d0 = decodeVault(blob);
    expect(toHex(out.subarray(0, d0.payloadOffset))).toBe(toHex(blob.subarray(0, d0.payloadOffset)));
    for (const k of [a, b, c]) expect(dec(await openVault(out, { prf: k.prf.slice() }))).toBe('new secret');
  });
});

describe('task 6.2: Shamir share codec', () => {
  const subsets = <T,>(arr: T[], k: number): T[][] =>
    k === 0 ? [[]] : arr.flatMap((x, i) => subsets(arr.slice(i + 1), k - 1).map((s) => [x, ...s]));

  for (const [m, n] of [
    [2, 2],
    [2, 3],
    [3, 5],
    [4, 8],
    [8, 8],
  ] as const) {
    it(`${m}-of-${n}: every M-subset reconstructs, M-1 shares do not`, async () => {
      const key = rand(32);
      const shares = await splitKey(key, n, m);
      expect(shares.every((s) => s.length === 33 && s[0] !== 0)).toBe(true);
      expect(new Set(shares.map((s) => s[0])).size).toBe(n);
      for (const sub of subsets(shares, m)) expect(toHex(await combineShares(sub))).toBe(toHex(key));
      for (const sub of subsets(shares, m - 1)) {
        const r = await combineShares(sub).then(toHex, (e: VaultError) => e.code);
        expect(r).not.toBe(toHex(key));
      }
    });
  }

  it('rejects duplicate or zero x-coordinates', async () => {
    const shares = await splitKey(rand(32), 3, 2);
    expect(await code(combineShares([shares[0]!, shares[0]!]))).toBe('MALFORMED');
    const z = shares[1]!.slice();
    z[0] = 0;
    expect(await code(combineShares([shares[0]!, z]))).toBe('MALFORMED');
  });

  it('end to end: 3-of-5 vault opens with any 3 keys, not with 2', async () => {
    const creds = Array.from({ length: 5 }, () => cred(32));
    const { blob } = await make(creds, enc('threshold'), 2, 3);
    for (const sub of subsets(creds, 3)) {
      expect(dec(await openVault(blob, sub.map((c) => ({ prf: c.prf.slice() }))))).toBe('threshold');
    }
    expect(await code(openVault(blob, creds.slice(0, 2).map((c) => ({ prf: c.prf.slice() }))))).toBe('INSUFFICIENT_SHARES');
  });
});
