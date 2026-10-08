# How the design limits personal data

> `add-privacy-and-compliance` task 2.5. CryoShield is an open-source project maintained by its contributors; there is
> no company and no lawyer engagement (founder decision 2026-10-08: "It's OSS so no company and legal"). **This
> document states facts about the design. It draws no legal conclusions and is not legal advice.** Where a law or a
> regulator's guidance is mentioned, it is quoted as context, not applied. Open questions are listed in §9 for anyone
> (contributor, user or regulator) who wants to take them further.

The detailed, row-by-row record is [`data-inventory.md`](data-inventory.md). This document explains *why* that list
is short.

## 1. What CryoShield never receives

CryoShield runs no server of its own (project rule: static frontend, public RPCs, a third-party bundler/paymaster and
Arweave only). So there is no CryoShield-side database, account, session, log or inbox that could hold user data.

| Never received | Why, and what proves it |
|---|---|
| Secrets, labels, vault names | encrypted in the browser before anything is sent (AES-256-GCM; `docs/spec/vault-format-v1.md`, payload v2); on-chain confidentiality review §1 searched a real blob for every secret value and found none |
| PRF outputs, wrap keys, data keys | exist only in browser memory during a ceremony and are wiped (`vault-web-app` "Secrets in memory only with auto-lock"; `hardware-key-auth`) |
| Names, emails, phone numbers, accounts | there are no accounts and no email address (`project-contact`) |
| Request logs | the static server writes none (tested, `apps/web/deploy/test/container.test.ts`) |
| Cookies or device storage | none on any route (`storage-inventory.json`, build scan, E2E sweep) |

## 2. The personal data that does exist, and where

1. **IP addresses and user agents,** seen by the services the browser talks to: Fly (hosting), Pimlico (bundler),
   OP Labs RPC, ArDrive Turbo and arweave.net, and Cloudflare (landing page only). Each keeps its own logs under its
   own public policy (inventory rows 2, 4, 6, 7, 8).
2. **Pseudonymous identifiers published permanently** on the chain and Arweave: the smart-account address, vaultId,
   locators, credential IDs, each key's P-256 public key, timestamps, and the ciphertext (rows 5, 6).
3. **GitHub correspondence** that people choose to send (rows 9, 10).

## 3. How the design keeps it small

- **Client-side encryption, symmetric only.** Nothing readable is published. No password, PIN or user-chosen value
  enters the key schedule, so there is nothing to guess offline.
- **Keyed locators.** A locator is `HKDF(PRF output, info = "cryoshield/v1/locator")`, a one-way image of a secret
  that lives in the security key. It is not a raw device identifier and cannot be computed without the key.
- **Ephemeral Arweave uploader.** The upload key is random per browser session and never derived from vault material,
  so uploads from different sessions are not linked by it.
- **Padding.** Payloads are padded to 64-byte steps, so the exact length of a secret is hidden (only a size range
  shows; review F3).
- **No identifiers of our own.** The app creates no client ID, sets no cookie and sends nothing beyond what the
  protocol needs (`privacy-compliance` "No CryoShield-side identifiers").
- **Analytics only where it cannot see a vault.** The Cloudflare beacon runs on `/` only, is blocked from `/app/` and
  the legal pages by CSP, strips query and fragment, and is not loaded under GPC or DNT.
- **Statistics from public data only.** `tools/metrics` reads public chain and Arweave data, suppresses any group under
  3 and refuses to write a report holding an identifier (`docs/reviews/product-metrics.md`).
- **Contact without a mailbox.** Privacy and security contact is GitHub only, so the project never runs an inbox.
- **Notice before publication.** The create flow requires a permanence acknowledgement and an 18+ confirmation each
  time, listing the public fields.

## 4. Permanence and erasure

What can and cannot be deleted, and the crypto-shredding steps, are in [`erasure-procedure.md`](erasure-procedure.md).
In short: correspondence and issue content can be deleted; vendor logs follow each vendor's policy; on-chain and
Arweave data cannot be deleted by anyone. Resetting or destroying every enrolled key makes the ciphertext undecryptable
by any known technique, but the project never calls that "erasure": the identifiers stay public and the ciphertext
stays unreadable only as long as AES-256-GCM holds.

