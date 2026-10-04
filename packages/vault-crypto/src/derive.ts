import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ascii, concat } from './bytes.js';
import { INFO_LOCATOR, INFO_WRAP, LOCATOR_SALT_INPUT, PRF_OUTPUT_BYTES, USER_VERIFICATION, WRAP_SALT_BYTES } from './constants.js';
import { VaultError } from './errors.js';

const LOCATOR_SALT = sha256(ascii(LOCATOR_SALT_INPUT));
const CTAP_SALT = sha256(concat(ascii('WebAuthn PRF'), Uint8Array.of(0), LOCATOR_SALT));
const INFO_LOCATOR_BYTES = ascii(INFO_LOCATOR);
const INFO_WRAP_BYTES = ascii(INFO_WRAP);

/** The single PRF input for every ceremony: SHA-256("cryoshield/v1/locator-salt"). Returns a fresh copy. */
export function locatorSalt(): Uint8Array {
  return LOCATOR_SALT.slice();
}

/** CTAP2 hmac-secret salt equivalent to the WebAuthn PRF input: SHA-256("WebAuthn PRF" || 0x00 || locatorSalt). */
export function ctapSalt(): Uint8Array {
  return CTAP_SALT.slice();
}

export interface PrfExtensionInput {
  prf: { eval: { first: Uint8Array } };
}

/**
 * CTAP 2.1 credProtect, requested at registration (enforce-credprotect-uv): level 3 makes the authenticator refuse
 * ANY assertion for this credential without user verification, even when the caller names the (public) credential
 * ID. `enforce: true` makes the browser fail create() rather than silently create a weaker credential.
 */
export interface CredProtectExtensionInput {
  credentialProtectionPolicy: 'userVerificationRequired';
  enforceCredentialProtectionPolicy: true;
}

/** Fragment for `navigator.credentials.create({ publicKey: { ...this, rp, user, challenge, … } })`. */
export interface WebAuthnPrfCreateOptions {
  /** create() reads UV only from authenticatorSelection; a top-level field is ignored. */
  authenticatorSelection: { userVerification: typeof USER_VERIFICATION; residentKey: 'required' };
  extensions: PrfExtensionInput & CredProtectExtensionInput;
}

/** Fragment for `navigator.credentials.get({ publicKey: { ...this, challenge, … } })`. */
export interface WebAuthnPrfGetOptions {
  userVerification: typeof USER_VERIFICATION;
  extensions: PrfExtensionInput;
}

const prfExtension = (): PrfExtensionInput => ({ prf: { eval: { first: locatorSalt() } } });

/**
 * Registration options fragment (spec §3.1): UV "required" inside
 * authenticatorSelection, a discoverable credential, the locator salt as the
 * only PRF input, and credProtect level 3 with enforcement (§3.1a).
 */
export function webauthnPrfCreateOptions(): WebAuthnPrfCreateOptions {
  return {
    authenticatorSelection: { userVerification: USER_VERIFICATION, residentKey: 'required' },
    extensions: { ...prfExtension(), credentialProtectionPolicy: 'userVerificationRequired', enforceCredentialProtectionPolicy: true },
  };
}

/** Assertion options fragment (spec §3.1): top-level UV "required" and the locator salt as the only PRF input. */
export function webauthnPrfGetOptions(): WebAuthnPrfGetOptions {
  return { userVerification: USER_VERIFICATION, extensions: prfExtension() };
}

/** UV flag: bit 2 of the flags byte at offset 32 of authenticatorData. */
const UV_FLAG = 0x04;

/**
 * Spec §3.1: call on the `authenticatorData` of every create() / get()
 * response BEFORE using its PRF output. Throws USER_NOT_VERIFIED if the
 * authenticator did not perform user verification (the PRF output would then
 * come from CredRandomWithoutUV and never match the recovery tool), and
 * INVALID_ARGUMENT if the data is shorter than 37 bytes.
 */
export function assertUserVerified(authenticatorData: Uint8Array): void {
  if (!(authenticatorData instanceof Uint8Array) || authenticatorData.length < 37) {
    throw new VaultError('INVALID_ARGUMENT', { hint: 'authenticatorData must be at least 37 bytes' });
  }
  if ((authenticatorData[32]! & UV_FLAG) === 0) throw new VaultError('USER_NOT_VERIFIED');
}

export function assertPrf(prf: unknown): asserts prf is Uint8Array {
  if (!(prf instanceof Uint8Array) || prf.length !== PRF_OUTPUT_BYTES) {
    throw new VaultError('INVALID_ARGUMENT', { hint: 'PRF output must be 32 bytes' });
  }
}

/**
 * locator = HKDF-SHA256(prf, salt = empty, info = "cryoshield/v1/locator", 32).
 * Does NOT wipe `prf`: the single-tap flow still needs it to open the fetched blob.
 */
export function deriveLocator(prf: Uint8Array): Uint8Array {
  assertPrf(prf);
  return hkdf(sha256, prf, new Uint8Array(0), INFO_LOCATOR_BYTES, 32);
}

/**
 * wrapKey = HKDF-SHA256(prf, salt = wrapSalt, info = "cryoshield/v1/wrap", 32).
 * Does NOT wipe `prf`. The caller owns (and must wipe) the returned key.
 */
export function deriveWrapKey(prf: Uint8Array, wrapSalt: Uint8Array): Uint8Array {
  assertPrf(prf);
  if (!(wrapSalt instanceof Uint8Array) || wrapSalt.length !== WRAP_SALT_BYTES) {
    throw new VaultError('INVALID_ARGUMENT', { hint: 'wrap salt must be 32 bytes' });
  }
  return hkdf(sha256, prf, wrapSalt, INFO_WRAP_BYTES, 32);
}
