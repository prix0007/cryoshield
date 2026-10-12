# Launch record: OP Mainnet (`launch-op-mainnet`)

> The go/no-go record for moving https://cryoshield.app from OP Sepolia to OP Mainnet (chain 10). CI's mainnet gate
> (`.github/scripts/mainnet-gate.mjs`) requires this file to exist before a PR may add `contracts/deployments/10.json`.
> No secrets are recorded here.

## Founder decisions (2026-10-09)

| # | Question | Decision |
|---|---|---|
| Q1 / G6 | Audit | **Launch unaudited; no contract audit is planned** (founder: "No audit on contracts"). At launch (`v1.0.0`) every page on chain 10 said "not been independently audited". Since `trim-landing-cta-audit-note` (#104, founder 2026-10-13) the mainnet audit status sits in the footer legal line on every page, `/terms` and `/privacy`. No page promises or claims an audit (denylist `AUDIT_PROMISES`). |
| Q2 | Recovery tool default network | `op-mainnet` from the launch release; `--testnet` reads OP Sepolia; the tool always prints the network. |
| Q3 | Compliance gate | Answered 2026-10-08 ("It's OSS so no company and legal"): the gate is the `mainnet-gate` review-log entry (G9). |
| Q4 | Testnet vaults | No migration; a 90-day notice; testnet-preview vaults stay readable with the recovery tool `--testnet`. |
| Q5 | Exposure | 7-day soft launch with daily monitoring before any announcement. |
| D8 | Pimlico mainnet policy | `sp_mixed_hellion` ("CryoShield App (Prod)"), chain 10 only: per user $1 and 10 operations, reset **monthly**; global $30 and 500 operations, reset **daily**; $0.50 per operation; 2026-10-10 to 2027-10-02. Disabled; enabled only after the deploy's smoke test. Live values recorded 2026-10-10 (task 1.2) in `apps/web/docs/paymaster-policy.md`. History: the first policy, `sp_many_longshot`, was deleted and replaced on 2026-10-10 because it had been created with resets "never" (lifetime limits). |
| D3 | Sequencing | **B**: set the mainnet `production-build` values before the first `v*` tag; `v1.0.0` deploys straight to chain 10 (no OP Sepolia release of `v1.0.0`). Risks and rollback paths in design D3/D4. |

## Go/no-go (G1–G11)

Status as of 2026-10-13; the owner fills in evidence and dates on launch day (task 7.1). Launch only when every row
is done.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| G1 | Human production gate; CI-H1; owner 2FA | Release gate in place (`release-tags` now `~ALL`, applied 2026-10-09; `apply.sh` in sync). 2FA on GitHub and Cloudflare: hardware security keys (founder, 2026-10-09/10). CI-H1: closed 2026-10-09 (machine account `cryoshield`, Write; probes in the mainnet-gate entry). **Rechecked 2026-10-12:** founder ran `apply.sh --with-ecc-review --environments` (no diff); machine account `cryoshield` has `admin: false, maintain: false, push: true` | |
| G2 | Dev not under `cryoshield.app` | `dev.cryoshield.app` NXDOMAIN (checked 2026-10-09). **Rechecked 2026-10-12:** no A, AAAA or CNAME record (founder and agent) | |
| G3 | `harden-gas-sponsorship` review and testnet proof | **Done 2026-10-12.** Review 7.1 APPROVE. 6.2, 6.3 and 6.4 done (#86): create, edits, add-key of a third key (tx `0x6180e582…`, 502,562 gas) and a padded 3-key save (tx `0x8328747f…`, v11, 999 B), all Pimlico-sponsored on dev; UV=0 refusal by fork simulation; v1 items waived. Founder accepted (2026-10-12) that no save is yet signed by the new key alone. D8 values approved by the founder 2026-10-12 with the G9 sign-off; 8.1 closed 2026-10-12: D6 reviewed (no new testnet users, no trigger) and the deploy approved by the founder (`harden-gas-sponsorship` design.md) | `apps/web/docs/hardware-test.md`, `contracts/GAS.md` |
| G4 | Pimlico mainnet settings | **Done 2026-10-10 (#83).** Policy `sp_mixed_hellion` per D8 (Disabled until runbook step 8; **in effect on mainnet by 2026-10-12 21:14 UTC**, see the first-vault entry); key `cryoshield-mainnet`: origin `cryoshield.app` only, bundler on, "verifying paymaster" off, account APIs and boost off; $120 prepaid, no card. Task 1.1 (a): policy-scoped sponsorship with "verifying paymaster" off verified on the dev key (2026-10-10/11, #86) | `apps/web/docs/paymaster-policy.md` §3–4 |
| G5 | Recovery tool on mainnet | **Done for the public-RPC path 2026-10-12/13; the Arweave path is still open (7.8).** `10.json` and the `op-mainnet` preset merged (#102, #103). The `recover-release.yml` dry run on `012c084` was green (run 38297212786). `v1.0.0` carries 7 files plus their `.sha256` files and `SHA256SUMS`; all pass `gh attestation verify`. `--version` prints `1.0.0`; with no flag the network is `op-mainnet`, v2 only. The founder unlocked a dev vault with `--testnet`, then the new mainnet vault with no network flag: "Cool recovery tool works and verified" (2026-10-13) | launch-day log below |
| G6 | Audit decision | **Done**: see Q1 above. The founder's 2026-10-12 sign-off accepts the `mainnet-gate` entry, which restates this decision (the quote does not name G6 separately) | this file |
| G7 | Monitoring ready | Runbook thresholds in `apps/web/docs/paymaster-policy.md` (task 5.3); founder calendar reminders: added by the founder 2026-10-12: the 2027-10-02 policy end, the daily (14 days), weekly and monthly checks, and the Fly token rotation before 2027-10-05. **Still to confirm:** the September 2027 domain and `security.txt` dates | |
| G8 | Rollback ready | **Done 2026-10-12.** The founder saved the four testnet `production-build` values offline, including the testnet bundler URL from the Pimlico dashboard (checklist 4.1). `v1.0.0`'s commit `012c084` was green on dev (deploy-dev) before the release | |
| G9 | Compliance `mainnet-gate` entry | **Signed 2026-10-12** by the founder (entry dated 2026-10-09). The `mainnet-gate` entry in `docs/compliance/review-log.md` is dated 2026-10-09; its CI window ends 2026-11-08. The risk register is re-scored. Both are signed. The entry's launch-day conditions (G7, G8, G5, G10, G11) stay open until closed in this record | [review-log 2026-10-09 entry](../compliance/review-log.md#2026-10-09-mainnet-gate-reviewer-prix0007), [risk register](../compliance/risk-register.md) |
| G10 | Copy and build | Chain-10 and chain-11155420 builds pass `verify-build` and the section-4 copy tests (6.1 evidence below); confirmed again by CI on `v1.0.0`: `deploy.yml` run 38307520254 green (full CI, chain-10 build, release, smoke), 2026-10-12 | |
| G11 | Chain facts on the day; deployer ≥ 0.001 ETH | **Done 2026-10-12.** P-256 precompile checked (block 158113739); the founder checked the other facts ("looks fine"); re-read by the agent at block 158120926, values in the launch-day log | launch-day log below |

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

- **2026-10-12, P-256 precompile (task 1.1, G11), run by the agent:** RIP-7212 at `0x100` on OP Mainnet, block
  158113739, 17:30 UTC. A fresh P-256 key signed a random SHA-256 hash; the 160-byte input returned
  `0x…0001`; the same input with the first hash byte changed returned `0x`. The other G11 chain facts were checked
  by the founder the same day ("looks fine"). Re-read by the agent, read-only, at block 158120926: chain ID 10;
  EntryPoint v0.6 `0x5FF137D4…2789` has code (23,689 bytes); the CREATE2 deployer `0x4e59b448…956C` has code (69
  bytes); Pimlico's paymaster `0x66666666…c68b` has code (15,138 bytes); deployer `0x33144f68…26bf` holds
  0.00499 ETH (≥ 0.001).
- **2026-10-12, contract deploy (task 7.2, runbook steps 1–2), by the founder:** simulation showed the three D1
  addresses, `v1: not deployed on op_mainnet (by design)` and "nothing sent"; then broadcast from deployer
  `0x33144f68…26bf` through the CREATE2 deployer:
  - VaultRegistryV2 `0xA622c92d3D5b54aeA081Cf410224a8A2eCb08cB7`, tx `0x11f22a39…ff44`, block 158114294, status 1;
  - `cryoshield.app` factory `0x775dc816594262274E78Ae75D97C8EdB0df5DfED` and implementation
    `0x8aA76FaA6629cA1EA8ccC3F9Edf0E8D98816Acd7`, tx `0x7de814ff…d358`, block 158114295, status 1.
- **2026-10-12, post-deploy checks (task 7.2), by the agent, read-only:**
  - runtime code at all three addresses is byte-identical to the reviewed OP Sepolia deployment at the same
    addresses (4,944, 1,798 and 16,722 bytes); `10.json`'s ABI hashes and `rpIdHash` equal `11155420.json`'s;
  - Sourcify: exact match for all three. Blockscout: all three fully verified (VaultRegistryV2 indexed at
    2026-10-12 17:53 UTC, after a short lag); Etherscan: not run (optional).
- **2026-10-12, security review of the `10.json` PR (task 7.3), by the agent:** the record matches the chain (above)
  and holds no v1; the CI mainnet gate passes on the 2026-10-09 entry. The recovery tool's `op-mainnet` preset lists
  exactly that v2 registry and block, marked built-in and trusted, and a user-supplied registry stays untrusted. Two
  recovery tests that used to target op-mainnet as an empty network would now reach the public OP Mainnet RPCs, so
  they moved to `arbitrum-sepolia` and stay offline. The broadcast logs hold transaction data only (no key material).
  No CRITICAL or HIGH findings.

- **2026-10-12, recovery tool dry run (task 7.4, checklist 3.2), run by the founder, checked by the agent:**
  `recover-release.yml` on `main` @ `012c084` (run 38297212786) green. The agent checked the artifact: 7 files, each
  matching its `.sha256` and `SHA256SUMS`; `--version` prints `cryoshield-recover 1.0.0 (vault format v1)`; the default
  network is `op-mainnet`; its preset lists only VaultRegistryV2 `0xa622…cb7` from block 158114294 (built-in,
  trusted), no v1. The founder then unlocked a dev vault on OP Sepolia with the macOS arm64 binary and `--testnet`.
- **2026-10-12, production values (task 7.5, checklist 4.2), by the founder; names checked by the agent:**
  `production-build` holds `VITE_CHAIN_ID=10`, `VITE_RPC_URL=https://mainnet.optimism.io`,
  `VITE_SPONSORSHIP_POLICY_ID=sp_mixed_hellion` and one secret, `VITE_BUNDLER_URL` (value not read); no repository-level
  `VITE_BUNDLER_URL` or `FLY_API_TOKEN`.
- **2026-10-12, release (task 7.5, runbook step 7), by the founder:** `v1.0.0` published 20:57 UTC on `012c084`.
  `deploy.yml` run 38307520254 green (full CI, chain-10 build, `release`, smoke); Fly release v16.
  `recover-release.yml` run 38307519843 green and attached 15 files (7 binaries and archives, 7 `.sha256` files and `SHA256SUMS`). The agent checked:
  - `https://cryoshield.app/release.json`: commit `012c084`, `chainId` 10, `rpId` `cryoshield.app`, `registry: null`,
    v2 `0xA622…cB7` from block 158114294, the D1 factory and implementation;
  - the landing page names OP Mainnet with no testnet banner, and showed "not been independently audited" (7 matches in
    the served HTML) and "OP Mainnet" (10 matches), as the original 7.5 criterion asked. The copy later moved to the
    footer, `/terms` and `/privacy` by #104, which ships with the next release;
  - the release's 7 files match `SHA256SUMS`, and all 7 pass `gh attestation verify`. Six are byte-identical to the
    dry run. `cryoshield-recover-macos-x86_64` is not (same size, ad-hoc signed, matches its own checksum, prints
    `1.0.0`, defaults to `op-mainnet`): the Intel macOS build is not yet reproducible. Follow-up [#106](https://github.com/prix0007/cryoshield/issues/106), not a launch blocker;
  - Fly: both machines on v16 (one running and passing `/healthz`, one suspended by `auto_stop`); certificates
    issued for `cryoshield.app` and `www`; `www`, `http://` and `cryoshield-web.fly.dev` redirect to
    `https://cryoshield.app/`; strict CSP, HSTS (preload), `X-Frame-Options: DENY`.
- **2026-10-12, first mainnet vault (task 7.7, part), created by the founder on https://cryoshield.app; checked by the
  agent:** vault `0x5786f991…2678`, tx `0x66ddb5b3…00a5`, block 158120434, 21:14:05 UTC, status 1. One UserOperation
  through EntryPoint v0.6, sent by Pimlico's bundler and paid by Pimlico's paymaster `0x66666666…c68b` (about
  1.7 × 10⁻⁶ ETH). The app requests policy `sp_mixed_hellion`, so the sponsored operation shows the policy was in
  effect. Who enabled it, and when, is not recorded here: runbook step 8 planned it after the smoke test, but this
  sponsored create was itself part of the smoke. The same transaction created the passkey wallet `0x174e1a82…1030`
  (ERC-1967 proxy to the D1 implementation, through the D1 factory). `getVault` returns version 1 and a 1,006-byte
  blob with the `CRYO` v1 header. Two `LocatorAdded` events, one per key. Edit, add-key and the Arweave mirror are not
  recorded here yet.
- **2026-10-13, recovery tool on mainnet (task 7.8, part, G5), by the founder:** the `v1.0.0` binary with no network
  flag unlocked the new mainnet vault from public RPCs: "Cool recovery tool works and verified". The Arweave path and
  the Pimlico dashboard check (runbook step 11) are not recorded here yet.

## Sign-off

- G9 and D8 sign-off (2026-10-12), in the founder's words: "Signed: prix0007, 2026-10-12. I accept this entry and the re-scored risk register, the sanctions stance in §6 holds for mainnet, and I approve the D8 sponsorship values."
- Founder go decision: _not recorded in words; the founder published `v1.0.0` on 2026-10-12 (20:57 UTC). G7 is still open (the September 2027 domain and `security.txt` dates)_
