# Launch record: OP Mainnet (`launch-op-mainnet`)

> The go/no-go record for moving https://cryoshield.app from OP Sepolia to OP Mainnet (chain 10). CI's mainnet gate
> (`.github/scripts/mainnet-gate.mjs`) requires this file to exist before a PR may add `contracts/deployments/10.json`.
> No secrets are recorded here.

## Founder decisions (2026-10-09)

| # | Question | Decision |
|---|---|---|
| Q1 / G6 | Audit | **Launch unaudited; no contract audit is planned** (founder: "No audit on contracts"). Every page on chain 10 says "not been independently audited", and no page promises an audit (denylist `AUDIT_PROMISES`). |
| Q2 | Recovery tool default network | `op-mainnet` from the launch release; `--testnet` reads OP Sepolia; the tool always prints the network. |
| Q3 | Compliance gate | Answered 2026-10-08 ("It's OSS so no company and legal"): the gate is the `mainnet-gate` review-log entry (G9). |
| Q4 | Testnet vaults | No migration; a 90-day notice; testnet-preview vaults stay readable with the recovery tool `--testnet`. |
| Q5 | Exposure | 7-day soft launch with daily monitoring before any announcement. |
| D8 | Pimlico mainnet policy | `sp_mixed_hellion` ("CryoShield App (Prod)"), chain 10 only: per user $1 and 10 operations, reset **monthly**; global $30 and 500 operations, reset **daily**; $0.50 per operation; 2026-10-10 to 2027-10-02. Disabled; enabled only after the deploy's smoke test. Live values recorded 2026-10-10 (task 1.2) in `apps/web/docs/paymaster-policy.md`. History: the first policy, `sp_many_longshot`, was deleted and replaced on 2026-10-10 because it had been created with resets "never" (lifetime limits). |
| D3 | Sequencing | **B**: set the mainnet `production-build` values before the first `v*` tag; `vA` deploys straight to chain 10 (no OP Sepolia release of `vA`). Risks and rollback paths in design D3/D4. |

## Go/no-go (G1–G11)

