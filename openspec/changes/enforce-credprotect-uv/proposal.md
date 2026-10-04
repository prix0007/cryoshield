# Proposal

## Why

The October 2026 internal security audit (`docs/reviews/security-audit-2026-10.md`, PR #20) proved **AA-H1**:
- Coinbase Smart Wallet v1.1 verifies WebAuthn signatures with `requireUV: false` and ignores `rpIdHash` and origin.
- A vault's credential IDs are public: they are stored in the blob on-chain and on Arweave.
- With the default credProtect levels (1 or 2), a stolen key with **no PIN** can therefore produce an assertion: flags
  0x01, any rpId, any origin.

That assertion is enough to sign user operations, add an owner and overwrite the vault. Our client's "UV required"
options don't help, because the attacker runs their own client.

## What Changes

- **Enrollment** requests CTAP 2.1 credProtect **level 3** (`credentialProtectionPolicy: "userVerificationRequired"`,
  `enforceCredentialProtectionPolicy: true`). This is set in vault-crypto's `webauthnPrfCreateOptions()`, which the web
  app's create path uses.
- **Confirmation:** after `create()`, the level is read from the registration authenticator data (the CBOR extension
  output; browsers don't report it in `getClientExtensionResults()`). Anything but 3 fails with the new vault-crypto
  error `CRED_PROTECT_UNSUPPORTED`. In the web app this becomes `KeyError('CRED_PROTECT_UNSUPPORTED')` with a
  plain-language message, and the key is never enrolled, so a vault is never saved on it.
- **Enrollment cancel wording:** an enforcing browser reports "this key can't do credProtect" as `NotAllowedError`,
  which is indistinguishable from a cancel. An enrollment cancel therefore explains both possibilities.
- **Signing:** UV was already required. The user-operation `getFn` already rejects an assertion without the UV flag
  before it reaches the wallet; this change adds tests that prove it.
- **Docs:** vault-format §3.1a, the error table, the system design and the web-app spec now say "UV is mandatory,
  enforced by the authenticator via credProtect level 3", and record the residual risk.
- **Recovery tool:** no change. CTAP2 `getAssertion` with `hmac-secret` and UV (PIN) works for credProtect-3
  credentials, and the tool always does UV.

## Capabilities

### Modified Capabilities
- `vault-crypto`: User verification required (credProtect level 3 in the create options, plus the confirmation
  check); Named error codes (`CRED_PROTECT_UNSUPPORTED`).
- The web app's `hardware-key-auth` (in the unarchived `add-web-app` change) is updated in place: Fixed
  user-verification policy.

## Impact

- **Code:** `packages/vault-crypto` (`derive.ts`, the new `credprotect.ts`, `errors.ts`, `index.ts`) and `apps/web`
  (`src/webauthn`, `src/ui/strings.ts`, `ceremony.ts`, `operations.ts`).
- **Tests:** unit tests in both packages; the E2E key fixture plus `13-credprotect.spec.ts`.
- **Docs:** `docs/spec/vault-format-v1.md`, `docs/system-design.md`.
- **Users:** keys that cannot do credProtect level 3 can no longer be enrolled. That means CTAP 2.0-only keys, and
  browsers that drop the extension. Existing vaults on such keys still unlock, but must be re-created. The only such
  vault is the founder's test vault.
- **No** contract, backend or dependency change.
