# CryoShield

## Problem Statement

People who hold crypto seed phrases, 2FA/TOTP backup codes, and account recovery codes have no long-lived, self-controlled place to back them up. Physical media (HDDs, SSDs, thumb drives, paper) degrade or get lost, hosted managers can be hacked or shut down and aren't under the user's control, and bank safes can be robbed. If the backup is lost, the user is permanently locked out of their assets and accounts.

## Evidence

- Founder observation: "if you lose your keys or backup codes and don't have any other way you are pretty much fucked."
- Market backlash against custodial recovery (Ledger Recover, 2023: seed leaves the device, three third parties hold shares, KYC required).
- Bitwarden shipped YubiKey/passkey PRF vault decryption in Jan 2026, which shows hardware-key unlock is becoming mainstream. It still depends on Bitwarden's servers.
- Assumption, needs validation through user interviews with 10–20 crypto holders and security professionals: target users own (or will buy) two FIDO2 keys and will pay about $1 of gas.

## Proposed Solution

A non-custodial vault. Secrets are encrypted in the browser with a random data key. Each enrolled FIDO2 hardware key (e.g. YubiKey) derives its own wrapping key through the WebAuthn PRF extension and protects a copy of that data key. The encrypted vault is stored in an Arbitrum contract, mirrored to Arweave, and fingerprinted (hashed) on Ethereum L1. Any single enrolled key unlocks the vault. **There is no CryoShield backend:** the product is a static frontend (also pinned to IPFS/ENS), the chain, and a third-party ERC-4337 bundler and paymaster. CryoShield sponsors the gas, and the user's YubiKey signs through a passkey smart account, so the user never needs a wallet, ETH, or a seed phrase. CryoShield runs no servers and stores nothing, and an open-source desktop recovery tool can unlock vaults without the CryoShield website, so users are unaffected if the company dissolves. We chose this over hosted password managers (company-dependent), physical media (decays and gets lost), and custodial recovery (third-party trust).

## Key Hypothesis

We believe a hardware-key-unlocked, on-chain encrypted vault will replace paper and drive backups for crypto holders and security professionals.
We'll know we're right when 10,000 users have created vaults and ≥95% of test unlocks succeed across supported browsers and devices.

## What We're NOT Building

- Inheritance or dead-man's switch: not a v1 need; vaults are always openable by their owner.
- Team or enterprise shared vaults: different buyer, different trust model.
- Native mobile apps: v1 is a web app that also works in mobile browsers.
- Paper or Shamir shares in the UI: the format supports them, but the UI is deferred (theft risk, extra friction).
- Ethereum L1 storage: deferred for cost; only a hash anchor goes to L1 in v1.
- Recovery after every key is lost: impossible by design; we state this clearly in the UI.
- Public-key or elliptic-curve encryption (ECIES, RSA): only symmetric crypto that FIDO2 supports, which keeps the public ciphertext quantum-safe.
- Large files: capped at about 1 KB per vault.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Vaults created | 10,000 | On-chain vault-creation events |
| Unlock success rate | ≥95% | Manual compatibility test matrix (no backend, so no telemetry) |
| Landing visits | (directional) | Cookieless page-view count on `/` only (Cloudflare Web Analytics); never on `/app/` |
| Recovery without CryoShield | 100% of test vaults | Desktop tool unlocks vaults with the website offline |
| Cost per vault to user | ≤ $1 | Gas paid per create, measured on-chain |

## Open Questions

