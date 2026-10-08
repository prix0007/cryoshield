# Design

> **Not legal advice.** This is an engineering plan. Where laws or regulators' guidance are mentioned, they are
> context, not conclusions.

## Rescope (2026-10-08)

**Founder decision, verbatim: "It's OSS so no company and legal".** CryoShield is an open-source project maintained by
its contributors. It has no legal entity, no company and no lawyer engagement. Contact is GitHub (issues and private
security advisories). This extends the 2026-10-03 "assume the best" decision that `adopt-oss-project-defaults` already
applied to the legal pages, `SECURITY.md` and `security.txt`.

Consequences for this design (the earlier company-based version is in the git history of this file):

| Earlier plan | Now |
|---|---|
| Entity, CIN, registered address, named Grievance Officer, `privacy@`/`security@`/`grievance@` mailboxes | N/A. Operator, GitHub contact and Grievance Officer ("the project maintainer") per `project-contact` |
| Signed DPAs with Fly and Pimlico | N/A. Public vendor terms are relied on (D10) |
| Lawyer light review, P2 opinion pack, `[lawyer]` markers | N/A. Open questions are listed in `legal-analysis.md` §9 |
| Legal analysis with conclusions and confidence levels (old D2, D4) | `legal-analysis.md`: facts about how the design limits personal data, context as reference only (D2) |
| Full DPIA before mainnet | N/A. Lite risk register with a necessity note (D9) |
| SOC 2 Type I: policies, Vanta/Drata, TSC mapping (old D13) | N/A (D13) |
| DPDP/CERT-In compliance confirmations, statutory log export | N/A. The user-facing notice, breach notice and no-log posture stay |
| Draft banner and placeholders on the pages (old D6) | Superseded by `project-contact` (no placeholders may ship) |

Kept: every user-facing privacy commitment (no identifiers, no logs, honest pages, permanence notice, 18+, erasure
honesty, incident notice, security contact), and the review cadence with a mainnet gate, now enforced in CI.

## Context

- The app is a static Vite build served by Caddy on Fly.io (`cryoshield-web`, and `cryoshield-web-dev` for dev,
  region `sin`). Caddy has no `log` directive, so it writes no access log. `fly logs` shows only container stdout
  (~7 days).
- The app bans cookies, browser storage and `console` (lint plus `test/privacy.test.ts`) and wipes PRF outputs.
  `connect-src` lists the RPC, the Pimlico bundler, ArDrive Turbo, Turbo's index and the Arweave gateway.
- On-chain: VaultRegistry v2 (writes) and v1 (legacy, read-only) hold `vaultId`, `owner`, version, the blob and
  `blobHash`, and index locators. The blob's cleartext header holds the RP ID, key count N, credential IDs and
  `wrapSalt` (`docs/spec/vault-format-v1.md` §5). The CryoShield smart account stores each key's P-256 public key and
  requires UV and `sha256(rpId)` on every signature. Arweave tags repeat the vaultId, version and locators; the
  uploader key is ephemeral per session.
- Agents: crypto-engineer (CE), frontend-engineer (FE), recovery-engineer (RE), security-reviewer (SR),
  solidity-engineer (SE), overwatcher (OW); plus the maintainer (M).

## Goals / Non-Goals

**Goals:** know exactly what personal data exists and who holds it; publish honest notices whose security claims are
checked against the specs; have an incident plan that tells users quickly through every public channel; keep the
records true with a review cadence and a CI-enforced mainnet gate.

**Non-Goals:** legal advice or legal conclusions; a company, lawyer, DPIA or SOC 2 programme; a consent-management
platform; user accounts or email collection; a CryoShield-run log store; changing the vault format.

## Decisions

### D1. Data-flow inventory
`docs/compliance/data-inventory.md` is the source of truth: one row per party (browser, Fly edge, Caddy, Pimlico,
chain, Arweave/Turbo/gateway, RPCs, Cloudflare beacon, GitHub, GitHub correspondence, DNS, recovery tool, metrics
job). Each row states the data, whether it identifies a person, who chose the party and who controls the data, and
retention ("unpublished" where the vendor does not say). `origins.json` maps every production `connect-src` and
`script-src` origin to a row, and `verify-build` fails on an unmapped origin.

### D2. How the design limits personal data
`docs/compliance/legal-analysis.md` records facts, not conclusions: what CryoShield never receives (and the test or
review that proves it), the three kinds of personal data that exist, the design measures that keep them small (client-
side symmetric encryption, keyed locators, ephemeral uploader, padding, no own identifiers, landing-only analytics,
public-data-only statistics, GitHub-only contact, notice before publication), permanence, gas-sponsorship facts, the
sanctions stance (D4), and the regulatory documents a reader may want (EDPB 02/2025 v2.0, *EDPS v SRB*, DPDP, CERT-In,
ePrivacy, US state laws) summarised as context. Open questions are listed without assigning them to anyone.

