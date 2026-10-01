# Proposal

## Why

The vault format (`vault-crypto`) and the on-chain store (`vault-registry`) are only useful once a non-technical person can create, unlock, and edit a vault with nothing but two YubiKeys and a browser. This is PRD Phase 3 (the end-to-end flow) plus the Arweave half of Phase 4. It is the first change that real users touch.

## What Changes

- New static **Vite + React + TypeScript** app in `apps/web`, deployable to any static host (and later IPFS/ENS). There is no CryoShield-operated server.
- **Hardware-key enrollment** of at least 2 FIDO2 keys:
  - discoverable credentials;
  - user verification always required, so the PRF output is stable;
  - RP ID taken from configuration;
  - PRF support detected, with a plain-language failure for keys older than firmware 5.2 or unsupported browsers.
- **Single-tap unlock:**
  - one WebAuthn PRF ceremony;
  - locator derivation and candidate lookup through a public RPC (`eth_call` only, no account, no gas);
  - candidate selection and decryption via `@cryoshield/vault-crypto`.
- **Sponsored writes via an ERC-4337 smart account:**
  - a Coinbase Smart Wallet whose owners are the enrolled keys' WebAuthn P-256 public keys, driven by `viem/account-abstraction`;
  - submitted through the Pimlico bundler, with gas sponsored by a CryoShield-funded Pimlico paymaster under a sponsorship policy;
  - flows: create vault, edit secrets, add a key.
- **Arweave mirror:** after every successful vault write, the app uploads the exact blob through ArDrive Turbo, tagged so the recovery tool can find it via Arweave GraphQL. It re-uploads on unlock if the current version is missing.
- **Vault payload encoding v1:** a small versioned format for the list of labelled secrets inside the encrypted payload. It is published so the recovery tool can display secrets.
- **Plain-language, WCAG 2.2 AA UI** for four flows: create vault, add key, unlock, and view/copy secrets.
- **Security posture:**
  - strict Content-Security-Policy and Trusted Types;
  - no analytics;
  - secrets and PRF outputs only in memory, with auto-lock;
  - nothing secret in any browser storage.
- **Tests:** Vitest + Testing Library units; Playwright E2E on Chromium with a CDP virtual authenticator (PRF enabled) against a local chain, bundler, and mock paymaster.

**Out of scope:**
- Ethereum L1 hash anchor (deferred to a later change).
- Removing or replacing a key, and Shamir M-of-N creation in the UI (format supports it; UI ships any-of-N only).
- IPFS/ENS pinning and mainnet deployment (Phase 6).
- Desktop recovery tool (consumes the payload encoding published here).
- Multiple vaults per user, vault deletion, and sharing.
- Native mobile apps.
- Configuring the Pimlico dashboard itself: the policy settings are specified here, but applying them is an operations step.

**Runtime dependencies added** (all third-party, none operated by CryoShield):
- public Arbitrum RPC (reads);
- Pimlico bundler + paymaster API (writes; CryoShield pays Pimlico);
- ArDrive Turbo upload service and an Arweave gateway (GraphQL + data).

npm dependencies: `react`, `react-dom`, `viem`, `permissionless`, `@ardrive/turbo-sdk`, and the workspace packages `@cryoshield/vault-crypto` and the VaultRegistry ABI. **This is not a CryoShield-operated backend.**

## Capabilities

### New Capabilities
- `hardware-key-auth`: WebAuthn enrollment and PRF ceremonies against FIDO2 hardware keys: PRF capability detection, discoverable credentials, fixed user-verification policy, configured RP ID, and the one-tap unlock ceremony.
- `sponsored-vault-writes`: the passkey-owned smart account and gas-sponsored writes to the VaultRegistry (create, edit, add key), including the sponsorship policy limits and failure handling.
- `arweave-vault-mirror`: uploading every written vault blob to Arweave with discoverable tags, and verifying or repairing the mirror on unlock.
- `vault-web-app`: the user-facing flows, the vault payload encoding, in-memory secret handling, accessibility, content-security policy, and configuration of the static app.

### Modified Capabilities
- None. `vault-crypto` and `vault-registry` are consumed as specified. Two additions are requested from the crypto engineer and listed in design.md (Dependencies); they don't change any existing requirement.

## Impact

- **New code:** `apps/web/` (app, unit tests, Playwright E2E, `.env.example`, `docs/payload-v1.md`).
- **Consumes:**
  - `@cryoshield/vault-crypto`: `createVault`, `selectVault`, `deriveLocator`, `locatorSalt`, `maxPayloadBytes`, plus a requested payload-only re-encrypt;
  - the VaultRegistry ABI and deployment address from `contracts/`.
- **External accounts:**
  - a Pimlico project with a funded sponsorship policy;
  - an RP ID domain that the app is served from.
- **Shared contract with the recovery tool:**
  - the payload encoding v1;
  - the Arweave tag schema;
  - the user-verification policy (UV always required), which changes the hmac-secret output.
- **Cost:** CryoShield pays the gas for each sponsored write (estimate in design.md). Arweave uploads of at most 105 KiB fall in Turbo's free tier.