- [ ] Do target users already own 2 FIDO2 keys, or does a ~$50–110 hardware cost kill adoption? Bundle or partner with Yubico?
- [ ] Which bundler/paymaster provider (Pimlico, Alchemy, Coinbase CDP), and which smart-account implementation with multi-owner WebAuthn support (Coinbase Smart Wallet, Kernel, Safe passkey module)?
- [ ] Monthly sponsorship budget cap before spam becomes a cost problem.
- [ ] Arweave upload without a backend: user pays directly in AR, or through a third-party bundler (Irys/Turbo)? Does that count as a "backend"?
- [x] GDPR/DPDP: does on-chain ciphertext make CryoShield a data controller / Data Fiduciary? Researched 2026-10-02 in OpenSpec `add-privacy-and-compliance` (design D2–D3): EDPB Guidelines 02/2025 **v2.0 (adopted 7 Jul 2026)** treat encrypted data and wallet addresses as personal data and advise storing personal data off-chain (paras 26, 48–51, 104), so we are very likely a controller for the publication. Mitigations: permanence notice, crypto-shredding, DPIA. ~~Still needs an external lawyer's opinion before mainnet~~: answered by the founder 2026-10-08 ("It's OSS so no company and legal"): no lawyer engagement; kept as an open question in `docs/compliance/legal-analysis.md` §9.
- [x] Log duties vs privacy: CERT-In Directions (2022) require ICT logs for 180 days in India and a 6-hour incident report; DPDP Rule 8(3) requires 1-year logs from ~13 May 2027. Caddy currently writes no access log. ~~Lawyer to confirm~~: answered by the founder 2026-10-08 ("It's OSS so no company and legal"): no request logs; open question in `legal-analysis.md` §9.
- [x] PMLA/VDA: does sponsoring gas (Pimlico bills USD; we never hold ETH) or deploying user smart accounts make us a VDA service provider needing FIU-IND registration? Our analysis says very likely not (medium confidence); ~~get a written opinion before mainnet~~: answered by the founder 2026-10-08 ("It's OSS so no company and legal"). Facts in `legal-analysis.md` §5; never top up the paymaster with ETH.
- [x] EU/UK Art. 27 representative: likely needed once we target EU/UK users (permanent publication is hard to call "occasional"). N/A: answered by the founder 2026-10-08 ("It's OSS so no company and legal").
- [x] Sanctions: ToS clause only, no screening, no geoblocking: current behaviour documented in `docs/compliance/legal-analysis.md` §6 (2026-10-08). Any change needs its own OpenSpec change.
- [ ] Landing analytics consent: EDPB Guidelines 2/2023 (para 32) treat script-sent requests as device "access", so cookieless is not automatically banner-free in the EU. Cloudflare's beacon reads Performance API timings, URL and referrer, so the EU risk is somewhat higher than a constant-only payload. Plan: no banner, landing only, GPC/DNT suppress it. Accept the residual risk, or skip the beacon for EU/UK visitors / add an opt-in? (No lawyer review: OSS, founder 2026-10-08; open question in `legal-analysis.md` §9.) Also ask Cloudflare whether the beacon may be self-hosted.
- [x] Legal entity details, Grievance Officer, and the mail provider: answered by the founder 2026-10-08 ("It's OSS so no company and legal"): no entity; contact via GitHub; Grievance Officer = the project maintainer (`project-contact`).
- [ ] iOS Safari PRF reliability with external keys: WebKit bugs 311099 and 314934 are open.
- [ ] Domain strategy: a long-lived domain plus ENS, and how to protect the RP ID against domain lapse or hijack.
- [x] **Mainnet chain:** decided 2026-10-02: **OP Mainnet**. No funds yet, so deployments stay on OP Sepolia only. Background: the testnet is OP Sepolia (2026-10-02). Both chains support everything the MVP needs; OP Mainnet is estimated at ~$0.004 per 1 KB sponsored create vs ~$0.03 on Arbitrum.
- [ ] Rollup long-term data availability: what is the archive story if the chosen L2 stops operating? This is mitigated by the Arweave mirror.
- [ ] Shipping without an audit while protecting high-value secrets: what is the disclosure, cap, or bug-bounty plan?
- [ ] Revenue model: CryoShield pays gas, so how does it make money?

---

## Users & Context

**Primary Users** (launching to both at once)
- **Who**: (1) crypto holders with seed phrases; (2) security professionals holding 2FA/TOTP and recovery codes. Neither group is assumed to be technically savvy.
- **Current behavior**: paper, metal plates, thumb drives, password managers, bank safes.
- **Trigger**: setting up a new wallet or enabling 2FA; a scare (lost drive or device).
- **Success state**: the secret is backed up once and recoverable decades later with only a hardware key.

**Job to Be Done**
When I set up a crypto wallet or turn on 2FA, I want to back up the seed phrase or recovery codes somewhere that can't rot, burn, be hacked, or disappear, so I can always get back in using only the hardware keys I physically hold.

