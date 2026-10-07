# Tasks

Every task is test-first: write the named test, see it fail, then implement until it passes.

## 1. Scaffolding, configuration, and external fact checks

- [x] 1.1 Scaffold `apps/web` (Vite, React 19, strict TS, self-hosted CSS, ESLint with `no-console` and a `no-restricted-syntax` ban on `dangerouslySetInnerHTML`/`innerHTML`/`eval` and on browser-storage globals, as errors), and add the workspace deps `@cryoshield/vault-crypto`, `viem`, `permissionless` (exact pinned versions). Verify that `pnpm --filter web build` and `pnpm --filter web test` run green on an empty app.
- [x] 1.2 Write failing tests for the config schema (a plain validator, no runtime dependency): every `VITE_*` variable from design D9 is required, and a missing `VITE_RP_ID` fails with the variable named. Implement `src/config`, add `.env.example`, and verify the tests pass and `.env.example` lists every variable.
- [x] 1.3 Write failing tests for the deployment loader Vite plugin: it reads `contracts/deployments/<chainId>.json`, fails on a missing file (naming the path), and fails on an `abiHash` mismatch (naming both hashes). Implement it against a fixture deployment file and verify the tests pass.
- [x] 1.4 Verify external facts before dependent code and record the results in design.md (update D2/D4):
  - whether a Pimlico sponsorship policy can restrict target contracts or calldata;
  - that Pimlico serves EntryPoint v0.6 on Arbitrum Sepolia and One;
  - that the CBSW v1.1 factory has bytecode on both chains (`cast code`).

  Verify the design.md D4 assumption is replaced by a verified statement.
- [x] 1.5 Write a failing build test asserting that `dist/index.html` has a CSP meta tag with `default-src 'none'`, no `unsafe-inline`/`unsafe-eval`, a `connect-src` equal to the configured origins, and `require-trusted-types-for 'script'`, and that `dist/_headers` adds `frame-ancestors 'none'`. Implement the CSP plugin and a default Trusted Types policy, and verify the test passes.

## 2. Test harness

- [x] 2.1 Set up Vitest (jsdom), Testing Library, and `vitest-axe`, plus a typed fake `navigator.credentials` (create/get with programmable PRF results and UV flags). Verify a sample test proves the fake records each ceremony's options.
- [x] 2.2 Add Playwright (Chromium) with a CDP fixture: `WebAuthn.enable` and `addVirtualAuthenticator({protocol:'ctap2', transport:'usb', hasResidentKey:true, hasUserVerification:true, isUserVerified:true, hasPrf:true})`, with helpers to add and switch between two "keys". Verify a smoke spec creates a credential and reads `getClientExtensionResults().prf.enabled === true`.
- [x] 2.3 Add the local chain stack (`e2e/stack/stack.ts`, design D11): anvil, the canonical EntryPoint v0.6 and CBSW v1.1 code from a hash-pinned fixture, the VaultRegistry via the same CREATE2 deploy (address = `contracts/deployments/31337.json`), an E2E paymaster, and a minimal dev bundler (ERC-4337 + ERC-7677 + gas price). Verify sponsored userOps from a fresh account succeed (`test-int/writes.int.test.ts`).
- [x] 2.4 Write an E2E spec asserting that a virtual authenticator returns PRF `results.first`, with the same output for the same credential and salt across two `get` calls. If it fails in the pinned Chromium, implement the `e2e/fixtures/prf-shim.ts` init-script fallback (design D11). Verify the spec passes and record which path is used in `apps/web/e2e/README.md`.
- [x] 2.5 Add a `page.route` Arweave/Turbo stub (in-memory upload store and GraphQL tag filter). Verify a spec uploads an item and finds it by tag.

## 3. Hardware-key ceremonies (`src/webauthn`)

- [x] 3.1 Write failing unit tests for `enrollKey()`:
  - the request has `residentKey:'required'`, `userVerification:'required'`, ES256 only, `excludeCredentials` of already-enrolled IDs, `prf.eval.first = locatorSalt()`, and the configured `rp.id`;
  - it returns `{id, publicKey:{x,y}, prf?}`, where `prf` is present only when PRF results were returned at create.

  Check whether viem `createWebAuthnCredential` accepts `extensions`, implement with it or with a `createFn` wrapper, and verify the tests pass.
