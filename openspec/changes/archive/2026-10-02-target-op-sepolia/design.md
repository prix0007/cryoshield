# Design: target OP Sepolia

## Context

See proposal.md for the motivation. The stack is already mostly chain-agnostic:
- **Web app:** reads `VITE_CHAIN_ID` and `contracts/deployments/<chainId>.json` (`apps/web/src/config/schema.ts`, `src/chain/registry.ts`). Only `.env.example`, the E2E fixture script, comments, and docs name Arbitrum.
- **Recovery tool:** has a preset table (`tools/recover/src/cryoshield_recover/config.py`) with `arbitrum-one` (the default) and `arbitrum-sepolia`. `--testnet` is hardwired to `arbitrum-sepolia` (`cli.py:46,82`).
- **Deploy script:** `contracts/script/deploy.sh` has one public case, `arbitrum_sepolia`, with `ARBITRUM_SEPOLIA_RPC_URL` and `ARBISCAN_API_KEY`. `foundry.toml` has a matching `[rpc_endpoints]` entry.
- **Contract compilation:** VaultRegistry compiles with `evm_version = "cancun"`. The OP Stack has supported Cancun opcodes since Ecotone.

## Verified facts (2026-10-02)

Every on-chain check below was made with `cast` against `https://sepolia.optimism.io` (chain 11155420) and, for mainnet, `https://mainnet.optimism.io` (chain 10).

