# Risk register (lite)

> `add-privacy-and-compliance` task 2.4, design D9. CryoShield is an open-source project maintained by its
> contributors; there is no company (founder decision 2026-10-08). This is a lite register for a small project, not a
> DPIA (a full DPIA is N/A for the OSS project). Re-scored at every six-monthly and `mainnet-gate` review
> ([`review-log.md`](review-log.md)).

**Scoring:** likelihood (L) × impact (I), each 1–5; score = L×I. **Owners:** M = maintainer (founder), SR =
security-reviewer, CE = crypto-engineer, FE = frontend-engineer, SE = solidity-engineer, RE = recovery-engineer,
OW = overwatcher.

> **Re-scored 2026-10-09 for OP Mainnet, pending founder signature.** This re-score belongs to the 2026-10-09
> `mainnet-gate` entry in [`review-log.md`](review-log.md). It draws on
> [`launch-op-mainnet`](../../openspec/changes/launch-op-mainnet/design.md) → Threat and risk table, which numbers
> its rows separately; they are cited here as "design R*n*".
>
> What changed for mainnet:
> - real users keep real secrets, such as seed phrases that guard real funds;
> - gas sponsorship costs real money under the D8 policy: per user $1 and 10 operations a month; globally $30 and
>   about 500 operations a day; $0.50 per operation; about $140 prepaid, no card;
> - the contracts are unaudited and cannot be changed;
> - the bundler key ships in the browser;
> - recovery without CryoShield depends on an `op-mainnet` preset generated from `10.json`.
>
> The scores before this re-score are under "Changes at the 2026-10-09 re-score", below the table.

