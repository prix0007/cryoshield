# Proposal: launch CryoShield on OP Mainnet

> **Plan only.** This change is a plan. Writing it sent no transaction, deployed nothing and changed no environment. Every on-chain and production step below is an `[owner]` task that runs only after the go/no-go in design.md is met and recorded.
>
> **Depends on:** `harden-gas-sponsorship` (its sections 6–8 are re-gates here), `split-dev-and-release-deploys` (owner-only releases), `add-privacy-and-compliance` (legal pages, mainnet compliance gate) and `add-desktop-recovery-tool` (recovery presets). It executes `harden-gas-sponsorship` task 8.2; it does not replace that change's gate (task 8.1).
>
> **Archive after:** `harden-gas-sponsorship`, `add-privacy-and-compliance`, `add-web-app`, `add-architecture-page`, `add-supported-devices-page` and `add-desktop-recovery-tool`. This change ADDs requirements to capabilities those changes create (`gas-sponsorship`, `legal-pages`, `vault-web-app`, `architecture-page`, `supported-devices`, `vault-recovery`).

> **Founder decisions (2026-10-09):** Q1 launch unaudited, no contract audit planned (and donations no longer mention an audit); Q2 recovery default `op-mainnet` (accepted); Q4 no migration, a 90-day notice, recovery `--testnet` (accepted); Q5 a 7-day soft launch (accepted); **Sequencing B**: the mainnet `production-build` values are set before the first `v*` tag, so `vA` deploys straight from the 2026-10-05 build to OP Mainnet, with no OP Sepolia release (design D3); the mainnet Pimlico policy with monthly per-user and daily global resets and a $0.50 per-operation cap (design D8, item 4 below).

## Why

OP Mainnet was chosen as the mainnet chain on 2026-10-02 and has been deploy-ready in principle since `harden-gas-sponsorship` landed VaultRegistry v2 and the UV- and rpId-enforcing wallet on OP Sepolia (2026-10-07). The founder has now funded the deployer keystore `cryoshield-deployer` (`0x33144f681d83527c0a8f364751a5d2f4505d26bf`, 0.005 ETH on OP Mainnet). Moving the production site from OP Sepolia to OP Mainnet touches contracts, the production build configuration, the recovery tool, the public copy and the operations runbooks at the same time. Doing that without one plan risks the usual launch failures: a dishonest "testnet" or "mainnet" claim, a recovery tool that cannot find mainnet vaults, a rollback that cannot build, or a sponsorship budget nobody watches.

This change is the single plan: what must be true before launch (go/no-go), the launch-day runbook, the code changes needed (presets, copy, guards), and how the launch is watched and rolled back.

## What Changes

1. **Contracts on OP Mainnet (owner, at launch):** deploy, with `contracts/script/deploy.sh op_mainnet`, **only** VaultRegistry v2 and the `cryoshield.app` wallet implementation and factory. **VaultRegistry v1 is never deployed on OP Mainnet**, and neither is the dev RP ID's wallet pair. The CREATE2 addresses equal the OP Sepolia ones (design D1 proves this, and a new guard in `deploy.sh` refuses a mainnet broadcast if they ever differ). Verify each contract on Blockscout and Sourcify (keyless) and on Etherscan through the V2 API with a founder-supplied key, using a curl-based script because forge 1.1.0's Etherscan path is broken.
2. **Deployment record and presets (code, TDD):** commit `contracts/deployments/10.json` with `contracts.vaultRegistryV2` and `contracts.wallets["cryoshield.app"]` only. Regenerate the recovery tool's `op-mainnet` preset from it and switch its default network to `op-mainnet` (founder question Q2). The web build already reads the record and refuses a v1 entry on chain 10.
3. **Production configuration (owner, at launch):** production still deploys only from owner-cut `v*` releases. The switch is four `production-build` values: `VITE_CHAIN_ID=10`, `VITE_RPC_URL` (an OP Mainnet public RPC), `VITE_SPONSORSHIP_POLICY_ID` (the mainnet Pimlico policy) and the `VITE_BUNDLER_URL` secret (the mainnet Pimlico key). The owner saves the current values offline (the testnet bundler URL from the Pimlico dashboard, because GitHub cannot return a secret), sets the mainnet ones, and then publishes `vA`, whose first deploy is on OP Mainnet (Sequencing B, design D3). A failed first deploy rolls back to the self-contained 2026-10-05 OP Sepolia image; a chain rollback restores the saved values and redeploys `vA` (design D4).
4. **Pimlico mainnet policy (owner):** the founder's policy (design D8), which replaces the values first planned here (per sender 50 operations and $1 monthly; global $20 and 2,000 operations per day; $0.10 per operation). Live values, recorded 2026-10-10 at task 1.2: policy `sp_mixed_hellion` on chain 10, created disabled and enabled after the first chain-10 deploy; per user $1 and 10 operations, **reset monthly**; global $30 and 500 operations, **reset daily**; **$0.50 per operation** (a MODIFIED `gas-sponsorship` requirement); valid 2026-10-10 to 2027-10-02; about $140 prepaid with no card (amount and card status still to be confirmed). It replaces the first policy, `sp_many_longshot`, deleted on 2026-10-10 because its resets were "never". A refused save on OP Mainnet says the fee could not be paid, nothing was saved, and limits reset over time. A key cannot name a policy, but the mainnet key has "verifying paymaster" off, so it sponsors only policy-scoped requests (`harden-gas-sponsorship` task 1.1 (a)); the prepaid balance with no card remains the hard bound.
5. **Honest copy (code, TDD):** every place that says "Testnet preview" or "OP Sepolia" (the landing page, `/terms`, `/privacy`, `/cookies` where it applies, `/devices`, `/architecture`, the app banner, the share image alt text, metadata) is driven by the build's chain. On OP Mainnet it names OP Mainnet and **still** says that CryoShield has not been independently audited and that losing all enrolled keys means losing the vault. A copy test denylist keeps "audited", "guaranteed", "risk-free" and similar claims out.
6. **Go/no-go and re-gates:** the launch needs every criterion in design → Go/no-go, including: owner-only release tags as the production human gate (CI-C1, founder decision 2026-10-08), T1 resolved, the `harden-gas-sponsorship` security review done and its tasks 6.2–6.4 passing on testnet, the recovery tool working against the mainnet preset, a recorded audit decision (founder 2026-10-09: launch unaudited, no audit planned), Pimlico spend monitoring, and a rehearsed rollback plan.
7. **Operations:** a launch-day runbook, a cost table with live gas numbers (fetched read-only on 2026-10-08), a threat and risk table, a communications plan, and post-launch monitoring with explicit thresholds (design.md).

