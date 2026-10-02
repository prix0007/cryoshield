# Tasks

Owners: **[sol]** solidity-engineer · **[fe]** frontend-engineer · **[rec]** recovery-engineer · **[ow]** overwatcher · **[sec]** security-reviewer.
Write each test first, and confirm it fails before implementing.

## 1. Preset parity contract [ow]

- [x] 1.1 [ow] Add `config/chain-presets.json`, listing preset name (kebab-case), chain ID, and Foundry key (snake_case) for anvil, op-sepolia, op-mainnet, arbitrum-sepolia, and arbitrum-one. This is the single reference that parity tests read. Verify: the file parses, and its chain IDs match design.md D1.

## 2. Contracts deploy tooling [sol]

- [x] 2.1 [sol] *(Verifier amended per design.md D3: keyless Blockscout instead of Etherscan V2; tests assert the Blockscout URL per preset.)* Write failing tests in `script/anvil-e2e.sh` or a new `script/test-deploy-args.sh`. They must show that `deploy.sh op_sepolia` (dry run) builds args with `--verifier etherscan --verifier-url https://api.etherscan.io/v2/api?chainid=11155420` on broadcast, and that an unknown network lists the valid names. Verify: the tests fail before 2.2.
- [x] 2.2 [sol] *(Amended per D3: no explorer key; `ARBISCAN_API_KEY` removed, `ETHERSCAN_API_KEY` not used.)* Add the `op_sepolia`, `op_mainnet` and `arbitrum_one` cases to `deploy.sh`, and generalize the public-network branch to be preset-driven (RPC env var, expected chain ID, verifier URL). Replace `ARBISCAN_API_KEY` with `ETHERSCAN_API_KEY` (env only). Keep refusing raw private keys, and keep the keystore-only and idempotency behaviour. Verify: 2.1 passes, and `anvil-e2e.sh` still passes.
- [x] 2.3 [sol] Add `op_sepolia` and `op_mainnet` to `foundry.toml` `[rpc_endpoints]`. Update the `Deploy.s.sol` comment, `contracts/.env.example` (`OP_SEPOLIA_RPC_URL`, `ETHERSCAN_API_KEY`, faucet links from design.md fact 7), and the contracts README. Verify: `forge build` and `forge test` (52) pass, and the gas snapshots are unchanged.
- [x] 2.4 [sol] Run a dry run against real OP Sepolia: `deploy.sh op_sepolia` without BROADCAST, using a throwaway keystore if one is needed for simulation. Verify that the chain-ID check and the CREATE2 address prediction work and that forge 1.1.0 accepts the V2 verifier URL. Record the output in design.md. Verify: a dry-run log is captured.
- [x] 2.5 [sol] Extend the `vault-registry` "Chain portability" requirement wording in `openspec/changes/add-vault-registry-contract/specs/vault-registry/spec.md` to name OP Sepolia and OP Mainnet. Verify: `openspec validate add-vault-registry-contract --strict` passes.
- [x] 2.6 [sol] Add a preset parity test comparing `deploy.sh`'s network table with `presets.json`. Verify: the test fails if a chain ID is edited.

## 3. Web app [fe]

- [x] 3.1 [fe] Write a failing test: building with `VITE_CHAIN_ID=11155420` and no `contracts/deployments/11155420.json` must fail, naming the missing file. Then make it pass, if it doesn't already. Verify: unit or build test.
- [x] 3.2 [fe] Update `apps/web/.env.example`: `VITE_CHAIN_ID=11155420`, `VITE_RPC_URL=https://sepolia.optimism.io`, `VITE_BUNDLER_URL=https://api.pimlico.io/v2/optimism-sepolia/rpc?apikey=pim_REPLACE_ME`, with the chain-ID comment listing 10, 11155420, 42161, 421614 and 31337. Verify: the config schema test parses the example file.
- [x] 3.3 [fe] Point `e2e/scripts/build-fixtures.mjs` at `https://sepolia.optimism.io` by default, regenerate `e2e/fixtures/chain-fixtures.json`, and add a test asserting the bytecode equals the previous Arbitrum-sourced fixture (design.md D4). Update the `e2e/stack/stack.ts` and `e2e/README.md` comments. Verify: the parity test, `test:int` (9) and `test:e2e` (8) pass.
- [x] 3.4 [fe] Update `docs/hardware-test.md` and `docs/costs.md` for OP Sepolia, including a step that confirms a real sponsored create on OP Sepolia succeeds. That step exercises the `0x100` precompile through CBSW in a real transaction (design.md fact 1a). Verify: the docs review in 6.1.
- [x] 3.5 [fe] Add a web preset parity test comparing the chain IDs documented in `.env.example` with `presets.json`. Verify: the test fails if a chain ID is edited.

## 4. Recovery tool [rec]

- [x] 4.1 [rec] Write failing tests:
  - `--testnet` selects chain 11155420 and the op-sepolia RPC list;
  - no flags selects `DEFAULT_NETWORK == "op-sepolia"` and prints the network name;
  - `--network op-mainnet` selects chain 10;
  - an unknown network lists the valid names.
  
  Verify: the tests fail before 4.2.
- [x] 4.2 [rec] Add the `op-sepolia` and `op-mainnet` presets to `config.py`, each with 3 RPCs:
  - op-sepolia: `https://sepolia.optimism.io`, `https://optimism-sepolia-rpc.publicnode.com`, `https://optimism-sepolia.drpc.org`;
  - op-mainnet: `https://mainnet.optimism.io`, `https://optimism-rpc.publicnode.com`, `https://optimism.drpc.org` (all three verified to answer `eth_chainId = 10` on 2026-10-02).
  
  Set `DEFAULT_NETWORK = "op-sepolia"`, make `--testnet` mean op-sepolia, and update the help text. Keep the Arbitrum presets. Verify: 4.1 passes, and the full suite (291) passes.
- [x] 4.3 [rec] Update every test that assumed an Arbitrum default (`test_cli.py`, `test_review_fixes.py`, `test_network.py`, `test_recover.py`, `test_anvil_e2e.py`, `tests/support/fakes.py`), and update the README and `docs/manual-yubikey-test.md`. Verify: pytest, ruff, `mypy --strict`.
- [x] 4.4 [rec] Add a preset parity test comparing `NETWORKS` with `presets.json` (names converted kebab↔snake, same chain IDs). Verify: the test fails if a chain ID is edited.

## 5. Project docs [ow]

- [x] 5.1 [ow] Update `openspec/config.yaml` context: "Testnet: OP Sepolia; mainnet chain TBD (Arbitrum One or OP Mainnet); contracts must stay portable across OP Stack, Arbitrum and Ethereum L1." Verify: `openspec validate --all --strict`.
- [x] 5.2 [ow] Update the PRD (decisions log, architecture notes, open questions: add "mainnet chain") and the root README (testnet name, faucet pointer). Verify: a grep finds no remaining "Arbitrum Sepolia" claim of being the testnet outside archives and the Arbitrum presets.

## 6. Review

- [x] 6.1 [sec] Security review of the diff. Check:
  - no secrets in argv (deploy.sh), and keystore-only still enforced;
  - the chain-ID check happens before any send or simulate;
  - the recovery default network and `--testnet` behaviour, and that no preset silently falls back to another chain's registry;
  - fixture bytecode parity;
  - each new RPC endpoint is plain HTTPS with no CryoShield host.
  
  Verify: all CRITICAL and HIGH findings are resolved, and the review is recorded in `docs/reviews/target-op-sepolia.md`.
