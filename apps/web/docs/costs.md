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

## OP Sepolia (11155420) through Pimlico: measured (harden-gas-sponsorship 6.3)

This is the founder's YubiKey run on the dev site (`cryoshield-web-dev.fly.dev`) from 2026-10-07 to 2026-10-09.

- The account is a `CryoShieldSmartWallet` from the dev factory, on EntryPoint v0.6.
- Every operation was sponsored by Pimlico's `SingletonPaymasterV6` `0x6666…c68b` and included with `success = true`.
- The vault is a 442-byte blob with 2 keys, in VaultRegistryV2.
- Per-transaction links, decoding and the method are in [`contracts/GAS.md`](../../../contracts/GAS.md#on-chain-op-sepolia-through-pimlico-harden-gas-sponsorship-6263).

| Write | Ops | L2 gas (op `actualGasUsed`) | Charged to the paymaster (`actualGasCost`) | L1 data fee (bundler tx) | USD |
|---|---:|---:|---:|---:|---|
| Create (deploys account, 2 keys, 2 locators) | 1 | 987,350 | 1.086e12 wei (0.0000011 ETH) | 5,134 wei | test ETH |
| Edit (same-size payload) | 7 | 219,510 – 236,716 | 2.42e11 – 2.60e11 wei | 2,507 – 3,988 wei | test ETH |
| Add key | 0 | **not measured** | | | |

- **The upper edit figure** (236.7k) is an edit that opens a new EntryPoint nonce key. Later edits on the same key
  cost 219.5k.
- **The L1 data fee** on OP Sepolia is a few thousand wei, because the Sepolia blob base fee is tiny. The bundler pays
  it from `preVerificationGas`.
- **Add key has no on-chain run yet.** None of the 7 edits adds a key: every blob keeps 2 keys and the account still
  has 2 owners. The estimate below is labelled as one.

## OP Mainnet estimate from the measured OP Sepolia gas

Read on **2026-10-09 19:04 UTC** from `https://mainnet.optimism.io` (block 157,986,920). The inputs are:

- **L2 gas price:** `eth_gasPrice` = 1,000,621 wei (base fee 621 + 0.001 gwei priority).
- **ETH price:** $2,483.09, from Chainlink ETH / USD on OP Mainnet (`0x13e3Ee699D1909E989722E753853AE30b17e08c5`,
  `latestRoundData`).
- **L1 data fee:** the `GasPriceOracle` (`0x4200…000F`) at L1 base fee 0.234 gwei and blob base fee 0.0132 gwei,
  applied to the real signed OP Sepolia bundle transactions (create: 2,905 bytes; edit: 2,297 bytes).

**Method:** cost = L2 gas × L2 gas price + the L1 fee **upper bound** (`getL1FeeUpperBound(size)`). The bound is about
1.8× the compressed estimate (`getL1Fee` = 4.42e10 wei for create, 3.47e10 wei for edit).

This adds the L1 fee on top of `actualGasUsed`, whose `preVerificationGas` already pays for it, so the estimate errs
high. The same bytecode and the same RIP-7212 precompile run on OP Mainnet, so the L2 gas carries over.

| Write | L2 gas | L2 fee | L1 fee bound | Total | ×10 gas spike | D2 mainnet cap $0.10 | D2 testnet cap $0.50 |
|---|---:|---:|---:|---:|---:|---|---|
| Create | 987,350 | 9.88e11 wei ($0.00245) | 7.94e10 wei ($0.00020) | 1.07e12 wei = **$0.0027** | **$0.027** | fits, 3.8× headroom at ×10 | fits, 19× |
| Edit (worst measured) | 236,716 | 2.37e11 wei ($0.00059) | 6.30e10 wei ($0.00016) | 3.00e11 wei = **$0.00074** | **$0.0074** | fits, 13× | fits, 67× |
| Add key (**estimate**) | ≈ 418,140 | 4.18e11 wei ($0.00104) | 7.94e10 wei ($0.00020) | 4.98e11 wei = **$0.0012** | **$0.012** | fits, 8× | fits, 40× |

The add-key gas is an estimate. It is the measured OP Sepolia edit (236,716) plus the local add-key-minus-edit delta
from the anvil table above (755,714 − 574,290 = 181,424). Its L1 bound is the create-sized one. Replace it once an
add-key operation is measured.

**Pre-charge at the maximum cost.** If Pimlico checks the per-operation limit against the operation's maximum cost
rather than its actual cost (open item, task 1.1), the gas limits the app sent apply instead:

- **Create:** 1,600,448 gas (verification + call + pre-verification), at 1.1× the gas price, plus the L1 bound, is
  ≈ $0.0046. At ×10 it is ≈ $0.046, still under $0.10.
- **Edit:** 1,044,951 gas, ≈ $0.0030. At ×10 it is ≈ $0.030.

**Cap re-check (design D2).** Every write fits both per-operation caps even at a ×10 gas-price spike. The tightest case
is a create pre-charged at its maximum cost during a ×10 spike, at about half of the $0.10 mainnet cap.

This replaces the earlier OP Mainnet create estimate of ≈ $0.004, which was 1.3M gas on anvil plus an L1 bound of
6.8e10 wei (2026-10-02). The estimate also fits the per-sender $1.00 per month: 1 create and 50 edits is about $0.04.

Arbitrum One (42161) has no new measurement. The earlier estimate was ≈ $0.03–0.05 per create.
