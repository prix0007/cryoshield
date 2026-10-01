# Security review: add-web-app

**Verdict: CHANGES REQUESTED → all findings fixed**, pending re-review (task 9.4). 1 HIGH (fixed at the crypto layer
plus app wiring), 2 MEDIUM and 4 LOW (fixed).
Reviewer: `ecc:security-reviewer` via the overwatcher. Scope: `apps/web` plus the OpenSpec change `add-web-app`.

## Checks that passed

- **WebAuthn / PRF:**
  - one PRF input (the locator salt), UV "required" on create and get, and `assertUserVerified` before any PRF output is used;
  - discoverable credentials, ES256 only, and an RP ID guard;
  - PRF outputs are wiped after use and never stored, logged, or sent (E2E checks every request body against the
    authenticator's PRF outputs).
- **ANS-104 signer:**
  - an ephemeral in-memory secp256k1 key per session, never derived from key material;
  - data items are byte-identical to `@dha-team/arbundles`.
- **Paymaster allowlist, with no bypass found:**
  - value 0, only registry `createVault` / `updateVault` / `addLocators` and self `addOwnerPublicKey`;
  - checked on the calls and again on the decoded `execute` / `executeBatch` callData inside the paymaster hook;
  - no unsponsored fallback.
  - Server-side, only the per-account and global caps bind; see `docs/paymaster-policy.md`.
- **CSP / Trusted Types:**
  - `default-src 'none'`, self-only scripts and styles, no `unsafe-*`, `require-trusted-types-for 'script'` with
    `trusted-types 'none'`, and `frame-ancestors` via `_headers`;
  - E2E proves injected scripts and handlers are blocked;
  - lint bans `dangerouslySetInnerHTML`, `innerHTML`, `eval`, browser storage, and `console`;
  - the bundle strips all `console` calls.
- **Ownership:**
  - account owners are exactly the enrolled P-256 keys in blob order;
  - signing reads the owner public key on-chain at the entry index;
  - the signing ceremony verifies that the expected key signed (locator check);
  - P-256 verification is proven on-chain (a wrong-owner signature is rejected in `test-int`).

## Findings

| # | Sev | Finding | Fix | Status |
|---|---|---|---|---|
| 1 | HIGH | **Vault cloning.** An attacker copies a victim's public blob and locators into their own vault (another vaultId and owner). The clone decrypts with the victim's key, so the victim may pick it and save edits into the attacker-controlled copy. | Crypto layer (`bind-vault-id-to-ciphertext`): vaultId goes into the wrap and payload AAD. The app passes the **on-chain** vaultId to `createVault` / `selectVault` / `addKey` / `updatePayload`. Candidates with identical (vaultId, blob) are collapsed; if more than one genuine vault remains, a picker shows a warning. On `VaultIdTaken`, the blob is re-encrypted under a fresh vaultId from the PRF outputs held for that setup, so the user touches key 1 once more with a plain-language explanation. Proof: `test-int` clone test (a byte-identical clone under an attacker vaultId is never offered), plus adapter and UI tests. | **Fixed** (neutralised) |
| 2 | MEDIUM | Dev-dependency install scripts (keccak, secp256k1 via arbundles) ran at install time. | Root `package.json`: `"pnpm": { "onlyBuiltDependencies": [] }`. pnpm now reports "build scripts were ignored: keccak, secp256k1"; all suites pass with pure-JS fallbacks. | Fixed |
| 3 | MEDIUM | The create flow kept enrolled PRF outputs in React state indefinitely while the user typed. | Idle wipe: after 5 minutes without interaction, PRF outputs are zeroized and the flow resets, with a plain message (`test/ui/flows.test.tsx`). | Fixed |
| 4 | LOW | `prfFirst` threw on a bad PRF length without wiping the copied buffer. | Wipe before throwing (`test/webauthn`). | Fixed |
| 5 | LOW | `verify-build` checked only the e2e-mode build. | Also builds production mode twice: reproducible, same bundle checks, no loopback/E2E endpoints, CSP lists the configured origins. | Fixed |
| 6 | LOW | Add-key could sign if the account's `nextOwnerIndex` didn't match the blob key count, breaking owner index == entry index. | `addKeyOnChain` asserts `nextOwnerIndex == keyCountBefore` before any signing tap, else `OWNER_MISMATCH` (`test/account/writes.test.ts`). | Fixed |
| 7 | LOW | The mirror self-heal must not trust a gateway's "already exists". | Self-heal returns "present" only after fetching the item's data (1024-byte cap, streamed) and byte-comparing it to the on-chain blob. A listing alone, a 404, different bytes, an oversized body, a fetch error, or a 409 from Turbo all lead to re-upload or failure. Regression tests in `test/mirror/mirror.test.ts`. | Fixed (tests added; behaviour already byte-verified) |

Task 9.4 stays open until the overwatcher re-reviews these fixes.

Arweave copies: the web app never opens a blob from Arweave (on-chain data only; Arweave is mirror and self-heal). The
recovery tool must open an Arweave copy under its `CryoShield-Vault-Id` tag value; a mismatched tag simply fails to
decrypt.

## Re-review (2026-10-02): APPROVE

All findings above are verified fixed. Suites: typecheck, lint, 124 unit, 9 integration, 8 E2E, verify-build (e2e and production builds).

**Residual risk (LOW, accepted).** A party that sees a pending create operation (the bundler or the sequencer) can register the same vaultId and blob first. The user's retry then succeeds under a fresh vaultId, but the attacker's copy also authenticates, so the user sees the "more than one vault" warning. The attacker's copy cannot capture edits, because writes to it revert with `NotVaultOwner`. Post-MVP fix: derive vaultId on-chain as `keccak256(msg.sender, salt)`.
