# Gas per vault write (task 6.6)

## Local (anvil, no RIP-7212 precompile: FreshCryptoLib P-256 fallback)

Measured by `test-int/gas.int.test.ts`: full `handleOps` transaction gas through EntryPoint v0.6 with the E2E
paymaster, Coinbase Smart Wallet v1.1, and one WebAuthn signature.

| Write | Blob | Gas |
|---|---|---|
| Create (deploys account, 2 keys, 2 locators) | 873 B | 1,520,575 |
| Edit (same size payload) | 873 B | 574,290 |
| Edit (smaller payload) | ~ 700 B | 532,864 |
| Add key (addOwner + addLocators + update) | 790 B | 755,714 |

The FCL fallback costs about 200–300k gas per signature. On OP Sepolia and OP Mainnet (Fjord), and on Arbitrum One and
Sepolia (ArbOS 31), the RIP-7212 precompile at `0x100` is used instead, at about 3,450 gas, so expect each figure to drop
by roughly that amount.

## OP Sepolia (11155420) through Pimlico: NOT YET MEASURED

This is the testnet. It is blocked on a Pimlico project and the registry deployment (`contracts/deployments/11155420.json`).
Measure with the hardware checklist (`docs/hardware-test.md`, steps 1a and 9) and fill in this table:

| Write | L2 gas | L1 data fee | USD |
|---|---|---|---|
| Create | | | |
| Edit | | | |
| Add key | | | |

On OP Sepolia the fees are test ETH. The L1 data fee upper bound for about 2.5 KB is about 3.7e11 wei, because the
Sepolia L1 base fee is higher.

## Mainnet estimates (mainnet chain TBD)

| Chain | Estimate per create | Basis |
|---|---|---|
| OP Mainnet (10) | **≈ $0.004** | 1.3M gas × ~0.001 gwei, plus an L1 fee bound of 6.8e10 wei for ~2.5 KB (target-op-sepolia design, measured 2026-10-02) |
| Arbitrum One (42161) | ≈ $0.03–0.05 | 1.3M gas × ~0.01 gwei, plus the L1 data fee for ~2 KB (earlier estimate) |

Both fit the policy caps in `docs/paymaster-policy.md`.
