# Proposal: fix the recovery tool's live OP Sepolia check

## Why

Pre-production review 2026-10-09, finding **F4** (low): `tools/recover/tests/test_live_op_sepolia.py:24` builds `Registry(P.rpcs, P.registry, P.chain_id, P.deploy_block)`. `recover-registry-versions` replaced the preset's `registry`/`deploy_block` pair with the `registries` list, so `pytest -m network` now fails with `AttributeError` before any request. It is the only automated check that the released tool still reads the real OP Sepolia registries, and it is opt-in, so nothing noticed that it broke.

## What Changes

- The live test builds its reader with `Registries.build(P.rpcs, P.chain_id, P.registries)`, the same path the CLI uses, and checks **every** built-in registry of the preset (v2 and v1 today):
  - each answers `MAX_BLOB_SIZE() == 1024` on at least two built-in RPCs;
  - a random locator is unknown: v1 `resolveLocator` returns `[]`; v2 `locatorLength` returns 0 and `getVaults([])` returns `[]`;
  - `Registries.resolve([locator]) == []`.
- An offline (always-run) test in the same file builds the same reader without any request and asserts it covers exactly the preset's registries (versions 2 and 1, their addresses and ABI kinds). A future rename of preset fields then fails the default test run instead of only the opt-in one.
- The `network` marker moves from module level to the live test, so the offline test runs by default.

**Runtime dependencies:** none; test code only. No CryoShield-operated backend.

**Out of scope:** the recovery tool's runtime code (unchanged); decrypting any vault; adding v3.

## Capabilities

### Modified Capabilities
- `vault-recovery`: adds a requirement that the live check covers every built-in registry and cannot silently rot.

## Impact

- **Edited:** `tools/recover/tests/test_live_op_sepolia.py`.
- No change to `src/`, the vault format, crypto, contracts or CI. No security-review task is required by the project rules (no crypto, contract, paymaster, secret-handling or CI change); the live test sends only read-only `eth_chainId`/`eth_call` to the built-in public RPCs, as before.