- [x] 3.2 Write failing tests for PRF detection: the `getClientCapabilities` path, the fallback path, `prf.enabled !== true` after create giving a "key too old or unsupported" error, and a duplicate credential ID giving a "use a different key" error. Implement and verify.
- [x] 3.3 Write failing tests for `evaluatePrf()`:
  - the request has `userVerification:'required'`, no `allowCredentials`, and exactly `eval.first = locatorSalt()` (no `second` or `evalByCredential`);
  - a result whose authenticator data lacks the UV bit is zeroized and rejected.

  Implement and verify.
- [x] 3.4 Write failing tests for the RP ID guard: a host that is neither the RP ID nor a subdomain of it disables ceremonies with a configuration message, and makes no WebAuthn call. Implement and verify.
- [x] 3.5 Write failing tests for `prfCapturingGetFn`: it injects the PRF extension and UV required into ox's request options, captures `getClientExtensionResults().prf.results.first`, and returns the credential unchanged, so viem's `toWebAuthnAccount.sign` still produces a valid signature. Implement and verify, including a test that the signing check fails when a different key's PRF is captured.
- [x] 3.6 Add a test that no `src/webauthn` code path writes to any storage API or `console`, using spies across all ceremony tests. Verify it passes.

## 4. Vault adapter and payload encoding (`src/vault`)

- [x] 4.1 Write failing tests for payload v1 encode/decode: round-trip with order preserved; reject an unknown `v`, extra fields, labels over 64 characters, and zero items. Implement, write `apps/web/docs/payload-v1.md` with three fixed examples whose bytes are checked by a test, and verify.
- [x] 4.2 Write failing adapter tests against the real `@cryoshield/vault-crypto` and `test-vectors/v1.json`:
  - `createVault` with 2 keys, then `selectVault` with either key's PRF, returns the payload;
  - a junk candidate list returns "no matching vault";
  - every buffer passed in is zeroed afterwards.

  Implement the thin adapter and verify. This is blocked until the crypto package exposes its v1 API.
- [x] 4.3 Write failing tests for the capacity meter: remaining bytes equal `maxPayloadBytes(rpId, credIds, 0x01)` minus the encoded payload length, and saving is blocked when it is negative with a "remove N characters" message. Implement and verify.

## 5. Reads and unlock (`src/chain`)

