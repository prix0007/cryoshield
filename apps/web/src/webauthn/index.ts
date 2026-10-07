/**
 * WebAuthn ceremonies against FIDO2 hardware keys (spec hardware-key-auth).
 * - one PRF input per ceremony (vault-crypto locator salt), UV always "required";
 * - every create/get response passes assertUserVerified BEFORE its PRF output is used;
 * - PRF outputs are returned to the caller, who owns (and must wipe) them. Nothing is stored.
 */
import {
  assertCredProtectUvRequired,
  assertUserVerified,
  deriveLocator,
  VaultError,
  webauthnPrfCreateOptions,
  webauthnPrfGetOptions,
} from '@cryoshield/vault-crypto';
import { bytesEqual, randomBytes, toBytes, toHex, wipe, type Hex } from '../lib/bytes';

export type KeyErrorCode =
  | 'CANCELLED'
  | 'DUPLICATE_KEY'
  | 'PRF_UNSUPPORTED_KEY'
  | 'PRF_UNSUPPORTED_BROWSER'
  | 'PRF_UNAVAILABLE'
  | 'USER_NOT_VERIFIED'
  | 'WRONG_ALGORITHM'
  | 'WRONG_KEY'
  | 'MISCONFIGURED'
  /** The key did not confirm credProtect level 3: it could sign without its PIN (audit AA-H1). Never enrolled. */
  | 'CRED_PROTECT_UNSUPPORTED';

export class KeyError extends Error {
  override name = 'KeyError';
  constructor(readonly code: KeyErrorCode, message?: string) {
    super(message ?? code);
  }
}

