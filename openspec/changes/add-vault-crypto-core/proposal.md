# Proposal

## Why

CryoShield's promise is that a secret stored today can be decrypted decades from now with nothing but an enrolled FIDO2 hardware key, even if CryoShield no longer exists. Every other component (contract, web app, desktop recovery tool, Arweave mirror) depends on a single, precisely specified, versioned vault format and key-derivation scheme. That format must be defined, implemented, and pinned down with test vectors first (PRD Phase 1).

## What Changes

- Introduce a versioned binary **vault blob format (v1)** with:
  - magic and version bytes, a suite (algorithm) ID, and an unlock mode;
  - the RP ID, a per-vault PRF wrap salt, and per-key credential IDs;
  - per-key wrapped data keys, and the payload ciphertext.
- Define **single-tap key derivation**: each ceremony evaluates one PRF input (the global locator salt), and that output derives both:
  - the **locator** (on-chain lookup key): HKDF-SHA256, empty salt, info `cryoshield/v1/locator`;
  - the **per-key wrapping key**: HKDF-SHA256, salt = per-vault wrap salt from the blob, info `cryoshield/v1/wrap`.
- PRF outputs are zeroized after use and never persisted.
- **Candidate selection:** when a locator resolves to several vaultIds (squatting), the client picks the one that authenticates.
- **Envelope encryption:** a random 256-bit data key encrypts the payload with AES-256-GCM, and each enrolled key wraps the data key with AES-256-GCM.
- **Unlock modes:**
  - **any-of-N** (default, N ≥ 2): any single enrolled key unlocks;
  - **Shamir M-of-N** (optional): the data key is split, and each key wraps one share.
- Enforce a **total blob size cap of 1024 bytes** and length-hiding payload padding.
- Publish **deterministic test vectors** (JSON) covering every mode and the error cases. The web app, contract tests, and desktop recovery tool all validate against these vectors.
- Deliver a TypeScript library `@cryoshield/vault-crypto`. Allowed runtime dependencies: WebCrypto, `@noble/hashes`, `@noble/ciphers`, and `shamir-secret-sharing` (Privy; reportedly audited by Cure53 and Zellic, to be verified before use) for mode 0x02.

**Out of scope:**
- WebAuthn ceremonies and browser UI (web app change)
- Smart contracts and paymaster (contract change)
- Arweave and L1 anchoring
- The desktop recovery tool itself (it consumes this spec and these vectors)
- Key add/replace flows
- Any public-key or elliptic-curve encryption (ECIES/RSA/ECDH)

**Runtime dependencies:** none beyond the browser/Node WebCrypto API and the three libraries above. This adds no CryoShield-operated backend.

## Capabilities

### New Capabilities
- `vault-crypto`: the vault blob format v1, PRF-based key derivation (locator and wrapping keys), envelope encryption, any-of-N and Shamir M-of-N unlock modes, size limits, and test vectors.

### Modified Capabilities
- None.

## Impact

- New package `packages/vault-crypto` (TypeScript library, no network access).
- New published spec document `docs/spec/vault-format-v1.md` and test vectors `packages/vault-crypto/test-vectors/v1.json`.
- Downstream consumers:
  - the vault contract treats the blob as opaque bytes and maps each locator to an append-only, capped list of vaultIds;
  - the web app;
  - the desktop recovery tool (must reproduce derivations byte-for-byte);
  - the Arweave mirror.
- The format is permanent once vaults exist on mainnet. Any later change requires a new version byte, and v1 decoding must be supported forever.
