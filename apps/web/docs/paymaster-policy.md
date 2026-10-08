# Gas sponsorship runbook (Pimlico)

CryoShield pays gas for every vault write through **Pimlico's verifying paymaster**, under a **sponsorship policy** set
in Pimlico's dashboard. CryoShield runs no paymaster, webhook, proxy or other server in this path
(OpenSpec `harden-gas-sponsorship`, spec `gas-sponsorship`, design D1–D6).

This file is the record of what is live. **Update it whenever a dashboard setting changes**, with the date.

## 1. How a sponsored write works

1. The app builds the calls and checks them against its allowlist (`src/account/policy.ts`):
   - value 0;
   - **VaultRegistry v2** `createVault(bytes32 salt, bytes, bytes32[])`, `updateVault(bytes32,bytes)` or
     `addLocators(bytes32,bytes32[])`; or the account itself, `addOwnerPublicKey(bytes32,bytes32)` (add-key only);
   - never VaultRegistry v1 (legacy, read-only), never any other target.
2. It asks Pimlico for paymaster data with the ERC-7677 context `{ sponsorshipPolicyId: VITE_SPONSORSHIP_POLICY_ID }`.
   Every request carries it (unit test: `test/account/writes.test.ts`, "sponsorship refusal").
3. Only then does the user touch their key (one tap plus PIN) to sign. The account (`CryoShieldSmartWallet`) accepts
   only signatures with user verification (PIN) and our RP ID.

The build refuses to start without a valid `VITE_SPONSORSHIP_POLICY_ID` (`test/config/schema.test.ts`).

## 2. When sponsorship is refused

Any refusal (a policy limit, an empty balance, a provider error) becomes `SPONSORSHIP_REFUSED`. Nothing is signed or
sent, and there is **never an unsponsored fallback**. The user sees:

| Where | Message |
|---|---|
| Edit, add a key | "Saving is paused right now. Your existing vault is safe; please try again later." |
| First create | "Nothing was saved. Please try again later." (with a Details reference) |

Unlocking still works: reads need only a public RPC. Recovery needs neither CryoShield nor Pimlico.

## 3. Settings per environment

Starting values from design D2/D3. The founder may tune them; the **Live** columns are the record.

> **Status 2026-10-09 (pre-production review, finding F1 / M2): nothing below is confirmed yet.** The Live testnet
> column shows, for each row, the value the review recommends for the **production** policy (the one whose id is
> `VITE_SPONSORSHIP_POLICY_ID` in `production-build`) before the first `gh release create`. The founder sets or
> checks each value in the Pimlico dashboard and then replaces `_pending_` with the live value and the date, in a docs
> PR (no key, no secret). Tasks `harden-gas-sponsorship` 1.1 and 1.2 are ticked only then. The dev policy (the id in
> `development-build`) is a **different** policy and may use smaller caps. See
> [`docs/reviews/2026-10-09-pre-production.md`](../../../docs/reviews/2026-10-09-pre-production.md).

### Sponsorship policy

| Pimlico field | Testnet (OP Sepolia) | Mainnet (OP Mainnet, at the gate) | Live testnet (date) | Live mainnet (date) |
|---|---|---|---|---|
| `chain_ids.allowlist` | 11155420 only | 10 only | _pending (task 1.2); recommended: `[11155420]` only_ | _not before task 8.1_ |
| `user.maximum_user_operation_count` | 50, `never` (lifetime) | 50, `monthly` | _pending; recommended: 50, reset `never`_ | |
| `user.user_operation_spending` | not set | $1.00, `monthly` | _pending; recommended: not set_ | |
| `user_operation.user_operation_spending` | $0.50 | $0.10 | _pending; recommended: $0.50_ | |
| `global.user_operation_spending` (`daily`) | USD equal to about 0.05 ETH (record the rate used) | $20 | _pending; recommended: USD of about 0.05 ETH, `daily`; record the ETH/USD rate used_ | |
| `global.maximum_user_operation_count` (`daily`) | 500 | 2,000 | _pending; recommended: 500, `daily`_ | |
| Webhook | **off** | **off** | _pending; recommended: off_ | |
| Start / end time | unset | unset | _pending; recommended: both unset (a policy that expires pauses all saving)_ | |

Why these numbers: a measured create is about 1.5M gas on anvil (`docs/costs.md`), about $0.004 on OP Mainnet. $0.10
per operation is about 25 times that, to allow for gas spikes and Pimlico pre-charging at maximum cost. A real user
needs one create, a few edits and one or two add-key operations, far below 50.

### API keys

One key per environment; never reuse the dev key in production.

| Environment | Allowed origin | Methods | "Policy required" | Live (date) |
|---|---|---|---|---|
| Dev (`cryoshield-web-dev.fly.dev`) | `https://cryoshield-web-dev.fly.dev` | bundler + paymaster on; account APIs off | on, if the dashboard offers it | _pending; recommended: as in this row, on a key used only by `development-build`_ |
| Testnet production (`cryoshield.app`) | `https://cryoshield.app` | bundler + paymaster on; account APIs off | on, if offered | _pending; recommended: a key **distinct from the dev key**, origin exactly `https://cryoshield.app`, bundler + paymaster on, account APIs off, restricted to the production policy id if the dashboard allows_ |
| Mainnet (`cryoshield.app`) | `https://cryoshield.app` | bundler + paymaster on; account APIs off | on, if offered | _not before task 8.1_ |