| # | Risk | L | I | Score | Mitigation in place | Next step | Owner |
|---|---|---|---|---|---|---|---|
| R1 | A malicious or compromised JS bundle served from `cryoshield.app` reads secrets at the next unlock (DNS, Fly, GitHub or release takeover). On mainnet the secrets guard real funds, so the target is worth more | 3 | 5 | 15 | owner-only `v*` releases; tag ruleset `~ALL` (applied 2026-10-09); owner-only `deploy.yml`; tag-only production environments; reproducible build + `release.json`; CSP with Trusted Types; SHA-pinned CI; DNSSEC in effect (DS published, `ad` flag, 2026-10-09); desktop recovery tool as the safe path; tabletop 2026-10-08 ([`tabletop-2026-10-08.md`](tabletop-2026-10-08.md)) | **before the deploy:** reduce CAA to Let's Encrypt only, with no wildcards (the live set still allows five CAs on 2026-10-09); CI-H1 closed 2026-10-09 (agents act as the Write-only machine account `cryoshield`); 2FA on GitHub and Cloudflare confirmed by the founder 2026-10-09, hardware-key method to confirm (G1); close or accept tabletop G2 (bundle check) and G5 | M, SR |
| R2 | A one-time capture of a PRF output or data key decrypts every past and future version (no forward secrecy, review F1) | 2 | 5 | 10 | documented; compromise guidance: move the secret and create a new vault with new keys | keep the guidance in the app and `/devices` | CE, FE |
| R3 | On-chain and Arweave data can never be erased; on mainnet it is real users' ciphertext and identifiers, permanently (no chain reset) | 5 | 3 | 15 | permanence + 18+ acknowledgement before every create; `/privacy` lists every public field; crypto-shredding guidance ([`erasure-procedure.md`](erasure-procedure.md)) | **before the first mainnet vault:** decide O3 fixed padding (with review F2), as [`on-chain-minimisation-options.md`](on-chain-minimisation-options.md) requires; accept or reject it in writing | M, CE |
| R4 | Future cryptanalysis of public ciphertext | 1 | 5 | 5 | symmetric only (AES-256-GCM, HKDF-SHA256), no low-entropy input, versioned format | none now | CE |
| R5 | Locator lookups via a public RPC link an IP to a vault | 3 | 2 | 6 | disclosed; the recovery tool lets the user choose RPCs | user-selectable RPC in the web app (post-MVP); OP Labs' logging for `mainnet.optimism.io` is unpublished (UNVERIFIED), as it is for Sepolia | FE |
| R6 | Pimlico keeps IP ↔ account-address logs for an unknown time | 4 | 2 | 8 | disclosed on `/privacy`; Pimlico sees ciphertext only | none; public terms relied on (no DPA, OSS) | M |
| R7 | A stolen key signs without its PIN | 1 | 4 | 4 | credProtect 3 at enrolment, and the CryoShield smart account requires UV and `sha256(rpId)` on every signature path (U2F path closed); mainnet has no v1 registry and no legacy CBSW vaults (pre-production F3 applies to testnet only) | none | SE, SR |
| R8 | Cross-chain replay of owner operations (review N1; design R13): the same keys give the same account address on OP Sepolia and OP Mainnet | 1 | 3 | 3 | the app never builds `executeWithoutChainIdValidation` operations; not in the sponsorship allowlist; replay needs the user's own signature | keep it so on mainnet; re-check in task 8.1 | SE |
| R9 | Gas sponsorship drained by scripts that make fresh accounts and go through our policy. Once the global $30 or ~500 operations is reached, saving is refused for everyone until the next day; this costs up to ~$30 a day of real money (design R1) | 3 | 3 | 9 | D8 global daily caps (spend and count), $0.50 per operation; target allowlist in the app; opening a vault never needs sponsorship; daily monitoring for 14 days, then weekly ([`paymaster-policy.md`](../../apps/web/docs/paymaster-policy.md) §7a); own-paymaster trigger (§8); policy end date 2027-10-02 with a 30-day reminder (design R17) | **before the deploy:** record the live D8 values (task 1.2, G4); confirm the calendar reminders (G7); write the pause and resume procedure (tabletop G4) | M |
| R10 | Sponsored gas is reclassified as a regulated crypto service; on mainnet the sponsorship has real value | 2 | 3 | 6 | Pimlico bills in USD; CryoShield never holds, buys or moves crypto for users; the accounts hold no value ([`legal-analysis.md`](legal-analysis.md) §5) | founder confirms §5 still describes the mainnet model | M |
| R11 | A sanctioned person uses the free sponsorship | 2 | 2 | 4 | terms eligibility clause; value bounded by D8 (≤ $0.50 an operation, ≤ $1 a user a month); no value transferred to the user | founder confirms §6 applies to mainnet and updates "a few cents per operation" to the D8 bound | M |
| R12 | Users cannot be told about an incident (no accounts, no email); on mainnet they may need to move real funds quickly | 3 | 4 | 12 | site banner, in-app notice, GitHub advisory, README ([`incident-runbook.md`](incident-runbook.md)) | close or accept tabletop G3 (no notice while production is scaled to 0); rehearse at the yearly tabletop | M |
| R13 | Children use the service | 2 | 2 | 4 | 18+ confirmation in the create flow; not directed at children | none | M |
| R14 | Domain lapse or loss of the RP ID `cryoshield.app` | 1 | 5 | 5 | auto-renew, registrar lock; DNSSEC in effect (2026-10-09); vaults stay readable with the desktop tool (CTAP2 needs no domain) | renew the domain (expires 2027-10-02) and `security.txt` (expires 2027-09-30) before September 2027 | M |
| R15 | Personal data or secrets posted in a public issue; mainnet users may post real seed phrases | 3 | 4 | 12 | issue-triage secret screen; privacy-request form warns first; maintainers delete such issues | none; keep the screen's BIP39 and key patterns current | M |
| R16 | Legal pages drift from what the product does | 2 | 3 | 6 | in-repo source, effective-date CI check, claims check at every review; the network name and "not independently audited" are chain-driven and tested on both chains, with an `AUDIT_PROMISES` denylist | next claims check at the six-monthly review | SR |
| R17 | A real user reaches the per-user cap (10 operations or $1 a month, D8). Their saves are refused until the monthly reset, and a new secret they have not kept elsewhere could be lost (design R16) | 3 | 2 | 6 | refusal copy says nothing was saved and tells the user to keep the secret safe until it saves; reading and recovery unaffected; refusals monitored | raise the cap with a recorded reason if real users hit it | M |
| R18 | The Pimlico key ships in the browser bundle and is used **without** the policy, if Pimlico cannot bind the key to it (AA-M3; design R2). The prepaid balance is lost, then saving is paused for everyone | 3 | 3 | 9 | prepaid only (~$140), no card (no overdraft); origin restriction (binds browsers only); dedicated mainnet key; policy-less spend checked daily, then weekly; rotate the key on any such spend | **before the deploy:** answer task 1.1 (a) and (b) and record the key's restrictions (G4); if the policy cannot be made mandatory, the founder accepts the balance bound in writing | M |
| R19 | No external audit: a bug in the immutable mainnet contracts (registry v2, wallet, factory) is found after real users rely on them, and it cannot be patched (design R6) | 2 | 4 | 8 | founder decision Q1 (2026-10-09), disclosed as "not independently audited" on every page; same bytecode as the reviewed OP Sepolia deployment; no admin or owner keys; internal reviews (`harden-gas-sponsorship` 7.1, launch 6.1); `forge test`; cross-implementation vectors; confidentiality rests on client-side crypto, not on the contracts | if a bug appears, pause sponsorship and ship a new versioned contract in its own change; task 8.1 post-launch review | M, SE, SR |
| R20 | Irreversible deploy: wrong or unreviewed bytecode lands on OP Mainnet, or a third party deploys first (design R3, R4) | 1 | 4 | 4 | D1 address-parity guard with `11155420.json`, checked before any RPC call; `CRYOSHIELD_MAINNET_GATE=approved:10`; simulate before broadcast; RP ID `cryoshield.app` only; Blockscout, Sourcify and Etherscan verification; runtime bytecode compared with `forge inspect` (task 7.2) | task 8.1 confirms the bytecode and the verifications | M, SE |
| R21 | Recovery without CryoShield fails on mainnet: the recovery tool's `op-mainnet` preset keeps placeholder addresses until it is generated from `10.json` and released (design R11) | 2 | 5 | 10 | preset generated from `10.json`, with parity tests (task 3.1); default network `op-mainnet`, `--testnet` for OP Sepolia (Q2); launch-day unlock from public RPCs and from Arweave (task 7.8); monthly recovery check | close `launch-op-mainnet` 3.1–3.4, 7.3, 7.4 and 7.8 (G5) before the soft launch ends and before any announcement | RE, M |
| R22 | Testnet users' vaults no longer appear on cryoshield.app after the switch (design R8) | 5 | 2 | 10 | no migration (Q4); 90-day in-app help on OP Mainnet; recovery tool `--testnet`; README and GitHub discussion notice | publish the communications texts (task 7.10) | FE, M |
| R23 | Cross-chain linkability: the same keys give the same account address and locators on OP Sepolia and OP Mainnet (design R12) | 5 | 2 | 10 | disclosed in `/privacy` "public and permanent data"; no secret is exposed | none | M |
| R24 | A chain rollback is blocked (design R9, R18): `vA` never runs in production on OP Sepolia (Sequencing B); old tags cannot build for chain 10; GitHub cannot return the testnet bundler URL | 2 | 3 | 6 | a failed first deploy rolls back to the self-contained 2026-10-05 image; `vA` builds for OP Sepolia; the dev site runs `vA`'s commit on OP Sepolia | **before the deploy:** save the four `production-build` values offline, taking the bundler URL from the Pimlico dashboard (G8) | M |
| R25 | One person releases, deploys, monitors and responds (bus factor, tabletop G6); a missed daily check lets an abuse day or a failure pass unnoticed | 3 | 3 | 9 | the caps bound any one missed day; recovery and reading need no CryoShield; manual monitoring runbook (§7a) | name a backup maintainer, or accept the bus factor in writing at this review | M |

