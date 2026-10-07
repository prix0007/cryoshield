# Design

## Context

See proposal.md (Why). Requirements are in `specs/*/spec.md`. Current state:
- the repo has no `apps/` yet;
- `@cryoshield/vault-crypto` is being implemented in parallel, so this plan is written against its spec (`add-vault-crypto-core`);
- the VaultRegistry is specified in `add-vault-registry-contract`;
- the desktop recovery tool (`add-desktop-recovery-tool`) fixes two contracts this app must honour: the Arweave tag schema (D5) and UV-required PRF (D3).

Constraints:
- no CryoShield server;
- the app must never reimplement crypto;
- non-technical users;
- vault blob ≤ 1024 bytes.

Facts below marked **(verified)** were checked against upstream sources on 2026-10-02. Items marked **(assumption)** are verified in a named task before the code depends on them.

## Goals / Non-Goals

**Goals:**
- Fewest possible taps.
- Unlock works from a fresh browser with only a key.
- Every external service is replaceable by changing configuration.
- The app shell is small and auditable: the Turbo SDK is lazy-loaded and kept off the unlock path.

**Non-Goals:**
- Wallet connection (EOA/MetaMask).
- Multiple vaults per user.
- Key removal or rotation.
- Shamir creation UI.
- L1 hash anchor.
- Offline/PWA mode.
- i18n beyond English, though strings are centralised to allow it later.

## Decisions

### D1. Stack and layout
- Vite + React 19 + TypeScript (strict), with pnpm workspace package `apps/web`.
- Plain React state with a small `VaultSession` context; no state library. The secrets live in one place, which makes zeroizing on lock easy.
- CSS Modules with no CSS-in-JS runtime, so no inline styles are needed (CSP).
- Modules:
  - `src/config` (env and deployment loading, validated with zod at build time);
  - `src/webauthn` (ceremonies, PRF capture, UV checks);
  - `src/vault` (thin adapter over `@cryoshield/vault-crypto` plus payload-v1 codec);
  - `src/chain` (viem public client and registry reads);
  - `src/account` (Coinbase Smart Account and the sponsored-operation builder);
  - `src/mirror` (Turbo upload and GraphQL check);
  - `src/ui` (flows).
- *Alternative rejected:* Next.js. It brings an SSR/server mindset, while a static export is all we need.

### D2. Smart account: Coinbase Smart Wallet via `viem/account-abstraction`
- `toCoinbaseSmartAccount({ client, owners: [toWebAuthnAccount(...)...], ownerIndex, version: '1.1' })`.
- **(verified)** viem supports versions `'1'` and `'1.1'`, takes an `ownerIndex` parameter, and wraps signatures as `(uint8 ownerIndex, bytes signatureData)`.
- **(verified)** It targets **EntryPoint v0.6**. Pimlico must therefore serve v0.6 on Arbitrum, and the local E2E stack must deploy EntryPoint v0.6 and the CBSW factory.
- Multi-owner: initial owners are the enrolled keys' P-256 public keys `(x, y)`, in blob credential order.
- **Invariant: owner index i equals blob entry i.** Owners are never removed in this change, and `addOwnerPublicKey` appends at `nextOwnerIndex`, so the invariant holds.
- At signing time:
  - the app learns the credential ID from the assertion and looks up its entry index in the decoded blob;
  - that index is the `ownerIndex`;
  - the public key is read on-chain with `ownerAtIndex(i)`.
  
  So nothing is stored locally.
- The account address comes from `getVault(vaultId).owner` for existing vaults. For new vaults it is computed counterfactually from the owners and nonce 0.
- *Alternatives rejected:*
  - a Safe with a WebAuthn signer: heavier, with more moving parts;
  - Kernel/ZeroDev: a vendor-specific validator;
  - a custom account: unaudited.

  CBSW is audited, multi-owner, and passkey-native.

