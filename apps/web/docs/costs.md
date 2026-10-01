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

The FCL fallback costs about 200–300k gas per signature. On Arbitrum One and Sepolia the RIP-7212 precompile at `0x100`
(ArbOS 31) is used instead, at about 3,450 gas, so expect each figure to drop by roughly that amount.

## Arbitrum Sepolia through Pimlico: NOT YET MEASURED

This is blocked on a Pimlico project and a Sepolia registry deployment (`contracts/deployments/421614.json`). Measure
with the hardware checklist (`docs/hardware-test.md`) and fill in this table:

| Write | L2 gas | L1 data fee | USD |
|---|---|---|---|
| Create | | | |
| Edit | | | |
| Add key | | | |

Rough expectation at 0.01 gwei L2: 1.3M gas ≈ 0.000013 ETH ≈ $0.03–0.05 per create plus the L1 data fee for about 2 KB of
calldata. This fits the policy caps in `docs/paymaster-policy.md`.
