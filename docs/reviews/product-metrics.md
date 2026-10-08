# Security review: product metrics (add-privacy-preserving-analytics, groups 1–2)

The CryoShield security reviewer reviewed branch `feat/onchain-metrics` (`tools/metrics`, `.github/workflows/metrics.yml`,
the CI `metrics` job, the `SCHEDULED_READ_ONLY` profile in `.github/scripts/workflow-policy.mjs`) in three read-only
passes on 2026-10-08.

**Verdict: APPROVE** (third pass, at `d5db540`). Its last LOW finding is fixed in the commit that adds this record.

## What was confirmed

- **Public data only:** the tool reads the preset RPCs and the configured Arweave gateways, with no secret, key, wallet
  or `.env`. Every RPC's chain ID is checked before any `eth_getLogs`.
- **No identifiers:** the report is scanned before it is written and refused if it holds any 20- or 32-byte hex value
  other than the registry addresses.
- **Supply chain:** every action is pinned by SHA; viem 2.57.2 was already in the lockfile, so no new packages;
  `onlyBuiltDependencies: []`; frozen-lockfile installs.
- **Workflow:** schedule and dispatch only, `contents: read`, no secrets or `github.token`, no persisted credentials,
  90-day artifact; it never commits, pushes or deploys.

## Findings and resolutions

- **MEDIUM (pass 1): `"<3"` cells were recoverable by subtraction** from totals, and by comparing successive weekly
  reports (including one operation's exact gas cost). **Resolution:** on public networks the run stops at the last
  complete ISO week. Time series are merged chronologically into week ranges of at least 3 vaults or accounts, and a
  range is identical in every later report. The open range is only `"<3"` and is part of no total. Excluded gas is
  reported as counts only.
- **MEDIUM (pass 1): mirror coverage was never suppressed.** **Resolution:** 1–2 unmirrored vaults are shown only as
  bounds.
- **MEDIUM (pass 2): running snapshots could be differenced** between reports to one vault's key change or mirror
  status. **Resolution:** snapshots are published per closed creation cohort and frozen at its close: key counts read
  at the cohort's last block, categories merged within the cohort, and mirror coverage counting only items mined
  within 28 days of the close (`"pending"` until then).
- **LOW (passes 1–3): the scheduled-workflow policy could be bypassed** (`git -c`, `/usr/bin/gh`, `&`, `cat x | node`,
  `node --eval=`, `pnpm create`/`run`, `>> $GITHUB_ENV`, `NODE_OPTIONS` and `npm_config_*` env, `github.token`,
  `actions/github-script`). **Resolution:** the policy uses allow-lists. Only four actions are allowed. A `run` step may
  be only `node <script file>`, `pnpm install --frozen-lockfile`, `pnpm --filter @cryoshield/<pkg> metrics|test|typecheck`
  or `echo`. Redirection, command substitution, `GITHUB_ENV`/`GITHUB_PATH` writes, hijacking env and package-manager
  config env are all rejected. Each bypass has a test.
- **LOW: unbounded HTTP bodies, a timeout that ended at the headers, open redirects, and `::` workflow commands in RPC
  error text.** **Resolution:** `src/http.ts` adds streamed byte caps and a timeout that covers the body. RPCs follow no
  redirects; gateways follow only https redirects on their own domain. Remote messages are cleaned.

## Accepted residuals

- A hostile RPC can fabricate logs and inflate counts. That is an accuracy issue, not a privacy one; the public
  defaults are well-known RPCs.
- A gateway that indexes an old Arweave item late can change a closed cohort's coverage once, and only a count that is
  already at least 3, or a bound.