### D3. P-256 verification cost on Arbitrum
- **(verified)** Arbitrum One and Nova support the RIP-7212 `P256VERIFY` precompile at `0x100`, activated in ArbOS 31 "Bianca". It costs about 3,450 gas.
- **(verified)** CBSW's `webauthn-sol` `WebAuthn.verify` calls `0x100` first and falls back to FreshCryptoLib in Solidity. It also checks the UV flag when `requireUV` is set.
- **Fallback cost** (chains or local nodes without the precompile, e.g. plain anvil): roughly 200–350k extra gas per signature check. On Arbitrum's L2 gas price this is a fraction of a cent. The fallback matters for E2E (gas limits) and a possible L1 move, not for Arbitrum cost.
- **Cost estimate per create** (account deploy about 300k, registry create about 700k for 1 KB, plus calldata L1 fee): about 1–1.2M L2 gas plus the L1 data fee for about 1.5 KB. This is expected at around $0.02–0.10. It is measured in task 6.6 and recorded in `apps/web/docs/costs.md`.

### D4. Bundler and paymaster: Pimlico
- Use permissionless.js `createSmartAccountClient` with a Pimlico client as bundler and paymaster, and `paymasterContext: { sponsorshipPolicyId }`. **(verified)** This is the documented way to pass a policy.
- **(verified)** Policies support global, per-user, and per-user-operation spend limits.
- **(verified)** API keys can be restricted by origin/domain, user agent, IP, and method allowlist.
- **(task 1.4 result: NOT verifiable, treated as unavailable)** Pimlico's docs don't document a policy rule that restricts sponsored targets or calldata to one contract or selector. **The global and per-account caps are therefore the real server-side backstop.**
  - The client-side allowlist (`src/account/policy.ts`) enforces value 0 plus allowlisted registry selectors and self `addOwnerPublicKey`, on both the calls and the decoded `execute`/`executeBatch` callData, inside the paymaster hook. It constrains honest clients only.
  - Pimlico sponsorship webhooks are **rejected**, because they need a server we operate.
  - Details and the settings to apply: `apps/web/docs/paymaster-policy.md`.
- **(task 1.4, verified with `cast code`)** The CBSW v1.1 factory (`0xBA5ED110…5842`) and EntryPoint v0.6 (`0x5FF137D4…2789`) have identical bytecode on Arbitrum Sepolia and Arbitrum One. Implementation: `0x00000110…534d`.
- **Private bundler endpoint:** operations go only to `VITE_BUNDLER_URL` (Pimlico) over HTTPS and never to a public ERC-4337 p2p mempool. Arbitrum's sequencer has no public pending-transaction pool. The protocol tolerates front-running anyway: a non-exclusive locator index, a `vaultId` retry, and a fresh credential on `LocatorFull`.
- Policy settings to apply in the dashboard (an operations step):
  - chain Arbitrum One / Sepolia, EntryPoint v0.6;
  - per-sender limit: 10 operations and $0.50 lifetime;
  - per-operation limit: $0.20;
  - global daily limit: $20, with an alert at 80%.
- The API key is public (it ships in the static bundle). The key is restricted to the production origin, and to bundler and paymaster methods only.
- *Alternatives rejected:*
  - our own paymaster plus a signer service: a backend;
  - Alchemy Gas Manager or Coinbase CDP paymaster: comparable features, but the overwatcher chose Pimlico. The adapter is isolated in `src/account`, so a swap is a configuration and adapter change.

### D5. Tap budget and the `getFn` PRF question
- **Unlock = 1 tap.** It uses `navigator.credentials.get` with no `allowCredentials` (discoverable), `userVerification: 'required'`, and `extensions.prf.eval.first = locatorSalt()`. Then: derive the locator, `resolveLocator` via `eth_call`, `getVault` for each candidate, and `selectVault`. No account is involved.
- **Can one ceremony both sign and evaluate PRF?** Yes, technically.
  - **(verified)** viem's `toWebAuthnAccount({ credential, getFn, rpId })` passes `getFn` to ox `WebAuthnP256.sign`.
  - ox builds the request options and calls `getFn(options)`, then reads only `credential.response`. It does not call `getClientExtensionResults`.
  - So a wrapping `getFn` can inject `publicKey.extensions.prf`, force `userVerification: 'required'`, call `navigator.credentials.get`, capture `getClientExtensionResults().prf.results.first`, and return the credential unchanged.