| # | Fact | Result | Evidence |
|---|---|---|---|
| 1 | RIP-7212 P-256 precompile at `0x100` | ✅ | Added to the OP Stack in **Fjord**. `GasPriceOracle.isFjord()` returns `true` on OP Sepolia and OP Mainnet. A freshly generated valid P-256 signature returns `0x…01` via `eth_call 0x100`; a corrupted one returns empty. Sources: [OP Stack precompiles spec](https://specs.optimism.io/protocol/precompiles.html), [RIP-7212](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7212.md). |
| 1a | Caveat: precompile return data | ⚠️ not a blocker | [ethereum-optimism/developers#791](https://github.com/ethereum-optimism/developers/discussions/791) reported empty return data in real transactions. The root cause was the caller's own code: the precompile must be reached with `staticcall`. Coinbase Smart Wallet's WebAuthn verifier already uses `staticcall`. The integration task re-checks this with a real sponsored transaction on OP Sepolia. |
| 2 | EntryPoint v0.6 `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | ✅ | Code size 23,689 bytes on OP Sepolia and OP Mainnet. |
| 3 | Coinbase Smart Wallet v1.1 factory `0xba5ed110efdba3d005bfc882d75358acbbb85842` (viem `toCoinbaseSmartAccount` v1.1) | ✅ | Code size 1,810 bytes on OP Sepolia and OP Mainnet. `implementation()` returns `0x00000110dCdEdC9581cb5eCB8467282f2926534d` on OP Sepolia **and** Arbitrum Sepolia (same address); the implementation is 17,694 bytes on OP Sepolia and OP Mainnet. |
| 3a | CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C` | ✅ | Code size 69 bytes on OP Sepolia and OP Mainnet, so the registry deploys to the same predicted address. |
| 4 | Pimlico on OP Sepolia | ✅ | Listed as chain 11155420, slug `optimism-sepolia`. `pm_validateSponsorshipPolicies` supports EntryPoint 0.6, and the singleton paymaster supports v0.6, v0.7 and v0.8. Endpoint: `https://api.pimlico.io/v2/optimism-sepolia/rpc?apikey=…` (the numeric chain ID also works in the path). Sources: [supported chains](https://docs.pimlico.io/guides/supported-chains), [sponsorship policies](https://docs.pimlico.io/guides/how-to/sponsorship-policies), [singleton paymaster](https://github.com/pimlicolabs/singleton-paymaster). |
| 5 | Explorer verification | ⚠️ superseded by D3 (keyless Blockscout; forge 1.1.0 cannot use V2) | Etherscan API V2 uses one key for 60+ chains, including OP Sepolia (`chainid=11155420`). Forge: `--verify --verifier etherscan --verifier-url "https://api.etherscan.io/v2/api?chainid=11155420"`, with the key read from `ETHERSCAN_API_KEY` (env only). Sources: [V2 migration](https://docs.etherscan.io/v2-migration), [verify with Foundry](https://docs.etherscan.io/contract-verification/verify-with-foundry). The pinned forge 1.1.0's handling of the V2 URL must be checked in the dry run (task 2.4). |
| 6 | Public OP Sepolia RPCs | ✅ | `https://sepolia.optimism.io`, `https://optimism-sepolia-rpc.publicnode.com`, `https://optimism-sepolia.drpc.org` all answered `eth_chainId = 11155420`. `endpoints.omniatech.io` returned HTTP 521, so it is excluded. |
| 7 | Faucets | ✅ | Superchain faucet ([docs](https://docs.optimism.io/app-developers/tools-sdks/faucets)), [Spectrum Nodes](https://spectrumnodes.com/blog/optimism-sepolia-faucet) (0.1 ETH/24 h), [LearnWeb3](https://learnweb3.io/faucets/optimism_sepolia/) (0.01/day, GitHub login), [GetBlock](https://getblock.io/faucet/op-sepolia/), [L2 Faucet](https://l2faucet.com/optimism), [thirdweb](https://thirdweb.com/op-sepolia-testnet). Bridging Ethereum Sepolia ETH through the official bridge also works. |
| 8 | Fee model | ✅ | OP Stack Ecotone/Fjord: total fee = L2 execution gas × L2 gas price + L1 data fee. Fjord bases the L1 data fee on a FastLZ-compressed size estimate. `GasPriceOracle.getL1FeeUpperBound(2500)` on OP Mainnet returns 6.77e10 wei. |

**No blockers found.**

### Cost estimate: sponsored 1 KB vault create on OP Mainnet (2026-10-02)

- **L2 gas.** `apps/web/docs/costs.md` measured 1,520,575 gas for a create (account deploy, 2 keys, 2 locators) using the Solidity P-256 fallback. With the `0x100` precompile, expect about 1.25–1.3M.
- **L2 gas price** on OP Mainnet: 1,001,539 wei (about 0.001 gwei).
- **L1 data fee:** the upper bound for about 2,500 bytes of calldata is 6.77e10 wei.
- **Total:** 1.3M × 1.0e6 + 6.8e10 ≈ 1.37e-6 ETH ≈ **$0.004** (ETH $2,704, from Chainlink on OP Mainnet). The L1 portion is about $0.0002.
- For comparison, the earlier Arbitrum estimate was about $0.03 at 0.01 gwei.
- On OP Sepolia the L1 bound is higher (3.69e11 wei, from the Sepolia L1 base fee), but it's test ETH.
- Task 6.6 of add-web-app measures the real figure.

## Deploy dry run on OP Sepolia (task 2.4, 2026-10-02)

Command (no keystore needed for simulation; `DEPLOYER_ADDRESS` is a plain sender address, not a key):

```
env -i PATH=$PATH HOME=$HOME OP_SEPOLIA_RPC_URL=https://sepolia.optimism.io \
  DEPLOYER_ADDRESS=0x000000000000000000000000000000000000dEaD contracts/script/deploy.sh op_sepolia
```

Captured output (abridged):

```
simulation only (set BROADCAST=1 to send)
network=op_sepolia chainId=11155420 predicted=0xB43f58cF17e64B603aE5588a1DD17E96a0849e44
Script ran successfully.
  chainId 11155420
  predicted 0xB43f58cF17e64B603aE5588a1DD17E96a0849e44
  deployed 0xB43f58cF17e64B603aE5588a1DD17E96a0849e44
Chain 11155420
Estimated gas price: 0.0012505 gwei
Estimated total gas used for script: 1206034
Estimated amount required: 0.000001508145517 ETH
SIMULATION COMPLETE.
```

- ✅ **Chain-ID check:** passed against the real RPC (11155420). `script/test-deploy-args.sh` also covers the negative case: `op_sepolia` against an RPC reporting 31337 exits non-zero before any simulation.
- ✅ **CREATE2 prediction:** the deployer exists on OP Sepolia, and the simulated address equals the predicted address and the anvil address `0xB43f58cF17e64B603aE5588a1DD17E96a0849e44`. The bytecode is unchanged, and the gas snapshot is unchanged.
- ✅ **Cost:** about 1.21M gas for the full script (the 871k deployment plus CREATE2 deployer overhead and the L1 data estimate). That's about 1.5e-6 test ETH, so 0.01 test ETH is plenty.
- ❌ **forge 1.1.0 + Etherscan V2: verification does not work.** Probed with `forge verify-contract … --chain 11155420 --verifier etherscan` and a dummy `ETHERSCAN_API_KEY`:
  - with `--verifier-url "https://api.etherscan.io/v2/api?chainid=11155420"` (also with a trailing `&` or `/api/?chainid=`), Etherscan answers *"Missing or unsupported chainid parameter (required for v2 api)"*. forge 1.1.0 drops the query string when it builds the request;
  - with no `--verifier-url`, forge uses the V1 endpoint, which answers *"You are using a deprecated V1 endpoint"*.

  The pinned forge therefore cannot verify on any Etherscan-family explorer, through `forge script --verify` or through `forge verify-contract` (the fallback in Risks).
  **Resolved (overwatcher decision):** switch to keyless Blockscout verification, without bumping forge in this change; see D3. Etherscan V2 is recorded as post-MVP.
- ✅ **Blockscout with forge 1.1.0:** `forge verify-contract --help` lists `--verifier blockscout` and `--verifier-url`. Every preset URL in D3 returned Blockscout's verification response (`Address is not a smart-contract`, expected before deploy).
- **Mitigation already in place:** `deploy.sh` runs verification as a separate step *after* writing `deployments/<chainId>.json`. A verifier failure exits 2 with a retry command, so it can never leave a live deployment without a record. No API key is involved.
- **Simulation sender:** a dry run accepts `DEPLOYER_ADDRESS` (an address only) so a keystore isn't needed for simulation. Broadcasting still requires `DEPLOYER_ACCOUNT` (keystore only), and raw private keys are still refused on every public preset.

## Goals / Non-Goals

**Goals:**
- OP Sepolia is the working testnet for deploy, web, E2E fixtures and recovery.
- Adding or switching a chain is a data-only edit.
- Arbitrum presets keep working.

**Non-Goals:**
- Choosing the mainnet chain.
- Any change to contract bytecode or the vault format.
- Multi-chain vaults (one deployment per chain; vaults never span chains).

## Decisions

**D1. Preset names.**
- Shell and Foundry use underscores (`op_sepolia`, `op_mainnet`, `arbitrum_sepolia`, `arbitrum_one`), because Foundry `[rpc_endpoints]` keys are conventionally `snake_case`.
- The recovery CLI uses kebab-case (`op-sepolia`, …), matching its existing presets.
- A shared test checks the names map one-to-one with identical chain IDs.
- Alternative considered: one shared JSON preset file read by all three tools. Rejected for the MVP: it couples a Python release artifact to a repo file. It may be adopted later.

**D2. Recovery tool network selection.**
- It ships per-chain built-in RPC lists, each with at least 3 RPCs.
- Selection order: `--network <preset>` > `--testnet` (= `op-sepolia`) > `DEFAULT_NETWORK`.
- `--chain-id` and `--rpc` remain overrides, and `--rpc` still requires `--chain-id` when it doesn't match a preset.
- **Security review decision (refuse):**
  - `--network`/`--testnet` combined with a `--chain-id` that differs from the preset's is a usage error. Otherwise the preset's registry could be used on another, possibly hostile, chain.
  - `--chain-id` alone selects the matching preset.
  - A non-preset `--chain-id` is a `custom` network: it requires `--rpc`, has no built-in registry (it needs `--registry`), and its endpoints are labelled user-supplied.
  - The preset parity reference lives in `config/chain-presets.json`.
- The registry address per preset is generated from `contracts/deployments/<chainId>.json` at release (the existing release-guard test covers this). A preset without a deployment record keeps the existing "not deployed" placeholder and refuses chain mode with a clear message.
- **The deployments file is not read at runtime,** because the binary must work outside the repo.
- `DEFAULT_NETWORK = "op-sepolia"` until mainnet is decided. Rejected alternatives: no default (worse UX for non-technical users), and auto-detecting by querying all chains (more network traffic, ambiguous results).

**D3. Explorer verification (amended 2026-10-02 by overwatcher decision: keyless Blockscout).**
- *Original plan:* one Etherscan V2 key (`ETHERSCAN_API_KEY`). It was dropped because the pinned forge 1.1.0 cannot verify through Etherscan V2 (see the task 2.4 dry run above).
- Every public preset verifies on **Blockscout**, which needs no key: `--verifier blockscout --verifier-url <preset URL>`. URLs (probed with forge 1.1.0 `verify-contract`; each returned Blockscout's "Address is not a smart-contract" for the not-yet-deployed address, which shows the request was accepted and routed):

  | Preset | Verifier URL |
  |---|---|
  | `op_sepolia` | `https://testnet-explorer.optimism.io/api/` |
  | `op_mainnet` | `https://explorer.optimism.io/api/` |
  | `arbitrum_sepolia` | `https://arbitrum-sepolia.blockscout.com/api/` |
  | `arbitrum_one` | `https://arbitrum.blockscout.com/api/` |

  `optimism-sepolia.blockscout.com` and `optimism.blockscout.com` now 301-redirect to the OP-branded hosts above. Through the redirect, forge's POST is retried and never completes, so the presets use the final URLs. A test asserts no OP preset uses a redirecting host.
- `ARBISCAN_API_KEY` and `ETHERSCAN_API_KEY` are both removed from the tooling and from `.env.example`. No preset needs a key, so the founder has one fewer secret to obtain. Blockscout also publishes to Sourcify-compatible verification, and the source is open in the repo anyway.
- Verification runs after `deployments/<chainId>.json` is written. On failure it exits 2, keeps the record, and prints a retry command.
- The security property from the add-vault-registry-contract review is unchanged: keystore only, no secrets in argv.
- **Post-MVP:** add Etherscan-family verification (Etherscan V2, one `ETHERSCAN_API_KEY`, env only) after bumping the pinned forge to a release that supports V2, through its own OpenSpec change.

**D4. E2E fixtures.**
- `build-fixtures.mjs` defaults to `https://sepolia.optimism.io`.
- The regenerated `chain-fixtures.json` records its source chain.
- A test asserts that the bytecode of EntryPoint v0.6, SenderCreator, and the CBSW v1.1 factory and implementation equals the previous Arbitrum-sourced fixtures (the canonical deployments are deterministic). Any difference blocks the change; it is never silently accepted.

**D5. No contract changes.** The `vault-registry` "Chain portability" requirement wording, in the un-archived add-vault-registry-contract change, is extended to name OP Sepolia and OP Mainnet. Its existing test (the same suite under L1 settings) already covers portability; no new contract code is needed.

## Risks / Trade-offs

- **Precompile caller pattern** (fact 1a): low risk, because CBSW uses `staticcall`. It's still verified by a real sponsored transaction on OP Sepolia in the hardware checklist.
- **Default network changes to a testnet:** a recovery tool built before mainnet would default to testnet. That's acceptable pre-launch. The release checklist must flip `DEFAULT_NETWORK` to the chosen mainnet, through an OpenSpec change.
- **Forge 1.1.0 and the Etherscan V2 URL:** confirmed incompatible (task 2.4). Resolved by switching to keyless Blockscout (D3). Etherscan V2 is post-MVP, after a forge bump.
- **Blockscout availability:** if Blockscout is down at deploy time, the deployment and its record still succeed, and verification exits 2 with a retry command.
- **Sequencer visibility:** the OP Sepolia sequencer is centralized, like Arbitrum's, so the accepted locator-stuffing and vaultId front-run risks are unchanged. We still use the private Pimlico endpoint.
- **Arbitrum presets become secondary:** they are kept and tested for preset parity only. No live Arbitrum testnet runs are planned.
