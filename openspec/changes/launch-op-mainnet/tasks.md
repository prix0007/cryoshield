# Tasks

**Owners:**
- **[owner]** the founder only (repository owner, deployer keystore, Pimlico admin, releases). Agents never do these.
- **[sol]** solidity-engineer (scripts only; `contracts/src` is frozen)
- **[fe]** frontend-engineer
- **[rec]** recovery-engineer
- **[sec]** security-reviewer

**TDD:** for every code task, write the listed test first, see it fail, then implement. No task here sends a transaction except those marked `[owner]` in section 7, and those run only after the go/no-go (design → Go/no-go) is recorded.

## 0. Plan

- [x] 0.1 Write the plan (proposal, design, specs, tasks). Verify: `openspec validate launch-op-mainnet --strict` and `openspec validate --all --strict`.

## 1. Preparation [owner]

- [ ] 1.1 [owner] Re-run the read-only chain checks of design → Live chain facts (chain ID, deployer balance and nonce, CREATE2 deployer, EntryPoint v0.6, P-256 precompile with a fresh signature, empty code at the predicted addresses, gas price, GasPriceOracle) on launch day. Verify: the values and the date are in `docs/reviews/launch-op-mainnet.md`.
- [ ] 1.2 [owner] Answer `harden-gas-sponsorship` task 1.1 for mainnet, then create the mainnet Pimlico policy (chain allowlist `[10]`; per sender 50 ops and $1, lifetime; global $20 and 2,000 ops per day; $0.10 per op) and a dedicated mainnet API key (origin `https://cryoshield.app`, bundler + paymaster only, "policy required" if offered). Prepay about $140; add no card. Verify: dated settings (no secrets) in `apps/web/docs/paymaster-policy.md`; G4 recorded.
- [ ] 1.3 [owner] Record the audit decision (design D7, Q1) and the compliance decision (Q3) in the launch record. Verify: G6 and G9 entries dated and signed.
- [ ] 1.4 [owner] Confirm CI-H1 (agents use only the machine account) and hardware-key 2FA on the owner account; run `.github/rulesets/apply.sh --with-ecc-review --environments` (no diff) and `dig +short dev.cryoshield.app` for A, AAAA and CNAME (empty). Verify: G1 and G2 recorded.

## 2. Contract tooling [sol]

- [ ] 2.1 [sol] Test first in `contracts/script/test-deploy-args.sh`: with `DEPLOY_PLAN_ONLY=1`, `deploy.sh op_mainnet` fails when the predicted registry v2, `cryoshield.app` factory or implementation differ from `deployments/11155420.json` (simulate with a patched copy of the record), naming the contract, and passes with the real record. Then implement the guard (design D1), before any RPC call. Verify: `script/test-deploy-args.sh`.
- [ ] 2.2 [sol] Test first: `deploy.sh op_mainnet` with an `RP_IDS` that includes `cryoshield-web-dev.fly.dev` or any RP ID other than `cryoshield.app` is refused, and a record with a top-level v1 `address` on chain 10 is refused (existing check, add the test if missing). Then implement. Verify: `script/test-deploy-args.sh`.
- [ ] 2.3 [sol] Test first: the plan for `op_mainnet` and `op_sepolia` lists a Sourcify verification per contract in addition to Blockscout, keyless, after the record is written. Then add Sourcify to the verify queue. Verify: `script/test-deploy-args.sh` (plan output).
- [ ] 2.4 [sol] Test first (`contracts/script/test-verify-etherscan.sh`, with a stub `curl` and stub `forge` on `PATH`): `verify-etherscan.sh 10` builds the V2 URL `https://api.etherscan.io/v2/api?chainid=10`; passes the key only through curl's stdin config (the recorded argv of every stub call contains no key); refuses an argument that looks like a key; treats "Already Verified" as success; exits 2 with a key-free retry command on failure; reads the addresses from `deployments/10.json`. Then implement the script (design D2). Verify: the test script, `shellcheck`, and the CI `contracts` job runs it.
- [ ] 2.5 [sol] Update `contracts/deployments/README.md` and the `deploy.sh` header for the mainnet run (gate variable, verification order, the "someone deployed first" response from design D1). Verify: docs reviewed in 6.1.

## 3. Recovery tool [rec]

