# Compliance review log

> `add-privacy-and-compliance`, spec `privacy-compliance` "Compliance records reviewed on a schedule". CryoShield is an
> open-source project maintained by its contributors; there is no company. Not legal advice.

The data-flow inventory, sub-processor list, retention statement, risk register, the three legal pages and the
expected DNS and registrar state (`apps/web/deploy/README.md` §4–5: CAA Let's Encrypt only, DNSSEC on, registrar
lock on, Cloudflare Universal SSL off, records DNS-only) are reviewed **at least every six months** and **before any mainnet deployment**. Each review adds one entry, newest
first, with this exact heading (CI parses it, `.github/scripts/mainnet-gate.mjs`):

```
## YYYY-MM-DD: <kind>[, <kind>] (reviewer: <name>)
```

Kinds: `six-monthly`, `claims-check` (security claims on the legal pages against the specs and reviews),
`mainnet-gate`, `incident`, `tabletop`.

**Mainnet gate.** A pull request that adds a mainnet `contracts/deployments/<chainId>.json` fails CI unless this log
has a `mainnet-gate` entry dated within the previous 30 days and the chain's launch record
(`docs/reviews/launch-<preset>.md`, for OP Mainnet `docs/reviews/launch-op-mainnet.md`) exists. A `mainnet-gate`
review re-checks everything in a six-monthly review, plus the items listed under "Mainnet gate checklist" below.

### Mainnet gate checklist

- every row of `data-inventory.md` and `origins.json` matches the mainnet build's CSP (`verify-build` with the
  mainnet chain);
- `/privacy`, `/terms` and `/cookies` name the mainnet network, the RPC host and the audit status truthfully, and
  their effective dates and changelogs are current;
- `risk-register.md` re-scored, with the maintainer's sign-off;
- the sanctions stance in `legal-analysis.md` §6 is still the current behaviour;
- the incident runbook's contacts and commands still work (`incident-runbook.md`), and the last tabletop is less
  than a year old;
- `security.txt` `Expires` is more than 90 days away.

---

## 2026-10-09: mainnet-gate (reviewer: prix0007)

> **Signed by the maintainer, 2026-10-12** (sign-off at the end of this entry). CI's mainnet gate
> (`.github/scripts/mainnet-gate.mjs`) reads only the heading above. Its 30-day window ends on **2026-11-08**: if the PR
> that adds `contracts/deployments/10.json` has not merged by then, it needs a new entry. Conditions 4, 6, 7 and 8 below
> are launch-day steps and stay open until the launch record shows them closed.

**Scope.** The compliance gate G9 of [`launch-op-mainnet`](../../openspec/changes/launch-op-mainnet/design.md)
(Go/no-go → G9) for moving https://cryoshield.app from OP Sepolia (11155420) to OP Mainnet (10): the six-monthly
items again, the "Mainnet gate checklist" above, and the risk register re-scored for real users and real money. The
evidence is the repository at `origin/main` `e620612` and read-only public lookups made on 2026-10-09. No transaction
was sent. No dashboard, secret, `.env` file or keystore was opened. No code, workflow or setting was changed.

**Checked, with evidence.**