**Non-Users**
Enterprises needing shared vaults; people without FIDO2 keys; people expecting recovery after losing all keys; anyone storing large files.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Client-side encryption: random data key + AES-256-GCM | Company never sees plaintext |
| Must | WebAuthn PRF → HKDF-SHA256 → per-key wrap of the data key | Hardware-key unlock using only what FIDO2 can do |
| Must | Enrol ≥2 keys at setup; any single key unlocks | Losing one key is survivable |
| Must | Arbitrum vault contract (≤1 KB, size cap enforced) | Cheap, EVM, path to L1 |
| Must | Open-source desktop recovery tool (CTAP2 hmac-secret over USB + reads chain/Arweave) | Removes the domain/company single point of failure |
| Must | Passkey smart account (ERC-4337, P-256/WebAuthn signer; each enrolled YubiKey is an owner) | User signs with the YubiKey; no wallet or seed phrase |
| Must | Sponsored gas via a third-party paymaster (CryoShield pays), restricted to the vault contract | Non-technical users never touch gas |
| Should | Paymaster abuse limits: per-account and global daily spend caps, vault-contract-only policy | Sponsorship can't be drained by spam |
| Could | "Bring your own wallet" connector (wagmi/WalletConnect) as fallback if sponsorship is down | Writes still work without the paymaster |
| Must | Keyless vault lookup: discoverable credential → PRF → derived vault locator | Recover with only the YubiKey, without remembering a wallet address |
| Must | Static frontend, no servers, also pinned to IPFS/ENS | No backend; nothing for CryoShield to run or lose |
| Should | Arweave mirror (user-paid, from the browser) + Ethereum L1 hash anchor (user-paid) | Data survives even if Arbitrum doesn't |
| Won't | Card on-ramp | Unneeded: CryoShield sponsors gas |
| Should | Add or replace key (needs an existing key present) | Hardware ages; 10+ year horizon |
| Should | Periodic "health check" unlock reminder | Detect dead keys before it's too late |
| Could | M-of-N threshold via Shamir's Secret Sharing, incl. optional paper share | Higher security tier; format supports it from day one |
| Could | Ethereum L1 "forever" storage tier | Maximum permanence for those willing to pay |
| Won't | Inheritance, team vaults, native mobile, ECIES/RSA | See "What We're NOT Building" |

### MVP Scope

Web app: create a vault → enroll 2 YubiKeys → store ≤1 KB of secrets on Arbitrum → unlock with either key. Plus the open-source desktop recovery tool that unlocks the same vault with the website offline.

### User Flow

1. Visit the static app → "Create vault" → tap YubiKey #1 (discoverable PRF credential).
2. Tap YubiKey #2 to enroll it as a backup.
3. Paste secrets → encrypted in the browser → tap a key to sign the store transaction (gas sponsored by CryoShield; no wallet).
4. Later: visit the app (or run the desktop tool) → tap any enrolled key → the locator is derived from the key's PRF → the vault is read from public RPCs → decrypted locally. **No wallet is needed to recover**, only to write.

---

## Technical Approach

**Feasibility**: MEDIUM. Every building block exists (PRF, P-256 smart accounts, Arbitrum, Arweave). The risks are browser/iOS compatibility and getting the cryptography right with no audit.