## 5. Gas sponsorship: facts

- Pimlico's verifying paymaster pays the network fee and bills the project in USD (testnets free).
- CryoShield never holds, buys or moves crypto for a user. The smart accounts hold no value and are controlled only by
  the user's keys; every signature needs a key and its PIN (CryoShield smart account, UV and `sha256(rpId)` checks).
- No value moves to or for the user. Sponsorship is capped per operation and may be paused at any time (terms).
- The project's only crypto receipt is voluntary ETH donations to a public address (`/support`), which are not linked
  to vaults or visits.

## 6. Sanctions: current behaviour (task 7.4)

This is what CryoShield does today. No further decision is pending for the testnet.

- **Terms only.** `/terms` "Eligibility": users must not be a person subject to comprehensive sanctions or ordinarily
  resident in a comprehensively sanctioned country or region.
- **No screening.** The app does not check addresses against any sanctions list or oracle, and runs no KYC.
- **No geoblocking.** The site does not look up visitors' locations and serves the same pages to everyone.
- **Bounded value.** The only thing provided is free, capped gas sponsorship worth a few cents per operation, with no
  value transferred to the user (§5).
- **Vendors' own terms** apply on top: Pimlico places end-user responsibility on its customer (Pimlico ToS §3.3);
  ArDrive's terms forbid use in breach of US embargoes.

If this changes (for example screening on mainnet), it needs its own OpenSpec change; a client-side check would be
advisory only, because the sponsorship key is public in the bundle.

## 7. Logs the project could keep but does not

The project keeps **no** request logs and **no** separate export of platform audit trails. Fly, GitHub, Pimlico and
the registrar keep their own audit trails under their own retention. The log-export task (6.4) and the log-retention
question existed only for a company's statutory duties and are N/A for the OSS project.

## 8. Context: what regulators have written (reference only)

These documents are relevant reading for anyone assessing a design like this one. They are summarised, not applied.

- **EDPB Guidelines 02/2025 on blockchain, v2.0 (adopted 7 Jul 2026).** They say that wallet addresses can be personal
  data where identifiable (para 26), that storing personal data on-chain is "not advisable" (para 48), that encrypted
  data "is still personal data" and key deletion makes it unintelligible only "until the algorithm is broken"
  (para 51), and that personal data "should be stored off-chain" (para 104).
- **CJEU *EDPS v SRB* (C-413/23 P, 4 Sep 2025)** discusses when pseudonymised data is personal data for a recipient
  who cannot re-identify it.
- **India: DPDP Act 2023 and DPDP Rules 2025.** Most duties phase in around 13 May 2027; s.3(c)(ii) excludes data
  "made publicly available by the Data Principal". **CERT-In Directions (28 Apr 2022)** set a 6-hour incident report
  and 180-day log retention for bodies corporate and other listed entities.
- **ePrivacy Art. 5(3)** and EDPB Guidelines 2/2023 on device access (relevant to the landing-page beacon).
- **US state privacy laws (CCPA/CPRA and others)** apply above revenue or volume thresholds; CryoShield has no revenue
  and sells or shares nothing.

## 9. Open questions

Recorded so they are not lost. None blocks the testnet; each would need its own OpenSpec change if answered in a way
that changes the product or the pages.

1. Is publishing ciphertext and pseudonymous identifiers on a public chain compatible with the EDPB's off-chain
   preference, and does the user's own signature on each write change who "makes it public"?
2. Does relaying sponsored user operations through Pimlico make the project an intermediary under India's IT Act?
3. Do any log-retention duties (CERT-In, DPDP Rule 8(3)) reach an unincorporated open-source project with no server?
4. Is a site banner plus GitHub advisory and in-app notice an adequate way to tell affected users about an incident,
   given there is no contact channel?
5. Is the landing-page beacon covered by an audience-measurement exemption in every EU/UK market, or would an opt-in
   be expected there?
6. Is self-declared 18+ enough where a law asks for "due diligence" on age?
7. Would sponsored gas on mainnet ever be read as a regulated crypto activity (§5)?

These are questions about how outside rules see the design, not defects in it. The engineering options that would
reduce the on-chain identifiers regardless of the answers are costed in
[`on-chain-minimisation-options.md`](on-chain-minimisation-options.md).