- [ ] 3.1 [rec] Test first in `tools/recover/tests`: the `op-mainnet` preset's `registry_v2` and `deploy_block_v2` equal `contracts.vaultRegistryV2` in `contracts/deployments/10.json` when that file exists (extend `test_built_in_registry_matches_deployment_records` to every record present), and `registry` (v1) stays the placeholder for chain 10. The test fails until 7.3 adds the record and the preset is regenerated. Verify: pytest shows the failure, then green in 7.3.
- [ ] 3.2 [rec] Test first: with no network flag the tool uses `op-mainnet`, prints that it does, and `--testnet` still selects `op-sepolia` (Q2). Update the `deployment-targets` "Recovery tool default network" scenarios' tests. Then change `DEFAULT_NETWORK`. Verify: pytest, ruff, `mypy --strict`.
- [ ] 3.3 [rec] Test first: against a local anvil chain seeded with a v2-only deployment (no v1) and a vault, the tool with the `op-mainnet`-shaped preset (v1 placeholder) finds and opens the vault, and reports no v1 lookups. Verify: pytest (integration marker).
- [ ] 3.4 [rec] Update `tools/recover/README.md`: mainnet is the default, testnet vaults need `--testnet`, mainnet has only VaultRegistry v2. Verify: docs reviewed in 6.1.

## 4. Honest copy [fe]

- [ ] 4.1 [fe] Test first in `apps/web/test/config/networks.test.ts`: every preset chain has a `status` (`testnet` for 11155420, 421614, 31337; `mainnet` for 10, 42161), and an unknown chain is `testnet` (fail safe: the warning shows). Then add it to `networks.ts` (design D6). Verify: `pnpm --filter @cryoshield/web test`.
- [ ] 4.2 [fe] Test first in `apps/web/test/landing/content.test.ts`: render the landing page for chain 11155420 and chain 10 (scripts off, reduced motion). Testnet: "OP Sepolia", "Testnet preview", "not been independently audited", the all-keys-lost warning. Mainnet: "OP Mainnet", "not been independently audited" (or "unaudited"), the all-keys-lost warning, and neither "OP Sepolia" nor "Testnet". Both: the denylist (design D6) finds no affirmative claim. Then make `index.html`, its meta description and the share-image alt text (`vite-plugins/seo.ts`) chain-driven. Verify: unit tests and `test:e2e` `05-landing`.
- [ ] 4.3 [fe] Test first in `apps/web/test/legal/pages.test.ts`: `/terms`, `/privacy` (and `/cookies` if it names the network) for both chains carry the network name, the unaudited statement and the all-keys-lost statement; the mainnet build's sub-processor table names the OP Mainnet RPC host from `VITE_RPC_URL`; the legal version and "last updated" date changed (`check-legal-dates.mjs`). Then template `legal/*.md` and `terms/index.html`. Verify: unit tests, `legal-check.mjs`.
- [ ] 4.4 [fe] Test first in `apps/web/test/build/origins.test.ts`: a chain-10 build whose `VITE_RPC_URL` host is not in the privacy sub-processor list fails `origins-check`; with `https://mainnet.optimism.io` (or the chosen RPC) listed it passes. Then add the row. Verify: unit tests and `verify-build` with `VERIFY_CHAIN_ID=10` against a fixture `10.json` (test-only fixture, never the real record).
- [ ] 4.5 [fe] Test first in `apps/web/test/ui/acknowledge.test.tsx` (or a new `network-notice.test.tsx`): on chain 10 the app shell shows an "unaudited" notice (no "Testnet" chip), on 11155420 the existing testnet banner; on chain 10 within 90 days of the launch date the "no vault found" state explains that testnet-preview vaults are not on OP Mainnet and how to read them with the recovery tool (Q4). Then implement in `App.tsx`, `chrome.tsx`, `strings.ts`. Verify: unit tests.
- [ ] 4.6 [fe] Test first: the testnet build shows the dated "moving to OP Mainnet" notice only between its configured start and the switch date, and never on the dev site (RP ID `cryoshield-web-dev.fly.dev`). Then implement. Verify: unit tests.
- [ ] 4.7 [fe] Test first in the architecture-page tests: a chain-10 build (fixture record without v1) renders "none on this network" for VaultRegistry v1, the network "OP Mainnet", chain ID 10, and the registry v2, factory and implementation from the record; `smoke.sh` continues to pass with an empty `REGISTRY_ADDRESS`. Then implement. Verify: unit tests, `npm test --prefix .github/scripts` if `smoke.sh` changes.
- [ ] 4.8 [fe] Test first in the supported-devices content test: a "Tested" row may name OP Mainnet only with a date and the flows tested, and the page's "Last reviewed" date is not in the future. Leave the row unchanged until 7.9. Verify: unit tests.

## 5. Documentation [fe] [sol] [rec]