**Architecture Notes**
- Envelope encryption: data key encrypts the secrets; each credential's PRF output → HKDF-SHA256 (with domain-separation info) → wrapping key → AES-256-GCM wraps the data key. Symmetric only, so it is quantum-safe.
- Vault format is versioned and records the algorithm IDs, the RP ID, the PRF salts, and the credential IDs. Storing credential IDs avoids using resident-key slots on the hardware key.
- The format supports a Shamir M-of-N split of the data key from day one; v1 defaults to 1-of-N.
- Vault contract on Arbitrum One: per-owner vault storage, size cap, events for indexing. It is EVM, so the same Solidity can be deployed to Ethereum L1 later.
- **No CryoShield backend.** A static site talks directly to public Arbitrum/Ethereum RPCs and to a third-party ERC-4337 bundler/paymaster (e.g. Pimlico, Alchemy, or Coinbase CDP; to choose). CryoShield funds the paymaster and sets its sponsorship policy in the provider's dashboard.
- Passkey smart account: each enrolled YubiKey is a P-256 owner, verified through Arbitrum's RIP-7212 precompile (**verify it is available**). One tap = PRF output (for encryption) + assertion signature (for the transaction).
- Vault ownership: the smart account controls updates. Reads are public and need no wallet, so losing the wallet never blocks recovery, only updates.
- Keyless lookup: vault locator = HKDF(PRF output, "cryoshield/locator/v1"). The contract maps locator → vault, so the YubiKey alone finds the vault. Requires discoverable (resident) credentials, which use one of the YubiKey's limited credential slots.
- Fallback: if the paymaster is down, writes pause but reads and recovery are unaffected (they never touch the paymaster).
- Durability: Arweave mirror of the vault blob, with a 32-byte hash anchored on Ethereum L1.
- Desktop recovery tool: libfido2 or python-fido2 hmac-secret with the recorded RP ID and salt; reads the vault from public Arbitrum RPCs or Arweave.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Domain lapse or hijack breaks browser unlock | M | Desktop recovery tool; RP ID and salts stored on-chain; long-lived domain |
| iOS Safari PRF bugs with external keys | H | Compatibility matrix; desktop and Android first; document supported setups |
| Crypto implementation bug, no audit | M | Use audited libraries (WebCrypto, noble); publish spec + test vectors; open-source; bug bounty; cap vault size |
| YubiKey firmware <5.2 lacks hmac-secret | M | Detect at enrollment and reject |
| Hardware key death over 10+ years | M | Require ≥2 keys; health-check reminders; key replacement flow |
| Arbitrum data unavailable long-term | L | Arweave mirror + L1 hash anchor |
| Gas spikes | L | Size cap; Arbitrum fees are cents even in spikes |
| Paymaster drained by spam vaults (anyone can make fresh passkeys) | M | Vault-contract-only policy, per-account and global daily caps, one vault per locator, size cap |
| Paymaster/bundler provider dependency | M | Reads and recovery never use it; can switch providers or fall back to a user's own wallet |
| Metadata leakage (who has a vault, number of keys) | M | Document it; don't store labels in plaintext |

---

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Crypto core & vault spec | Vault format, PRF→HKDF→wrap, SSS-ready, test vectors (TS library) | pending | - | - | - |
| 2 | Vault contract | Solidity vault on Arbitrum (Foundry), size cap, events, testnet deploy | pending | with 1 | - | - |
| 3 | Web app | Static frontend: WebAuthn enroll/unlock, passkey smart account + sponsored gas, store/read flow | pending | with 4, 5 | 1, 2 | - |
| 4 | Durability layer | Arweave mirror + L1 hash anchor | pending | with 3, 5 | 2 | - |
| 5 | Desktop recovery tool | Open-source CLI: CTAP2 hmac-secret + chain/Arweave reader | pending | with 3, 4 | 1 | - |
| 6 | Compatibility & launch | Browser/device test matrix, E2E tests, on-ramp, mainnet deploy | pending | - | 3, 4, 5 | - |
| 7 | ~~SOC 2 readiness~~ | **Dropped 2026-10-08** (OSS, no company: SOC 2 attests an organisation). Privacy records live in OpenSpec `add-privacy-and-compliance` | n/a | - | 6 | - |

### Phase Details

**Phase 1: Crypto core & vault spec**
- **Goal**: A correct, documented encryption scheme.
- **Scope**: Versioned vault format spec; TypeScript library for encrypt/decrypt and per-key wrap/unwrap; SSS module; deterministic test vectors.
- **Success signal**: Test vectors pass; spec published in the repo.

**Phase 2: Vault contract**
- **Goal**: Durable on-chain storage.
- **Scope**: Contract to create/update/read a vault blob with a size cap; Foundry tests; OP Sepolia deploy (testnet pivot, 2026-10-02).
- **Success signal**: Store and read back a 1 KB blob on testnet; gas per vault measured.

**Phase 3: Web app**
- **Goal**: The end-to-end user flow.
- **Scope**: Static site (no backend); enroll ≥2 keys as smart-account owners, keyless lookup, store with sponsored gas, unlock with only a key.
- **Success signal**: A vault is created and unlocked with either of 2 YubiKeys on desktop Chrome.

