/**
 * enforce-credprotect-uv (security audit AA-H1): credentials MUST be created with credProtect level 3
 * (userVerificationRequired), so a stolen key cannot produce ANY assertion for the (public) credential ID without
 * its PIN. The create options request it with enforcement, and the result is checked in authenticatorData.
 */
import { describe, expect, it } from 'vitest';
import { assertCredProtectUvRequired, credProtectLevel, VaultError, webauthnPrfCreateOptions, webauthnPrfGetOptions } from '../src/index.js';
import { cbor, credProtect, regAuthData } from './helpers/authdata.js';

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as VaultError).code;
  }
  return 'OK';
};

describe('create options request credProtect level 3, enforced', () => {
  it('sets credentialProtectionPolicy userVerificationRequired with enforcement, next to UV required and the PRF input', () => {
    const o = webauthnPrfCreateOptions();
    expect(o.extensions.credentialProtectionPolicy).toBe('userVerificationRequired');
    expect(o.extensions.enforceCredentialProtectionPolicy).toBe(true);
    expect(o.authenticatorSelection).toEqual({ userVerification: 'required', residentKey: 'required' });
    expect(o.extensions.prf.eval.first).toHaveLength(32);
  });
  it('get options are unchanged (credProtect is a registration-time policy)', () => {
    expect(webauthnPrfGetOptions().extensions).not.toHaveProperty('credentialProtectionPolicy');
  });
});

describe('credProtect level read from registration authenticatorData', () => {
  it('level 3 is confirmed', () => {
    const ad = regAuthData({ extensions: credProtect(3, [['hmac-secret', true]]) });
    expect(credProtectLevel(ad)).toBe(3);
    expect(code(() => assertCredProtectUvRequired(ad))).toBe('OK');
  });
  it.each([1, 2])('level %i is refused (a PIN-less assertion would still be possible)', (lvl) => {
    const ad = regAuthData({ extensions: credProtect(lvl) });
    expect(credProtectLevel(ad)).toBe(lvl);
    expect(code(() => assertCredProtectUvRequired(ad))).toBe('CRED_PROTECT_UNSUPPORTED');
  });
  it('no extension output (ED clear) is refused', () => {
    const ad = regAuthData();
    expect(credProtectLevel(ad)).toBeUndefined();
    expect(code(() => assertCredProtectUvRequired(ad))).toBe('CRED_PROTECT_UNSUPPORTED');
  });
  it('extensions without credProtect (only hmac-secret) are refused', () => {
    expect(code(() => assertCredProtectUvRequired(regAuthData({ extensions: new Map([['hmac-secret', true]]) })))).toBe('CRED_PROTECT_UNSUPPORTED');
  });
  it('a non-integer credProtect value is refused', () => {
    expect(code(() => assertCredProtectUvRequired(regAuthData({ extensions: new Map([['credProtect', 'high']]) })))).toBe('CRED_PROTECT_UNSUPPORTED');
  });
  it('without attested credential data (AT clear) the level cannot be confirmed', () => {
    expect(code(() => assertCredProtectUvRequired(regAuthData({ at: false, extensions: credProtect(3) })))).toBe('CRED_PROTECT_UNSUPPORTED');
  });
  it('truncated or malformed data is refused, never thrown as an unexpected error', () => {
    const ad = regAuthData({ extensions: credProtect(3) });
    for (const cut of [40, 60, 80, ad.length - 3]) expect(code(() => assertCredProtectUvRequired(ad.slice(0, cut)))).toBe('CRED_PROTECT_UNSUPPORTED');
    const junk = Uint8Array.from([...regAuthData({ extensions: credProtect(3) }), 0x00]); // trailing bytes
    expect(code(() => assertCredProtectUvRequired(junk))).toBe('CRED_PROTECT_UNSUPPORTED');
    expect(code(() => assertCredProtectUvRequired(new Uint8Array(20)))).toBe('INVALID_ARGUMENT');
  });
  it('a credProtect key hidden inside the COSE key is not mistaken for the extension output', () => {
    const tricky = regAuthData();
    tricky[32] = tricky[32]! | 0x80; // ED set but no extension map follows
    const withTail = Uint8Array.from([...tricky, ...cbor('credProtect'), 3]);
    expect(code(() => assertCredProtectUvRequired(withTail))).toBe('CRED_PROTECT_UNSUPPORTED');
  });
});
