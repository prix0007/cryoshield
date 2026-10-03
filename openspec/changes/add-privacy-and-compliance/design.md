# Design

> **Not legal advice.** This is an engineering plan with a researched legal map. Every legal conclusion is tagged
> with a confidence level (H = high, M = medium, L = low), and **UNVERIFIED** marks anything not confirmed against a
> primary source. Items marked **[lawyer]** need external counsel before they are relied on. Sources were accessed
> on 2026-10-02.

## Context

See proposal.md for the motivation. State observed in the repo:
- The app is a static Vite build served by Caddy on Fly.io (`cryoshield-web`, region `sin` = Singapore). Caddy has no
  `log` directive, so it writes no access log. `fly logs` shows only container stdout (~7 days).
- The app already bans cookies, browser storage and `console` (lint plus `test/privacy.test.ts`) and wipes PRF outputs.
  `connect-src` lists the RPC, the Pimlico bundler, ArDrive Turbo and the Arweave gateway.
- On-chain (`VaultRegistry`): `VaultCreated(vaultId, owner, version, blobHash)`, `LocatorAdded(vaultId, locator)`, and the
  blob. Its cleartext header holds the RP ID, key count N, credential IDs and PRF salts (`docs/spec/vault-format-v1.md`
  §5). Arweave tags repeat the vaultId, version and locators. The uploader key is ephemeral per session.
- The agent team: crypto-engineer (CE), frontend-engineer (FE), recovery-engineer (RE), security-reviewer (SR),
  solidity-engineer (SE), overwatcher (OW); plus the founder (F) and an external lawyer (L).

## Goals / Non-Goals

**Goals:** know exactly what personal data exists and who holds it; publish honest notices before public launch; have
a breach plan that meets the shortest clock (CERT-In, 6 h); get a written legal position on the four hard questions
(on-chain erasure, PMLA/VDA, CERT-In/DPDP log duties, EU representative) before mainnet; and reuse all of it as SOC 2
evidence.

**Non-Goals:** a consent-management platform; user accounts or email collection; a CryoShield-run log store; changing
the vault format.

## Decisions

### D1. Data-flow inventory

"PD" = personal data under GDPR Art. 4(1) / DPDP s.2(t). Role = CryoShield's role for that flow. Pseudonymous data is
still personal data under GDPR when someone can reasonably link it to a person (Recital 26; CJEU *Breyer* C-582/14 for
IP addresses; CJEU *EDPS v SRB* C-413/23 P for the "relative" view, see D2). DPDP has no separate pseudonymous category:
any data "about an individual who is identifiable by or in relation to such data" counts.