**Phase 4: Durability layer**
- **Goal**: Survive Arbitrum failing.
- **Scope**: Arweave upload and L1 hash anchor; integrity check on read.
- **Success signal**: The vault restores from Arweave alone, verified against the L1 hash.

**Phase 5: Desktop recovery tool**
- **Goal**: No dependency on the company.
- **Scope**: CLI using libfido2/python-fido2 that reads a vault by address and unlocks it with a USB key.
- **Success signal**: Unlocks a web-created vault with the website offline.

**Phase 6: Compatibility & launch**
- **Goal**: Ship.
- **Scope**: Test matrix (Chrome, Firefox, Safari / macOS, Windows, Android, iOS / YubiKey 5 series); Playwright E2E; IPFS/ENS pin; mainnet deploy.
- **Success signal**: ≥95% unlock success on the supported setups.

**Phase 7: SOC 2 readiness** (dropped 2026-10-08: OSS, no company)
- **Goal**: Compliance for startup credibility.
- **Scope**: Security criteria first; Vanta or Drata; Type I, then Type II after an observation window of at least 3 months.
- **Success signal**: Type I report.

### Parallelism Notes

Phases 1 and 2 are independent once the vault blob is defined as opaque bytes. Phases 3, 4, and 5 all run on top of them: the web app, the Arweave/L1 layer, and the CLI share only the spec and the contract ABI. This suits a multi-agent setup with one agent per track.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Testnet | OP Sepolia (pivot from Arbitrum Sepolia, 2026-10-02) | Arbitrum Sepolia | Founder choice: Arbitrum Sepolia test ETH was hard to get. The P-256 precompile, EntryPoint v0.6, CBSW v1.1 and Pimlico are all verified on OP Sepolia; the stack is chain-configurable via presets |
| Chain (mainnet) | **OP Mainnet** (decided 2026-10-02; not deployed until funded) | Arbitrum One (original choice) | Ethereum L1, Starknet | Cents per KB; EVM so moving to L1 is straightforward; mature tooling. Starknet is not EVM (Cairo) and has no permanence advantage |
| Permanence | Arweave mirror + L1 hash | Arbitrum only | Data survives if any copy survives |
| Crypto | FIDO2 PRF + AES-256-GCM (symmetric only) | ECIES, hybrid ML-KEM | FIDO keys can't do ECIES; elliptic-curve encryption is quantum-vulnerable while the ciphertext is public forever |
| Threshold | 1-of-N, at least 2 keys; SSS-capable format | 2-of-3 with paper, user-chosen M-of-N | Simplest for non-technical users; a paper share risks theft |
| Custody | Fully non-custodial | Escrow, MPC | Core promise; company stores nothing |
| Gas | CryoShield sponsors through a third-party ERC-4337 paymaster; YubiKey-owned passkey smart account | User pays via own wallet; on-ramp | Founder choice; non-technical users never touch a wallet or gas |
| Architecture | Static frontend + chain + third-party bundler/paymaster; no CryoShield backend | Own API server, own relayer | Founder choice; nothing to run, hack, or shut down; smaller SOC 2 scope |
| Process | OpenSpec for every change (HARD requirement) | Ad-hoc plans | Founder requirement; specs are the contract between build agents |
| License | MIT (decided 2026-10-02; matches existing SPDX/package metadata) | Apache-2.0, AGPL-3.0 | Founder: "anything public and OSS"; MIT needed no relicensing |
| Open source | Always public repo | Closed source | Trust for an unaudited security product; enables independent recovery |
| Launch audience | Crypto holders + security professionals together | One first | Founder choice; risk: diluted positioning |
| Audit | None for MVP | Audit before launch | Solo founder, ASAP timeline; compensate with open source + test vectors + bug bounty |
| Analytics | **On-chain + cookieless** (founder, 2026-10-02): product metrics only from public on-chain events + the Pimlico dashboard; cookieless, no-PII analytics on the landing page only; no analytics on `/app`. Vendor (founder, 2026-10-03): **Cloudflare Web Analytics, "beacon only"**: no Cloudflare proxy, Fly keeps hosting/TLS, DNS unchanged. The beacon runs on `/` only, SRI-pinned (self-hosted copy if Cloudflare permits, else the CF URL failing closed on updates, because CF does not version-pin the beacon), with per-route CSP, no WebAuthn on `/`, and GPC/DNT suppression (OpenSpec `add-privacy-preserving-analytics`) | Plausible (earlier recommendation), full-site analytics, none at all | Zero user tracking fits a secrets product; on-chain data already answers the 10k-vaults metric |
| Project form | **Open-source project, no company and no lawyer** (founder, 2026-10-08: "It's OSS so no company and legal"). Supersedes the Jurisdiction, Legal pages and Compliance sequencing rows below: no entity, DPAs, lawyer opinions, DPIA or SOC 2; contact via GitHub; user-facing privacy commitments kept (OpenSpec `add-privacy-and-compliance`, rescoped) | Indian legal entity | OSS maintained by its contributors; nothing to incorporate |
| On-chain minimisation | Keep credential IDs, locators, Arweave locator tags and shared accounts (reject O1, O2, O4, O5); decide fixed-size padding (O3) together with review F2 before the first mainnet vault. Proposed by the maintainers 2026-10-08 (`docs/compliance/on-chain-minimisation-options.md`) | Drop credential IDs; per-vault locators or accounts | The three per-key identifiers are redundant, so removing one unlinks nothing; O2/O4 break keyless recovery |
| Jurisdiction | ~~**Indian legal entity, global users** (founder, 2026-10-02)~~ superseded 2026-10-08 (Project form): comply with the DPDP Act 2023 + Rules 2025, GDPR/UK GDPR, US state laws (CCPA thresholds not met today), the IT Act/CERT-In, and analyse PMLA-VDA and sanctions (OpenSpec `add-privacy-and-compliance`) | Offshore entity | Founder choice; DPDP core duties start ~13 May 2027 |
| Legal pages | Privacy Policy, Terms of Service **and Cookie Policy** drafted now, before public launch, with placeholders `[ENTITY]`, `[REGISTERED ADDRESS]`, `[GRIEVANCE OFFICER]`, `[CONTACT EMAIL]` and a visible "Draft, pending legal review" banner; the cookie policy publishes a device-storage inventory (founder, 2026-10-03) | Wait for final legal text | Ship honest disclosures with the landing analytics; counsel finalises later |
| Compliance sequencing | Privacy/terms, security.txt, inventory, permanence + 18+ acknowledgement, and the incident runbook **before public launch**; lawyer opinions, full DPIA and a mainnet gate **before mainnet**; policies + Vanta/Drata **before SOC 2 Type I** (Security + Confidentiality; Privacy criteria optional) | Do it all at SOC 2 time | Cheap now; on-chain data is permanent, so notices must precede the first real write |

