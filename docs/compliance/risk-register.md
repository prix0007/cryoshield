# Risk register (lite)

> `add-privacy-and-compliance` task 2.4, design D9. CryoShield is an open-source project maintained by its
> contributors; there is no company (founder decision 2026-10-08). This is a lite register for a small project, not a
> DPIA (a full DPIA is N/A for the OSS project). Re-scored at every six-monthly and `mainnet-gate` review
> ([`review-log.md`](review-log.md)).

**Scoring:** likelihood (L) × impact (I), each 1–5; score = L×I. **Owners:** M = maintainer (founder), SR =
security-reviewer, CE = crypto-engineer, FE = frontend-engineer, SE = solidity-engineer, RE = recovery-engineer,
OW = overwatcher.

| # | Risk | L | I | Score | Mitigation in place | Next step | Owner |
|---|---|---|---|---|---|---|---|
| R1 | A malicious or compromised JS bundle served from `cryoshield.app` reads secrets at the next unlock (DNS, Fly, GitHub or release takeover) | 2 | 5 | 10 | owner-only `v*` releases, tag ruleset, reproducible build + `release.json`, CSP, SHA-pinned CI, desktop recovery tool as the safe path; tabletop run 2026-10-08 ([`tabletop-2026-10-08.md`](tabletop-2026-10-08.md)) | close the tabletop gaps; mainnet re-gate (reviewer on `production`, CI-H1) | M, SR |
| R2 | A one-time capture of a PRF output or data key decrypts every past and future version (no forward secrecy, review F1) | 2 | 5 | 10 | documented; compromise guidance: move the secret and create a new vault with new keys | keep the guidance in the app and `/devices` | CE, FE |
| R3 | On-chain and Arweave data can never be erased | 5 | 2 | 10 | permanence + 18+ acknowledgement before every create; `/privacy` lists every public field; crypto-shredding guidance ([`erasure-procedure.md`](erasure-procedure.md)) | decide the minimisation options before the first mainnet vault ([`on-chain-minimisation-options.md`](on-chain-minimisation-options.md)) | M, CE |
| R4 | Future cryptanalysis of public ciphertext | 1 | 5 | 5 | symmetric only (AES-256-GCM, HKDF-SHA256), no low-entropy input, versioned format | none now | CE |
| R5 | Locator lookups via a public RPC link an IP to a vault | 3 | 2 | 6 | disclosed; the recovery tool lets the user choose RPCs | user-selectable RPC in the web app (post-MVP) | FE |
| R6 | Pimlico keeps IP ↔ account-address logs for an unknown time | 4 | 2 | 8 | disclosed on `/privacy`; Pimlico sees ciphertext only | none; public terms relied on (no DPA, OSS) | M |
| R7 | A stolen key signs without its PIN | 1 | 4 | 4 | credProtect 3 at enrolment, and the CryoShield smart account requires UV and `sha256(rpId)` on every signature path (U2F path closed) | none | SE, SR |
| R8 | Cross-chain replay of owner operations (review N1) | 1 | 3 | 3 | the app never builds `executeWithoutChainIdValidation` operations; not in the sponsorship allowlist | keep it so on mainnet | SE |
| R9 | Gas sponsorship drained by spam | 3 | 2 | 6 | Pimlico policy caps (`apps/web/docs/paymaster-policy.md`), allowlist; opening a vault never needs sponsorship | mainnet caps in `launch-op-mainnet` | OW |
| R10 | Sponsored gas is reclassified as a regulated crypto service | 1 | 3 | 3 | Pimlico bills in USD; CryoShield never holds, buys or moves crypto for users; the accounts hold no value ([`legal-analysis.md`](legal-analysis.md) §5) | re-check if the model changes | M |
| R11 | A sanctioned person uses the free sponsorship | 2 | 1 | 2 | terms eligibility clause; per-operation caps bound the value (≤ a few cents of gas) | none (stance in `legal-analysis.md` §6) | M |
| R12 | Users cannot be told about an incident (no accounts, no email) | 3 | 3 | 9 | site banner, in-app notice, GitHub advisory, README ([`incident-runbook.md`](incident-runbook.md)) | rehearse at the yearly tabletop | M |
| R13 | Children use the service | 2 | 2 | 4 | 18+ confirmation in the create flow; not directed at children | none | M |
| R14 | Domain lapse or loss of the RP ID `cryoshield.app` | 1 | 5 | 5 | auto-renew, registrar lock; vaults stay readable with the desktop tool (CTAP2 needs no domain) | none | M |
| R15 | Personal data or secrets posted in a public issue | 3 | 3 | 9 | issue-triage secret screen; privacy-request form warns first; maintainers delete such issues | none | M |
| R16 | Legal pages drift from what the product does | 2 | 3 | 6 | in-repo source, effective-date CI check, claims check at every review | next claims check at the six-monthly review | SR |

**Necessity and proportionality (lite).** Publishing ciphertext on a public chain and Arweave is the product: it is
what lets a user recover with no CryoShield server, ever. Alternatives (a CryoShield database, a custodian) were
rejected in the PRD because they reintroduce a party that can lose, leak or be compelled to hand over data. Everything
published is either ciphertext or a pseudonymous identifier needed for keyless recovery; the options to shrink the
identifiers are in [`on-chain-minimisation-options.md`](on-chain-minimisation-options.md).

**Residual-risk acceptance.** I accept the residual risks above for the OP Sepolia testnet preview.

Maintainer: ______________________ Date: __________
