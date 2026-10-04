/** Stable error codes shared with the test vectors and the recovery tool (spec §10). */
export type VaultErrorCode =
  | 'BAD_MAGIC'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_SUITE'
  | 'UNSUPPORTED_MODE'
  | 'MALFORMED'
  | 'VAULT_TOO_LARGE'
  | 'TOO_FEW_KEYS'
  | 'TOO_MANY_KEYS'
  | 'INVALID_ARGUMENT'
  | 'NO_MATCHING_KEY'
  | 'INSUFFICIENT_SHARES'
  | 'AUTH_FAILED'
  | 'NO_MATCHING_VAULT'
  | 'USER_NOT_VERIFIED'
  | 'CRED_PROTECT_UNSUPPORTED';

const MESSAGES: Record<VaultErrorCode, string> = {
  BAD_MAGIC: 'not a CryoShield vault',
  UNSUPPORTED_VERSION: 'unsupported version',
  UNSUPPORTED_SUITE: 'unsupported suite',
  UNSUPPORTED_MODE: 'unsupported mode',
  MALFORMED: 'malformed vault',
  VAULT_TOO_LARGE: 'vault too large',
  TOO_FEW_KEYS: 'at least 2 keys required',
  TOO_MANY_KEYS: 'at most 8 keys allowed',
  INVALID_ARGUMENT: 'invalid argument',
  NO_MATCHING_KEY: 'no matching key',
  INSUFFICIENT_SHARES: 'insufficient shares',
  AUTH_FAILED: 'authentication failed',
  NO_MATCHING_VAULT: 'no matching vault',
  USER_NOT_VERIFIED: 'user verification was not performed',
  CRED_PROTECT_UNSUPPORTED: 'the key did not confirm credProtect level 3 (user verification required)',
};

/**
 * The only error type the library throws for vault operations. Messages are
 * fixed per code (plus a non-secret hint for argument errors) so they can
 * never act as a decryption oracle.
 */
export class VaultError extends Error {
  readonly code: VaultErrorCode;
  /** Set for VAULT_TOO_LARGE: the largest secret (bytes) that fits. */
  readonly maxPayloadBytes?: number;

  constructor(code: VaultErrorCode, opts: { hint?: string; maxPayloadBytes?: number } = {}) {
    let msg = MESSAGES[code];
    if (opts.maxPayloadBytes !== undefined) msg += `: maximum payload size is ${opts.maxPayloadBytes} bytes`;
    else if (opts.hint) msg += `: ${opts.hint}`;
    super(msg);
    this.name = 'VaultError';
    this.code = code;
    if (opts.maxPayloadBytes !== undefined) this.maxPayloadBytes = opts.maxPayloadBytes;
  }
}