### D3. Erasure vs immutable data (crypto-shredding)
- **Can be deleted:** GitHub correspondence the maintainers control; the user's own `.cryo` files; vendor logs only by
  each vendor under its own policy; nothing else, because the project holds nothing else.
- **Nobody can delete:** the on-chain blob and every earlier version, account address, vaultId, locators, credential
  IDs, P-256 keys and events, or the Arweave items and tags. Gateways may hide items; the network keeps them.
- **Crypto-shredding:** the user resets the FIDO2 application on every enrolled key (`ykman fido reset`, which erases
  every passkey on that key) or destroys the keys. No wrapping key can then be derived, and the AES-256-GCM
  ciphertext cannot be decrypted by any known technique. The project **must not** call this "erasure".
- **Before-write notice:** the permanence and 18+ acknowledgement (spec `legal-pages`).
- **Minimisation options** (dropping credential IDs, per-vault locators, fixed padding, no Arweave locator tags,
  per-vault accounts) are costed in `docs/compliance/on-chain-minimisation-options.md`. Each accepted option needs its
  own OpenSpec change and format version.
- Reply targets: acknowledge within 24 h, respond within 15 days (the Grievance Officer commitment on `/privacy`).
- Procedure: `docs/compliance/erasure-procedure.md`.

### D4. Sanctions: current behaviour
Stated as fact in `legal-analysis.md` §6: the terms' eligibility clause is the only measure; there is no address
screening, no oracle check, no KYC and no geoblocking; the only thing provided is capped, free gas sponsorship with no
value transferred. Changing any of this needs its own OpenSpec change. No founder decision is pending.

### D5. Cookie and consent posture
- No banner on any page: no cookies, no storage, no client identifiers, and no analytics on `/app/`, `/privacy`,
  `/terms` or `/cookies` (the device-storage inventory lists no entries; an E2E test and a build scan enforce it).
- Landing analytics (`add-privacy-preserving-analytics`): Cloudflare Web Analytics, beacon only, on `/` only; no
  cookies or storage; GPC/DNT suppress it; query and fragment stripped first; disclosed on `/privacy` and `/cookies`.
- A consent choice becomes required before: any non-essential cookie or storage, a cross-site or persistent
  identifier, a second analytics or marketing vendor, ads or pixels, or any analytics on `/app/`.

### D6. Privacy Policy, Terms of Service and Cookie Policy
Operator, contact, Grievance Officer and the not-legal-advice note follow `project-contact`. Content:
- **/privacy:** summary; who we are; what we never see (secrets, labels, vault names, keys); data held by third
  parties (one row per inventory party); public and permanent data (every field, including earlier versions, P-256
  keys, locator linkability and the size range) with the crypto-shredding explanation; purposes; analytics and the
  public-data statistics job; donations; retention; rights and how to ask; Grievance Officer (24 h / 15 days);
  international transfers; children; security (not independently audited, link to reviews); changes.
- **/terms:** testnet and unaudited; non-custodial, no recovery after all keys are lost, a PIN per key; permanence;
  sponsored gas may be paused; donations; acceptable use; eligibility (18+, sanctions); MIT licence and its disclaimer
  and liability text; third-party services; governing law; changes.
- **/cookies:** summary; device-storage table (and which pages the sweep visits, with the build scan covering the
  rest); landing analytics; choices; when this would change; contact; changes.
- **Claims check:** SR checks every security claim against `openspec/specs` and `docs/reviews` at every six-monthly
  review and records it in the review log.

### D7. security.txt and responsible disclosure
- `/.well-known/security.txt` (RFC 9116): `Contact` = the GitHub advisory URL only; `Expires` ≤ 365 days (build
  check); `Policy` = `SECURITY.md`; `Canonical`; `Preferred-Languages: en, hi`.
- `SECURITY.md`: scope (site, contracts incl. registry v2 and the smart wallet, vault format, recovery tool, paymaster
  abuse, CI/release); out of scope; safe harbour; acknowledge within 72 h, triage within 7 days, coordinated
  disclosure within 90 days; credit; no paid bounty yet.
- GitHub private vulnerability reporting is enabled (checked 2026-10-08).

### D8. Data-retention statement
`docs/compliance/retention.md`: no request logs; Fly and vendor logs per their policies; GitHub correspondence until
deleted (private advisories at most 3 years after closure); platform audit trails per each platform; metrics
artifacts 90 days; on-chain and Arweave data permanent.

### D9. Risk register (lite)
`docs/compliance/risk-register.md`: one row per risk with likelihood × impact (1–5), mitigation in place, next step
and owner; a short necessity-and-proportionality note; a maintainer residual-risk sign-off line. Re-scored at every
six-monthly and `mainnet-gate` review.

### D10. Vendors
`docs/compliance/subprocessors.md`: Fly, Pimlico, ArDrive Turbo, the arweave.net gateway, the public RPCs, Cloudflare
Web Analytics, GitHub, GoDaddy. For each: entity, what it does for the project, and the **public** terms relied on.
No agreements are signed (no company). There is no mail provider.