| # | Where | Data | PD? | CryoShield role | Other party's role | Retention / control |
|---|---|---|---|---|---|---|
| 1 | Browser (user's device) | PRF outputs, data key, plaintext secrets (in memory only); WebAuthn credential lives on the YubiKey | Plaintext secrets may contain PD; never leaves the device | **Neither**: CryoShield code runs on the user's device but CryoShield never receives anything (household/own-device processing by the user) | User | Wiped after use; no cookies or storage (lint + `test/privacy.test.ts`) |
| 2 | Fly.io edge proxy | Client IP, TLS metadata, Host, path, user agent, timestamps | **Yes** (IP) | **Controller** (we chose to run a website; GDPR Art. 4(7)); Data Fiduciary under DPDP | **Processor** for app traffic (Fly privacy policy, DPA at fly.io/documents) | Fly exposes no edge access logs to customers; internal retention **unpublished (UNVERIFIED)**; `fly logs` keeps app stdout ~7 days. Fly is US-based, DPF-certified; 34 sub-processors |
| 3 | Caddy container (our config) | Would see `Fly-Client-IP`, path, UA | Yes, if logged | Controller | n/a | **No `log` directive → Caddy writes no access log** (Caddy default). Spec "Minimal hosting logs" makes this a tested guarantee |
| 4 | Pimlico bundler/paymaster (Austerlitz Labs Ltd, UK) | Client IP, Origin, user agent, smart-account address (sender), userOp calldata (ciphertext blob, locators, vaultId), signatures, sponsorship policy ID | **Yes** (IP; account address linked to IP) | **Controller** (we choose Pimlico and embed it in our app) | **Processor** (Pimlico self-describes as sub-processor for customers); **no DPA/SCCs published, retention unstated (UNVERIFIED)** | Ask Pimlico for a DPA and retention; UK adequacy for EU→UK transfers |
| 5 | Public chain (OP Sepolia → OP Mainnet) | Smart-account address, vaultId, locators (≤8), blob: RP ID, key count N, credential IDs, PRF salts, wrapped keys, ciphertext; timestamps; `VaultCreated.owner` | **Likely yes for GDPR** (pseudonymous identifiers that a node operator, bundler or the user can link; credential IDs are stable device-bound IDs). Ciphertext is PD for anyone with a key, arguably not for others (SRB relative test) | **Controller** for the decision to publish (we designed the protocol, the app builds and signs the transaction), jointly with the user who submits it; EDPB 02/2025 treats a dApp provider that determines on-chain processing as a controller | Validators/sequencer/nodes: neither our processors nor controllers we instruct (no contract) | **Permanent, public, cannot be erased** |
| 6 | Arweave via ArDrive Turbo (Permanent Data Solutions Inc., US) + arweave.net gateway (ar.io, NL; operator UNVERIFIED) | Upload: client IP, signed data item = blob + tags `App-Name`, `CryoShield-Vault-Id`, `CryoShield-Version`, `CryoShield-Locator`×N, ephemeral uploader public key; reads: IP, GraphQL query (vaultId, locators) | Yes (IP; same pseudonymous IDs as #5). Uploader key is ephemeral per session, so it does not link sessions | Controller (upload decision) | Turbo/gateway: independent controllers of their logs (their own ToS/privacy, no DPA offered to us; UNVERIFIED) | Data permanent; gateway may blocklist but the network keeps it |
| 7 | Public RPCs (`sepolia.optimism.io`/OP Labs; publicnode; drpc) | IP, `eth_call`/`eth_getLogs` params (locators, vaultIds) | Yes (IP linked to locator lookups = "this IP owns this vault") | Controller (we chose the endpoints) | Independent controllers in practice (no contract); OP Labs logging policy **unpublished (UNVERIFIED)**; PublicNode ≤24h; dRPC weekly purge | Plan: rotate/let user choose RPC; disclose |
| 8 | Cloudflare Web Analytics (landing `/` only, beacon only, `add-privacy-preserving-analytics`) | IP + UA in transit; page path (query and fragment stripped first), referrer, Performance API timings; country derived from IP | Yes in transit (IP). Cloudflare says IPs are not stored and no cookies or localStorage are used (cloudflare.com/web-analytics, H for the claim) | Controller | Processor (Cloudflare DPA, cloudflare.com/cloudflare-customer-dpa; sub-processors cloudflare.com/gdpr/subprocessors) | Metadata processed in US + EU data centres; EU-only needs the Enterprise Data Localization Suite (M). Retention UNVERIFIED |
| 9 | GitHub (public repo, issues, private vulnerability reports, Actions) | Reporter/contributor GitHub accounts, emails in commits, report contents | Yes | Controller for report handling; GitHub is an independent controller of its users' accounts | GitHub: controller of accounts; processor for our repo content (GitHub DPA for org customers; UNVERIFIED for free plan) | Delete reports/issue content on request where we control it |
| 10 | Email (security@ / privacy@ / grievance@) | Sender address, request contents, possibly account address | Yes | Controller | Mail provider = processor (provider not chosen yet: **founder decision**) | Retain 3 years after closure (DPDP Rules log-retention minimum is 1 year; lawyer to confirm) |
| 11 | Domain/DNS (GoDaddy), CAA iodef mail | WHOIS (company, not users) | No user PD | n/a | n/a | n/a |
| 12 | Desktop recovery tool | Runs locally; contacts preset RPCs and Arweave gateway like #6–7 | IP to RPCs | Neither for local processing; controller only for the default RPC choice | Same as #7 | No telemetry (by design) |

Inventory sources: Fly privacy policy https://fly.io/legal/privacy-policy/, sub-processors https://fly.io/legal/sub-processors/,
logging https://docs.fly.io/monitoring/logging-overview (H); Pimlico https://www.pimlico.io/privacy and /tos (H);
ArDrive https://ardrive.io/tos-and-privacy/ (H); ar.io https://ar.io/legal/terms-of-service-and-privacy-policy/ (H);
PublicNode https://www.publicnode.com/privacy, dRPC https://drpc.org/privacy-policy (M); Optimism
https://www.optimism.io/data-privacy-policy (does not cover RPC traffic).

### D2. Legal map: privacy laws

**India: DPDP Act 2023 + DPDP Rules 2025** (G.S.R. 846(E), 13 Nov 2025; text read)
- *Status (H):* the Board provisions took effect on 13 Nov 2025. Rule 4 (Consent Managers) starts ~13 Nov 2026. The
  Act's ss.3–17 and Rules 3, 5–16, 22–23 start ~13 May 2027. Secondary sources give 13 or 14 Nov/May; plan for the
  earlier date. MeitY's Jan 2026 proposal to shorten the window (mainly for SDFs) was not notified as of Jul 2026 (M).
  Board appointments reported Jun 2026, UNVERIFIED.
- *Scope (H):* s.3 covers processing in India, so all of CryoShield's processing is in scope regardless of where users
  are. s.3(c)(ii) excludes data "made publicly available by the Data Principal". The user signs and submits the
  on-chain write, which may take on-chain data outside the Act. **[lawyer]**, L confidence: the app builds the
  transaction, so the user may not be the one "making it public".
- *Role:* CryoShield is a **Data Fiduciary** for IP data seen by its vendors and for the protocol's on-chain
  publication (M).
- *Duties that apply from ~13 May 2027:*
  - notice (s.5 + Rule 3): standalone, itemised data, purposes, withdrawal and rights links, how to complain to the Board;
  - consent (s.6) or a legitimate use (s.7);
  - security safeguards (s.8(5) + Rule 6);
  - breach intimation (s.8(6) + Rule 7): to the Board "without delay", with a detailed report **within 72 h**, and to
    each affected Data Principal without delay. There is no risk threshold;
  - a published contact (s.8(9) + Rule 9);
  - grievance redressal (s.8(10), s.13): Rule 14(3) sets at most 90 days;
  - erasure on withdrawal (s.8(7));
  - children under 18 need verifiable parental consent (s.9 + Rule 10);
  - **log retention of at least 1 year** for personal data, traffic data and processing logs (Rule 8(3) + Seventh
    Schedule).
- *Not applicable:* the Rule 8 three-year inactivity erasure (only large e-commerce, gaming and social platforms, H);
  SDF duties (s.10; not designated, H). Cross-border transfer (s.16) is allowed until a negative list is notified;
  none is (M). Startup exemption s.17(3): none notified (UNVERIFIED), and it would not lift security, breach,
  grievance or children duties anyway (H).
- *Penalties (M, from memory; check the Schedule):* up to ₹250 cr (security), ₹200 cr (breach intimation, children).
- *Before May 2027:* IT Act s.43A + SPDI Rules 2011 still apply (they are omitted when DPDP s.44(2) commences,
  reportedly 13 May 2027, UNVERIFIED). SPDI covers passwords, financial info and similar. A published privacy policy is
  required (SPDI Rule 4).

**EU/UK: GDPR / UK GDPR**
- *Scope (H for law, M for application):* Art. 3(2)(a) applies when we target EU/UK users (English site, global
  marketing; likely yes once marketed). Art. 3(2)(b) "monitoring" would apply to analytics; our aggregate analytics
  argues against it.
- *Controller (H):* choosing the host, bundler and RPCs and embedding them makes us controller for the IP processing
  they do for us (CJEU *Wirtschaftsakademie* C-210/16, *Fashion ID* C-40/17). Dynamic IPs are personal data
  (*Breyer* C-582/14).
- *On-chain (H):* EDPB Guidelines 02/2025 on blockchain, **v2.0 adopted 7 Jul 2026** (PDF read:
  https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202502_blockchain_v2_en.pdf):
  - wallet addresses and public keys are personal data where identifiable (para 26);
  - "not advisable to store personal data on the blockchain" (para 48);
  - "technical impossibility cannot be invoked to justify non-compliance" (para 50);
  - **encrypted data "is still personal data"**, and key deletion makes it unintelligible only "until the algorithm is
    broken" (para 51);
  - hashes must be salted or keyed (para 52);
  - a DPIA is required where risk is high (para 91);
  - personal data "should be stored off-chain" (para 104).
  - *CJEU EDPS v SRB* (C-413/23 P, 4 Sep 2025, H): pseudonymised data may not be personal data for a recipient who
    cannot re-identify, but the controller's transparency duties are judged from the controller's side.
  - **Net (M): for CryoShield, the account address, locators, credential IDs and ciphertext are personal data, and the
    EDPB's preferred design (off-chain storage) conflicts with the product's core promise.**
- *Lawful basis (M):*
  - IP processing for delivery, security and abuse limits: legitimate interests (Art. 6(1)(f)), with a documented
    balancing test;
  - on-chain publication: contract necessity (Art. 6(1)(b)), since publishing *is* the service the user asks for, with
    a prominent permanence notice. **[lawyer]**
- *Notice:* Art. 13 at the point of collection. The privacy policy covers it, plus the in-app permanence step.
- *Erasure:* see D3.
- *Representative, Art. 27 (M):* the exemption covers only "occasional", low-risk processing. Permanent public
  publication makes that hard to argue, so an EU (and UK) representative is likely needed once we target EU/UK users.
  **[lawyer]** Founder decision on cost (~€1–3k/yr, UNVERIFIED).
- *DPIA (M):* EDPB para 91 + Art. 35 criteria (innovative technology, irreversibility). Do a DPIA-lite now (D9) and a
  full DPIA before mainnet.

**US**
- *CCPA/CPRA (H, cppa.ca.gov):* covers businesses with >$26,625,000 revenue, or that buy, sell or share the personal
  information of ≥100,000 consumers, or get ≥50% of revenue from selling or sharing. A free, no-revenue service that
  never sells or shares is **not covered**. If it ever were, "Do Not Sell/Share" + GPC would be trivially met.
- *Virginia and Colorado (M):* 100k-consumer thresholds, not met.
- *Connecticut (M):* from 1 Jul 2026 it covers **any** processing of sensitive data, and financial-account data is
  now sensitive. Seed phrases are encrypted and never processed by us; whether this triggers CTDPA is UNVERIFIED
  **[lawyer]**.
- *Texas TDPSA (M):* small businesses are exempt except for the sale of sensitive data.
- *COPPA (H):* applies only to services directed to under-13s or with actual knowledge of them. The 18+ statement
  covers this.
- *State breach-notification laws:* they apply by resident, not by business size. Most cover "username/email +
  password or security question" and financial account credentials. Our ciphertext is encrypted, and most states
  have an encryption safe harbour (M). **[lawyer]**

**India: IT Act / IT Rules 2021 / CERT-In**
- *Intermediary (L/M):*
  - s.2(1)(w) means receiving, storing or transmitting records "on behalf of another person". We host no user
    content, so we are probably not an intermediary. But sponsoring and relaying userOps via Pimlico could be read as
    "transmits on behalf of". **[lawyer]**
  - If we are one, Rule 3(1)(a) requires published rules, a privacy policy and a user agreement, and Rule 3(2)
    requires a Grievance Officer who acknowledges within 24 h and resolves within 15 days.
  - We adopt those timelines anyway: they are stricter than DPDP's 90 days and cost nothing.
- *CERT-In Directions, 28 Apr 2022 (H, primary text read):* these bind every body corporate.
  - **Report listed cyber incidents within 6 h** of noticing them (website compromise, unauthorised access, data breach, ...).
  - **Keep ICT system logs for a rolling 180 days "within the Indian jurisdiction"**.
  - The KYC and 5-year transaction-record rule (vi) covers VASPs and **custodian** wallet providers. A non-custodial
    vault is likely outside it (M/L).
- **Conflict to resolve [lawyer]:** CERT-In's 180-day ICT logs and DPDP Rule 8(3)'s 1-year logs pull against our
  zero-access-log posture.
  - Plan: keep platform and admin audit logs that we already get without collecting user IPs: Fly org audit, GitHub
    org audit, Pimlico dashboard, registrar and DNS change history, deploy release manifests. Export them monthly to an
    India-resident store owned by the company.
  - If counsel says request logs are required, enable the truncated-IP format allowed by spec "Minimal hosting logs",
    rather than full IPs.

### D3. Erasure vs immutable data (crypto-shredding)
- **CryoShield can delete:**
  - email and grievance correspondence;
  - GitHub issues and comments in our repo;
  - vendor-held logs, by request to Fly, Pimlico, Cloudflare and Turbo, each under its own policy;
  - nothing else, because we hold nothing else.
- **Nobody can delete:** the on-chain blob, account address, vaultId, locators and events, or the Arweave items and tags.
  Gateways may *hide* items (arweave.net honours takedowns), but the network keeps them (M).
- **Crypto-shredding:** the user resets the FIDO2 application on every enrolled key (`ykman fido reset`) or destroys the
  keys. The PRF secrets are gone, so no wrapping key can be derived, and the AES-256-GCM ciphertext cannot be
  decrypted by any known technique. Symmetric-only crypto keeps this true against known quantum attacks (Grover halves
  the margin, leaving ~128-bit security). We **must not** call this "erasure": EDPB para 51 says it is unintelligible
  only "until the algorithm is broken".
  - Residual identifiers (address, locators, credential IDs) stay linkable metadata. To unlink them from a person, the
    user stops using the address. Nothing on-chain names a person.
- **Before-write mitigation:** the permanence and 18+ acknowledgement (spec `legal-pages`) is the GDPR Art. 13 notice
  and DPDP s.5 notice at the moment of collection.
- **Post-MVP options for SE/CE to evaluate (not in scope):**
  - keyed locators already exist (HKDF of the PRF), so they are not raw identifiers;
  - drop credential IDs from the cleartext header: try all entries, at a cost of ≤8 PRF attempts;
  - per-vault fresh smart accounts already exist.
  - Each needs its own OpenSpec change and format version.
- Reply SLA: acknowledge within 24 h; respond within 15 days (IT Rules timing), and no later than 30 days (GDPR
  Art. 12(3)) or 90 days (DPDP Rule 14(3)).

### D4. Legal map: crypto regulation and sanctions
- **PMLA / VDA (M, lawyer opinion needed):**
  - The 7 Mar 2023 notification S.O. 1072(E) makes five activities "reporting entity" business when done "for or on
    behalf of another": exchange (VDA↔fiat, VDA↔VDA), **transfer**, **safekeeping/administration** (including
    instruments enabling control), and issuer-offer services.
  - Registration with FIU-IND is via FINGate under the **2026 Guidelines (8 Jan 2026)**, which require a Principal
    Officer in India, KYC including IP, device and selfie, and 5-year records. Offshore providers serving India must
    register too (AZB client update, Jan 2026).
  - Analysis:
    - Pimlico's verifying paymaster pays gas and **bills CryoShield in USD** (10% mainnet surcharge; testnets free:
      docs.pimlico.io/guides/pricing). CryoShield never holds, buys or moves ETH.
    - No VDA moves to or for the user, and the smart accounts hold no value and are controlled only by the user's
      keys.
    - So this is very likely **none of the five activities**: gas is a fee for CryoShield's own service, not a
      transfer on the user's behalf.
    - Risk rises if the accounts ever hold tokens, if CryoShield controls a signer, or if CryoShield buys ETH itself
      (FEMA treatment UNVERIFIED; 1% TDS under s.194S applies to the buyer).
  - **Recommendation:** keep the USD-billed paymaster model, never top up with ETH, and get a short written opinion
    **before mainnet**.
