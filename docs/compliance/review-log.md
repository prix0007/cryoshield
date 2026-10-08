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

## 2026-10-08: claims-check, six-monthly (reviewer: security-reviewer agent)

First review, as part of rescoping `add-privacy-and-compliance` to the open-source project (founder decision
2026-10-08: "It's OSS so no company and legal").

Details are filled in below.

**Maintainer sign-off:** ______________________ (date: __________)