- [ ] 5.1 [fe] Replace `docs/deploy.md` → "Before OP Mainnet" with a pointer to this change's runbook and the D3 same-tag rollout and D4 rollback table; record the founder decision that owner-only release tags are the production human gate. Verify: docs reviewed in 6.1.
- [ ] 5.2 [fe] Update `docs/reviews/security-audit-2026-10.md` (CI-C1 status: founder decision 2026-10-08) and `openspec/changes/split-dev-and-release-deploys/design.md` (re-gate item 1 superseded, items 2 and 3 kept). Verify: docs reviewed in 6.1.
- [ ] 5.3 [fe] Add the mainnet thresholds and cadence (design → Post-launch monitoring) to `apps/web/docs/paymaster-policy.md`. Verify: every number matches design; G7.
- [ ] 5.4 [fe] Prepare (not publish) the communications texts of design → Communications as `docs/launch/op-mainnet-comms.md`, and draft the `vA` release notes template. Verify: the copy denylist test also runs over this file.

## 6. Pre-launch security review [sec]

- [ ] 6.1 [sec] Review sections 2–5: the D1 guard; `verify-etherscan.sh` (no key in argv, logs, files or error output; stdin config only); copy honesty on both chains against the shipped code; recovery preset parity and default; the rollback plan; that no CryoShield server, admin key or runtime dependency was added. Record it in `docs/reviews/launch-op-mainnet.md`. Verify: no open CRITICAL or HIGH findings; G3 (the `harden-gas-sponsorship` review) is also recorded clean.

## 7. Go/no-go and launch [owner] (design → Launch-day runbook)

- [ ] 7.1 [owner] Fill in every go/no-go criterion G1–G11 with evidence and date in `docs/reviews/launch-op-mainnet.md`, and record `harden-gas-sponsorship` task 8.1 approval. Verify: no criterion open; otherwise stop.
- [ ] 7.2 [owner] Simulate, then broadcast the mainnet deploy (runbook steps 1–2) with `DEPLOYER_ACCOUNT=cryoshield-deployer`, then run `verify-etherscan.sh 10` with the founder's key in the environment (step 3). Verify: `contracts/deployments/10.json` has only `contracts.vaultRegistryV2` and `contracts.wallets["cryoshield.app"]` at the D1 addresses; Blockscout, Sourcify and Etherscan show verified source; the runtime bytecode equals `forge inspect … deployedBytecode`.
- [ ] 7.3 [rec] [fe] PR with `10.json` (from 7.2) and the regenerated recovery `op-mainnet` preset. Verify: 3.1 green; web parity tests green; dev deploy green on OP Sepolia.
- [ ] 7.4 [owner] Release the recovery tool with the mainnet preset and publish its hashes. Verify: `uvx cryoshield-recover --version` and a `--network op-mainnet` dry lookup name registry v2.
- [ ] 7.5 [owner] Publish release `vA` with production still on OP Sepolia (runbook step 6). Verify: deploy and smoke green; `/release.json` shows chain 11155420 and `vA`'s commit; testnet copy unchanged.
- [ ] 7.6 [owner] Save the four current `production-build` values offline, set the mainnet values (runbook step 7), and redeploy `vA` with `gh workflow run deploy.yml --ref vA`. Verify: smoke green; `/release.json` shows chain 10, registry v2 and no v1; the landing page shows "OP Mainnet" and "not been independently audited".
- [ ] 7.7 [owner] Founder smoke with two YubiKeys on https://cryoshield.app: create, unlock, edit, add-key, Arweave mirror (runbook step 9). Verify: four included operations with explorer links; costs recorded.
- [ ] 7.8 [owner] Recovery tool against the new mainnet vault with no network flag, public RPCs only, then through Arweave (runbook step 10); Pimlico dashboard check (step 11). Verify: the vault unlocks both ways; all operations under the mainnet policy; G5 recorded.
- [ ] 7.9 [fe] PR with measured mainnet costs (`apps/web/docs/costs.md`), the `/devices` YubiKey row (date, flows tested on mainnet), and the launch record entries. Verify: 4.8 and copy tests green.
- [ ] 7.10 [owner] Soft-launch window (Q5) with launch-cadence monitoring, then publish the announcement and the `vA` release notes. Verify: daily monitoring entries for the window; no threshold crossed, or each crossing has a recorded action.

## 8. Final security review [sec]

- [ ] 8.1 [sec] Post-launch security review: the deployed bytecode and verifications match the reviewed source; `10.json` matches the chain; the live site's `/release.json`, CSP and copy match the reviewed build; the Pimlico key and policy match design (no secrets recorded); the recovery tool release hashes are published; the monitoring log exists; no CryoShield-operated server or admin key exists. Record it in `docs/reviews/launch-op-mainnet.md`. Verify: no open CRITICAL or HIGH findings.