- **OFAC and other sanctions (M):**
  - An Indian company is not directly bound by OFAC. But it can "cause" a violation by a US person (Fly is
    US-incorporated), and secondary sanctions exist (Iran, DPRK, Russia).
  - Pimlico (UK, Austerlitz Labs Ltd) has no sanctions clause and puts end-user responsibility on the customer (ToS
    §3.3, H). ArDrive Turbo's terms forbid use in breach of US embargoes (H).
  - Tornado Cash was delisted on 21 Mar 2025 after *Van Loon* (5th Cir., 26 Nov 2024) (H). Immutable contracts are not
    blockable property, but sponsoring transactions *for* a listed person remains a service to them.
  - **Exposure is small:** a capped, free service worth ≤$0.50 per account, with no value transferred.
  - Recommendation:
    - terms clause: users represent they are not sanctioned and not in comprehensively sanctioned regions;
    - before mainnet, a **client-side advisory check** against the Chainalysis sanctions oracle
      `0x40C57923924B5c5c5455c48D93317139ADDaC8fb` (claimed on OP Mainnet, UNVERIFIED) on the smart-account address.
      It is advisory only, because the API key is public and scripts bypass it;
    - geoblocking at Caddy needs a GeoIP database (MaxMind GeoLite2 on `Fly-Client-IP`) and only stops honest
      browsers. **Founder decision**, not recommended for the testnet.
  - India implements UN Security Council lists via UAPA s.51A, which formally binds reporting entities. We are not
    one (D4 above).