- [x] 5.1 Write failing tests, with a mocked viem transport, for `resolveLocator` (an empty list doesn't throw), `getVault` per distinct candidate, and a per-candidate blob cap of 1024 bytes. Implement with a viem public client and the deployment-file address, and verify.
- [x] 5.2 Write failing tests for the unlock pipeline: one `evaluatePrf`, then locator, candidates, `selectVault`, and decoded items. It returns `{vaultId, owner, version, blob, items, credIndex}` and zeroizes the PRF on success and on failure; "no vault" gives a typed error. Implement and verify.
- [x] 5.3 E2E: create a vault in the app with two virtual keys, then unlock in a fresh page load with one key. Verify secrets are shown and that the authenticator saw exactly one assertion for the unlock (`e2e/specs/10-flows.spec.ts`).

## 6. Smart account and sponsored writes (`src/account`)

- [x] 6.1 Write failing tests for `buildAccount()`:
  - owners are WebAuthn accounts in blob order;
  - `ownerIndex` equals the credential's blob entry index;
  - for existing vaults, the address comes from `getVault().owner` and public keys from `ownerAtIndex`;
  - the counterfactual address is computed for new vaults.

  Implement with `toCoinbaseSmartAccount({version:'1.1'})` and verify.
- [x] 6.2 Write failing tests that the operation builder throws before any bundler request for any call target other than the registry (`createVault`/`updateVault`/`addLocators`) or the account itself (`addOwnerPublicKey`), and that every request carries `paymasterContext.sponsorshipPolicyId`. Implement and verify.
- [x] 6.3 Write a failing E2E for create: two virtual keys, a fresh account with zero balance, and a sponsored userOp that deploys the account and creates the vault. Assertions: account owners match the keys in order; the registry owner is the account; the balance stays 0. Also unit-test the vaultId-collision single retry. Implement the create write and verify.
- [x] 6.4 Write a failing E2E for edit: unlock with key A, add an item, sign with key A, then unlock with key B and see the item, with the version incremented by 1. Implement using vault-crypto `updatePayload` and verify.
- [x] 6.5 Write a failing E2E for add-key with ONE current key (vault-crypto `addKey`): a 2-key vault plus key C gives a single batched userOp; C alone unlocks and the account has 3 owners. Also write a unit test that a reverting inner call leaves the vault openable by A and B. Implement and verify.
- [ ] 6.6 Measure the gas and USD cost of create, edit, and add-key on Arbitrum Sepolia through Pimlico (precompile path), and on anvil (FCL fallback path). Record them in `apps/web/docs/costs.md` with the proposed policy caps. Verify the doc lists all six figures. (Anvil figures are recorded; Sepolia is BLOCKED on a Pimlico project and a 421614 deployment.)
- [x] 6.7 Write failing tests that map paymaster refusal (cap reached) to the "Saving is paused" message with no unsponsored retry, that registry custom errors map to plain messages, and that `LocatorFull` (selector 0xcfe5bd5b) is caught in an `eth_call` preflight before any tap and leads to setting up that key again as a fresh credential. Implement and verify.
- [x] 6.8 Write failing tests that "Saved" appears only after a successful receipt and a public-RPC read-back blob equal to the submitted blob, and that a reverted inner call shows "nothing was saved" and keeps the edits in memory. Implement and verify.

## 7. Arweave mirror (`src/mirror`)

- [x] 7.1 Build the ANS-104 Ethereum-signed data item in-tree (design D8, replacing `@ardrive/turbo-sdk`). Write a failing test that it is byte-identical (bytes and id) to `@dha-team/arbundles` for the same key, tags, anchor, and data. Implement and verify, and verify that uploads work under the production CSP in E2E with no relaxation.
- [x] 7.2 Write failing tests for the tag builder: exactly the D5 tags (App-Name, CryoShield-Format, CryoShield-Vault-Id, CryoShield-Version, one CryoShield-Locator per locator), lowercase 0x hex with 64 digits, and 7 tags for 3 locators. Implement and verify.
- [x] 7.3 Write failing tests that the upload uses an in-memory random signer that differs per session and is never persisted, and that a 1024-byte blob with 8 locators produces a signed data item under 8 KiB. Implement and verify.
- [x] 7.4 Write a failing E2E: after create, edit, and add-key, the stub store holds a byte-identical blob for each version; a Turbo failure shows the non-blocking warning with Retry while the vault is still reported saved. Implement and verify.
- [x] 7.5 Write a failing E2E for self-heal: drop the mirror for the current version, then unlock; the app re-uploads with no extra tap, and the GraphQL query by locator finds it. Also check that a spoofed item with the victim's locator tag is ignored. Implement and verify.

## 8. User flows, secret handling, and accessibility (`src/ui`)

- [x] 8.1 Write failing Testing Library tests for the create flow steps: explanation, key 1, key 2 (finish disabled with one key, with optional extra keys), secrets with the capacity meter, saving, and a done screen telling the user to keep keys apart. Focus moves to each step heading. Implement and verify.
- [x] 8.2 Write failing tests for the unlock/view flow: a single button; items hidden until Show; Copy; "We couldn't find a vault for this key" with a Create action; and an unknown payload version message. Implement and verify.
- [x] 8.3 Write failing tests for the add-key flow: it explains that one current key plus the new key are needed, waits for Continue at each physical key swap, and enforces the 8-key limit. Implement and verify.
- [x] 8.4 Write failing tests (fake timers): auto-lock at 5 minutes idle with a warning 30 seconds ahead and an extend button; lock on `pagehide` and on hidden for more than 60 seconds; Lock removes the secret DOM and drops the session. Implement and verify.
- [x] 8.5 Write failing tests for clipboard clearing after 30 seconds when focused (mocked Clipboard API) and the user notice. Implement and verify.
- [x] 8.6 Write failing tests for vault details: show the vaultId, and "Download encrypted backup file" saves `cryoshield-<prefix>.cryo` whose bytes equal the on-chain blob. Implement and verify.
- [x] 8.7 Add a jargon test scanning the default-flow string table for "gas", "wallet", "transaction", "smart account", "bundler", "paymaster", and "ETH". Verify it passes.
- [x] 8.8 E2E accessibility: axe-core (WCAG 2.2 A/AA tags) on every screen of every flow reports zero violations; keyboard-only completion of create and unlock; target size ≥ 24 px checked by a computed-style assertion. Verify all pass.

## 9. Integration and security review

- [x] 9.1 E2E end-to-end checks across all flows:
  - every request goes to one of the configured origins or self;
  - after each flow, localStorage, sessionStorage, IndexedDB, Cache Storage, and cookies are empty;
  - no request body contains a PRF output, which is checked against the authenticator's known PRF values;
  - an injected inline script is blocked with a CSP violation.

  Verify all pass.
- [x] 9.2 Build checks: two clean builds produce identical `dist` hashes; the production bundle contains no E2E-only code, no `console.` calls (stripped with `dropConsole`), and no source maps; the CSP meta tag and `_headers` are present. Verify with a script in `apps/web/scripts/verify-build.mjs`.
- [ ] 9.3 Write `apps/web/docs/hardware-test.md` (2 real YubiKeys 5 with firmware ≥ 5.2 on desktop Chrome: create, unlock with each key, edit, add a third key, and an old-firmware rejection). Execute it on Arbitrum Sepolia with the Pimlico policy, and record the results. Verify every row passes. (BLOCKED: no Pimlico project, Sepolia deployment, or physical keys available to the agent.)
- [x] 9.4 Security review: run the `ecc:security-reviewer` agent over `apps/web` and this change. The checklist covers:
  - PRF and UV handling, and zeroization;
  - storage, logging, and clipboard leakage;
  - CSP and Trusted Types, and XSS sinks;
  - the userOp target allowlist and sponsorship-policy abuse (paymaster drain);
  - ownerIndex/credential mapping;
  - RPC, Arweave, and GraphQL trust and size caps;
  - the ephemeral Turbo signer;
  - dependency pinning and supply chain.

  Verify that every CRITICAL/HIGH finding is resolved and that the review is recorded in `apps/web/docs/security-review.md`.

## 10. Security-review fixes (review: CHANGES REQUESTED; see apps/web/docs/security-review.md)

- [x] 10.1 Root `package.json` sets `pnpm.onlyBuiltDependencies: []` so dependency install scripts (keccak, secp256k1 via arbundles) never run. Verify `pnpm install` reports them as ignored and that unit, integration, E2E and verify-build all still pass.
- [x] 10.2 Create-flow idle wipe: write a failing test that after 5 minutes idle the enrolled PRF outputs are zeroized and the flow resets with a plain message. Implement and verify.
- [x] 10.3 Write a failing test that a wrong-length PRF result is wiped before `PRF_UNAVAILABLE` is thrown. Fix and verify.
- [x] 10.4 Extend `scripts/verify-build.mjs` to a production-mode build (reproducible, same bundle checks, no loopback/E2E endpoints, CSP origins). Verify it passes.
- [x] 10.5 Write a failing test that add-key refuses (`OWNER_MISMATCH`, no tap, nothing sent) unless the account's `nextOwnerIndex` equals the blob's key count. Implement and verify.
- [x] 10.6 Add regression tests that mirror self-heal never trusts a gateway listing or an "already exists" response without fetching and byte-comparing the data (capped). Verify.
- [x] 10.7 HIGH, vault cloning: once the crypto change `bind-vault-id-to-ciphertext` lands, pass vaultId to `createVault` / `selectVault` / `openVault` / `addKey` / `updatePayload`, collapse candidates with identical blobs, and warn when more than one genuine vault remains. Write a failing E2E/integration test that a clone of the victim's blob under another vaultId is ignored. Verify. On `VaultIdTaken`, rebuild under a fresh vaultId from the held PRF outputs (one extra signing touch, explained in plain language).
