/**
 * enforce-credprotect-uv (security audit AA-H1). The smart wallet verifies WebAuthn with requireUV = false and does
 * not check rpIdHash or origin, and credential IDs are public in the blob. Unless the KEY refuses to assert without
 * its PIN (credProtect level 3), one stolen key can sign user operations. So: enrol only with level 3 confirmed,
 * and never use a signing assertion without the UV flag.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveLocator, locatorSalt } from '@cryoshield/vault-crypto';
import { toWebAuthnAccount } from 'viem/account-abstraction';
import { FakeAuthenticators } from '../fixtures/fake-webauthn';
import { enrollKey, evaluatePrf, findKeyError, prfCapturingGetFn } from '../../src/webauthn';
import { S } from '../../src/ui/strings';
import { noticeTitle } from '../../src/ui/ceremony';

const rp = { rpId: 'localhost', rpName: 'CryoShield' };
let f: FakeAuthenticators;
beforeEach(() => {
  f = new FakeAuthenticators();
});
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('enrolment requests and confirms credProtect level 3', () => {
  it('create() asks for credentialProtectionPolicy userVerificationRequired with enforcement', async () => {
    f.addKey();
    await enrollKey({ ...rp, label: 'k', exclude: [] }, f.credentials);
    const ext = f.calls[0]!.options.publicKey.extensions;
    expect(ext.credentialProtectionPolicy).toBe('userVerificationRequired');
    expect(ext.enforceCredentialProtectionPolicy).toBe(true);
  });

  it('accepts a key that confirms level 3', async () => {
    f.addKey({ prfAtCreate: true });
    const k = await enrollKey({ ...rp, label: 'k', exclude: [] }, f.credentials);
    expect(k.prf).toHaveLength(32);
  });

  it.each([1, 2])('refuses a key that reports level %i with CRED_PROTECT_UNSUPPORTED', async (lvl) => {
    f.addKey({ credProtect: lvl, prfAtCreate: true });
    const err = await enrollKey({ ...rp, label: 'k', exclude: [] }, f.credentials).catch((e) => e);
    expect(err.code).toBe('CRED_PROTECT_UNSUPPORTED');
  });

  it('refuses a key that reports no credProtect at all (the browser did not enforce)', async () => {
    f.addKey({ credProtect: false });
    // Simulate a browser that ignores the enforcement flag: strip it before the fake sees it.
    const creds = { create: (o: CredentialCreationOptions) => f.credentials.create({ publicKey: { ...o.publicKey!, extensions: {} } } as never), get: f.credentials.get };
    const err = await enrollKey({ ...rp, label: 'k', exclude: [] }, creds).catch((e) => e);
    expect(err.code).toBe('CRED_PROTECT_UNSUPPORTED');
  });

  it('a key without credProtect support makes an enforcing browser fail create(); it is never enrolled', async () => {
    f.addKey({ credProtect: false });
    const err = await enrollKey({ ...rp, label: 'k', exclude: [] }, f.credentials).catch((e) => e);
    expect(err.name).toBe('KeyError');
    expect(f.keys[0]!.creds).toHaveLength(0);
  });

  it('has a plain-language message and the "Key not supported" title', () => {
    expect(S.keyErrors.CRED_PROTECT_UNSUPPORTED).toMatch(/PIN/);
    expect(noticeTitle(S.keyErrors.CRED_PROTECT_UNSUPPORTED!)).toBe('Key not supported');
  });
});

describe('signing assertions are only used with UV (unlock and user operations)', () => {
  it('a level-3 credential cannot be asserted without UV at all (the key hides it)', async () => {
    const i = f.addKey();
    await enrollKey({ ...rp, label: 'k', exclude: [] }, f.credentials);
    f.keys[i]!.opts.uv = false;
    const err = await evaluatePrf({ rpId: 'localhost' }, f.credentials).catch((e) => e);
    expect(err.code).toBe('CANCELLED');
  });

  it('the user-operation getFn rejects a signature whose authenticatorData lacks UV, before it reaches the wallet', async () => {
    const i = f.addKey({ enforcesCredProtect: false }); // a faulty key that ignores credProtect
    const k = await enrollKey({ ...rp, label: 'k', exclude: [] }, f.credentials);
    const expectedLocator = deriveLocator(await f.prfFor(k.credId, locatorSalt()));
    f.keys[i]!.opts.uv = false;
    const owner = toWebAuthnAccount({ credential: { id: toB64(k.credId), publicKey: k.publicKey }, getFn: prfCapturingGetFn({ expectedLocator, credentials: f.credentials }) as never, rpId: 'localhost' });
    const err = await owner.sign({ hash: ('0x' + '11'.repeat(32)) as `0x${string}` }).catch((e) => e);
    expect(findKeyError(err)?.code).toBe('USER_NOT_VERIFIED');
  });

  it('the user-operation getFn always asks for UV required', async () => {
    f.addKey();
    const k = await enrollKey({ ...rp, label: 'k', exclude: [] }, f.credentials);
    const expectedLocator = deriveLocator(await f.prfFor(k.credId, locatorSalt()));
    const owner = toWebAuthnAccount({ credential: { id: toB64(k.credId), publicKey: k.publicKey }, getFn: prfCapturingGetFn({ expectedLocator, credentials: f.credentials }) as never, rpId: 'localhost' });
    await owner.sign({ hash: ('0x' + '22'.repeat(32)) as `0x${string}` });
    expect(f.calls.at(-1)!.options.publicKey.userVerification).toBe('required');
  });
});

describe('enrollment cancel wording', () => {
  it('a NotAllowedError during enrollment (cancel OR an enforced credProtect refusal) explains both', async () => {
    const { messageFor } = await import('../../src/ui/operations');
    f.addKey({ credProtect: false });
    const err = await enrollKey({ ...rp, label: 'k', exclude: [] }, f.credentials).catch((e) => e);
    expect(err.code).toBe('CANCELLED');
    expect(messageFor(err)).toBe(S.enrollCancelled);
    expect(noticeTitle(S.enrollCancelled)).toBe('Key not supported');
  });
  it('a cancelled unlock keeps the plain cancel message', async () => {
    const { messageFor } = await import('../../src/ui/operations');
    f.addKey();
    f.cancelNext = true;
    const err = await evaluatePrf({ rpId: 'localhost' }, f.credentials).catch((e) => e);
    expect(messageFor(err)).toBe(S.keyErrors.CANCELLED);
  });
});