### D5. Cookie and consent posture
- **No banner on any page today, and none needed:**
  - no cookies, no storage, no client identifiers, and no analytics on `/app/`, `/privacy`, `/terms` or `/cookies`
    (the device-storage inventory on `/cookies` lists no entries, and an E2E test enforces it);
  - the only device "access" is the browser's own requests to services the user asked for. ePrivacy Art. 5(3) has a
    "strictly necessary for a service explicitly requested" exemption, and these requests fall under it (H).
- **Landing analytics** (`add-privacy-preserving-analytics` D5): Cloudflare Web Analytics, beacon only, on `/` only.
  - It sets no cookies or storage (Cloudflare's claim, enforced by E2E). But it reads device data: Performance API
    timings, URL and referrer. EDPB Guidelines 2/2023 v2 para 32 treats script-triggered requests that carry such data
    as "gaining access" under Art. 5(3), so "cookieless" is not automatically exempt in the EU (H).
  - Partial cover: CNIL's audience-measurement exemption (FR) and the UK DUAA 2025 statistical exception to PECR
    reg 6 (in force 5 Feb 2026 per secondary sources, UNVERIFIED).
  - Posture: **no banner**; disclose on `/privacy` and `/cookies`; GPC/DNT suppress the beacon entirely; query and
    fragment stripped first. **[lawyer]** Fallback if counsel disagrees for the EU: skip the beacon for EU/UK
    locales/timezones, or add a one-click opt-in.
- **A banner (or opt-in) becomes required if:** any cookie or storage for non-essential purposes, cross-site or
  persistent identifiers, a second analytics or marketing vendor, URL or referrer capture, ads or pixels, or any
  analytics on `/app`.

### D6. Privacy Policy, Terms of Service and Cookie Policy: outlines and key clauses (**needs lawyer review**)
All three pages are drafted **now, before public launch** (founder decision 2026-10-03). Each shows a visible banner
"Draft, pending legal review" and keeps the placeholders `[ENTITY]`, `[REGISTERED ADDRESS]`, `[GRIEVANCE OFFICER]` and
`[CONTACT EMAIL]` verbatim until the founder and counsel fill them in. A build check enforces this (spec `legal-pages`
"Draft status and placeholders").

**Privacy Policy (`/privacy`)**, written in plain English with a summary box first:
1. *Who we are:* `[ENTITY]`, CIN, `[REGISTERED ADDRESS]`; Data Fiduciary/controller; `[CONTACT EMAIL]`; EU/UK
   representative if appointed.
2. *What we never see:* your secrets, PRF outputs, keys, labels. "We cannot recover, read or hand over your vault."
3. *Data held by third parties when you use the site:* one row per inventory item (D1), naming the vendor, data,
   purpose, location, and a link to its policy.
4. *Public and permanent data:* the exact on-chain and Arweave fields; "cannot be deleted by us or anyone"; the
   crypto-shredding explanation (D3).
5. *Purposes and legal bases:* delivery, security and abuse limits (legitimate interests); publishing your vault (the
   service you asked for); aggregate statistics (legitimate interests; analytics section).
6. *Retention:* D8.
7. *Your rights:* DPDP (access, correction, erasure, grievance, nomination, complaint to the Board); GDPR (Arts. 15–22,
   complaint to a supervisory authority); US state rights; how to ask and what we can realistically do.
8. *Grievance Officer:* `[GRIEVANCE OFFICER]`, `[CONTACT EMAIL]`, 24 h acknowledgement, 15-day resolution, escalation to the Data Protection Board
   of India.
9. *International transfers:* India, Singapore (Fly region), US (Fly, ArDrive), UK (Pimlico), US/EU (Cloudflare); the
   safeguards (DPF, SCCs, UK adequacy). **[lawyer]**
10. *Children:* D12.
11. *Security:* client-side encryption, no audit yet, the disclosure policy link.
12. *Analytics:* Cloudflare Web Analytics on the landing page only: what the beacon reads, no cookies, US/EU processing under Cloudflare's DPA, GPC/DNT suppression, and none on `/app/`. Links to `/cookies`.
13. *Changes:* effective date, changelog, Git history link.

**Terms of Service (`/terms`)**, key clauses:
- *Testnet and unaudited:* no warranty of security; do not store high-value secrets until mainnet and audit (an
  explicit warning while on testnet).
- *Non-custodial:* we never hold your secrets or keys; losing all enrolled keys means permanent loss; no recovery
  service.
- *Permanence:* you instruct the publication of encrypted data to public networks, and you understand it cannot be
  removed.
- *Sponsored gas:* free, capped, and may be paused, limited or withdrawn at any time; no entitlement.
- *Acceptable use:* no abuse of sponsorship, no automated account creation, no illegal content.
- *Eligibility:* 18+; not a sanctioned person or resident of a comprehensively sanctioned region.
- *Open source:* the software is licensed under MIT, and the Terms govern only the hosted site.
- *Third-party services:* Pimlico, Arweave, RPCs and Fly are not under our control.
- *Disclaimers and limitation of liability:* "as is"; liability capped at the greater of INR 1 or fees paid (zero).
  **[lawyer]**: enforceability under the Indian Contract Act, EU consumer law and the UK CRA.
- *Governing law and venue:* India (city of registered office), with consumer-protection carve-outs where mandatory.
- *Changes:* notice on the site; effective date.

**Cookie Policy (`/cookies`)**, key content:
- *Summary:* "CryoShield sets no cookies. No page stores anything on your device."
- *What we store on your device:* the device-storage inventory table (route × cookie / localStorage / sessionStorage /
  IndexedDB / Cache Storage / service worker × purpose × lifetime). Today every cell is "none". The WebAuthn credential
  lives on your hardware key, not in the browser. An E2E test keeps the table true.
- *Analytics on the landing page:* Cloudflare Web Analytics beacon on `/` only; what it reads; that it sets no cookie
  (Cloudflare's statement); the integrity pin; that `/app/` and the legal pages have none.
- *Your choices:* GPC or DNT turns the beacon off entirely; blocking `cloudflareinsights.com` has no side effects.
- *When this would change:* the banner triggers from D5. Any change updates the effective date and changelog.
- Contact `[CONTACT EMAIL]`; draft banner and placeholders as above.

### D7. security.txt and responsible disclosure
- `/.well-known/security.txt` (RFC 9116: `Contact` and `Expires` are required, with `Expires` ≤ 1 year recommended;
  https://www.rfc-editor.org/rfc/rfc9116):
  - `Contact: mailto:security@cryoshield.app`
  - `Contact: https://github.com/prix0007/cryoshield/security/advisories/new`
  - `Expires` (≤ 365 days, checked by the build)
  - `Policy: https://github.com/prix0007/cryoshield/blob/main/SECURITY.md`
  - `Canonical: https://cryoshield.app/.well-known/security.txt`
  - `Preferred-Languages: en, hi`
  - optional `Encryption` (a link to an OpenPGP key) and `Acknowledgments`. Sign with OpenPGP later.
- `SECURITY.md`:
  - scope: site, contracts, vault format, recovery tool, paymaster abuse;
  - out of scope: volumetric DoS, third-party services;
  - safe harbour for good-faith research;
  - acknowledge within 72 h, triage within 7 days, coordinated disclosure in 90 days;
  - credit in a hall of fame; no paid bounty until funded (PRD open question).
- Enable GitHub private vulnerability reporting (Settings → Advanced Security; H).

### D8. Data-retention statement
| Data | Retention |
|---|---|
| Caddy request logs | none (none written). If counsel requires them: truncated-IP format, 180 days (CERT-In) or 1 year (DPDP Rule 8(3)), then deleted |
| Fly platform logs | Fly's policy (unpublished); `fly logs` ~7 days |
| Vendor logs (Pimlico, Turbo, RPC, Cloudflare Web Analytics) | each vendor's policy, listed in the inventory; "unpublished" where unknown |
| Privacy, grievance and security email | 3 years after closure (limitation period; at least the 1-year DPDP log minimum) **[lawyer]** |
| Admin audit exports (Fly, GitHub, Pimlico, DNS) | 1 year rolling, India-resident store (CERT-In 180 d / DPDP 1 y) |
| On-chain and Arweave data | permanent; outside our control |
| Aggregate metrics | indefinite (not personal data) |

### D9. DPIA-lite and risk register
`docs/compliance/risk-register.md`, one row per risk, scored likelihood × impact (1–5). Initial rows:
| Risk | L×I | Mitigation | Owner |
|---|---|---|---|
| Malicious or compromised JS bundle exfiltrates secrets (DNS/Fly/GitHub takeover) | 2×5 | hardware-key 2FA, DNSSEC, CAA, reproducible builds + release manifest, CSP, desktop tool | OW, SR |
| On-chain personal data cannot be erased (EDPB 02/2025) | 5×3 | permanence notice, minimised header, crypto-shredding guidance, DPIA, lawyer | F, L, CE |
| Future cryptanalysis of public ciphertext | 1×5 | symmetric-only AES-256, versioned format, re-encrypt/migrate path | CE |
| Locator lookups via RPC link an IP to a vault | 3×2 | disclose; multiple RPCs; user-selectable RPC (post-MVP) | FE |
| Pimlico logs IP ↔ account address with unknown retention | 4×2 | DPA request, disclose, BYO-wallet fallback (PRD "Could") | F |
| PMLA/VDA reclassification | 2×4 | USD paymaster model, lawyer opinion before mainnet | F, L |
| Sanctioned-user sponsorship | 2×2 | ToS, caps, advisory oracle check before mainnet | F, FE |
| Paymaster drained by spam | 3×2 | caps (paymaster-policy.md) | OW |
| Breach-notification failure (no user contact channel) | 3×3 | site banner, GitHub advisory, social accounts, in-app notice | F |
| Missed CERT-In 6 h clock | 2×3 | runbook with a pre-filled CERT-In form; F on call | F |
| Children use the service | 2×2 | 18+ gate, not directed at children | F |
| Domain lapse / RP ID loss | 1×5 | auto-renew, registrar lock, desktop tool | F |

The DPIA-lite adds: necessity and proportionality (why on-chain; alternatives rejected in the PRD); data-subject
rights limits; residual-risk sign-off by F. A full DPIA happens before mainnet with L.

### D10. Sub-processor and vendor list (`docs/compliance/subprocessors.md`)
| Vendor | Entity / country | Role | DPA | Transfer safeguard |
|---|---|---|---|---|
| Fly.io | Fly.io Inc., US; machine in Singapore | processor | pre-signed in dashboard (fly.io/documents) | EU-US DPF certified; SCCs UNVERIFIED |
| Pimlico | Austerlitz Labs Ltd, UK | processor | **none published; request** | UK adequacy (EU→UK) |
| ArDrive Turbo | Permanent Data Solutions Inc., US | independent controller (its ToS) | none | n/a; disclose |
| arweave.net gateway | ar.io (Stichting, NL); operator UNVERIFIED | independent controller | none | n/a; disclose |
| OP public RPC / PublicNode / dRPC | OP Labs (US/Cayman, UNVERIFIED) / Allnodes / dRPC | independent controllers | none | disclose |
| Cloudflare Web Analytics (landing only) | Cloudflare, Inc., US; US + EU data centres | processor | cloudflare.com/cloudflare-customer-dpa (v6.4, 3 Apr 2026, M); sub-processors cloudflare.com/gdpr/subprocessors | EU-US DPF + SCCs (cloudflare.com/cloudflare-customer-scc) |
| GitHub | GitHub Inc., US | controller of accounts; processor for repo content | GitHub DPA (plan-dependent, UNVERIFIED) | DPF |
| Mail provider | **TBD (founder)** | processor | required | per provider |
| GoDaddy | registrar | n/a (no user data) | n/a | n/a |

### D11. Incident and breach runbook (`docs/compliance/incident-runbook.md`)
- Severities: **SEV1** = served bundle or domain compromise, or a key-material exposure path; **SEV2** = vendor breach
  affecting our users' IPs or addresses, or a paymaster drain; **SEV3** = contained, no user impact.
- Steps for SEV1:
  1. contain: `fly scale count 0`, or roll back to a manifest-verified image;
  2. preserve evidence: Fly releases, GitHub audit, DNS history;
  3. publish a site banner and a GitHub advisory;
  4. advise users: verify the bundle hash; if you unlocked during the exposure window, assume secrets are exposed and
     rotate seed phrases and 2FA codes; the desktop tool is the safe path;
  5. post-mortem.
- **Notification clocks** (from awareness):

| Regime | To | Deadline | Source / confidence |
|---|---|---|---|
| CERT-In Directions 2022 | CERT-In (incident@cert-in.org.in) | **6 h** | primary, H |
| DPDP Rule 7 (from ~13 May 2027) | Data Protection Board; each affected Data Principal | without delay; detailed report **72 h** | primary, H |
| SPDI / IT Act s.43A (until DPDP) | n/a (no notification duty); CERT-In covers it | n/a | M |
| GDPR Art. 33/34 | every relevant EU supervisory authority (no EU establishment, so no one-stop shop) via the Art. 27 representative; data subjects if high risk | 72 h; without undue delay | H law, M application |
| UK GDPR | ICO | 72 h | H |
| US state breach laws | affected residents (+ some AGs) | "most expedient"; 30–60 days in many states | M **[lawyer]**; encryption safe harbours likely apply |
| Vendors' contracts | Fly / Pimlico, per DPA | per DPA | UNVERIFIED |

- No user contact channel exists, so "notify each Data Principal" is done by site banner, in-app notice on the next
  unlock, GitHub advisory and social posts. Whether this satisfies Rule 7 is **[lawyer]**.
- A yearly tabletop exercise (spec scenario) is SOC 2 CC7.4/CC7.5 evidence.

### D12. Children and age
- 18+ only, matching DPDP's child definition (<18, s.2(f)) and avoiding s.9 verifiable parental consent. The service
  is not directed at children, which also covers COPPA (<13) and GDPR Art. 8 (13–16).
- Self-declaration in the create flow plus the terms statement. No age verification: we would have to collect
  identity data, which defeats the product. If we learn that a user is a child, there is nothing we can delete except
  correspondence; we tell them how to crypto-shred. **[lawyer]**: whether DPDP Rule 10 "due diligence" requires more
  than self-declaration.

### D13. SOC 2 mapping and sequencing
Trust Services Criteria (AICPA TSC 2017, revised points of focus 2022). Scope recommendation: **Security (CC) +
Confidentiality** for Type I. Add **Privacy** only if a customer asks: we hold almost no personal data, and P-series
evidence would mostly be "not applicable".

| Artefact | TSC |
|---|---|
| Data-flow inventory, sub-processor list | CC2.1, CC3.2, CC9.2, P1.1, P6.1 |
| Privacy policy, terms, permanence notice | CC2.3, P1.1, P2.1, P3.2 |
| security.txt, SECURITY.md, private reporting | CC2.3, CC7.1 |
| DPIA-lite + risk register | CC3.1–CC3.4, CC9.1 |
| Incident runbook + tabletop | CC7.3, CC7.4, CC7.5, P6.5 |
| Retention statement, crypto-shredding | C1.1, C1.2, P4.2, P4.3 |
| Erasure / grievance procedure | P5.1, P5.2, P8.1 |
| Vendor DPAs and reviews | CC9.2, P6.4 |
| Six-monthly review log, mainnet gate | CC4.1, CC4.2, CC5.3 |
| No-access-log test, account hardening (existing) | CC6.1, CC6.6, CC6.8 |
| OpenSpec + CI (existing) | CC8.1 |

**Sequence:**
- **Before public launch (testnet):**
  - inventory, sub-processor list, retention statement;
  - `/privacy`, `/terms` and `/cookies` drafted with placeholders and the "Draft, pending legal review" banner, then a
    lawyer's light review;
  - the device-storage inventory and its E2E test;
  - landing analytics (`add-privacy-preserving-analytics` groups 3–6) shipped in the same deploy as the pages;
  - security.txt, SECURITY.md and GitHub private reporting;
  - permanence + 18+ acknowledgements;
  - the no-access-log test;
  - incident runbook v1 with a CERT-In contact;
  - Grievance Officer and mailboxes;
  - Fly DPA signed; Pimlico DPA requested;
  - consent posture recorded.
- **Before mainnet:**
  - full lawyer review (India + EU/UK);
  - full DPIA;
  - written PMLA/VDA opinion;
  - decisions on CERT-In/DPDP log duties, the Art. 27 representative and sanctions;
  - tabletop exercise;
  - a review-log `mainnet-gate` entry;
  - bug-bounty decision.
  - Also by **~13 May 2027** regardless of mainnet: DPDP Rule 3 notice, Rule 7 breach process, Rule 8(3) log retention.
- **Before SOC 2 Type I:**
  - written policies (information security, access, change management, vendor management, incident, BCP/DR, data
    retention, acceptable use);
  - Vanta or Drata onboarding;
  - two completed six-monthly reviews;
  - vendor SOC 2 reports on file (Fly, GitHub; Pimlico UNVERIFIED);
  - security-awareness evidence.

### D14. Threat and abuse
- *Fake erasure or grievance requests used for social engineering* (for example, "add this key to my vault"): we hold
  nothing and can change nothing on-chain. The runbook states that we never act on a vault or ask for keys or secrets.
- *Phishing clones of `/privacy` or `/terms`:* the pages carry the canonical domain and the security.txt
  `Canonical`; users are told that the RP ID is the only valid domain.
- *A legal page overstating security* (liability): SR reviews every security claim on the pages against the specs.
- *Sanctions evasion via the public Pimlico key:* only a client check is possible; caps bound the value (D4).
- *security.txt left to expire:* build check (spec "Expiry guard").

## Risks / Trade-offs

- [The EDPB's position makes the core design hard to defend in the EU] → transparency, data minimisation and
  crypto-shredding now; full DPIA + counsel before mainnet; post-MVP header minimisation (D3). Founder accepts the
  residual risk explicitly.
- [Log-retention duties (CERT-In 180 d in India, DPDP 1 y) vs the privacy posture] → retain admin/platform logs
  without user IPs; truncated-IP request logs only if counsel requires them.
- [No user contact channel for breach notices] → multi-channel public notice; counsel to confirm adequacy.
- [Vendor retention unknown (Fly edge, Pimlico, OP RPC)] → written requests, "unpublished" in the inventory, prefer
  PublicNode-style ≤24 h RPCs.
- [Legal text drifts from the product] → in-repo source, date check, six-monthly review, mainnet gate.

## Migration Plan

Documents land first; then the pages and acknowledgements (one deploy); then the CI checks. Rollback means redeploying
the previous image. The legal text keeps its changelog.

## Open Questions

These are founder decisions or counsel answers that change wording, not the plan:
- Legal entity name, CIN and registered address; who is Grievance Officer; the mail provider.
- Whether to appoint an EU/UK Art. 27 representative now or before marketing in the EU.
- Whether to add the sanctions oracle check and/or geoblocking before mainnet.
- Whether counsel requires request logs (switches D8 to truncated-IP logging).