/** Finds a KeyError anywhere in an error's cause chain (viem/ox wrap getFn errors). */
export function findKeyError(e: unknown): KeyError | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur; i++) {
    if (cur instanceof KeyError) return cur;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

export interface CredentialsApi {
  create(options: CredentialCreationOptions): Promise<unknown>;
  get(options: CredentialRequestOptions): Promise<unknown>;
}

export interface EnrolledKey {
  credId: Uint8Array;
  /** Uncompressed P-256 public key without the 0x04 prefix: x || y (64 bytes). */
  publicKey: Hex;
  /** Present only if the authenticator evaluated PRF during create. Caller must wipe. */
  prf?: Uint8Array;
}

const TIMEOUT_MS = 120_000;
/** KeyError message marking a CANCELLED that happened during enrollment (may also mean "no credProtect"). */
export const ENROLL = 'enroll';
const ES256 = -7;

function defaultCredentials(): CredentialsApi {
  if (typeof navigator === 'undefined' || !navigator.credentials) throw new KeyError('PRF_UNSUPPORTED_BROWSER');
  return navigator.credentials;
}

function mapDomError(e: unknown): never {
  if (e instanceof KeyError) throw e;
  if (e instanceof VaultError && e.code === 'USER_NOT_VERIFIED') throw new KeyError('USER_NOT_VERIFIED');
  if (e instanceof VaultError && e.code === 'CRED_PROTECT_UNSUPPORTED') throw new KeyError('CRED_PROTECT_UNSUPPORTED');
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') throw new KeyError('CANCELLED');
  if (name === 'InvalidStateError') throw new KeyError('DUPLICATE_KEY');
  if (name === 'SecurityError') throw new KeyError('MISCONFIGURED');
  if (name === 'NotSupportedError') throw new KeyError('WRONG_ALGORITHM');
  throw e;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * vault-list-labels-archive D12: the credential's user.name and displayName, "CryoShield vault \u00b7 Oct 2026 (key 1)".
 * The creation month only (English, local clock, independent of locale). NEVER the vault name: credential labels are
 * stored unencrypted on the key and shown by browsers and credential managers.
 */
export function credentialLabel(n: number, now: Date = new Date()): string {
  return `CryoShield vault \u00b7 ${MONTHS[now.getMonth()]} ${now.getFullYear()} (key ${n})`;
}

/** True when `host` may use `rpId` (exact match or a subdomain). */
export function rpIdAllowed(host: string, rpId: string): boolean {
  const h = host.toLowerCase();
  const r = rpId.toLowerCase();
  return h === r || h.endsWith('.' + r);
}

type PkcStatic = { getClientCapabilities?: () => Promise<Record<string, boolean | undefined>> } | undefined;

/** Browser PRF capability: "unknown" when the browser has WebAuthn but no capability API (checked after create). */
export async function detectPrfSupport(
  pkc: PkcStatic = (globalThis as { PublicKeyCredential?: PkcStatic }).PublicKeyCredential,
): Promise<'supported' | 'unsupported' | 'unknown'> {
  if (!pkc) return 'unsupported';
  if (typeof pkc.getClientCapabilities !== 'function') return 'unknown';
  try {
    const caps = await pkc.getClientCapabilities();
    if (caps['extension:prf'] === true) return 'supported';
    if (caps['extension:prf'] === false) return 'unsupported';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** P-256 SPKI DER (91 bytes) -> x||y. */
function spkiToXY(spki: Uint8Array): Uint8Array {
  const prefix = '3059301306072a8648ce3d020106082a8648ce3d030107034200';
  if (spki.length !== 91 || toHex(spki.subarray(0, 26)).slice(2) !== prefix || spki[26] !== 0x04) {
    throw new KeyError('WRONG_ALGORITHM');
  }
  return spki.slice(27);
}

interface PrfExtResults {
  prf?: { enabled?: boolean; results?: { first?: BufferSource } };
}

function prfFirst(ext: PrfExtResults): Uint8Array | undefined {
  const first = ext.prf?.results?.first;
  if (!first) return undefined;
  const out = toBytes(first as ArrayBuffer);
  if (out.length !== 32) {
    wipe(out);
    throw new KeyError('PRF_UNAVAILABLE');
  }
  return out;
}

export async function enrollKey(
  params: { rpId: string; rpName: string; label: string; exclude: readonly Uint8Array[] },
  credentials: CredentialsApi = defaultCredentials(),
): Promise<EnrolledKey> {
  const frag = webauthnPrfCreateOptions();
  let cred: {
    rawId: ArrayBuffer;
    response: {
      getAuthenticatorData(): ArrayBuffer;
      getPublicKey(): ArrayBuffer | null;
      getPublicKeyAlgorithm(): number;
    };
    getClientExtensionResults(): PrfExtResults;
  };
  try {
    cred = (await credentials.create({
      publicKey: {
        rp: { id: params.rpId, name: params.rpName },
        user: { id: randomBytes(16), name: params.label, displayName: params.label },
        challenge: randomBytes(32),
        pubKeyCredParams: [{ type: 'public-key', alg: ES256 }],
        authenticatorSelection: {
          ...frag.authenticatorSelection,
          requireResidentKey: true,
          authenticatorAttachment: 'cross-platform',
        },
        excludeCredentials: params.exclude.map((id) => ({ type: 'public-key' as const, id: new Uint8Array(id) })),
        attestation: 'none',
        timeout: TIMEOUT_MS,
        // PRF input + credProtect level 3 (userVerificationRequired) with enforcement (enforce-credprotect-uv).
        extensions: frag.extensions as AuthenticationExtensionsClientInputs,
      },
    })) as typeof cred;
  } catch (e) {
    // An enforcing browser rejects a key without credProtect support exactly like a user cancel (NotAllowedError).
    const name = (e as { name?: string } | null)?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') throw new KeyError('CANCELLED', ENROLL);
    mapDomError(e);
  }
  if (!cred) throw new KeyError('CANCELLED', ENROLL);
  let prf: Uint8Array | undefined;
  try {
    const authData = toBytes(cred.response.getAuthenticatorData());
    assertUserVerified(authData);
    // The key itself must refuse any assertion without its PIN; browsers do not report this in the client extension
    // results, so it is read from the authenticator's extension output in authenticatorData.
    assertCredProtectUvRequired(authData);
    const ext = cred.getClientExtensionResults();
    prf = prfFirst(ext);
    if (ext.prf?.enabled !== true && !prf) throw new KeyError('PRF_UNSUPPORTED_KEY');
    if (cred.response.getPublicKeyAlgorithm() !== ES256) throw new KeyError('WRONG_ALGORITHM');
    const spki = cred.response.getPublicKey();
    if (!spki) throw new KeyError('WRONG_ALGORITHM');
    const credId = toBytes(cred.rawId);
    if (params.exclude.some((x) => bytesEqual(x, credId))) throw new KeyError('DUPLICATE_KEY');
    const out: EnrolledKey = { credId, publicKey: toHex(spkiToXY(toBytes(spki))) };
    if (prf) out.prf = prf;
    return out;
  } catch (e) {
    wipe(prf);
    mapDomError(e);
  }
}

export interface PrfAssertion {
  credId: Uint8Array;
  /** Caller owns and must wipe. */
  prf: Uint8Array;
}

/**
 * One PRF ceremony. Without `credId` it is discoverable (unlock: the user just taps a key).
 * Exactly one PRF input is sent: eval.first = locatorSalt().
 */
export async function evaluatePrf(
  params: { rpId: string; credId?: Uint8Array },
  credentials: CredentialsApi = defaultCredentials(),
): Promise<PrfAssertion> {
  const frag = webauthnPrfGetOptions();
  let cred: {
    rawId: ArrayBuffer;
    response: { authenticatorData: ArrayBuffer };
    getClientExtensionResults(): PrfExtResults;
  };
  try {
    const publicKey: PublicKeyCredentialRequestOptions = {
      rpId: params.rpId,
      challenge: randomBytes(32),
      userVerification: frag.userVerification,
      timeout: TIMEOUT_MS,
      extensions: frag.extensions as AuthenticationExtensionsClientInputs,
    };
    if (params.credId) publicKey.allowCredentials = [{ type: 'public-key', id: new Uint8Array(params.credId) }];
    cred = (await credentials.get({ publicKey })) as typeof cred;
  } catch (e) {
    mapDomError(e);
  }
  if (!cred) throw new KeyError('CANCELLED');
  let prf: Uint8Array | undefined;
  try {
    assertUserVerified(toBytes(cred.response.authenticatorData));
    prf = prfFirst(cred.getClientExtensionResults());
    if (!prf) throw new KeyError('PRF_UNAVAILABLE');
    const credId = toBytes(cred.rawId);
    if (params.credId && !bytesEqual(params.credId, credId)) throw new KeyError('WRONG_KEY');
    return { credId, prf };
  } catch (e) {
    wipe(prf);
    mapDomError(e);
  }
}

/**
 * getFn for viem's toWebAuthnAccount (design D5). ox builds the request options and calls getFn; this wrapper
 * adds the PRF extension and UV "required" to the same signing ceremony, checks the UV flag, and verifies that
 * the key that signed is the expected enrolled key (its derived locator must equal `expectedLocator`).
 * The captured PRF output is wiped immediately; it is never returned.
 */
export function prfCapturingGetFn(opts: { expectedLocator: Uint8Array; credentials?: CredentialsApi }) {
  return async (options?: CredentialRequestOptions): Promise<Credential | null> => {
    const credentials = opts.credentials ?? defaultCredentials();
    const frag = webauthnPrfGetOptions();
    const publicKey = {
      ...(options?.publicKey ?? ({} as PublicKeyCredentialRequestOptions)),
      userVerification: frag.userVerification,
      timeout: TIMEOUT_MS,
      extensions: { ...(options?.publicKey?.extensions ?? {}), ...frag.extensions } as AuthenticationExtensionsClientInputs,
    };
    let cred: {
      response: { authenticatorData: ArrayBuffer };
      getClientExtensionResults(): PrfExtResults;
    };
    try {
      cred = (await credentials.get({ ...options, publicKey })) as typeof cred;
    } catch (e) {
      mapDomError(e);
    }
    let prf: Uint8Array | undefined;
    let loc: Uint8Array | undefined;
    try {
      assertUserVerified(toBytes(cred.response.authenticatorData));
      prf = prfFirst(cred.getClientExtensionResults());
      if (!prf) throw new KeyError('PRF_UNAVAILABLE');
      loc = deriveLocator(prf);
      if (!bytesEqual(loc, opts.expectedLocator)) throw new KeyError('WRONG_KEY');
      return cred as unknown as Credential;
    } catch (e) {
      mapDomError(e);
    } finally {
      wipe(prf, loc);
    }
  };
}
