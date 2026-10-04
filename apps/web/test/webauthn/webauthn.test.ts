import { beforeEach, describe, expect, it, vi } from 'vitest';
import { locatorSalt, deriveLocator } from '@cryoshield/vault-crypto';
import { FakeAuthenticators } from '../fixtures/fake-webauthn';
import { enrollKey, evaluatePrf, KeyError, detectPrfSupport, rpIdAllowed, prfCapturingGetFn, findKeyError } from '../../src/webauthn';
import { toWebAuthnAccount } from 'viem/account-abstraction';
import { toHex } from '../../src/lib/bytes';

const rp = { rpId: 'localhost', rpName: 'CryoShield' };
let f: FakeAuthenticators;
beforeEach(() => {
  f = new FakeAuthenticators();
});

describe('enrollKey (3.1)', () => {
  it('requests a discoverable, UV-required, ES256-only cross-platform credential with the single PRF input', async () => {
    f.addKey();
    const k = await enrollKey({ ...rp, label: 'key 1', exclude: [] }, f.credentials);
    const pk = f.calls[0]!.options.publicKey;
    expect(pk.rp).toEqual({ id: 'localhost', name: 'CryoShield' });
    expect(pk.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required', requireResidentKey: true, authenticatorAttachment: 'cross-platform' });
    expect(pk.pubKeyCredParams).toEqual([{ type: 'public-key', alg: -7 }]);
    expect(new Uint8Array(pk.extensions.prf.eval.first)).toEqual(locatorSalt());
    expect(pk.extensions.prf.eval.second).toBeUndefined();
    expect(pk.attestation).toBe('none');
    expect(k.credId.length).toBeGreaterThan(0);
    expect(k.publicKey).toBe(toHex(await f.publicKeyOf(k.credId)));
    expect(k.prf).toBeUndefined();
  });

  it('returns the PRF output when the authenticator evaluates PRF at create', async () => {
    f.addKey({ prfAtCreate: true });
    const k = await enrollKey({ ...rp, label: 'k', exclude: [] }, f.credentials);
    expect(k.prf).toEqual(await f.prfFor(k.credId, locatorSalt()));
  });

  it('passes already-enrolled credentials as excludeCredentials and maps InvalidStateError to DUPLICATE_KEY', async () => {
    f.addKey();
    const a = await enrollKey({ ...rp, label: 'a', exclude: [] }, f.credentials);
    await expect(enrollKey({ ...rp, label: 'b', exclude: [a.credId] }, f.credentials)).rejects.toMatchObject({ code: 'DUPLICATE_KEY' });
    expect(new Uint8Array(f.calls[1]!.options.publicKey.excludeCredentials[0].id)).toEqual(a.credId);
  });
});

describe('PRF detection (3.2)', () => {
  it('rejects a key whose PRF is not enabled as PRF_UNSUPPORTED_KEY', async () => {
    f.addKey({ prf: false });
    await expect(enrollKey({ ...rp, label: 'a', exclude: [] }, f.credentials)).rejects.toMatchObject({ code: 'PRF_UNSUPPORTED_KEY' });
  });

  it('uses getClientCapabilities when present, else "unknown"', async () => {
    expect(await detectPrfSupport({ getClientCapabilities: async () => ({ 'extension:prf': false }) })).toBe('unsupported');
    expect(await detectPrfSupport({ getClientCapabilities: async () => ({ 'extension:prf': true }) })).toBe('supported');
    expect(await detectPrfSupport({})).toBe('unknown');
    expect(await detectPrfSupport(undefined)).toBe('unsupported');
  });

  it('maps a cancelled ceremony to CANCELLED', async () => {
    f.addKey();
    f.cancelNext = true;
    await expect(enrollKey({ ...rp, label: 'a', exclude: [] }, f.credentials)).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('rejects a create response without the UV flag', async () => {
    f.addKey({ uv: false });
    await expect(enrollKey({ ...rp, label: 'a', exclude: [] }, f.credentials)).rejects.toMatchObject({ code: 'USER_NOT_VERIFIED' });
  });
});

describe('evaluatePrf (3.3)', () => {
  it('sends UV required, no allowCredentials, and exactly eval.first = locatorSalt()', async () => {
    f.addKey();
    const k = await enrollKey({ ...rp, label: 'a', exclude: [] }, f.credentials);
    const r = await evaluatePrf({ rpId: 'localhost' }, f.credentials);
    const pk = f.calls[1]!.options.publicKey;
    expect(pk.userVerification).toBe('required');
    expect(pk.allowCredentials).toBeUndefined();
    expect(Object.keys(pk.extensions.prf)).toEqual(['eval']);
    expect(Object.keys(pk.extensions.prf.eval)).toEqual(['first']);
    expect(new Uint8Array(pk.extensions.prf.eval.first)).toEqual(locatorSalt());
    expect(r.credId).toEqual(k.credId);
    expect(r.prf).toEqual(await f.prfFor(k.credId, locatorSalt()));
  });

  it('can target one credential (enrollment follow-up tap)', async () => {
    f.addKey();
    const k = await enrollKey({ ...rp, label: 'a', exclude: [] }, f.credentials);
    await evaluatePrf({ rpId: 'localhost', credId: k.credId }, f.credentials);
    expect(new Uint8Array(f.calls[1]!.options.publicKey.allowCredentials[0].id)).toEqual(k.credId);
  });

  it('rejects an assertion without the UV flag (defence in depth, even from a key that ignores credProtect)', async () => {
    const i = f.addKey({ enforcesCredProtect: false });
    await enrollKey({ ...rp, label: 'a', exclude: [] }, f.credentials);
    f.keys[i]!.opts.uv = false;
    await expect(evaluatePrf({ rpId: 'localhost' }, f.credentials)).rejects.toMatchObject({ code: 'USER_NOT_VERIFIED' });
  });

  it('reports PRF_UNAVAILABLE when the assertion carries no PRF result', async () => {
    const i = f.addKey();
    await enrollKey({ ...rp, label: 'a', exclude: [] }, f.credentials);
    f.keys[i]!.opts.prf = false;
    await expect(evaluatePrf({ rpId: 'localhost' }, f.credentials)).rejects.toBeInstanceOf(KeyError);
  });
});

describe('rpIdAllowed (3.4)', () => {
  it('accepts the RP ID and its subdomains only', () => {
    expect(rpIdAllowed('cryoshield.app', 'cryoshield.app')).toBe(true);
    expect(rpIdAllowed('www.cryoshield.app', 'cryoshield.app')).toBe(true);
    expect(rpIdAllowed('evilcryoshield.app', 'cryoshield.app')).toBe(false);
    expect(rpIdAllowed('cryoshield.app.evil.com', 'cryoshield.app')).toBe(false);
    expect(rpIdAllowed('ipfs.io', 'cryoshield.app')).toBe(false);
  });
});

describe('prfCapturingGetFn (3.5)', () => {
  it('adds PRF + UV to the signing ceremony and checks the signer is the expected key', async () => {
    f.addKey();
    const k = await enrollKey({ ...rp, label: 'a', exclude: [] }, f.credentials);
    const expectedLocator = deriveLocator(await f.prfFor(k.credId, locatorSalt()));
    const getFn = prfCapturingGetFn({ expectedLocator, credentials: f.credentials });
    const owner = toWebAuthnAccount({ credential: { id: toB64(k.credId), publicKey: k.publicKey }, getFn: getFn as never, rpId: 'localhost' });
    const { signature } = await owner.sign({ hash: ('0x' + '11'.repeat(32)) as `0x${string}` });
    expect(signature).toMatch(/^0x[0-9a-f]{128}$/);
    const pk = f.calls.at(-1)!.options.publicKey;
    expect(pk.userVerification).toBe('required');
    expect(new Uint8Array(pk.extensions.prf.eval.first)).toEqual(locatorSalt());
  });

  it('fails when a different key signs', async () => {
    f.addKey();
    const k = await enrollKey({ ...rp, label: 'a', exclude: [] }, f.credentials);
    const getFn = prfCapturingGetFn({ expectedLocator: new Uint8Array(32).fill(9), credentials: f.credentials });
    const owner = toWebAuthnAccount({ credential: { id: toB64(k.credId), publicKey: k.publicKey }, getFn: getFn as never, rpId: 'localhost' });
    const err = await owner.sign({ hash: ('0x' + '11'.repeat(32)) as `0x${string}` }).catch((e) => e);
    expect(findKeyError(err)?.code).toBe('WRONG_KEY');
  });
});

function toB64(b: Uint8Array) {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('review fix 4: bad PRF length wipes the copy', () => {
  it('zeroizes the copied output before throwing PRF_UNAVAILABLE', async () => {
    const short = new Uint8Array(16).fill(7);
    const copies: Uint8Array[] = [];
    const OrigU8 = Uint8Array;
    const sliceSpy = vi.spyOn(OrigU8.prototype, 'slice').mockImplementation(function (this: Uint8Array, ...a: [number?, number?]) {
      const out = OrigU8.prototype.subarray.call(this, ...a);
      const c = new OrigU8(out);
      copies.push(c);
      return c as never;
    });
    const credentials = {
      create: async () => ({}),
      get: async () => ({
        rawId: new ArrayBuffer(4),
        response: { authenticatorData: new Uint8Array(37).fill(0x05).buffer },
        getClientExtensionResults: () => ({ prf: { results: { first: short.buffer } } }),
      }),
    };
    await expect(evaluatePrf({ rpId: 'localhost' }, credentials)).rejects.toMatchObject({ code: 'PRF_UNAVAILABLE' });
    sliceSpy.mockRestore();
    const copy = copies.find((c) => c.length === 16);
    expect(copy).toBeDefined();
    expect(copy!.every((x) => x === 0)).toBe(true);
  });
});
