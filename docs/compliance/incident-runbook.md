# Incident runbook

> `add-privacy-and-compliance` task 6.2, design D11; spec `privacy-compliance` "Breach and incident response".
> CryoShield is an open-source project maintained by its contributors; there is no company (founder decision
> 2026-10-08). Not legal advice. Commands come from [`docs/deploy.md`](../deploy.md); if they differ, `deploy.md` wins
> and this file is updated.

**One rule above all: we never ask anyone for secrets, seed phrases, recovery codes, PINs or keys, and we cannot act
on a vault.** Every public notice repeats this, because incidents attract phishing.

## 1. Roles

| Role | Who | Notes |
|---|---|---|
| Incident lead (on call) | the maintainer (repository owner, `prix0007`) | the only person who can release, roll back production, rotate production secrets and publish advisories |
| Security reviewer | security-reviewer agent, or any contributor the lead asks | assesses impact, reviews the fix; never touches production |
| Agents | machine account | may prepare fix PRs and drafts; never deploy, tag or change settings (CLAUDE.md) |

Reports arrive through GitHub private vulnerability reporting (`SECURITY.md`), issue triage (`security` label), the
weekly `deployments-check` issue, or a failed deploy/smoke run.

## 2. Severity

| Level | Examples | Response |
|---|---|---|
| **SEV1** | a modified bundle served from `cryoshield.app`; DNS, registrar, Fly, GitHub owner or release takeover; any path that exposes PRF outputs, data keys or plaintext | start §3 at once; public notice the same day |
| **SEV2** | vendor breach exposing our users' IPs or account addresses (Fly, Pimlico, RPC, Turbo, Cloudflare); paymaster drained or policy bypassed; a leaked deploy or Pimlico key with no sign of use; compromise of the dev site only (`cryoshield-web-dev.fly.dev`, a different RP ID) | contain within 24 h; advisory within 72 h if users are affected |
| **SEV3** | contained, no user impact (a blocked attempt, a fixed bug with no exposure) | fix through the normal PR flow; note in the review log |

## 3. SEV1 steps

Record every action with its UTC time in the incident log (a private security advisory on the repository is the log;
create it first).

1. **Contain** (minutes):
   - take production offline: `fly scale count 0 --app cryoshield-web`. Vaults are on-chain and the desktop recovery
     tool keeps working, so this costs availability only;
   - stop new deploys: `gh workflow disable deploy.yml` and `gh workflow disable deploy-dev.yml`;
   - if the write path is involved, stop gas sponsorship: disable the sponsorship policy in the Pimlico dashboard, or
     revoke the API key. The app then shows "Saving is paused"; vaults stay readable
     (`apps/web/docs/paymaster-policy.md`).
2. **Preserve evidence** (before changing anything else):
   - `curl -s https://cryoshield.app/release.json` (if still up) and `fly releases --app cryoshield-web --image --json`.
     `release.json` is served by the site itself, so a malicious image can fake it: line up every release in
     `fly releases` (time and image) with the `fly deploy` step of a `deploy.yml` run at that time
     (`gh run list --workflow deploy.yml`). A release with no matching run was deployed outside the pipeline (a
     leaked Fly token);
   - the GitHub audit log (owner settings → Security log), recent workflow runs (`gh run list --workflow deploy.yml`),
     tags and releases (`gh release list`), and ruleset and environment settings;
   - the registrar and DNS records (GoDaddy and Cloudflare audit logs, `dig cryoshield.app A AAAA CAA NS DS`);
   - save them outside GitHub and Fly.
3. **Cut off the attacker:** rotate the Fly tokens (`docs/deploy.md` → Rotating the Fly tokens), the Pimlico API key,
   and any GitHub token or SSH key that could be involved; review collaborators and the machine account; check
   2FA on GitHub, Fly, Pimlico, Cloudflare and GoDaddy.
4. **Establish the exposure window:** from the first bad release or DNS change to containment, using the evidence in
   step 2. Anyone who **unlocked or created a vault on `cryoshield.app` in that window** must be treated as exposed:
   a malicious page sees the PRF output at the tap, and one capture decrypts every past and future version of that
   vault (review F1).
5. **Restore a known-good site:** fix forward with a new release, or redeploy the last good tag:
   `gh workflow run deploy.yml --ref <last good vX.Y.Z>` (runs that tag's full CI, then deploy and smoke), then
   `fly scale count 1 --app cryoshield-web` if the deploy does not restore the machine count. Check
   `curl -s https://cryoshield.app/release.json` names the expected commit. A rollback cannot fix DNS, certificates
   or Fly app settings: fix those by hand first.
6. **Tell users** (§4) the same day. Do not wait for the full analysis.
7. **Re-enable** deploy workflows and sponsorship only after the security reviewer agrees the cause is closed.
8. **Post-mortem** within 14 days: timeline, cause, what worked, what did not; publish it in the advisory; file each
   follow-up as an issue; add an `incident` entry to [`review-log.md`](review-log.md).

## 4. Telling users

There are no accounts and no email list, so notice is public and repeated on every channel we have:

| Channel | How | When |
|---|---|---|
| GitHub Security Advisory | publish the advisory from step 1 (CVE if code is affected) | same day (SEV1), within 72 h (SEV2 with user impact) |
| README | a notice at the top of `README.md` | same day |
| Pinned issue | a pinned, locked issue linking the advisory | same day |
| The site itself | once a known-good release is live, a notice on the landing page and in the app shell; while offline, there is no site | when the site is back |
| In-app notice | shown after unlock for vaults whose last write falls in the window, if that can be detected from public data | with the fixed release, if feasible |

### Notice template (SEV1, malicious page)

> **Security notice: [date]. If you unlocked or created a CryoShield vault on cryoshield.app between [start] and [end]
> UTC, assume the secrets in it are exposed.**
>
> What happened: [one sentence]. What we did: we took the site offline at [time], restored a verified release at
> [time], and rotated our deployment credentials.
>
> What you should do: move the secrets themselves: create a new wallet and move your funds, regenerate your recovery
> codes. Then, if you want, create a **new** vault with **newly enrolled** keys. Editing the old vault does not help:
> anyone who captured it can read every version.
>
> Vaults you did not open in that window are not affected. To read a vault without the website, use the open-source
> desktop recovery tool: [link].
>
> **We will never ask for your seed phrase, recovery codes, PIN or keys.** Anyone who does is not us.

## 5. External reporting (reference only)

Whether any of these duties reaches an unincorporated open-source project is an open question
([`legal-analysis.md`](legal-analysis.md) §9). The project's commitment is the public notice in §4. They are listed so
the clocks are known if the project's status ever changes.

| Regime | To | Clock (from awareness) |
|---|---|---|
| CERT-In Directions, 28 Apr 2022 | CERT-In (`incident@cert-in.org.in`) | 6 h |
| DPDP Rules 2025, Rule 7 (from ~13 May 2027) | Data Protection Board of India; affected Data Principals | without delay; detailed report 72 h |
| GDPR Art. 33/34; UK GDPR | supervisory authorities; data subjects if high risk | 72 h; without undue delay |
| US state breach laws | affected residents | varies (often 30–60 days); most exempt encrypted data |
| Vendors | Fly, Pimlico | per their terms |

## 6. Exercises

A tabletop exercise runs at least yearly and before mainnet. The first one:
[`tabletop-2026-10-08.md`](tabletop-2026-10-08.md).

## Sign-off

- Maintainer: ______________________ Date: __________
- Security reviewer: security-reviewer agent, 2026-10-08 (commands checked against `docs/deploy.md` and
  `.github/scripts/deploy/rollback.sh`)