- **But it rarely saves a tap.** The userOp hash covers the new blob, and the new blob needs the PRF output first. So the signing ceremony can only capture PRF for a key whose output is already known.
- **Decision:** writes use a dedicated signing tap. The PRF-capturing `getFn` (`prfCapturingGetFn`) adds the PRF extension and UV "required" to the signing ceremony. It then checks UV and verifies that the derived locator equals the expected key's locator, which catches a different key being tapped. The captured output is wiped immediately and never returned.
- **Resulting tap counts:**
  - unlock: 1;
  - edit: 2 (PRF tap with any vault key, then a sign tap with the same key). PRF outputs are not kept for the whole session;
  - create, per key: 1 create + 1 PRF get (skipped when the browser returns PRF results at create; Chromium's virtual authenticator and YubiKey 5.8+ do), then 1 sign. That is 3–5 taps for 2 keys;
  - add key: 1 current-key PRF tap + 1–2 for the new key + 1 sign. Each physical key swap waits for an explicit **Continue** button. This prevents the wrong plugged-in key from answering, which matters for real USB keys and for E2E alike.

### D6. Enrollment details
- `navigator.credentials.create` with:
  - `rp.id = VITE_RP_ID`;
  - `authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'cross-platform' }`;
  - `pubKeyCredParams: [ES256]` only, since CBSW needs P-256;
  - `excludeCredentials` set to the credentials already enrolled in this flow;
  - `extensions: { prf: { eval: { first: locatorSalt() } } }`;
  - attestation `none`.
- `user.id` is 16 random bytes; `user.name` / `displayName` is "CryoShield vault (key N)", which is what the OS key manager shows.
- **PRF detection:**
  - before enrollment: `PublicKeyCredential.getClientCapabilities?.()['extension:prf']`, falling back to a UA-family allowlist when the API is missing;
  - after create: `getClientExtensionResults().prf.enabled === true` is required. Otherwise, show the "key too old or unsupported" message (YubiKey firmware older than 5.2 has no hmac-secret).
- The public key comes from `response.getPublicKey()` (SPKI DER), parsed to `(x, y)` with viem/ox helpers. viem's `createWebAuthnCredential` is used if its options accept `extensions` (checked in task 3.1); otherwise it gets a `createFn` wrapper that adds them.
- **UV:** always `'required'`. Every PRF result is accepted only when the authenticator-data UV bit is set. This matches recovery-tool D3, where hmac-secret's CredRandomWithUV differs from CredRandomWithoutUV. A YubiKey needs a FIDO2 PIN; Chrome prompts the user to create one, and the UI explains it.

### D7. Vault operations (consuming `@cryoshield/vault-crypto`)
- **Create:** `createVault({ rpId, credentials: [{ id, prf }...], secret: encodePayloadV1(items) })` returns the blob and locators. It runs one userOp: `registry.createVault(vaultId = random32, blob, locators)`.
- **Unlock:** `deriveLocator(prf)`, then `resolveLocator`, then `getVault` for each candidate (blob and owner), then `selectVault(candidates, prf)`, then `decodePayloadV1`.
- **Edit:** requires the requested crypto API `updatePayload(blob, prf, newSecret)`. It keeps the header, entries, and wrap salt, and re-encrypts only the payload under the same data key with a fresh nonce. The payload AAD (all preceding bytes) stays valid.
  - The registry `updateVault(vaultId, newBlob)` call is signed by the unlocking key.
- **Add key (updated at apply):** vault-crypto now ships `addKey(blob, existingKey, newCredential)`, which needs **one** existing key in any-of-N mode. Existing entries are copied byte for byte.
  - One batched userOp: `executeBatch([self.addOwnerPublicKey(x, y), registry.addLocators(vaultId, [newLoc]), registry.updateVault(vaultId, blob)])`. It is atomic.
- **Preflight:** every registry call is `eth_call`-ed from the account address before any signing tap. Custom errors are decoded to `WriteError` codes:
  - `VaultIdTaken`: retry once with a fresh random id;
  - `LocatorFull`: drop that key and set it up again as a fresh credential, since a new PRF output gives a new locator;
  - `OwnerAlreadyHasVault`, `TooManyLocators`, `InvalidBlobSize`, `NotVaultOwner`, `DuplicateLocator`: plain messages.
  
  A revert after inclusion (`UserOperationRevertReason`) is decoded the same way.
- **Vault binding (security-review fix, `bind-vault-id-to-ciphertext`):** every vault-crypto call takes the on-chain vaultId (wrap and payload AAD), so a byte-identical clone under another vaultId never opens. Create builds the blob per vaultId; on `VaultIdTaken` it re-encrypts under a fresh random id from the PRF outputs already held for the setup (no re-tap of every key), and the user touches key 1 once more with a plain-language explanation. Identical (vaultId, blob) candidates are collapsed before trying them.
- **Several genuine vaults for one credential:** `selectVault` returns only the first authenticating candidate, so the adapter calls it per candidate with a PRF copy and collects every match. The UI shows a picker, newest (last appended) first.
- **UV:** vault-crypto's `webauthnPrfCreateOptions()` / `webauthnPrfGetOptions()` build the options. `assertUserVerified(authenticatorData)` runs on every create and get response before the PRF output is used.
- `maxPayloadBytes(rpId, credIds, 0x01)` drives the capacity meter.
- Payload v1 is compact JSON (spec), at about 640 bytes usable for 2 keys. JSON was chosen over a binary TLV because the recovery tool and humans can read it directly. Its overhead is about 15 bytes per item.

### D8. Arweave mirror via ArDrive Turbo
- **(verified, corrects the brief)** The free tier is no longer "under 100 KiB, unlimited". Current rules:
  - items up to **105 KiB** are free;
  - but within a **10 MiB lifetime allowance per wallet and per subnet** that never resets;
  - `turbo.getFreeStatus()` reports the remaining bytes, but the decision is made at upload time.
- **Cost model beyond that:** Turbo Credits are pegged to storage (about $7–14/GB per the PRD), plus a flat fee of 0.02 credits per 1,000 items. One vault item is about 1.5–3 KB, so the cost per upload is effectively zero.
- **Our usage:** an ephemeral in-memory Ethereum signer per session (spec) keeps the per-wallet allowance from binding.
  - The per-subnet allowance is about 3,000+ uploads per subnet. It could bind behind a shared NAT or CGNAT.
  - Fallback when the upload is refused for the allowance: keep the vault saved (non-blocking warning), and retry on the next unlock (self-healing).
  - A CryoShield-funded credit share needs an approval from our wallet to each upload signer, which in turn needs a server, so it is **deferred**. It is listed in Open Questions.
- **Changed at apply: no `@ardrive/turbo-sdk` in the bundle.** Its dependency tree (ethers, @solana/web3.js, axios, arweave-js, bignumber.js, …) is a large supply-chain surface for one POST.
  - Instead, `src/mirror/ans104.ts` (about 120 lines) builds an ANS-104 data item with an Ethereum (type 3) signature from an ephemeral in-memory viem account, and POSTs it to Turbo's upload API (`POST {VITE_TURBO_UPLOAD_URL}/v1/tx/ethereum`, `application/octet-stream`), the same endpoint the SDK uses.
  - A unit test checks the bytes and id against `@dha-team/arbundles` (a dev dependency only).
  - No WASM or `eval`, so the CSP needs no relaxation.
- Locators for the tags come from `LocatorAdded` logs (indexed `vaultId`, from `deployBlock`), merged with the locators the client already knows. If log queries fail (RPC range limits), the known locators are used.
- **Tags:** exactly recovery-tool D5 (spec). There is no `Content-Type` tag, so gateways serve it as `application/octet-stream`.
- **Self-heal on unlock:**
  - GraphQL `transactions(tags: [App-Name, CryoShield-Vault-Id, CryoShield-Version])`;
  - fetch each item's data with a 1024-byte cap and compare it to the on-chain blob;
  - upload if no item matches.
- **Ethereum L1 hash anchor: deferred** (out of scope). The registry events already carry `keccak256(blob)` with an indexed `vaultId`.

### D9. Configuration
- `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_BUNDLER_URL` (the Pimlico URL including the restricted API key), `VITE_SPONSORSHIP_POLICY_ID`, `VITE_TURBO_UPLOAD_URL`, `VITE_ARWEAVE_GATEWAY_URL`, `VITE_RP_ID`, `VITE_RP_NAME`, all documented in `.env.example`.
- The registry `{address, deployBlock, abiHash}` is imported at build time from `contracts/deployments/<chainId>.json`, as the solidity engineer publishes it.
  - A Vite plugin checks that `abiHash` equals keccak256 of the ABI JSON the app imports, and validates everything with zod.
  - The CSP `connect-src` is generated from the same variables at build time and written into a `<meta http-equiv>` tag (static hosts and IPFS gateways can't set headers). It is also written to `dist/_headers` for hosts that support it, since `frame-ancestors` is only effective as a header.
- **RP ID vs IPFS:** PRF is scoped to the RP ID, so the app only works when served from the RP ID domain or a subdomain of it. Raw IPFS gateway URLs won't work, and the UI explains this (spec "Configured relying party").

### D10. In-memory secrets
- Decrypted items live in a single `VaultSession` object. Lock replaces it with `null`, overwrites the item string array references, and zeroes any `Uint8Array` buffers (plaintext bytes from the crypto library).
- JS strings can't be zeroized. This is accepted and documented: we minimise copies, never log, and never put secrets in URLs or the History API state.
- Auto-lock after 5 minutes idle, with a warning 30 seconds ahead and an "I'm still here" button (WCAG 2.2.1). Also lock on `pagehide`, and on `visibilitychange` to hidden for more than 60 seconds.
- Plaintext DOM is rendered only for a revealed item. Inputs use `autocomplete="off"`, `spellcheck=false`, and `data-1p-ignore` on secret fields.

### D11. Testing strategy
- **Unit (Vitest + Testing Library + jsdom):**
  - config validation, payload codec, the WebAuthn wrapper with a fake `navigator.credentials`, registry read/candidate logic against a mocked viem transport, the userOp target allowlist, mirror tag builder, flows, and a11y (`vitest-axe`);
  - vault-crypto integration tests run against the real package and its `test-vectors/v1.json`.
- **E2E (Playwright, Chromium):**
  - a CDP session per page: `WebAuthn.enable` plus `WebAuthn.addVirtualAuthenticator({ protocol: 'ctap2', transport: 'usb', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true })`. **(verified at apply)** PRF works, including results at create; the shim fallback was not needed;
  - each key is its own authenticator, and only the "touched" one has `automaticPresenceSimulation` enabled;
  - **local stack (choice made at apply): anvil + a minimal dev bundler, not Alto/prool.**
    - The canonical EntryPoint v0.6, SenderCreator, and CBSW v1.1 factory and implementation runtime code are copied from Arbitrum Sepolia into a hash-pinned fixture and placed with `anvil_setCode`.
    - The VaultRegistry is deployed with the same CREATE2 salt as `contracts/script/deploy.sh`, so its address matches `contracts/deployments/31337.json`. An accept-all E2E paymaster is deposited in the EntryPoint.
    - A ~300-line Node JSON-RPC server implements the bundler, ERC-7677 paymaster, and `pimlico_getUserOperationGasPrice` methods. It submits via `handleOps`, so WebAuthn P-256 verification (FCL fallback), account deployment, and registry calls run on-chain for real.
    - Rationale: no Docker, offline, deterministic, and CBSW available. Not covered: ERC-7562 simulation and Pimlico's gas estimation, which the Sepolia hardware run covers;
  - the same stack backs Vitest integration tests (`test-int/`) using the software fake authenticator;
  - Arweave and Turbo are stubbed by `page.route` with an in-memory GraphQL and data store;
  - axe-core on every screen; a network-origin allowlist assertion; a CSP violation test.
- **Fallback if `hasPrf` is unavailable:** not needed (task 2.4). A build check still asserts that no E2E-only code (`prf-shim`, test RPC controls, `__recordPrf`) reaches the bundle. The bundle also has every `console` call stripped (`dropConsole`), and it builds reproducibly.
- **Firefox and WebKit** have no CDP virtual authenticator, so they get smoke E2E with the shim only. A manual hardware checklist (`apps/web/docs/hardware-test.md`) covers 2 real YubiKeys on desktop Chrome, which is the PRD success signal.

## Threat / Abuse Considerations

- **Paymaster drain:** the API key is public by necessity.
  - Bounded by: origin and method restrictions on the key; per-sender and global caps in the policy; target restriction if Pimlico supports it (task 1.4); the client-side target check; and the registry's own caps (one vault per owner, 1 KB, 8 locators).
  - Residual: an attacker scripting fresh accounts up to the global daily cap. That is a cost and availability issue only; existing vaults stay readable. A refused operation never falls back to user-paid gas.
- **Malicious or compromised frontend:** this is the biggest risk. Static code sees the PRF output and plaintext.
  - Mitigations: open source, reproducible build (task 9.2), strict CSP and Trusted Types, no third-party scripts, an SRI-pinned bundle, and later IPFS/ENS pinning.
  - The recovery tool is the escape hatch if the domain is hijacked, though a hijacker with the RP ID domain can phish PRF outputs. This is accepted, and documented for users.
- **Wrong-key or phishing taps:** the RP ID binding stops other origins from evaluating our PRF.
- **UV downgrade:** PRF results without the UV flag are rejected.
- **Malicious RPC:** it can return junk candidates, which `selectVault` rejects, or withhold data, which shows as "no vault found" and offers retry with another RPC.
  - For writes, "Saved" is confirmed by reading the blob back. A lying RPC can fake that, which is an accepted limit. The bundler receipt is a second source.
- **Front-running create:** a copied vaultId leads to a retry with a new random one. Copied locators are harmless (non-exclusive index).
- **Arweave spoofing:** anyone can upload items with our tags. They are treated as untrusted, accepted only after authentication, and the on-chain blob is preferred.
- **Ephemeral Turbo signer:** links nothing to the user. Upload timing and IP are visible to Turbo, which is an accepted metadata leak, the same as RPC.
- **Secret leakage via the browser:**
  - covered by: no storage, auto-lock, clipboard clearing, no secrets in URLs or titles, error reporting that never includes payloads, and `console` stripped in production builds;
  - residual: browser extensions with page access can read the DOM. Documented.
- **XSS:** React escaping, no `dangerouslySetInnerHTML` (enforced by a lint rule), Trusted Types, and CSP.
- **Supply chain:** pinned lockfile, a minimal dependency set, the Turbo SDK lazy-loaded only after a write, and a dependency review in the security task.

## Risks / Trade-offs

- [Pimlico policy can't restrict targets] → Rely on caps. Documented residual risk; revisit with another provider if abuse appears.
- [Turbo per-subnet allowance exhausted] → Non-blocking warning plus self-heal. A future change can add a credit-sharing approach that needs no server.
- [Pimlico target restriction unavailable] → The caps are the backstop (documented). A provider offering target allowlists could be swapped in at `src/account/writes.ts`.
- [Bundle size: about 640 KB minified, mostly viem] → Acceptable for MVP. Code-splitting the write path is a later optimisation.
- [Browser PRF gaps: Safari bugs, older Firefox] → Capability detection plus a clear message. The support matrix lives in Phase 6.
- [YubiKey PIN friction] → UV is mandatory for recovery-tool parity. Plain-language PIN guidance.
- [CBSW factory not deployed on the target chain] → Verified in task 1.4. If missing, deploy the canonical factory via its deterministic deployer (an operations step).

## Migration Plan

This is a greenfield app. Deploy order:
1. Arbitrum Sepolia: registry deployment file, then Pimlico policy, then static deploy on a staging RP ID.
2. Run the hardware checklist.
3. Production RP ID and mainnet are Phase 6 work.

Rollback: redeploy the previous static build. On-chain data is unaffected.

## Dependencies on other engineers

All were delivered before apply:
- **Crypto:** `updatePayload`, one-key `addKey`, `webauthnPrfCreateOptions` / `webauthnPrfGetOptions`, `assertUserVerified`, and UV-required in the spec.
- **Solidity:** `contracts/abi/VaultRegistry.json`, `contracts/deployments/31337.json` (keccak of the ABI bytes as `abiHash`), the 10 custom errors, and an indexed `vaultId` on all events.

The E2E stack reads `contracts/out` and does not run `deploy.sh`, so it writes nothing under `contracts/`.

## Open Questions

- CryoShield-funded Turbo credit sharing without a server (only if the free allowance proves insufficient). This doesn't change the specs.
- Exact Pimlico cap values after the testnet cost measurement (task 6.6).
