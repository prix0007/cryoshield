/** Format constants for vault v1 (docs/spec/vault-format-v1.md §2). */
/** "CRYO". Internal; never mutate. */
export const MAGIC = Uint8Array.of(0x43, 0x52, 0x59, 0x4f);
export const FORMAT_VERSION = 0x01;
export const SUITE_HKDF_SHA256_AES256GCM = 0x01;
export const MODE_ANY_OF_N = 0x01;
/** Experimental: Shamir M-of-N is not part of the default MVP flow. */
export const MODE_SHAMIR = 0x02;
export type VaultMode = typeof MODE_ANY_OF_N | typeof MODE_SHAMIR;

export const MAX_BLOB_BYTES = 1024;
export const MIN_KEYS = 2;
export const MAX_KEYS = 8;
export const MAX_RP_ID_BYTES = 64;
export const MAX_CRED_ID_BYTES = 128;
export const PRF_OUTPUT_BYTES = 32;
export const KEY_BYTES = 32;
export const WRAP_SALT_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const PAD_BLOCK = 64;
export const SHARE_BYTES = 1 + KEY_BYTES;

export const LOCATOR_SALT_INPUT = 'cryoshield/v1/locator-salt';
export const INFO_LOCATOR = 'cryoshield/v1/locator';
export const INFO_WRAP = 'cryoshield/v1/wrap';
/** Every PRF ceremony MUST use UV "required" (spec §3.1: CredRandomWithUV vs WithoutUV). */
export const USER_VERIFICATION = 'required' as const;
