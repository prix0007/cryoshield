# VaultRegistry gas

Measured with forge 1.1.0, solc 0.8.28, optimizer 10,000 runs, EVM `cancun`, in `test/Gas.t.sol` with
`isolate = true`. Each figure is one call run as its own transaction: 21,000 intrinsic gas, calldata, and cold
storage access are all included. The snapshot lives in `snapshots/VaultRegistry.json`; `.gas-snapshot` holds the
per-test totals (`forge snapshot --mc GasTest --check`).

| Operation | Gas (full tx) |
|---|---:|
| `createVault`, 1024-byte blob, 2 new locators | **912,617** |
| `updateVault`, 1024-byte blob replacing a 1024-byte blob | **212,039** |
| `addLocators`, 1 new locator | **74,667** |
| Deployment (CREATE2, 3,845-byte runtime) | 871,075 (plus deployer-call overhead) |

Reproduce: `forge test --mc GasTest --gas-report` or read `snapshots/VaultRegistry.json`.

Worst case per call is bounded by the caps: at most 8 locators, each scanning at most 15 existing entries.

## Estimated cost

> **Assumptions, not measurements:** ETH = $3,000. Arbitrum One L2 gas price = 0.01 gwei (the network floor).
> Ethereum L1 gas price = 1 gwei (quiet) or 10 gwei (busy). Rescale linearly for other prices.

| Operation | Arbitrum L2 execution | Ethereum L1 @ 1 gwei | Ethereum L1 @ 10 gwei |
|---|---:|---:|---:|
| create (1 KB, 2 locators) | 0.0000091 ETH ≈ **$0.027** | 0.00091 ETH ≈ $2.74 | 0.0091 ETH ≈ $27.38 |
| update (1 KB) | 0.0000021 ETH ≈ **$0.006** | 0.00021 ETH ≈ $0.64 | 0.0021 ETH ≈ $6.36 |
| add 1 locator | 0.00000075 ETH ≈ **$0.002** | 0.000075 ETH ≈ $0.22 | 0.00075 ETH ≈ $2.24 |

Arbitrum also charges an L1 data-posting component for the roughly 1.2 KB of compressed calldata. Ciphertext does
not compress, so expect about 1.2 KB per create or update. Post-EIP-4844 this has typically been about a cent or less,
but it varies with L1 blob fees and is **not measured here**. Task 8.2 (the Sepolia deploy) should read
`gasUsedForL1` from real receipts and replace this estimate.

Paymaster policy input: sponsored cost per new vault is about 913k L2 gas plus the L1 data component. That is well
under the PRD's ≤ $1 per vault target on Arbitrum. Hosting the same contract on L1 would cost about $3–30 per create.
These figures are for direct calls. ERC-4337 adds EntryPoint and account-validation overhead on top.

## VaultRegistryV2 (harden-gas-sponsorship 3.5)

Same method (isolated, full transaction gas). Snapshot: `snapshots/VaultRegistryV2.json` (`test/GasV2.t.sol`).

| Operation | Gas |
|---|---:|
| `createVault`, 1024-byte blob, 2 new locators | **959,763** |
| `updateVault`, 1024-byte blob | **213,559** |
| `addLocators`, 1 new locator | **97,626** (v1: 74,667; the per-vault duplicate set costs one extra slot) |
| `resolveLocator`, 256-entry page (eth_call) | 733,712 |
| `getVaults`, 32 ids × 1 KB (eth_call) | 2,427,354, about 36 KB response; within public RPC eth_call gas caps |

Registration cost no longer depends on how long a locator's list is (`test_appendCostIndependentOfListLength`).

## CryoShieldSmartWallet validation (harden-gas-sponsorship 4.6)

`validateUserOp` with one WebAuthn signature, measured with the software P-256 fallback (no RIP-7212 precompile in the
test EVM; on OP chains the precompile is used, about 3,450 gas, so both figures drop by roughly 200k):

| Account | Gas |
|---|---:|
| CryoShieldSmartWallet (our build: solc 0.8.28, 10,000 runs) | 221,950 |
| Coinbase Smart Wallet v1.1 (Coinbase's deployed bytecode) | 301,116 |

The extra checks (length, rpIdHash comparison, UV bit) cost well under 1k gas; the difference above comes from the
different compiler settings of the two builds. Snapshot: `snapshots/CryoShieldSmartWallet.json`.