Status as of 2026-10-09; the owner fills in evidence and dates on launch day (task 7.1). Launch only when every row
is done.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| G1 | Human production gate; CI-H1; owner 2FA | Release gate in place (`release-tags` now `~ALL`, applied 2026-10-09; `apply.sh` in sync). CI-H1 and owner 2FA: **owner to confirm** | |
| G2 | Dev not under `cryoshield.app` | `dev.cryoshield.app` NXDOMAIN (checked 2026-10-09) | |
| G3 | `harden-gas-sponsorship` review and testnet proof | Review 7.1 APPROVE; tasks 6.2–6.4 and 8.1 **open** (founder's YubiKey run on dev) | |
| G4 | Pimlico mainnet settings | **Recorded 2026-10-10; balance amount and no-card pending founder.** Policy `sp_mixed_hellion` per D8 (Disabled until runbook step 8); dedicated key `cryoshield-mainnet`: origin `cryoshield.app` only, bundler on, "verifying paymaster" off (policy-scoped sponsorship only), account APIs and boost off; `harden-gas-sponsorship` task 1.1 answered. Pending: the prepaid amount and no card on the account (founder), and the testnet check that policy-scoped sponsorship works with "verifying paymaster" off | `apps/web/docs/paymaster-policy.md` §3–4 (2026-10-10) |
| G5 | Recovery tool on mainnet | Open until `10.json` and the regenerated preset (task 7.3/7.4) | |
| G6 | Audit decision | **Done**: see Q1 above | this file |
| G7 | Monitoring ready | Runbook thresholds in `apps/web/docs/paymaster-policy.md` (task 5.3); founder calendar reminders **to confirm** | |
| G8 | Rollback ready | Open: save the four current `production-build` values offline and the testnet bundler URL from the Pimlico dashboard; `vA`'s commit green on dev | |
| G9 | Compliance `mainnet-gate` entry | **Open**: a `mainnet-gate` entry in `docs/compliance/review-log.md` (within 30 days), risk register re-scored and signed | |
| G10 | Copy and build | Chain-10 and chain-11155420 builds pass `verify-build` and the section-4 copy tests (6.1 evidence below); confirmed again by CI on `vA` | |
| G11 | Chain facts on the day; deployer ≥ 0.001 ETH | Re-run on launch day | |

## 6.1 Pre-launch security review

- **Date:** 2026-10-09 (round 2, after fixes)
- **Reviewer:** security-reviewer (agent), read-only; no transaction, push or edit.
- **Scope:** `launch-op-mainnet` sections 2–5 on `feat/mainnet-contract-tooling` @ `95eabb9`, `feat/mainnet-recovery-default` @ `40b5cc1`, `feat/mainnet-honest-copy` @ `b99b490`, each diffed against `main` @ `a59a179`; design D1–D8, go/no-go G1–G11. Round 1 reviewed `7527e99`, `6330ed3`, `320701d`.
- **Verdict:** **APPROVE. No open CRITICAL or HIGH.** Remaining before go (not findings): the founder records the live `sp_many_longshot` values at task 1.2 (G4); G3 is still open. *(2026-10-10: that policy was replaced by `sp_mixed_hellion`; see D8.)*

### Evidence

| Area | Command | Result |
|---|---|---|
| Deploy guards | `contracts/script/test-deploy-args.sh` | 140 passed |
| Etherscan script | `contracts/script/test-verify-etherscan.sh`; mutations on scratch copies | 102 passed; removing the key-like argument check fails 8 tests; dropping `curl -q` fails 1 |
| Recovery tool | `uv run --frozen pytest -q`, `ruff`, `mypy --strict` | 902 passed (5 opt-in skips); clean |
| Web | `vitest run`, `tsc --noEmit`, `eslint` | 1424 passed; clean |
| Specs | `openspec validate --all --strict` | 36/36 |
| Chain-10 build | production build against the test-only fixture record, output searched | no testnet wording; no audit promise; unaudited and all-keys-lost present; RPC row `mainnet.optimism.io`; CSP origins all in `docs/compliance/origins.json` |
| /app initial JS | verify-build on the chain-10 build | 206,555 B of a 206,977 B cap |

### Round-1 findings: status

| # | Sev | Finding | Status |
|---|---|---|---|
| H1 | HIGH | D8 policy without resets contradicted the `gas-sponsorship` spec; refusal copy untrue | **Resolved**: per-user monthly and global daily resets; $0.50/op as a MODIFIED "Sponsorship limits"; chain-10 refusal copy truthful, specified and tested. Live values: founder, task 1.2 (G4). |
| H2 | HIGH | Donations promised "an independent audit" | **Fixed**: "gas sponsorship and hosting"; MODIFIED `donation` "Support page"; `AUDIT_PROMISES` denylist on every public page and `llms.txt`, both chains. |
| M1 | MED | Recovery README claimed mainnet before launch; unpinned git install | **Fixed**; the branch is held for the `10.json` PR (task 7.3). |
| L1–L8 | LOW | Gate value, `curl -q`, mutation coverage, "stored permanently", "audited yet", chain-10-only exception, RPC policy link, rollback note | **Fixed**. |
| N1 | LOW | Mainnet starting values in the MODIFIED requirement differed from the founder's | **Fixed** (`7de4ce1`). |
| N2 | LOW | "Limits reset over time" not true for an empty balance or after the policy window | Accepted; monitoring (balance < $50, R17) covers it. |
| N3–N4 | INFO | One same-meaning merge conflict; ~400 B /app headroom | Noted. |

### Checked and clean

D1 guard before any RPC call (RP ID `cryoshield.app` only, no v1 on chain 10, address parity, `DEPLOY_RECORDS_DIR`
refused on broadcast, gate `approved:10` fail-closed); `verify-etherscan.sh` keeps the key out of argv, child
environments, files, logs and errors; copy honest on both chains; recovery parity and lookup-off without `10.json`;
Sequencing B's rollback paths work as described; no CryoShield server, admin key or new runtime dependency.

## Launch-day log

_Filled in on the day (tasks 7.1–7.10): chain facts, deploy and verification transactions, `10.json` PR, release,
smoke, founder YubiKey smoke, recovery test, Pimlico check, soft-launch monitoring._

## Sign-off

- Founder go decision: ____________________ (date: __________)
