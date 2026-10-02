# Proposal: Target OP Sepolia as the testnet

## Why

The founder can't easily get Arbitrum Sepolia test ETH, which blocks the first public testnet deployment. OP Sepolia (chain 11155420) has plentiful faucets, and it was verified on-chain on 2026-10-02 to have every dependency the MVP needs: the P-256 precompile, EntryPoint v0.6, Coinbase Smart Wallet v1.1, the CREATE2 deployer, and Pimlico support. Moving the testnet there unblocks launch without changing the product. It is also the moment to stop hardcoding a chain anywhere.

## What Changes

- **OP Sepolia (11155420) becomes the testnet target** for the deploy tooling, the web app's example config, the E2E fixtures, and the recovery tool's default network.
- **Chain-configurable everywhere.** Each network is a named preset (chain ID, RPC env var, explorer verification, built-in RPC list), and adding a chain is a data change. Supported presets after this change:
  - `anvil` (31337)
  - `op-sepolia` (11155420)
  - `op-mainnet` (10)
  - `arbitrum-sepolia` (421614)
  - `arbitrum-one` (42161)
- **Deploy script.** `contracts/script/deploy.sh` gains `op_sepolia` (and the other public presets). Explorer verification switches to **keyless Blockscout** on every public preset (overwatcher decision; the pinned forge 1.1.0 cannot use Etherscan API V2). **BREAKING (tooling only):** `ARBISCAN_API_KEY` is removed, and no explorer key is needed.
- **Recovery tool.**
  - Adds `op-sepolia` and `op-mainnet` presets.
  - `--testnet` now means `op-sepolia`.
  - The default network stays a single named constant, set to `op-sepolia` until mainnet is decided. **BREAKING (CLI default):** `--testnet` previously meant `arbitrum-sepolia`.
- **E2E fixtures.** The chain fixtures (EntryPoint v0.6, SenderCreator, CBSW v1.1 factory and implementation) are re-read from OP Sepolia. The bytecode is expected to be identical to the Arbitrum Sepolia copies, and this is checked.
- **Docs and config.** `openspec/config.yaml`, the PRD, `.env.example` files, `docs/hardware-test.md`, and the README name OP Sepolia as the testnet and mark mainnet as TBD.
- **No contract or crypto changes.** The VaultRegistry bytecode and vault format v1 are untouched.

**Open decision: mainnet chain (Arbitrum One vs OP Mainnet).** This change does not decide it; both stay supported presets. Measured on 2026-10-02, a sponsored 1 KB vault create costs about $0.004 on OP Mainnet (see design.md). The founder decides before mainnet launch.

**Out of scope:**
- the mainnet deployment itself;
- any change to VaultRegistry, vault-crypto, or the paymaster allowlist logic;
- per-chain Arweave changes (the Arweave mirror is chain-independent);
- adding non-OP, non-Arbitrum chains.

**Runtime dependencies:** none added. The third-party services stay the same kind: public RPCs, Pimlico (now its `optimism-sepolia` endpoint), and Arweave. There is still no CryoShield-operated backend.

## Capabilities

### New Capabilities
- `deployment-targets`: the supported networks and their presets; how the deploy tooling, the web app, and the recovery tool select a network; the testnet default; deployment records per chain; and explorer verification.

### Modified Capabilities
- None in `openspec/specs/`. The only archived capability is `vault-crypto`, which is chain-independent. The un-archived `vault-registry` requirement "Chain portability" (in `add-vault-registry-contract`) names only Arbitrum chains and Ethereum L1. Tasks update that wording in place to include OP Sepolia and OP Mainnet before that change is archived.

## Impact

- **contracts:** `script/deploy.sh`, `script/Deploy.s.sol` (comment), `foundry.toml` (`[rpc_endpoints]`), `.env.example`, README, and a new `deployments/11155420.json` after the real deploy.
- **apps/web:**
  - `.env.example` (`VITE_CHAIN_ID=11155420`, OP Sepolia RPC, Pimlico `optimism-sepolia` URL);
  - `e2e/scripts/build-fixtures.mjs` (default RPC);
  - `e2e/fixtures/chain-fixtures.json` (regenerated);
  - `e2e/stack/stack.ts` and `e2e/README.md` (comments);
  - `docs/hardware-test.md`, `docs/costs.md`.
- **tools/recover:**
  - `config.py` (presets, default network);
  - `cli.py` (`--network` choices, `--testnet`, help text);
  - tests that assume Arbitrum defaults;
  - the README.
- **openspec/config.yaml, the PRD, root README:** testnet and mainnet wording.
- **CI:** no workflow changes; the jobs are chain-independent.
