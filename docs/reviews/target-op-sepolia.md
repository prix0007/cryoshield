# Security review: target-op-sepolia

**Change:** `openspec/changes/target-op-sepolia`. This change makes the stack chain-configurable and switches the testnet from Arbitrum Sepolia to OP Sepolia (chain 11155420). No contract or crypto code changes.
**Date:** 2026-10-02 · **Reviewer:** security-reviewer agent · **Final verdict:** APPROVE

## Round 1: CHANGES REQUESTED

- **HIGH:** the root `.gitignore` pattern `build/` hid `apps/web/test/build/`, which holds the CSP, deployment-record, OP preset and fixture-parity tests. `.env.*` hid the non-secret `.env.development` and `.env.e2e`. CI would never have run those tests. **Fixed:** the pattern is anchored to `/build/`, and the two env files are explicitly un-ignored.
- **MEDIUM:** the web app never compared the RPC's `eth_chainId` with `VITE_CHAIN_ID`. The registry has the same CREATE2 address on every chain, so a misconfigured RPC silently read another chain's registry ("no vault", leading to a duplicate vault). **Fixed:** chain ID is checked once per session before any registry read or account action, and the bundler's chain ID is checked before sending. A mismatch shows "wrong network". Unit, UI and live integration tests cover it.
- **LOW, recovery:** `--network X --chain-id Y` (Y ≠ X) kept X's registry on another chain. **Fixed:** it is now a usage error, and custom endpoints are labelled user-supplied.
- **LOW, contracts:** the stale `--private-key` comment in `Deploy.s.sol` now points to the keystore. The verify step runs with `ETHERSCAN_API_KEY` and `VERIFIER_API_KEY` unset, so no key reaches Blockscout (tested).
- **LOW, parity:** the parity tests read a file inside the change folder, which archiving would break. **Fixed:** the file moved to `config/chain-presets.json`.

## Round 2: APPROVE

All findings were verified fixed.

| Suite | Result |
|---|---|
| forge | 52 passed |
| `test-deploy-args.sh` | 45 passed |
| recover pytest | 316 passed (4 opt-in skipped) |
| web unit | 143 passed |

`git status --ignored` lists only build output, caches, venvs, and the generated README snippets.

**Verified OK:**
- **Keystore-only broadcast:** enforced on all public presets, and the address-only dry-run path never broadcasts.
- **Deploy chain-ID check:** runs before any simulation or send.
- **Blockscout verify:** runs after the deployment record is written, so a failure keeps the record.
- **Recovery RPCs:** wrong-chain RPCs are dropped, and all built-in RPCs use HTTPS.
- **Fixtures:** CBSW/EntryPoint code on OP Sepolia is byte-identical to Arbitrum Sepolia.
- **CSP:** `connect-src` is built from the configured endpoints.
- **Presets:** parity holds across all three tools.

**Follow-up (LOW):** the clone integration test (`writes.int.test.ts:191`) failed once in 6 runs because it didn't await the clone transaction's receipt. **Fixed:** the clone and LocatorFull tests now await the mined, successful receipt; `test:int` passed 5/5.
