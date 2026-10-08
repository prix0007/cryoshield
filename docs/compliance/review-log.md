# Compliance review log

> `add-privacy-and-compliance`, spec `privacy-compliance` "Compliance records reviewed on a schedule". CryoShield is an
> open-source project maintained by its contributors; there is no company. Not legal advice.

The data-flow inventory, sub-processor list, retention statement, risk register and the three legal pages are
reviewed **at least every six months** and **before any mainnet deployment**. Each review adds one entry, newest
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