### Out of scope

- Any contract change. `contracts/src` is frozen; the mainnet contracts are the exact OP Sepolia bytecode. A contract bug after launch means a new, versioned registry in its own change (design D4).
- An own paymaster, webhooks, a proxy, or any server CryoShield operates (the `harden-gas-sponsorship` D6 trigger still governs that).
- Migrating testnet vaults to mainnet. Testnet vaults stay readable with the recovery tool (`--testnet`); users re-create their vault on mainnet (founder question Q4).
- An external audit. The founder decided on 2026-10-09 to launch unaudited, with no contract audit planned (design D7, Q1); the copy says "has not been independently audited" on every network.
- Arbitrum One or any other chain.
- Changing the vault format, the crypto or the test vectors (none change).
- The compliance records owned by `add-privacy-and-compliance` (rescoped 2026-10-08 to the OSS project: no entity, no lawyer). This change only gates on its `mainnet-gate` review (design → Go/no-go G9), which CI enforces on the `10.json` PR.

### Runtime dependencies

- **Added:** none. OP Mainnet public RPCs and Pimlico's OP Mainnet bundler and verifying paymaster are the mainnet instances of dependencies the project already has (public chain RPCs and a third-party ERC-4337 provider, both allowed by `openspec/config.yaml`). Etherscan, Blockscout and Sourcify are used only by the founder at deploy time for source verification, never at runtime.
- There is **no CryoShield-operated backend**. Monitoring is the founder reading the Pimlico dashboard and running read-only `cast` queries from a laptop.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `deployment-targets`: the recovery tool's default network becomes `op-mainnet`; explorer verification adds Sourcify and optional Etherscan V2 with the key kept out of argv; new requirements for the OP Mainnet deployment (address parity with OP Sepolia, the gate, the record contents) and for switching the production chain through a release.
- `landing-page`: the honest-content disclosures are driven by the build's chain and stay honest on mainnet.
- `legal-pages`: the terms, privacy and cookie pages name the build's network and keep the unaudited and all-keys-lost statements; the RPC sub-processor row names the mainnet endpoint.
- `vault-web-app`: the app shell shows an "unaudited" notice on mainnet instead of the testnet banner, and explains where testnet vaults went.
- `architecture-page`: renders a network without VaultRegistry v1 truthfully.
- `supported-devices`: the YubiKey row records the mainnet launch test honestly.
- `vault-recovery`: the `op-mainnet` preset is generated from `contracts/deployments/10.json`.
- `gas-sponsorship`: mainnet spend monitoring with thresholds and a launch-period cadence; the mainnet per-operation cap is $0.50 (founder decision); the OP Mainnet refusal copy says limits reset. (MODIFIED requirements of a capability that `harden-gas-sponsorship` creates: archive that change first.)
- `donation`: the support page says donations fund gas sponsorship and hosting, and never promises an audit.

## Impact

- **contracts/:** `deployments/10.json` (written by the owner's deploy), a mainnet address-parity guard in `script/deploy.sh` and its test in `script/test-deploy-args.sh`, a new `script/verify-etherscan.sh` (curl, Etherscan V2, key from the environment through stdin), and Sourcify in the verify queue.
- **apps/web:** chain-driven copy (landing, legal pages, `/devices`, `/architecture`, app banner, SEO alt text), the privacy sub-processor row for the OP Mainnet RPC, copy tests for chain 10 and chain 11155420 builds.
- **tools/recover:** the `op-mainnet` preset from `10.json`, the default network, tests, and a recovery-tool release.
- **docs/:** `docs/deploy.md` ("Before OP Mainnet" replaced by this plan's runbook), `docs/system-design.md` status line and network table, `apps/web/docs/costs.md` (measured mainnet costs), `apps/web/docs/paymaster-policy.md` (mainnet settings and monitoring), a launch record in `docs/reviews/launch-op-mainnet.md`, and the audit document's CI-C1 re-gate note updated to the founder's decision.
- **Owner operations:** Pimlico mainnet policy and key, `production-build` values, the deploy and verification, the release, the launch announcement.
- **Cost:** about $0.016 of ETH to deploy (0.3% of the funded 0.005 ETH) and about $0.004 per sponsored vault creation at today's prices (design → Costs).