The origin restriction binds browsers only: a script can send any `Origin`. It stops other websites from using our
key, not scripts.

### Balance

- **Mainnet:** prepaid only, about **7 days of the global cap ($140)**, and **no card** (a card unlocks a $10
  overdraft). The balance is then the hard bound on spending that bypasses the policy.
- **Testnet:** Pimlico documents testnet operations as free to sponsor (unconfirmed for our account: question (c)
  below). Recommended before the first release: no card on file for mainnet.

## 4. Dashboard facts (task 1.1)

Pimlico's public docs leave these open. The founder confirms each in the dashboard and records the answer and date.

| Question | Answer | Date |
|---|---|---|
| (a) Can a key require a sponsorship policy, or be limited to specific policy IDs? | _pending_ (if yes: turn it on for the production key; if no: record "no", and the balance stays the bound) | |
| (b) Is a policy-less request refused when the balance is empty and there is no card? | _pending_ | |
| (c) How do USD limits count testnet operations? (If $0, the count limits are the testnet bound.) | _pending_ | |
| (d) Which origin and method restrictions are available on a key? | _pending_ | |
| (e) Do failed or reverted operations count toward the per-sender operation count? | _pending_ | |

These answers are also the manual checks for the dashboard-only spec scenarios: a key used from another website, a
policy bypass bounded by the balance, and the global cap reached.

## 5. The honest abuse bound

| Attacker | Can do | Bounded by | Cannot do |
|---|---|---|---|
| A script making fresh accounts with software passkeys, through our policy | Sponsored writes until the day's global cap is spent. Per-sender limits don't help: every account is a new sender. | The **global daily cap** (spend and count); the per-operation cap bounds each operation | Read, change or delete any vault; get any plaintext; block a registration (v2 has no locator cap); squat a vaultId (v2 derives it from the sender) |
| A script using our key **without** the policy (if Pimlico allows it) | Sponsored operations with no policy limits | The **prepaid balance**, with no overdraft. Testnet costs nothing. | The same as above |
| A website embedding our key | Nothing | The origin restriction | n/a |
| A stolen key **without** its PIN | Nothing: the account refuses signatures without user verification, and the key itself refuses without its PIN (credProtect 3) | n/a | n/a |
| A stolen key **with** its PIN | Everything that key can do. The user removes that key by re-keying. | Out of scope | n/a |
| Pimlico outage or refusal | No sponsored writes ("Saving is paused") | Vaults stay readable and recoverable without CryoShield or Pimlico | Touch any vault |

**In one sentence:** abuse can only exhaust the sponsorship budget, so users see "Saving is paused". It cannot read or
corrupt any vault: vault integrity rests on the immutable registry's owner checks and on each vault's ciphertext being
bound to its vaultId.

Vault cloning is sponsorable but harmless: a copy of a victim's public blob under another vaultId never decrypts
(the vaultId is in the AAD), so it is never offered (`test-int/writes.int.test.ts`, "vault cloning is neutralised").

## 6. Testnet per-sender lockout

On testnet the per-sender limit is lifetime (50 operations). A tester who reaches it sees "Saving is paused" on every
edit. **Remedy:** the founder raises the per-sender cap in the dashboard. The user is never asked to pay gas. (Mainnet
resets monthly, so nobody is locked out for good.)

## 7. Weekly review (founder, about 10 minutes)

There is no server to send alerts, and Pimlico has no low-balance alerting, so this check is manual.

- [ ] Usage page: on how many of the last 7 days was the global cap (spend or count) reached?
- [ ] Usage page: is there any sponsored spend that did **not** use our policy ID?
- [ ] Balance (mainnet): still about 7 days of the global cap, and no card on the account?
- [ ] Spend rate: in line with D2, or draining faster?
- [ ] Policy and key settings still match section 3 (webhook off, origins, methods)?
- [ ] Any user reports of "Saving is paused" that the numbers don't explain?
- [ ] Record the date and anything changed in this file.

## 8. Re-evaluation trigger for an own paymaster (design D6)

**Open a new OpenSpec change for an own paymaster** (one that fixes the earlier review's blocking flaws) when **any**
of these happens:

- **Observed abuse:**
  - the global daily cap is reached on **2 or more days in any 7-day window**; or
  - sponsorship that **did not use our policy** appears in Pimlico usage; or
  - the balance drains faster than D2 predicts.
- **Mainnet scale:** sustained sponsored spend above **$300 a month**, or more than **1,000 new vaults a month**.
- **Pimlico capability:** Pimlico removes or weakens policies, or a key cannot be restricted to the policy and the
  founder judges the balance bound insufficient.

## 9. Private bundler endpoint

`VITE_BUNDLER_URL` points at Pimlico's RPC endpoint. User operations go straight to Pimlico over HTTPS, not to the
public ERC-4337 mempool. On OP Stack chains a centralized sequencer orders transactions, with no public
pending-transaction mempool. Front-running no longer matters for correctness: VaultRegistry v2 derives each vaultId
from the account address, so a copied pending create gives the copier a different id, and locators have no entry cap.