### D11. Incident runbook
`docs/compliance/incident-runbook.md`:
- roles (the maintainer is the incident lead; agents never deploy);
- severities: **SEV1** = a served bundle or domain compromise, or a key-material exposure path; **SEV2** = a vendor
  breach affecting users' IPs or addresses, a paymaster drain, a leaked credential, a dev-only compromise; **SEV3** =
  contained, no user impact;
- SEV1 steps with the real commands from `docs/deploy.md`: contain (`fly scale count 0`, disable deploy workflows,
  stop sponsorship), preserve evidence (and do not trust `release.json`), rotate credentials, establish the exposure
  window, restore a known-good tag, tell users, re-enable, post-mortem;
- user notice through every public channel (GitHub advisory, README, pinned issue, the site once restored), with a
  template and the line "we never ask for keys";
- external reporting clocks (CERT-In, DPDP Rule 7, GDPR, US states) listed for reference only;
- a yearly tabletop exercise (spec scenario); the first is `docs/compliance/tabletop-2026-10-08.md`.

### D12. Children and age
18+ only. Self-declaration in the create flow plus the terms statement; no age verification, which would require
collecting identity data. If a user is a child, the only thing to delete is correspondence; we explain crypto-shredding.

### D13. SOC 2
N/A for the open-source project (SOC 2 attests an organisation). The engineering evidence it would have used (CI,
OpenSpec, reviews, the no-log test, the records above) exists anyway.

### D14. Threat and abuse
- *Fake erasure or grievance requests used for social engineering* ("add this key to my vault"): the project holds
  nothing and can change nothing on-chain. The runbook and erasure procedure say the maintainers never act on a vault
  or ask for keys or secrets.
- *Phishing clones of the legal pages:* the pages carry the canonical domain and security.txt `Canonical`; the RP ID
  is the only valid domain.
- *A legal page overstating security:* the claims check (D6) at every review.
- *security.txt left to expire:* build check (spec "Expiry guard").
- *Mainnet record slipped in without review:* the CI mainnet gate (D15) is fail-closed on chain ids and needs a recent
  `mainnet-gate` review plus the launch record. A PR could add a fake review-log entry in the same PR: the gate makes
  the review visible in the diff, and the owner's release and the ECC review are the human checks. Editing a record
  already on `main` is not gated; it is reviewed as any PR.

### D15. Mainnet gate in CI
`.github/scripts/mainnet-gate.mjs`, run in `ci.yml` `pr-checks` on the files the PR **adds**
(`git diff --diff-filter=A --no-renames BASE...HEAD`):
- a record `contracts/deployments/<chainId>.json` is "mainnet" unless its chain id is a local or testnet preset of
  `contracts/script/deploy.sh` (31337, 11155420, 421614; a parity test keeps the list in sync). Unknown ids fail;
- it then needs the launch record `docs/reviews/launch-<preset name>.md` (`config/chain-presets.json`; for OP Mainnet
  `docs/reviews/launch-op-mainnet.md`, written by `launch-op-mainnet` before its record PR), and
- a review-log heading `## YYYY-MM-DD: ...mainnet-gate... (reviewer: <name>)` dated within the previous 30 days and
  not in the future.
- No secrets, no network, no GitHub token; PR data reaches it only as a file from `git diff`.

### D16. Reconciliation with archived specs (task 8.3)
`vault-web-app` (archived via `add-web-app`) and `web-hosting` (via `add-fly-hosting`) were checked on 2026-10-08.
Neither has text that conflicts with this change: `vault-web-app` "Create-vault flow" lists steps without excluding
an acknowledgement, and its jargon rules are met by the acknowledgement copy; `web-hosting` says nothing about logs.
So the acknowledgements stay in `legal-pages` and the no-log guarantee in `privacy-compliance`, with no MODIFIED
deltas. The `project-contact` supersessions from `adopt-oss-project-defaults` D5 are applied to the `legal-pages`
delta now: "Draft status and placeholders" is removed, and "Privacy policy page" and "Security contact file" follow
`project-contact`.

## Risks / Trade-offs

- [Regulators' view of on-chain personal data conflicts with the core design] → transparency (every public field
  listed), minimisation options costed, crypto-shredding guidance; accepted by the maintainer in the risk register.
- [No user contact channel for incident notices] → every public channel at once; rehearsed in the tabletop.
- [Vendor retention unknown] → "unpublished" in the inventory; disclosed on `/privacy`.
- [Legal text drifts from the product] → in-repo source, date check, claims check at every review, mainnet gate.
- [No legal review] → pages say they are not legal advice and keep conservative wording; open questions are public.

## Migration Plan

Documents and pages first; then the CI checks. Rollback means redeploying the previous image (pages) or reverting the
commit (docs and CI). The legal text keeps its changelog.

## Open Questions

None blocking. The questions about how outside rules see the design are listed in `legal-analysis.md` §9; the
on-chain minimisation decision O3 is due before the first mainnet vault.