| Item | Result | Evidence |
|---|---|---|
| `origins.json` and `data-inventory.md` against the mainnet CSP | The OP Mainnet RPC `https://mainnet.optimism.io` has a row (inventory row 7, sub-processor row 7). The 6.1 review's chain-10 build (built against the **test-only fixture** `10.json`) found every CSP origin in `origins.json`. Not yet run against the real `10.json`, which does not exist yet (G10, task 7.3) | [`origins.json`](origins.json); [`data-inventory.md`](data-inventory.md) rows 5 and 7; [launch record 6.1](../reviews/launch-op-mainnet.md#61-pre-launch-security-review) "Chain-10 build" |
| `/terms`, `/privacy` and `/cookies` name the network, RPC host and audit status | `/terms` and `/privacy` take the network name from the build (`<!--net:mainnet-->`, `__CS_NET_NAME__`) and say "has not been independently audited" on every chain. The RPC row comes from `VITE_RPC_URL`. `/cookies` does not name a network and does not need to. The effective date is 2026-10-09 on `/terms` and `/privacy`, with matching changelog entries. `/cookies` is still at 2026-10-08 (revision 3), and no mainnet change was made to it | [`terms.md`](../../apps/web/legal/terms.md), [`privacy.md`](../../apps/web/legal/privacy.md), [`cookies.md`](../../apps/web/legal/cookies.md); `launch-op-mainnet` tasks 4.2–4.4 (ticked); launch record 6.1 (H2, `AUDIT_PROMISES` denylist on both chains) |
| Risk register re-scored | Re-scored for OP Mainnet, with eight new rows. The founder has not signed it | [`risk-register.md`](risk-register.md) |
| Sanctions stance (`legal-analysis.md` §6) | Unchanged: terms-only eligibility, no screening and no geoblocking. §6 says "No further decision is pending **for the testnet**", so the founder has to confirm that the same stance holds for mainnet. One fact has changed: the value per user is now capped at $1 a month and $0.50 an operation (D8), where §6 says "a few cents per operation" | [`legal-analysis.md`](legal-analysis.md) §5–6; [design D8](../../openspec/changes/launch-op-mainnet/design.md#d8-mainnet-pimlico-policy-founder-decisions-2026-10-09) |
| Incident runbook and tabletop | The last tabletop was 2026-10-08, less than a year ago. The runbook's contain step covers pausing sponsorship (disable the policy or revoke the key). Its `fly`, `gh` and Pimlico commands were **not run** in this review, so whether they still work is not shown. Tabletop gaps G2, G3 and G6 are still open, G4 is partly closed and G5 is open (see below) | [`incident-runbook.md`](incident-runbook.md) §3; [`tabletop-2026-10-08.md`](tabletop-2026-10-08.md) "Gaps found" |
| `security.txt` `Expires` | `2027-09-30T23:59:59Z`, both in the repo and live on 2026-10-09. That is more than 90 days away, and 2 days before the domain expires (2027-10-02) | [`security.txt`](../../apps/web/public/.well-known/security.txt); pre-production review I1–I4 |
| Launch record exists (the CI gate's other condition) | Yes. It records the founder decisions, G1–G11, and the 6.1 review (round 2: APPROVE, no open CRITICAL or HIGH) | [`launch-op-mainnet.md`](../reviews/launch-op-mainnet.md) |
| `dev.cryoshield.app` (G2) | A, AAAA and CNAME all came back empty on 2026-10-09 (`dig +short`) | public DNS |
| DNSSEC on `cryoshield.app` (pre-production M1) | **In effect** on 2026-10-09. A DS record is published (key tag 2371, alg 13), and the validating resolvers 1.1.1.1 and dns.google return the `ad` flag | public DNS; [`apps/web/deploy/README.md`](../../apps/web/deploy/README.md) §4–5 |
| CAA on `cryoshield.app` (pre-production M1) | **As required (2026-10-10).** The founder disabled Cloudflare Universal SSL, which removed its unused Universal and Backup edge certificates and the CA records Cloudflare added with them. Cloudflare's authoritative server and the 1.1.1.1, 8.8.8.8 and 9.9.9.9 resolvers now return exactly `0 issue "letsencrypt.org"` and `0 issuewild ";"`. The site still serves Fly's Let's Encrypt certificate (HTTP 200) | `dig +short CAA cryoshield.app`; [`apps/web/deploy/README.md`](../../apps/web/deploy/README.md) §4 |
| Cloudflare Security Center "Exposed RDP Servers" (2026-10-09) | **False positive.** `66.241.124.125` is Fly.io's shared anycast IPv4: the edge proxy accepts TCP on every port (3389, 22, 5900 and a random 47123 all connect). An RDP X.224 connection request gets 0 bytes back, and port 22 sends no SSH banner. The dedicated IPv6 refuses 3389. `apps/web/fly.toml` defines only `[http_service]` (80/443 to 8080). Checked 2026-10-10 | `nc`, a raw RDP probe; `fly ips list -a cryoshield-web`; [`apps/web/fly.toml`](../../apps/web/fly.toml) |
| Production today | `/release.json` shows commit `f06ccb9`, chain 11155420, RP ID `cryoshield.app` (the 2026-10-05 build). Nothing is on OP Mainnet yet | `curl -s https://cryoshield.app/release.json` |
| Pimlico mainnet policy | **Recorded 2026-10-10 (#83).** Policy `sp_mixed_hellion`, chain 10 only, Disabled until the deploy's smoke test: per user $1 and 10 operations, reset monthly; global $30 and 500 operations, reset daily; $0.50 per operation; 2026-10-10 to 2027-10-02. The first policy, `sp_many_longshot`, was deleted (resets "never"). Key `cryoshield-mainnet`: origin `cryoshield.app`, bundler on, "verifying paymaster" off, account APIs off. $120 prepaid, no card. Task 1.1 (a): policy-scoped sponsorship with "verifying paymaster" off **verified on the dev key 2026-10-10/11** (#86) | [`paymaster-policy.md`](../../apps/web/docs/paymaster-policy.md) §3–4 |
| CI gate behaviour | Before this entry, `node .github/scripts/mainnet-gate.mjs` on an added-file list naming `contracts/deployments/10.json` exited 1 ("no mainnet-gate entry"). With this entry it exits 0 | `.github/scripts/mainnet-gate.mjs`; `npm test --prefix .github/scripts` |

**Founder decisions accepted in this review** (recorded in the [launch record](../reviews/launch-op-mainnet.md#founder-decisions-2026-10-09)
and design D3, D7 and D8; this review records them and does not make them):

1. **No external contract audit, and none planned** (Q1/G6, D7). The contracts are the OP Sepolia bytecode, reviewed
   internally; every chain's copy says "has not been independently audited", and nothing promises an audit.
2. **Straight to mainnet with no testnet release of `v1.0.0`** (Sequencing B, D3). The mainnet `production-build` values
   are set before the first `v*` tag. The proof that `v1.0.0` works on OP Sepolia comes from the dev site, not from
   production. A failed first deploy rolls back to the 2026-10-05 OP Sepolia image. A later chain rollback depends on
   the four testnet values having been saved offline beforehand (G8).
3. **The D8 Pimlico values.** Policy `sp_mixed_hellion`, chain 10 only (it replaced `sp_many_longshot`, deleted
   2026-10-10 because its resets were "never"):
   - per user: $1 and 10 operations, reset monthly;
   - global: $30 and 500 operations, reset daily;
   - $0.50 per operation;
   - valid 2026-10-10 to 2027-10-02;
   - $120 prepaid, no card;
   - created disabled and enabled after the first green chain-10 deploy.

**Residual risks** (scored in [`risk-register.md`](risk-register.md)):

- **Unaudited contracts (R19).** The immutable contracts serve real users. A contract bug cannot be patched: the fix
  is a new versioned contract plus a read path for the old one.
- **Irreversible deploys (R20).** A wrong deploy cannot be undone. The guard is D1's address parity plus three
  explorer verifications.
- **Bundle and supply chain (R1).** A malicious or compromised bundle on the RP ID reads secrets at the next unlock.
  Mainnet makes that worth more to an attacker. CAA is now Let's Encrypt only (2026-10-10).
- **Sponsorship availability (R9, R17, R18).** Abuse or real growth can pause saving for everyone for the rest of a
  day ($30 global cap), or for one user for the rest of a month (10 operations or $1).
- **The bundler key in the browser (R18).** The Pimlico key ships to every browser. A key cannot name a policy, but
  with "verifying paymaster" off it sponsors only policy-scoped requests (task 1.1 (a), verified on the dev key
  2026-10-10/11). The $120 prepaid balance with no card remains the hard bound.
- **Recovery without CryoShield (R21)** needs the recovery tool's `op-mainnet` preset to be generated from the real
  `10.json` and released. Until then it does not find mainnet vaults.
- **Single maintainer (R25).** Monitoring is manual and daily for 14 days, done by one person (tabletop G6).
- **Testnet users and linkability (R22, R23).** Testnet users' vaults are not on mainnet. A user's testnet activity
  is linkable to their mainnet activity by construction. Both are disclosed.
- **Permanence (R3).** Real users' ciphertext and identifiers are permanent. Fixed padding (O3) is decided and
  implemented (#85): every payload is padded to its key set's maximum, so ciphertext length no longer reveals the
  secret's size.
- **Outdated tabs (new, #88).** A tab left open across a deploy refuses to write and asks for a reload. Accepted LOW
  risks (its `design.md`): if the build check cannot answer (offline, timeout) the save goes ahead; a deploy in the
  seconds between check and signature is not caught; reloading discards unsaved edits, because keeping them would
  put secrets in browser storage.
- **Compromised keys (new, #87).** `/lost-key` tells users that past vault versions stay public and that every key
  ever enrolled can read them, so a compromised key and PIN means rotating the secrets at their source and creating
  a new vault; removing a key would not protect them.

**Conditions: each must be closed (or, where marked, explicitly accepted in writing) before the mainnet deploy**
(`launch-op-mainnet` tasks 7.2 onward):

1. **G4 / task 1.2 (Pimlico). Closed 2026-10-10** (#83): the live policy, key restrictions and balance are
   recorded in `paymaster-policy.md` §3, dated; task 1.1 (a) is answered and verified on the dev key (#86). The
   policy stays Disabled until runbook step 8.
2. **G3 (founder's YubiKey run). Closed 2026-10-12** (#86, `harden-gas-sponsorship` 6.2 and 6.3 ticked, 6.4 done
   2026-10-10). Evidence on OP Sepolia, vault `0x94a68b0b…5e87`:
   - **create, unlock, edit, recovery-tool unlock of v2:** reported by the founder 2026-10-10; create and 7 edits on
     chain, all sponsored through Pimlico's `SingletonPaymasterV6`; UV=0 refusal shown by fork simulation;
   - **add-key with a third key (YubiKey 5C NFC):** tx `0x6180e582…`, 2026-10-10 14:03 UTC, `LocatorAdded` +
     `VaultUpdated`, 3 entries, wallet `nextOwnerIndex()` = `ownerCount()` = 3; 502,562 gas, within the D2/D8 caps
     at ×10;
   - **padded save with 3 keys:** tx `0x8328747f…`, 2026-10-11 19:28 UTC, version 11, 999 bytes (padded to the
     3-key maximum), sponsored. The founder reports unlocking with only the new key, on mobile over NFC;
   - **accepted by the founder, 2026-10-12:** that save was signed by an original key (wallet owner 1), so no
     on-chain operation is signed by the new key alone. The founder accepts this for the use case ("we are fine for
     that usecase");
   - the v1 items stay **waived for mainnet** (founder, 2026-10-10): v1 is OP Sepolia only.

   `harden-gas-sponsorship` 8.1 (the founder's approval, against the D8 values `sp_mixed_hellion`) was given with
   this sign-off.
3. **G1.** 2FA is on for the GitHub owner account and for Cloudflare (founder's statement, 2026-10-09). The founder
   confirmed on 2026-10-10 that the method is hardware security keys on both accounts. **CI-H1 closed 2026-10-09:** agents now push and
   open PRs as the machine account `cryoshield` (Write role, classic token with `repo` scope only, expiring
   2027-01-07, held in the founder's macOS keychain). Its no-op probes were run on 2026-10-09:
   - **blocked:** workflow-permission and repository-setting writes (403/404), the ruleset view (404), a push to
     `main`, and pushes of the tags `v0.0.0-probe`, `probe-1` and `V0.0.1-probe`;
   - **allowed:** listing secret names (values are never readable), and a draft release, which was deleted and created
     no tag. A release published by this account cannot deploy: `deploy.yml` runs only when
     `triggering_actor == repository_owner`.

   `cryoshield` was added to `.github/trusted-authors.json` by the owner (PR #81, 2026-10-10). Task 1.4 was run on
   2026-10-10 as a dry run as the owner: `apply.sh --with-ecc-review --environments --founder-hardening` exits 0, with
   both rulesets, the merge settings, the workflow permissions, fork approval and all four environments **in sync**.
   **G1 closed 2026-10-10.**
4. **G7.** The founder confirms the calendar reminders: daily checks for the first 14 days, weekly after that, and
   monthly. Also a reminder 30 days before the policy end date (2027-10-02), and before the domain and
   `security.txt` dates (September 2027).
5. **CAA (pre-production M1). Closed 2026-10-10:** `dig +short CAA cryoshield.app` returns exactly
   `0 issue "letsencrypt.org"` and `0 issuewild ";"`, after Universal SSL was disabled. Keep Universal SSL **off**:
   re-enabling it brings Cloudflare's CAs back. (Cloudflare 2FA: on, per the founder's statement, 2026-10-09; see G1.)
6. **G8 (rollback).** Save the four current `production-build` values offline, with the testnet `VITE_BUNDLER_URL`
   taken from the Pimlico dashboard, and confirm `v1.0.0`'s commit is green on the dev site.
7. **G5 and `launch-op-mainnet` section 3 (recovery tool).** Tasks 3.1–3.4 are unticked (the
   `feat/mainnet-recovery-default` branch is held for task 7.3). Close them through tasks 7.3 and 7.4 (the preset
   from `10.json`, a tool release with published hashes), then 7.8 (unlock the founder's mainnet vault from public
   RPCs and from Arweave). This sits after the deploy by design, but it must be closed before the soft-launch window
   ends and before any announcement.
8. **G10 and G11.** CI on `v1.0.0` passes `verify-build` for chain 10 and chain 11155420 against the real `10.json`. On
   launch day, re-check the chain facts and that the deployer holds at least 0.001 ETH (task 1.1).
9. **Task 1.3.** The launch record's G6 and G9 rows are dated and signed, and this entry is signed, before the
   `10.json` PR.
10. **Fixed padding O3. Closed 2026-10-10:** accepted by the founder and implemented in #85 (`pad-to-max-payload`;
    format version unchanged, decoders accept both paddings). Live on dev: the founder's vault saves at the padded
    size (1,018 bytes with 2 keys, 999 bytes with 3).
11. **Tabletop gaps G2–G6** ([`tabletop-2026-10-08.md`](tabletop-2026-10-08.md)). Founder decisions, 2026-10-10:
    - **G2, accepted for launch:** users cannot check which bundle they loaded. Each release's tree hash is already
      in `/release.json`. Follow-up after launch: publish it in the GitHub Release notes.
    - **G3, accepted:** no notice is shown while production is scaled to 0. The GitHub advisory and the README carry
      the incident notice.
    - **G4, closed:** the pause and resume procedure is written in `apps/web/docs/paymaster-policy.md` (docs PR
      after #83).
    - **G5, closed 2026-10-10:** the expected DNS and registrar state is in `apps/web/deploy/README.md` §4–5, the live
      CAA matches it, and it is now part of every six-monthly review (header of this log).
    - **G6, accepted in writing:** one maintainer (bus factor). Mitigation: users never depend on the maintainer.
      Vaults stay readable from public RPCs or Arweave, and the open-source recovery tool works without CryoShield.
      An "if the maintainer is unavailable" note is in `docs/deploy.md`, in the same docs PR as G4.
12. **Pre-production L1–L3.** **L1 closed:** SHA pinning is required, and it was in sync on 2026-10-10; all
    `uses:` refs on `main` are full commit SHAs or local paths. **L2 closed:** Dependabot security updates are on
    (2026-10-10). **L3 accepted:** GitHub reports secret-scanning validity checks as unavailable on this plan;
    gitleaks runs on every PR.
13. **Sanctions stance for mainnet: closed 2026-10-10.** The founder confirmed that `legal-analysis.md` §6 applies
    unchanged to OP Mainnet: eligibility through the terms only, no screening and no geoblocking. §6 now states the
    D8 bound ($0.50 per operation, $1 per user per month).

**Pre-release check, 2026-10-12** (read-only, agent; nothing changed):

- `main` `36842e3`: CI and the dev deploy green; dev serves `main`'s head. Changes since this draft: #85 padding,
  #86 hardware results, #87 `/lost-key` guide, #88 outdated-tab guard.
- `openspec validate --all --strict`: all changes pass. Dependency audits (web and recovery tool): no known
  vulnerabilities; gitleaks and osv-scanner run in CI.
- Recovery tool: 921 tests pass; it reads the founder's dev vault from public RPCs (version 11, 3 keys, 999 bytes).
- `cryoshield.app`: CAA Let's Encrypt only, wildcard blocked; certificate Let's Encrypt, expires 2026-12-31 (auto
  renew); production still serves the 2026-10-05 OP Sepolia build, as planned.
- OP Mainnet (read-only RPC): chain id 10; the CREATE2 deployer, EntryPoint v0.6 and Pimlico's paymaster have code;
  CryoShield's predicted addresses are empty; deployer `0x3314…26bf` holds 0.005 ETH, nonce 0.
- GitHub: `production` and `production-build` accept only `v*` tags; the `release-tags` ruleset is active; no tags or
  releases exist. `production-build` still holds the testnet values by design (set on launch day, after G8).
- `feat/mainnet-recovery-default` @ `40b5cc1` pushed to origin 2026-10-12; it merges cleanly with `main` and ships
  with the `10.json` PR (G5).

Not checked here, and left to the owner: anything that needs a dashboard or a credential (Pimlico, Cloudflare,
GoDaddy, Fly, GitHub settings), running the incident runbook's commands, and the live chain facts.

**Next review due:** a new `mainnet-gate` entry if `10.json` has not merged by 2026-11-08; otherwise the six-monthly
review by 2027-04-08.

**Sign-off:** Signed: prix0007, 2026-10-12. I accept this entry and the re-scored risk register, the sanctions stance in §6 holds for mainnet, and I approve the D8 sponsorship values.

## 2026-10-08: claims-check (reviewer: frontend engineer agent, add-theme-switch)

Founder decision 2026-10-08: a Theme menu (System, Light, Dark) whose choice is remembered in the browser. That made
the "nothing is stored on your device" claims untrue, so `/privacy` and `/cookies` were revised (effective date
"2026-10-08 (revision 3)") and checked against the shipped code:

| Page | Was | Now | Source |
|---|---|---|---|
| /cookies | "No page stores anything on your device"; meta description "stores nothing on your device" | no cookies; a page never stores anything by itself; picking Light or Dark keeps one key, `cryoshield-theme` (`light` or `dark`), never sent anywhere, removed by choosing System or clearing the site's data; a new "Saved only if you choose it" table | `legal/storage-inventory.json` `preferences`; `src/theme/theme-init.js` |
| /privacy | no section on device storage; /support "stores nothing on your device" | new "On your device" section with the same facts; /support "stores nothing in your browser except the optional theme choice" | as above |
| /cookies | consent trigger: "browser storage that is not strictly necessary" | "...not strictly necessary and that you did not ask for yourself (the theme setting is saved only when you pick it)" | the key is written only on an explicit choice |

Enforcement checked: `verify-build` allows `localStorage` only in the one theme script every page references
(`storageApiOutsideAllowedFiles`), still refuses every other storage API, and checks each page loads exactly that
script; E2E `08-legal.spec.ts` sweeps every route before a choice (nothing stored), after Dark (only
`cryoshield-theme`) and after System (nothing); E2E `19-theme.spec.ts` checks no request carries the key or value.
`data-inventory.md` (row 1 and "Browser-side device storage"), `erasure-procedure.md` and `legal-analysis.md` updated
to match. Not legal advice.

## 2026-10-08: claims-check, six-monthly (reviewer: security-reviewer agent)

First review, as part of rescoping `add-privacy-and-compliance` to the open-source project (founder decision
2026-10-08: "It's OSS so no company and legal").

**Claims check (task 3.6).** Every security claim on `/privacy`, `/terms` and `/cookies` was checked against
`openspec/specs` (`vault-web-app`, `hardware-key-auth`, `vault-crypto`, `project-contact`, `web-hosting`) and the
review records in `docs/reviews/` (`on-chain-confidentiality-2026-10`, `security-audit-2026-10`,
`enforce-credprotect-uv`, `harden-gas-sponsorship`, `vault-list-labels-archive`, `product-metrics`, `add-donation`).
Inaccuracies found and fixed (commit "fix(legal): make every security claim ..."; pages now dated 2026-10-08):

| Page | Was | Now | Source |
|---|---|---|---|
| /privacy | "unreadable without one of your keys" | one of your enrolled keys **and** its PIN (or fingerprint) | `hardware-key-auth` UV + credProtect 3; confidentiality review §3 |
| /privacy | vault names not mentioned | secrets, labels **and the vault name** are encrypted | payload v2, `vault-list-labels-archive` |
| /privacy | public list omitted earlier versions, each key's P-256 public key, the registry contract, locator linkability, the size range and the Arweave upload address | all listed | confidentiality review §1, F3, F6 |
| /privacy | account described only as "account address" | a CryoShield smart account controlled only by the keys; every change needs a key and its PIN | `harden-gas-sponsorship` (UV and `sha256(rpId)` on every path) |
| /privacy | key material "in memory for a moment and then wiped" | PRF wiped after use; open vault cleared on Lock, 5 min idle, page hide | `vault-web-app` "Secrets in memory only with auto-lock" |
| /privacy | statistics job not disclosed | disclosed: public data only, weekly, < 3 suppressed, 90-day artifact | `product-metrics` review |
| /privacy, /terms | 2026-10-05 "Donations" sections added without changelog entries | entries added | spec `legal-pages` "Versioned legal text" |
| /terms | PIN not mentioned | each key needs its PIN to open or change a vault | as above |
| /cookies | table implied it covers every page | says which pages the sweep visits and that the build scans every shipped script | `verify-build.mjs` storage scan |

Confirmed accurate, unchanged: no cookies or storage (true at this review; since add-theme-switch, later the same
day, the only storage is the optional theme preference, see the entry above); no request logs (container test); landing-only beacon with
GPC/DNT suppression and SRI; testnet and not independently audited; non-custodial, no recovery after all keys are lost;
opening never depends on sponsorship; Fly in Singapore; GitHub-only contact; operator and Grievance Officer wording
(`project-contact`).

**Six-monthly items.** `data-inventory.md` completed (rows 5, 7, 12 and 13; vendor terms relied on publicly);
`subprocessors.md` and `retention.md` updated for the OSS project; `risk-register.md` written (16 risks, all scored
and owned; sign-off pending); `security.txt` `Expires` 2027-09-30 (> 90 days away). Tabletop run
([`tabletop-2026-10-08.md`](tabletop-2026-10-08.md)); gaps G2–G6 are proposed issues for the maintainer.

**CI change review (task 9.2).** `.github/scripts/mainnet-gate.mjs` reads only repository files and the PR's
added-file list; it uses no secret, token or network. It runs in `pr-checks` (`contents: read`), with PR data reaching
it only as a file produced by `git diff`. "Mainnet" is fail-closed: any chain id that is not a local or testnet preset
counts, and an unknown id fails. A parity test ties the allow-list to `contracts/script/deploy.sh`. Gate scripts
390/390 tests, `workflow-policy.mjs` OK. Residual: only *added* records are gated; editing an existing mainnet record
is reviewed through the normal PR flow.

**Next review due:** by 2027-04-08, or at the `mainnet-gate`, whichever comes first.

**Maintainer sign-off:** ______________________ (date: __________)