---

## Research Summary

**Market Context**
No live product found that combines hardware-key PRF unlock with permanent on-chain ciphertext. Closest analogues: Ledger Recover (custodial shares + KYC), Casa (multisig, holds a key, funds only), Trezor SLIP-39 / Keystone (physical shares), Bitwarden PRF unlock (hosted), Lit Protocol (node network), Sarcophagus (dead-man's switch; status unverified), Vault12 / Nunchuk / Kresus (inheritance).

**Technical Context**
- PRF / hmac-secret works on YubiKey 5 with firmware ≥5.2 (PRF at creation needs ≥5.8; firmware can't be upgraded).
- Browser support: Chrome/Edge good; Firefox 139+/148+; Safari 26.4+ (March 2026) with open bugs.
- The PRF output is scoped to the RP ID (domain), which motivates the desktop recovery tool.
- Ethereum L1 contract storage costs ~$3.30/KB at 1.8 gwei. Blobs are pruned after ~18 days; calldata/log history may expire (EIP-4444).
- Arbitrum costs an estimated ~$0.02–0.10/KB (unverified); OP Mainnet an estimated ~$0.004 per sponsored 1 KB create (target-op-sepolia design).
- Arweave costs ~$7–14/GB, one-time.
- SOC 2 costs $25–80k and takes 6–12 months.

---

*Generated: 2026-10-02*
*Status: DRAFT - needs validation*