**Changes at the 2026-10-09 re-score.** The testnet scores were set on 2026-10-08.

| # | Was | Now | Why |
|---|---|---|---|
| R1 | 2×5 = 10 | 3×5 = 15 | real funds raise the attacker's incentive; CAA still broad; DNSSEC now in effect |
| R3 | 5×2 = 10 | 5×3 = 15 | permanent real-user data; O3 still undecided |
| R5 | 3×2 = 6 | unchanged | the mainnet RPC's logging policy is also unpublished |
| R7 | 1×4 = 4 | unchanged | no legacy CBSW path on mainnet |
| R8 | 1×3 = 3 | unchanged | same account addresses on both chains, now noted |
| R9 | 3×2 = 6, owner OW | 3×3 = 9, owner M | real money (up to $30 a day) and everyone's saving paused; only the founder can use the dashboard |
| R10 | 1×3 = 3 | 2×3 = 6 | sponsorship has real value on mainnet |
| R11 | 2×1 = 2 | 2×2 = 4 | the per-operation cap is $0.50, not "a few cents" |
| R12 | 3×3 = 9 | 3×4 = 12 | users may need to act to protect real funds |
| R14 | 1×5 = 5 | unchanged | renewal dates added |
| R15 | 3×3 = 9 | 3×4 = 12 | real seed phrases more likely to be posted |
| R16 | 2×3 = 6 | unchanged | chain-driven copy and the denylist added |
| R17–R25 | — | new | mainnet risks: per-user cap, browser key used without the policy, no audit, irreversible deploy, recovery preset, testnet vaults, linkability, chain rollback, bus factor |

**Necessity and proportionality (lite).** Publishing ciphertext on a public chain and Arweave is the product: it is
what lets a user recover with no CryoShield server, ever. Alternatives (a CryoShield database, a custodian) were
rejected in the PRD because they reintroduce a party that can lose, leak or be compelled to hand over data. Everything
published is either ciphertext or a pseudonymous identifier needed for keyless recovery; the options to shrink the
identifiers are in [`on-chain-minimisation-options.md`](on-chain-minimisation-options.md).

**Residual-risk acceptance.** I accept the residual risks above for the OP Sepolia testnet preview.

Maintainer: ______________________ Date: __________

**Residual-risk acceptance for OP Mainnet (re-score of 2026-10-09).** I accept the residual risks above for OP
Mainnet (chain 10), on one condition. First, every "before the deploy" step in R1, R3, R9, R18 and R24 must be closed
or accepted in writing. So must every condition in the 2026-10-09 `mainnet-gate` entry of
[`review-log.md`](review-log.md).

Maintainer: _pending: founder signature and date_
