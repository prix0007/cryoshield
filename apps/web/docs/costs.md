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

**Pre-charge at the maximum cost.** Pimlico pre-charges the maximum cost (gas limits × max gas price) when it signs,
then refunds the unspent part after about 15 minutes
([verifying paymaster FAQ](https://docs.pimlico.io/references/paymaster/verifying-paymaster/faqs), read 2026-10-10;
task 1.1 (e)). So the gas limits the app sent are what counts against the limits until the refund:

- **Create:** 1,600,448 gas (verification + call + pre-verification), at 1.1× the gas price, plus the L1 bound, is
  ≈ $0.0046. At ×10 it is ≈ $0.046, still under $0.10.
- **Edit:** 1,044,951 gas, ≈ $0.0030. At ×10 it is ≈ $0.030.

**Cap re-check (design D2).** Every write fits both per-operation caps even at a ×10 gas-price spike. The tightest case
is a create pre-charged at its maximum cost during a ×10 spike, at about half of the $0.10 mainnet cap.

This replaces the earlier OP Mainnet create estimate of ≈ $0.004, which was 1.3M gas on anvil plus an L1 bound of
6.8e10 wei (2026-10-02). The estimate also fits the per-sender $1.00 per month: 1 create and 50 edits is about $0.04
in gas alone (Pimlico's fees are below).

## Padding every payload to the maximum (pad-to-max-payload)

Since `pad-to-max-payload`, every blob is padded to the maximum for its key set, so a 2-key vault is about 1 KB
whatever it holds (974 bytes with 64-byte credential IDs; 1,018 bytes with the founder's YubiKey credential IDs, whose
vault was 442 bytes before). The rows above were measured with the earlier, smaller blobs. Larger blobs cost more
calldata and, mostly, more registry storage (one 32-byte slot per 32 bytes).

**Measured, before → after.**

| Measurement | Before | After | Δ gas |
|---|---:|---:|---:|
| Registry `createVault`, forge full tx (`contracts/GAS.md`) | 616,314 (526 B) | 934,241 (974 B) | +317,927 |
| Registry `updateVault`, forge full tx | 127,700 (526 B) | 206,228 (974 B) | +78,528 |
| Anvil full stack, create, 12-word seed (`test-int/gas.int.test.ts`) | 1,259,328 (489 B) | 1,618,847 (1,001 B) | +359,519 |
| Anvil full stack, edit, 12-word seed | 455,258 (489 B) | 548,707 (1,001 B) | +93,449 |
| Anvil full stack, create, 24-word seed | 1,306,516 (553 B) | 1,615,457 (1,001 B) | +308,941 |
| Anvil full stack, edit, 24-word seed | 465,571 (553 B) | 551,609 (1,001 B) | +86,038 |

The anvil figures use the fake authenticator's credential IDs and RP ID `localhost`. After the change the 12-word and
24-word blobs are the same length, and so cost the same within a few thousand gas (signature encoding varies).

**OP Mainnet estimate**, by the method above, read on **2026-10-09 21:04 UTC** (block 157,990,537): L2 gas price
1,000,774 wei, ETH $2,479.03 (Chainlink), L1 base fee 0.104 gwei, blob base fee 0.0056 gwei. The founder's vault grows
by 576 bytes (442 → 1,018), so the anvil per-byte deltas (702 gas per byte for create, 183 for edit) give +404,459 gas
per create and +105,130 per edit on top of the measured OP Sepolia operations. The L1 bound is read for the bundle
sizes plus 576 bytes.

| Write | L2 gas before → after | L1 bound before → after | Total before → after | Δ per write | ×10 gas spike (after) |
|---|---:|---:|---:|---:|---:|
| Create | 987,350 → 1,391,809 | 3.55e10 → 4.24e10 wei | $0.00254 → **$0.00356** | **+$0.0010** | $0.036 |
| Edit (worst measured) | 236,716 → 341,846 | 2.81e10 → 3.50e10 wei | $0.00066 → **$0.00093** | **+$0.00028** | $0.0093 |

So an edit costs about $0.0003 more and a create about $0.001 more (once per vault; add-key is an edit plus
`addOwnerPublicKey` and `addLocators`, so about +$0.0003 too). With Pimlico's 10% surcharge: +$0.0011 and +$0.0003.
Against the $0.0105 per-operation fee, the totals per operation become about **$0.0144** for a create (was $0.0135)
and **$0.0115** for an edit (was $0.0113).

**Caps re-checked.**

- **$0.50 per operation:** a create pre-charges about 2.0M gas (1,600,448 + 404,459) × 1.1 × gas price + the L1
  bound ≈ $0.0056, or $0.056 at a ×10 spike: 9× headroom. An edit ≈ $0.0032 ($0.032 at ×10).
- **$1 and 10 operations per user per month:** 10 creates at a ×10 spike pre-charge about 10 × ($0.056 × 1.1 +
  $0.0105) ≈ $0.72, still under $1; the count binds first.
- **$30 and 500 operations per day, global:** at normal gas, 500 creates pre-charge ≈ $8.3. During a ×10 spike, 500
  creates ≈ $35.9 (was $30.75), so a burst of creates during a spike reaches the $30 daily cap on pre-charges about
  70 operations earlier than before; 500 edits ≈ $23. This was already the tightest case (above) and stays an
  availability risk only.
- **Registry and wallet limits:** the registry accepts blobs of 1..1024 bytes and every padded blob is at most 1024;
  the wallet has no calldata limit.

## Pimlico fees on OP Mainnet and the budget (recomputed 2026-10-10)

The figures above are gas only. On mainnet Pimlico also charges for each sponsored operation (sources read
2026-10-10, `launch-op-mainnet` task 1.2):

- **Gas surcharge:** sponsorship bills the actual gas plus **10%**
  ([pricing](https://www.pimlico.io/pricing)).
- **Per-operation fee:** the pricing page lists pay-as-you-go at about **$0.0075 per user operation**, about
  **$0.0105 for a sponsored one** ([pricing](https://www.pimlico.io/pricing)).
- **Testnet:** operations are free, with no surcharge, so none of this applies on OP Sepolia.

At today's gas the fee, not gas, dominates. Per sponsored operation, with the gas from the estimate table:

| Write | Gas | Gas + 10% | + $0.0105 fee | Total per operation |
|---|---:|---:|---:|---:|
| Create | $0.0027 | $0.0030 | $0.0105 | **≈ $0.0135** |
| Edit | $0.00074 | $0.0008 | $0.0105 | **≈ $0.0113** |
| Add key (estimate) | $0.0012 | $0.0013 | $0.0105 | **≈ $0.0118** |

**Budget, corrected.** Counting gas alone, the ~$140 prepaid balance looks like hundreds of thousands of operations
($140 ÷ $0.00074 ≈ 190k edits). That is wrong once the fee is included:

- **$140 buys roughly 10–13k sponsored operations:** $140 ÷ $0.0135 ≈ 10,370 if every one were a create, $140 ÷
  $0.0113 ≈ 12,390 if every one were an edit, and $140 ÷ $0.0105 ≈ 13,330 is the ceiling even with free gas.
- **Per user, $1 still covers the 10-operation monthly cap:** 10 edits ≈ 10 × $0.0113 = $0.113; 1 create and 9 edits
  ≈ $0.0135 + 9 × $0.0113 = $0.115. So about **$0.11**, and the count (10) binds long before the $1. A typical first
  month (1 create, 3 edits, 1 add-key) is ≈ $0.0135 + 3 × $0.0113 + $0.0118 = **$0.059**.
- **Global, the 500-operation count binds before the $30:** 500 × $0.0113–0.0135 ≈ **$5.65–6.75 a day**. Reaching $30
  with 500 operations needs about $0.06 each, about 4–5× today's total. At most 500 operations a day, the balance
  lasts at least 140 ÷ 6.75 ≈ 20 days at the cap, and more than four days even if $30 were spent every day.
- **Live balance (founder, 2026-10-10): $120 prepaid**, not the planned ~$140. That is about 8,900 creates
  ($120 ÷ $0.0135), 10,600 edits ($120 ÷ $0.0113), or 11,400 operations even with free gas ($120 ÷ $0.0105). It lasts
  about 17 days at 500 operations a day ($120 ÷ $6.75), or **4 days** if $30 were spent every day. The runbook's
  top-up threshold (balance < $50) still applies.

**Pre-charge effect on the caps.** Until the refunds land (about 15 minutes), the $30 daily and $1 per-user caps can
fill faster than real spend, because each operation counts at its maximum cost. Whether Pimlico counts its
per-operation fee against the policy's USD limits is not documented; the worst cases below include it:

- **Normal gas:** a create pre-charges ≈ $0.0046 × 1.1 ≈ $0.0051 of gas (an edit ≈ $0.0033), against ≈ $0.0030 of
  real gas. Per user: 10 creates ≈ 10 × ($0.0051 + $0.0105) ≈ $0.16, far under $1. Global: 500 creates ≈ $7.80,
  under $30.
- **×10 gas spike:** a create pre-charges ≈ $0.046 × 1.1 ≈ $0.051. Per user: 10 creates ≈ 10 × ($0.051 + $0.0105)
  ≈ $0.61, still under $1. Global: 500 creates ≈ 500 × $0.0615 ≈ **$30.75**, so a burst of creates during a spike can
  hit the $30 daily cap on pre-charges alone, refusing saves for everyone until refunds land or the day resets.

Arbitrum One (42161) has no new measurement. The earlier estimate was ≈ $0.03–0.05 per create.
