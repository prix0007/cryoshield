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
| D3 | Sequencing | **B**: set the mainnet `production-build` values before the first `v*` tag; `v1.0.0` deploys straight to chain 10 (no OP Sepolia release of `v1.0.0`). Risks and rollback paths in design D3/D4. |

## Go/no-go (G1–G11)

Status as of 2026-10-12; the owner fills in evidence and dates on launch day (task 7.1). Launch only when every row
is done.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| G1 | Human production gate; CI-H1; owner 2FA | Release gate in place (`release-tags` now `~ALL`, applied 2026-10-09; `apply.sh` in sync). 2FA on GitHub and Cloudflare: hardware security keys (founder, 2026-10-09/10). CI-H1: closed 2026-10-09 (machine account `cryoshield`, Write; probes in the mainnet-gate entry). **Rechecked 2026-10-12:** founder ran `apply.sh --with-ecc-review --environments` (no diff); machine account `cryoshield` has `admin: false, maintain: false, push: true` | |
| G2 | Dev not under `cryoshield.app` | `dev.cryoshield.app` NXDOMAIN (checked 2026-10-09). **Rechecked 2026-10-12:** no A, AAAA or CNAME record (founder and agent) | |
| G3 | `harden-gas-sponsorship` review and testnet proof | **Done 2026-10-12.** Review 7.1 APPROVE. 6.2, 6.3 and 6.4 done (#86): create, edits, add-key of a third key (tx `0x6180e582…`, 502,562 gas) and a padded 3-key save (tx `0x8328747f…`, v11, 999 B), all Pimlico-sponsored on dev; UV=0 refusal by fork simulation; v1 items waived. Founder accepted (2026-10-12) that no save is yet signed by the new key alone. D8 values approved by the founder 2026-10-12 with the G9 sign-off; 8.1 (approval to deploy) **open** until the D6 trigger review is recorded | `apps/web/docs/hardware-test.md`, `contracts/GAS.md` |
| G4 | Pimlico mainnet settings | **Done 2026-10-10 (#83).** Policy `sp_mixed_hellion` per D8 (Disabled until runbook step 8); key `cryoshield-mainnet`: origin `cryoshield.app` only, bundler on, "verifying paymaster" off, account APIs and boost off; $120 prepaid, no card. Task 1.1 (a): policy-scoped sponsorship with "verifying paymaster" off verified on the dev key (2026-10-10/11, #86) | `apps/web/docs/paymaster-policy.md` §3–4 |
| G5 | Recovery tool on mainnet | Open until `10.json` and the regenerated preset (task 7.3/7.4). Branch `feat/mainnet-recovery-default` @ `40b5cc1` pushed to origin 2026-10-12; merges cleanly with `main` | |
| G6 | Audit decision | **Done**: see Q1 above. Signed 2026-10-12 with the `mainnet-gate` sign-off, which restates the decision | this file |
| G7 | Monitoring ready | Runbook thresholds in `apps/web/docs/paymaster-policy.md` (task 5.3); founder calendar reminders **to confirm** | |
| G8 | Rollback ready | Open: save the four current `production-build` values offline and the testnet bundler URL from the Pimlico dashboard; `v1.0.0`'s commit green on dev | |
| G9 | Compliance `mainnet-gate` entry | **Signed 2026-10-12** by the founder (entry dated 2026-10-09). The `mainnet-gate` entry in `docs/compliance/review-log.md` is dated 2026-10-09; its CI window ends 2026-11-08. The risk register is re-scored. Both are signed. The entry's launch-day conditions (G7, G8, G5, G10, G11) stay open until closed in this record | [review-log 2026-10-09 entry](../compliance/review-log.md#2026-10-09-mainnet-gate-reviewer-prix0007), [risk register](../compliance/risk-register.md) |
| G10 | Copy and build | Chain-10 and chain-11155420 builds pass `verify-build` and the section-4 copy tests (6.1 evidence below); confirmed again by CI on `v1.0.0` | |
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

- G9 and D8 sign-off (2026-10-12), in the founder's words: "Signed: prix0007, 2026-10-12. I accept this entry and the re-scored risk register, the sanctions stance in §6 holds for mainnet, and I approve the D8 sponsorship values."
- Founder go decision: _pending (task 7.1: G5, G7, G8, G10 and G11 are open)_
