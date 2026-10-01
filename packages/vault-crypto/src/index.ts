/**
 * @cryoshield/vault-crypto: public API.
 * Spec: docs/spec/vault-format-v1.md. Vectors: test-vectors/v1.json.
 */
export {
  createVault,
  openVault,
  selectVault,
  addKey,
  updatePayload,
  type Credential,
  type UnlockKey,
  type CreateVaultParams,
  type CreateVaultResult,
  type SelectVaultResult,
  type AddKeyResult,
  type RngOptions,
} from './vault.js';
export {
  locatorSalt,
  ctapSalt,
  webauthnPrfCreateOptions,
  webauthnPrfGetOptions,
  assertUserVerified,
  deriveLocator,
  deriveWrapKey,
  type WebAuthnPrfCreateOptions,
  type WebAuthnPrfGetOptions,
  type PrfExtensionInput,
} from './derive.js';
export { decodeVault, encodeVault, maxPayloadBytes, type DecodedVault, type VaultEntry, type VaultFields } from './format.js';
export { VaultError, type VaultErrorCode } from './errors.js';
// The deterministic replay RNG lives in '@cryoshield/vault-crypto/testing' only.
export { webCryptoRng, type Rng } from './rng.js';
export {
  FORMAT_VERSION,
  SUITE_HKDF_SHA256_AES256GCM,
  MODE_ANY_OF_N,
  MODE_SHAMIR,
  MAX_BLOB_BYTES,
  MIN_KEYS,
  MAX_KEYS,
  USER_VERIFICATION,
  type VaultMode,
} from './constants.js';
