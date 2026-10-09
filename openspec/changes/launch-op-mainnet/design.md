# Design: launch CryoShield on OP Mainnet

## Context

- **Today (2026-10-08, `main` at `f2ce3da`):**
  - Production (https://cryoshield.app) deploys only from owner-published `v*` releases, and `production-build` targets OP Sepolia (11155420). Dev (https://cryoshield-web-dev.fly.dev) follows `main` on OP Sepolia with its own RP ID.
  - OP Sepolia holds VaultRegistry v1 (legacy, read-only), VaultRegistry v2 and the wallet pairs for `cryoshield.app` and `cryoshield-web-dev.fly.dev` (`contracts/deployments/11155420.json`).
  - `deploy.sh` already has an `op_mainnet` preset (Blockscout verifier `https://explorer.optimism.io/api/`), deploys only v2 and the `cryoshield.app` pair there by default, refuses a v1 entry, and refuses to broadcast unless `CRYOSHIELD_MAINNET_GATE=approved:10` (the gate value names the chain).
  - The web build (`vite-plugins/deployment.ts`) refuses a v1 entry for chain 10, and the smoke test expects `/release.json` to name no v1 registry when the record has none.
  - The recovery tool has an `op-mainnet` preset with three public RPCs but placeholder registry addresses, and its default network is `op-sepolia`.
  - Public copy is hard-coded to "Testnet preview" and "OP Sepolia" (`apps/web/index.html`, `legal/*.md`, `src/ui/strings.ts`, `src/ui/chrome.tsx`, `vite-plugins/seo.ts`, `terms/index.html`). The app banner is shown only for chains in a testnet map, so on chain 10 it would silently disappear, along with the "not independently audited" sentence.
- **Founder facts for this plan:** the deployer keystore `cryoshield-deployer` (`0x33144f681d83527c0a8f364751a5d2f4505d26bf`) holds 0.005 ETH on OP Mainnet (confirmed read-only below, nonce 0). The Pimlico mainnet policy limits are fixed (proposal item 4; the founder's values of 2026-10-09 are in D8). Etherscan verification uses a founder-supplied V2 key.
- **Founder decisions of 2026-10-09** (Open questions, answered below): launch unaudited with no audit planned (Q1); recovery default `op-mainnet` (Q2); no migration, a 90-day notice and `--testnet` (Q4); a 7-day soft launch (Q5); **no separate testnet release** before the switch (D3, Sequencing); the mainnet Pimlico policy values (D8). **After the pre-launch review (same day):** the mainnet production values are set **before** the first `v*` tag, so `vA` deploys straight to chain 10 (Sequencing B, D3); the Pimlico limits get resets (per user monthly, global daily) and keep the $0.50 per-operation cap (D8); donations no longer mention an audit.

## Goals / Non-Goals

**Goals:**
- One reviewed path from "funded deployer" to "cryoshield.app on OP Mainnet", with explicit go/no-go criteria and abort points.
- Mainnet contracts byte-identical to the OP Sepolia ones, at the same addresses.
- Copy that is honest on both chains and tested.
- A recovery tool that finds mainnet vaults with no flags.
- A rollback for every step that can be rolled back, and a clear statement of what cannot.

**Non-Goals:** see proposal → Out of scope.

## Live chain facts (read-only, 2026-10-08)

All values came from `cast` against `https://mainnet.optimism.io` (block ≈ 157,903,946). No transaction was sent.

| Check | Result |
|---|---|
| `cast chain-id` | 10 |
| Deployer balance / nonce | 0.005 ETH / 0 |
| CREATE2 deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C` | code present (69 bytes) |
| EntryPoint v0.6 `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | code present (23,690 bytes) |
| RIP-7212 P-256 precompile `0x100` | returns `1` for a freshly generated valid P-256 signature |
| Code at the predicted addresses (registry v2, `cryoshield.app` factory and implementation) and at the v1 address | empty (`0x`) for all four |
| L2 gas price | 1,002,688 wei (base fee 2,692 wei + priority 0.001 gwei) |
| GasPriceOracle (Fjord) | `l1BaseFee` 2.12e8 wei, `blobBaseFee` 1.29e7 wei, scalars 5,227 / 1,014,213 |
| ETH/USD (Chainlink OP Mainnet feed `0x13e3…08c5`) | $2,572.65 |

These satisfy the `deployment-targets` requirement "Dependency availability on target chains" for OP Mainnet as amended by `harden-gas-sponsorship` (P-256 precompile, EntryPoint v0.6, CREATE2 deployer; no Coinbase factory, no v1). Task 1.1 re-runs them on launch day and records them.

## Decisions

### D1. Same addresses as OP Sepolia: the reasoning, and a guard

A CREATE2 address is `keccak256(0xff ‖ deployer ‖ salt ‖ keccak256(initCode))[12:]`. For our contracts:

- **deployer** is the canonical CREATE2 proxy `0x4e59…956C` (`DeployV2.s.sol`), present at the same address on both chains. The EOA that calls it (`cryoshield-deployer`) is **not** an input, so which keystore broadcasts does not change any address.
- **salt** is a constant: `keccak256("cryoshield.vault-registry.v2")` for the registry, `keccak256("cryoshield.wallet-factory.v1")` for each factory.
- **initCode** is the creation bytecode (for a factory, plus `abi.encode(sha256(rpId))`). The factory's constructor creates the implementation with CREATE2 from the factory's own address and salt 0, so the implementation address follows from the factory's.

So the same build, salts and RP ID give the same three addresses on every chain. **Checked today:** `script/deploy.sh --predict-v2 cryoshield.app` on a clean build of `f2ce3da` prints registry `0xA622c92d3D5b54aeA081Cf410224a8A2eCb08cB7`, factory `0x775dc816594262274E78Ae75D97C8EdB0df5DfED`, implementation `0x8aA76FaA6629cA1EA8ccC3F9Edf0E8D98816Acd7` and rpIdHash `0xb14a…3d7f`, exactly the values in `11155420.json`. `cast estimate` of both CREATE2 calls on OP Mainnet succeeds (below).

**What can break it:** any change to `contracts/src`, the solc version or settings, the metadata hash, or the remappings changes the init code and hence the addresses. A different address would not be unsafe (no admin, same code), but it would split the "same address on every chain" property the docs and the recovery tool rely on, and it would mean the mainnet bytecode is not the reviewed one.

**Guard (task 2.1, TDD):** `deploy.sh op_mainnet` refuses to simulate or broadcast unless the predicted registry and `cryoshield.app` factory and implementation equal the entries in `deployments/11155420.json`. It names the mismatching contract. `DEPLOY_PLAN_ONLY=1` covers it in `script/test-deploy-args.sh`.

**Someone else deploys first.** Anyone can send the same init code to the CREATE2 proxy. The result would be our exact contracts at our addresses, with no owner and no admin, so it is harmless. `deploy.sh` then stops with "already deployed but not recorded" (by design it never silently adopts a deployment). The runbook response: check the runtime bytecode against the build (`cast code` vs `forge inspect … deployedBytecode`, as the script already does for v1), then write `10.json` by hand with the actual transaction hash and block, reviewed in the record PR. Nothing is lost.

### D2. Explorer verification: Blockscout, Sourcify and Etherscan V2

- **Blockscout** (`https://explorer.optimism.io/api/`) is already automatic in `deploy.sh`, keyless, after the record is written.
- **Sourcify** is keyless and supported by forge 1.1.0 (`--verifier sourcify`). Task 2.3 adds it to the same verify queue, so each contract gets a Blockscout and a Sourcify verification, with the existing "exit 2 and print retry commands" behaviour.
- **Etherscan (Optimistic Etherscan)** through the **V2 API** (`https://api.etherscan.io/v2/api?chainid=10`). forge 1.1.0 drops the query string and fails (`target-op-sepolia` design, task 2.4 probe). Instead, a new `contracts/script/verify-etherscan.sh`:
  - gets the standard JSON input from `forge verify-contract --show-standard-json-input` (no network);
  - posts `module=contract&action=verifysourcecode` with `codeformat=solidity-standard-json-input`, the contract name, `compilerversion`, the constructor arguments, and then polls `checkverifystatus`;
  - reads the key **only** from `ETHERSCAN_API_KEY` in the environment and hands it to curl through a config read from stdin (`curl --config -`), so it never appears in argv, logs or the shell history; it refuses `--api-key` style arguments;
  - is idempotent ("Already Verified" is success) and exits 2 on failure with the retry command (without the key).
  - The founder supplies the key at deploy time; it is never committed, never put in a GitHub secret, and `deploy.sh` keeps stripping explorer keys from the forge environment (`VERIFY_ENV`).
- This amends the `deployment-targets` requirement "Keyless explorer verification": keyless verification stays mandatory; Etherscan is an additional, optional step.

### D3. Production switch through a release (Sequencing B, founder decision 2026-10-09)

The chain is configuration in `production-build`, not code. The founder decided, after the pre-launch review, that there is **no OP Sepolia release of `vA`**: production goes from the 2026-10-05 build straight to `vA` on OP Mainnet.

1. **Before tagging,** the owner saves the four current values offline and sets the mainnet ones (runbook step 6). `VITE_BUNDLER_URL` is a secret, and GitHub cannot return a secret's value: the testnet bundler URL (with its key) is copied from the **Pimlico dashboard** into the offline record before it is replaced, or a chain rollback cannot restore it (review L8).
2. **Then** the owner publishes `vA` (step 7 = S). Its first production deploy builds for chain 10, and the smoke test checks chain 10, registry v2 and no v1 in `/release.json`.

The spec requirement "Production chain switch through a release" (`deployment-targets`) was rewritten to allow this order.

**Risks of B, stated plainly, and their mitigations:**

| Risk | What happens | Mitigation |
|---|---|---|
| The first chain-10 deploy fails after `fly deploy` started | The `release` job rolls back to the previous image, the **2026-10-05 OP Sepolia build**. That image is self-contained (its config is baked in), so the site keeps working on testnet. The values now say chain 10, so no redeploy succeeds until they are fixed or restored | Fix forward with a new tag, or restore the saved testnet values (with the bundler URL from the Pimlico dashboard) |
| Old tags cannot be rebuilt for chain 10 | Every pre-`vA` tag lacks `10.json`; its chain-10 build fails by design ("No deployment record for chain 10") | After the switch only `vA` and later tags are rollback targets (R9) |
| `vA`'s code was never deployed to production on OP Sepolia | A code defect and a chain problem show up in the same deploy | `vA`'s commit already runs on OP Sepolia on the **dev site**, which deploys every `main` commit through the same pipeline and smoke test; the copy tests cover both chains |
| Chain rollback | There is no production run of `vA` on OP Sepolia to point back to | Restore the saved testnet values and redeploy `vA` (`gh workflow run deploy.yml --ref vA`), or publish a new tag on the same commit; `vA` contains `11155420.json`, so it builds for OP Sepolia |

**Why the plan's order A was dropped:** A (release `vA` on OP Sepolia, then switch and redeploy the same tag) proved `vA` in production on both chains, at the cost of an extra production deploy and a testnet release the founder does not want. The dev site gives most of that proof for the code; what B gives up is a production-proven chain rollback, which only matters before real users arrive (the soft-launch window, Q5).

The `VITE_RPC_URL` host must be in the privacy policy's sub-processor table, because the origins check fails the build for any CSP origin not listed there. `vA` therefore lists the OP Mainnet RPC host (task 4.4).

Because nothing is released on OP Sepolia before the switch, the dated "moving to OP Mainnet" notice (task 4.6) never reaches production; it is published in the README and a GitHub discussion instead (Communications). The main mitigation for testnet users is the 90-day help on OP Mainnet (task 4.5).

### D4. Rollback

| What fails | When | Rollback | User impact |
|---|---|---|---|
| Contract deploy or verification | Before the switch | None needed: contracts are immutable and unused. Retry verification; a wrong deploy means a new versioned contract in a new change | None |
| Mainnet values set, `vA` not yet tagged | Before the switch | Nothing is deployed yet; restore the saved values (bundler URL from the Pimlico dashboard) if the launch is called off | None |
| The first `vA` build or smoke test on chain 10 | At the switch | Build failure: nothing deployed. Deploy or smoke failure: automatic image rollback to the 2026-10-05 OP Sepolia image (self-contained, keeps working). Then fix forward with a new tag, or restore the saved testnet values before any redeploy | None (no mainnet users yet); the site stays on testnet |
| A defect found in the first hours, before the announcement | Soft-launch window | Chain rollback: restore the saved testnet values and redeploy `vA` (dispatch at the tag) or re-tag the same commit; `vA` builds for OP Sepolia. Only the founder's test vault exists on mainnet; it stays readable with the recovery tool | Founder only |
| A front-end defect after the announcement | Post-launch | Redeploy the last good mainnet-capable tag (`vA` or later). **Do not** roll the chain back: users' mainnet vaults would vanish from the web app (they stay safe and readable with the recovery tool) | Short outage at worst |
| A contract defect after the announcement | Post-launch | Contracts cannot be changed. Pause new writes if needed (take `VITE_SPONSORSHIP_POLICY_ID` to a paused policy, or stop the policy in Pimlico, which shows "Saving is paused"), then a new versioned registry or wallet in its own OpenSpec change with a read path for the old one | Saving paused; reading and recovery keep working |
| Sponsorship abuse or budget exhausted | Post-launch | Pimlico shows "Saving is paused". Top up only after reviewing usage; D6 trigger of `harden-gas-sponsorship` | Saving paused |
| Site down | Any time | `fly scale count 0` is never needed for safety: vaults are on-chain and the recovery tool works without the site | Use the recovery tool |

### D5. Recovery tool on mainnet

- The `op-mainnet` preset is generated from `10.json` (`registry_v2`, `deploy_block_v2`); `registry` (v1) stays the placeholder, and the tool already treats a network with only v2 correctly.
- The default network becomes `op-mainnet` in the recovery-tool release that ships with `vA`; `--testnet` keeps selecting `op-sepolia`, and the tool prints the network it uses (existing behaviour). This is founder question Q2; the default is recommended because a user in a hurry runs the tool with no flags, and their real vault is on mainnet.
- The launch-day test reads and unlocks the founder's mainnet vault with two YubiKeys, from the public RPCs only, with the released binary or `uvx` package, and a second run with `--arweave-only` (or the equivalent Arweave path) proves the mirror.

### D6. Honest copy, driven by the chain

- A single build-time source of network wording: `networks.ts` already maps chain IDs to names and explorers. Add a `status` field: `testnet` for 11155420, 421614, 31337; `mainnet` for 10 and 42161. The Vite plugins substitute placeholders in the static pages and `legal/*.md` (as `/architecture` already does with `__CS_REGISTRY__`), and the app reads the same value.
- **Testnet build:** unchanged wording ("Testnet preview: CryoShield runs on OP Sepolia, a test network, and has not been independently audited…").
- **Mainnet build:** "CryoShield runs on OP Mainnet. It has not been independently audited. Your vault is permanent and public as ciphertext; only your keys can open it, and if you lose all of them, nobody, including us, can open it. Keep your existing backups too." The chip reads "Unaudited" instead of "Testnet preview". The FAQ answer about permanence names OP Mainnet, Arweave and a working key. Exact strings are fixed in tasks 4.2–4.6 and tested.
- **Always present on both chains** (visible without scripts or motion): the network name, "not been independently audited" (or "unaudited"), and the all-keys-lost warning. **Never present:** "audited" as a claim, "guaranteed", "unhackable", "military-grade", "risk-free", "insured", "bank-grade", "never lose".
- **Testnet vaults notice** (Q4): on the mainnet build, the app's "no vault found" state and the landing FAQ say that vaults created during the testnet preview are not on OP Mainnet, that they stay readable with the recovery tool (`--testnet`), and that the user should create a new vault. Shown for 90 days after launch (a build-time date, tested).
- **Pages:** landing (`index.html`, meta, share-image alt), `/terms` (the "Testnet and unaudited" section becomes "Network and audit status"), `/privacy` (blockchain row and RPC sub-processor row name the build's network and RPC host), `/cookies` only if it names the network, `/devices` (the YubiKey row gains the mainnet launch test with date and flows, only after it happened; "Last reviewed" updated), `/architecture` (network name, chain ID, registry v2, factory and implementation from `10.json`, and "VaultRegistry v1: none on this network" instead of an empty cell), the app shell banner.
- Legal text changes bump the legal version and "last updated" date (`check-legal-dates.mjs`), and the permanence acknowledgement re-prompts if its version is tied to the terms. (It is not tied: the acknowledgement is per session and nothing is stored, so there is nothing to re-prompt.)

**As implemented (tasks 4.1 to 4.8, 2026-10-09):**

- **One mechanism.** `vite-plugins/network-copy.ts` resolves `<!--net:testnet-->…<!--/net-->`, `<!--net:mainnet-->…<!--/net-->` and `<!--net:moving-->…<!--/net-->` blocks and the tokens `__CS_NET_NAME__`, `__CS_RPC_HOST__` and `__CS_RPC_VENDOR__` in every page, in the shared header and footer partials, and in the legal Markdown (before rendering, so the escaping renderer never sees a marker). The status comes from `networks.ts` (`status`, `shortName`); an unknown chain is a testnet. An unknown block, a nested or unclosed block, or a leftover token fails the build. The app reads the same table at run time.
- **Mainnet wording:** chip "Unaudited"; hero "Runs on OP Mainnet. … CryoShield has not been independently audited, so please keep your existing backups too."; the calls to action and footers "Runs on OP Mainnet, not independently audited."; the FAQ answers name OP Mainnet and the audit status. "Yet" is dropped everywhere, because no audit is planned (Q1, review L5). The testnet wording is unchanged, except that it now names the build's own test network (the E2E build on chain 31337 says "a local test chain"; `05-landing` was updated) and, after review L5, drops "yet" from "not been independently audited yet" on **every** chain.
- **Denylist** (`test/landing/banned.ts`, `bannedFor(chainId)`): on a testnet build "mainnet" never appears; on a chain-10 build it may appear only as the name "OP Mainnet". "mainnet-ready", "production-ready", "battle-tested", "risk-free" and "insured" are banned on every chain. **One deliberate exception:** the dated "moving to OP Mainnet" notice (task 4.6) names the target network on a testnet build; the test removes exactly that notice and applies the testnet denylist to the rest.
- **Landing FAQ for testnet vaults: not added (spec conflict resolved).** D6 above mentions the landing FAQ, but the `landing-page` scenario for chain 10 requires that neither "OP Sepolia" nor "Testnet" appears there. The testnet-vault help is therefore only in the app's no-vault state (spec `vault-web-app`), shown to exactly the users who need it.
- **Share image:** neutral, preferred over a per-chain PNG. `brand/og-image.svg` drops the "Testnet preview" pill and says "Not independently audited" instead of "Not yet audited"; the PNG and `og-image.sha256` are regenerated; the alt text describes that card ("Free and open source, not independently audited") and is the same on every chain.
- **Privacy RPC row:** generated from `VITE_RPC_URL` and the vendor recorded for its origin in `docs/compliance/origins.json` (which already lists `https://mainnet.optimism.io`, so no inventory row was added). An RPC origin missing there fails the build and names the host, and `verify-build` checks the built `/privacy` row (`VERIFY_RPC_URL`). Loopback and `.invalid` fixtures are labelled as test endpoints.
- **Launch dates:** `src/config/launch.ts` holds `moveNoticeFrom` and `switchDate` (UTC days), both `null` until an agent PR sets them for the switch day. With `switchDate` unset, a chain-10 build shows the testnet-vault help (fail safe). The "moving" notice needs `moveNoticeFrom` and shows only on the production RP ID `cryoshield.app`, never on the dev site. The app evaluates both when it opens; the landing page at build time.
- **Size:** the status notice and the no-vault help are in the initial `/app` JS on purpose (+866 B gzip); `verify-build`'s baseline is raised by 1 KB with the measurement recorded.
- **Chain-10 tests** build against a test-only fixture record (`apps/web/test/fixtures/mainnet-contracts.mjs`: v2 and the `cryoshield.app` pair at the D1 addresses, fake blocks and hashes), never against a real `contracts/deployments/10.json`. `verify-build` was run the same way: `CRYOSHIELD_CONTRACTS_DIR=<fixture> VERIFY_CHAIN_ID=10 VERIFY_RPC_URL=https://mainnet.optimism.io`.
- **Not changed:** the app's save-budget hint stays testnet-only (D8, consequences).

**Pre-launch review fixes (2026-10-09):**
- **H2:** donations no longer promise an audit (landing footer, `/support` text and description, README). The denylist gains `AUDIT_PROMISES` ("fund/toward/for an (independent) (security) audit", "an audit is coming/planned", "will be audited", "audited yet"), applied to every built public page and `llms.txt` on both chains (`test/build/public-pages-honesty.test.ts`). The `donation` "Support page" requirement is MODIFIED accordingly.
- **L4:** the mainnet app notice says the vault is "published permanently as ciphertext on a public blockchain", matching the terms.
- **L6:** the "OP Mainnet" denylist exception is keyed on chain 10, not on a mainnet status (Arbitrum One still bans "mainnet").
- **L7:** the privacy RPC row's policy link comes from `docs/compliance/origins.json` (`privacy: {name, url}`; https only, plain name); a row without one says "Not published".
- **Refusal copy (founder):** on chain 10 every sponsorship refusal says "CryoShield could not pay the network fee for this save. Nothing was saved and your vault is unchanged. Sponsorship limits reset over time; if you’re adding a new secret, keep it somewhere safe until it saves." under the title "Saving is paused". Testnets keep their messages (the testnet per-sender cap does not reset). The `gas-sponsorship` "Refusal is visible and safe" requirement is MODIFIED to say so.

### D7. Audit decision

`CLAUDE.md` and the PRD record "No external audit for the MVP", compensated by open source, the published format spec, cross-implementation vectors and internal reviews (`docs/reviews/`). The mainnet launch is the moment to confirm or change that, because value at risk changes. Options:

- **A. Launch unaudited** with the D6 copy everywhere, a security contact and private reporting (`SECURITY.md`), and the four internal audits on record.
- **B. Fund an audit first** (contracts: VaultRegistryV2 and the CBSW subclass; vault-crypto and the recovery tool), for example through the NLnet grant (deadline 3 November 2026), and launch after its findings are fixed.
- **C. Launch unaudited now and apply for NLnet funding for an audit after launch** (A plus a scheduled audit).

The plan recommended C. **Founder decision (2026-10-09): A.** Launch unaudited; no contract audit is planned ("No audit on contracts"). The copy says "has not been independently audited" on every chain and never implies that an audit is coming (no "yet" on mainnet). An NLnet application stays possible, but it is not a planned next step and nothing promises it. The decision and its date still go into the launch record (task 1.3, G6).

### D8. Mainnet Pimlico policy (founder decisions 2026-10-09)

The founder created the mainnet policy in the Pimlico dashboard, then, after the pre-launch review, decided to add resets. The values replace the plan's first ones (per sender 50 operations and $1 monthly; global $20 and 2,000 operations per day; $0.10 per operation). **Planned values; the exact live values are recorded at task 1.2:**

| Setting | Founder's planned value |
|---|---|
| Policy id (public: it ships in the bundle as `VITE_SPONSORSHIP_POLICY_ID`) | `sp_many_longshot` |
| Chain | Optimism (10) |
| State | **disabled**; the founder enables it right after the first chain-10 deploy is green (runbook step 8) |
| Per user | $1 and 10 operations, **reset monthly** |
| Global | $30 and about 500 operations, **reset daily** |
| Per operation | **$0.50** |
| Date range | 2026-10-09 to 2027-10-02 |

In short: **per-user limits reset monthly, global limits reset daily (values recorded at task 1.2).** The per-operation cap of $0.50 (plan: $0.10) is a founder decision recorded as a MODIFIED `gas-sponsorship` "Sponsorship limits" requirement in this change; the other `harden-gas-sponsorship` numbers stay the spec's starting values. That MODIFIED delta targets a capability created by the unarchived `harden-gas-sponsorship`; `openspec validate --strict` accepts it, and it archives cleanly only after that change, which the proposal's archive order already requires.

**Consequences, stated plainly:**

- **A user can be refused for the rest of the month** after 10 sponsored operations (create, edits, add-key). The app then says the fee could not be paid, nothing was saved, and limits reset over time (D6, refusal copy). A typical first month (1 create, 3 edits, 1 add-key) uses 5. Reading and recovery are unaffected. There is no "saves left" hint on mainnet (`src/account/budget.ts` is testnet-only); adding one is a separate change.
- **Abuse can stop saving for everyone for the rest of a day** by reaching the global $30 or about 500 operations; the limit resets the next day. Sustained abuse costs up to about $30 a day.
- **One operation can cost up to $0.50** during a gas spike (five times the plan's cap), bounded by the global daily cap.
- **The policy ends on 2027-10-02.** After that, sponsorship stops for everyone unless the founder extends it (R17).
- **The policy is disabled until the first chain-10 deploy is green.** Saves in that window are refused.
- The prepaid balance (about $140, no card) stays the hard bound on spend that bypasses the policy (AA-M3).

## Go/no-go criteria

All must be **met and recorded** in `docs/reviews/launch-op-mainnet.md` (task 7.1) before the owner broadcasts. The pre-launch security review (task 6.1) must also be clean. A "no" on any is a no-go. Status as of 2026-10-08 is given for orientation only.

| # | Criterion | Evidence | Status 2026-10-08 |
|---|---|---|---|
| G1 | **Human production gate (CI-C1).** Production deploys only from owner-cut `v*` tags (tag ruleset, owner-only workflow gate, tag-only environments). Founder decision 2026-10-08: this is the human gate for mainnet, replacing the "reviewer back on `production`" item of the `split-dev-and-release-deploys` re-gate. CI-H1 closed (agents only through the machine account) and hardware-key 2FA on the owner account remain required. | `apply.sh --with-ecc-review --environments` prints no diff; `gh api user --jq .login` for agents is the machine account; owner confirms 2FA | Release gate in place; CI-H1 and 2FA to confirm |
| G2 | **T1 resolved.** Dev runs on its own registrable domain; nothing under `cryoshield.app` serves dev. | `dig +short dev.cryoshield.app` A/AAAA/CNAME empty; `fly certs list --app cryoshield-web-dev` without it | DNS empty today |
| G3 | **`harden-gas-sponsorship` review and testnet proof.** Its task 7.1 security review recorded with no open CRITICAL/HIGH; tasks 6.2 (sponsored create, edit, add-key, UV=0 refused), 6.3 (hardware checklist, measured costs) and 6.4 (founder vault on v2) pass on OP Sepolia; task 8.1 approval recorded. | `docs/reviews/harden-gas-sponsorship.md`; ticked tasks | Open |
| G4 | **Pimlico mainnet settings.** Policy per D8 (founder 2026-10-09; proposal item 4), chain allowlist `[10]`, a dedicated mainnet key restricted to `https://cryoshield.app` with bundler + paymaster methods only, ~$140 prepaid, no card. Task 1.1 answers recorded, including whether a policy can be made mandatory on the key. | Dated dashboard notes (no secrets) in `apps/web/docs/paymaster-policy.md` | Open |
| G5 | **Recovery tool on mainnet.** A tool release with the `op-mainnet` preset from `10.json` passes its preset-parity tests, and on launch day reads and unlocks the founder's mainnet vault from public RPCs and from Arweave. | Tests green; launch-record entry | Open |
| G6 | **Audit decision** recorded (D7). | Launch record | Open (Q1) |
| G7 | **Monitoring ready.** The runbook in `paymaster-policy.md` has the mainnet thresholds and cadence (below), and the founder has the calendar reminders. | Runbook PR merged | Open |
| G8 | **Rollback ready.** The four current `production-build` values are saved offline, the testnet `VITE_BUNDLER_URL` taken from the Pimlico dashboard (L8); `vA`'s commit is green on the dev site on OP Sepolia (D3, Sequencing B); the previous-image rollback is known to work. | Launch record | Open |
| G9 | **Compliance mainnet gate** (`add-privacy-and-compliance`, rescoped 2026-10-08 for the OSS project: no company, no lawyer items): a `mainnet-gate` review-log entry dated within 30 days, covering its mainnet checklist (pages name the network truthfully, sanctions stance in `docs/compliance/legal-analysis.md` §6 still current, risk register re-scored and signed). CI enforces it: the PR that adds `10.json` fails without that entry and without this launch record (`.github/scripts/mainnet-gate.mjs`), so the launch record must be merged first (task 1.3). Placeholders are already refused by `verify-build`. | `docs/compliance/review-log.md`, this launch record | Open |
| G10 | **Copy and build.** The chain-10 build passes `verify-build` (`VERIFY_CHAIN_ID=10`) and every copy test in section 4; the chain-11155420 build still passes. | CI on `vA` | Open |
| G11 | **Chain facts re-checked on the day** (table above) and the deployer balance ≥ 0.001 ETH. | Launch record | Re-run on the day |

## Launch-day runbook

Roles: **owner** = the founder (repository owner, deployer keystore holder, Pimlico admin). **Agent** = the machine account (PRs only). Times are relative to the switch (S).

**Before the day (S−7 to S−1)**
1. Agent: land sections 2–5 of tasks.md (guards, verification script, copy, presets code) through normal PRs. They are chain-agnostic and ship to dev on OP Sepolia.
2. Owner: Pimlico mainnet policy and key (G4). Do not put the key in any environment yet.
3. Owner: record G1, G2, G3, G6, G9 in the launch record.

**Launch day**

| Step | Who | Action | Check | Abort / rollback |
|---|---|---|---|---|
| 0 | owner | Re-run the read-only chain checks (task 1.1) | Matches the table; balance ≥ 0.001 ETH | Stop if any dependency is missing |
| 1 | owner | Simulate: `DEPLOYER_ACCOUNT=cryoshield-deployer OP_MAINNET_RPC_URL=https://mainnet.optimism.io contracts/script/deploy.sh op_mainnet` | Prints the three D1 addresses, `v1: not deployed on op_mainnet (by design)`, "simulation complete; nothing sent" | Stop on any address mismatch (the D1 guard does this) |
| 2 | owner | Broadcast: same command with `BROADCAST=1 CRYOSHIELD_MAINNET_GATE=approved:10` (only after task 8.1 of `harden-gas-sponsorship` is recorded) | `deployments/10.json` written with `contracts.vaultRegistryV2` and `contracts.wallets["cryoshield.app"]`, no top-level `address`; Blockscout and Sourcify verified | Exit 2 = deployed and recorded, verification failed: re-run the printed retry commands. Contracts are immutable: no rollback needed |
| 3 | owner | `ETHERSCAN_API_KEY=… contracts/script/verify-etherscan.sh 10` (key typed into the environment, never argv) | Three contracts "Pass - Verified" on Optimistic Etherscan | Retry later; not a launch blocker if Blockscout and Sourcify pass |
| 4 | agent | PR: `10.json`, regenerated recovery `op-mainnet` preset, default network `op-mainnet`, devices row stays untested | CI green incl. preset parity; ECC review; merged; dev deploy still OP Sepolia and green | Fix forward |
| 5 | owner | Release the recovery tool (with the mainnet preset) and publish its hashes | `uvx cryoshield-recover --version`; `--network op-mainnet` shows registry v2 | Hold the switch until it is out |
| 6 | owner | Save the four current `production-build` values offline: the three variables from `gh variable list --env production-build`, and the testnet `VITE_BUNDLER_URL` copied from the **Pimlico dashboard** (GitHub cannot return a secret, review L8). Then set `VITE_CHAIN_ID=10`, `VITE_RPC_URL`, `VITE_SPONSORSHIP_POLICY_ID=sp_many_longshot` as variables and the mainnet `VITE_BUNDLER_URL` as the secret (Sequencing B, D3) | `gh variable list --env production-build` shows the mainnet values; `gh secret list --env production-build` shows `VITE_BUNDLER_URL` only; the offline record has all four testnet values | Restore the saved values |
| 7 (= S) | owner | `gh release create vA --target main --generate-notes`: the first `v*` release since 2026-10-05, deployed straight to chain 10 | Full CI, build for chain 10, smoke green; `/release.json` shows chain 10, registry v2 `0xA622…cB7`, `registry: null`; landing shows "OP Mainnet" and "not been independently audited"; no testnet banner | Build failure: nothing deployed. Deploy or smoke failure: automatic rollback to the 2026-10-05 OP Sepolia image; fix forward or restore the values (step 6) before any redeploy |
| 8 | owner | Enable the Pimlico policy `sp_many_longshot` (D8) | The dashboard shows it enabled with the recorded values | Disable it again |
| 9 | owner | Founder smoke with two YubiKeys on https://cryoshield.app: create, unlock, edit, add-key; check the Arweave mirror | Each operation included; explorer links point to `explorer.optimism.io`; the vault location panel names OP Mainnet | Before announcement: restore values and redeploy `vA` (D4) |
| 10 | owner | Recovery tool against the new vault: default network, public RPCs only; then the Arweave path | Vault unlocks; secrets match | As step 9 |
| 11 | owner | Pimlico dashboard: the four operations are under the mainnet policy; spend per operation recorded | No policy-less sponsorship; per-op cost well under $0.50 (D8) | Pause the policy if anything is unexpected |
| 12 | agent | PR: measured costs in `apps/web/docs/costs.md`, the `/devices` YubiKey row with the mainnet test, launch record entries | Copy tests green | Fix forward |
| 13 | owner | Soft-launch window (Q5): no announcement for 7 days, monitoring at launch cadence | No threshold crossed | Chain rollback (restore the testnet values, redeploy `vA`) still possible while only the founder's vault exists |
| 14 | owner | Announce (communications plan) | — | — |

## Threat and risk table

| # | Threat or risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | Sponsorship drained by scripted fresh accounts | M | Saving refused for everyone for the rest of the day once the global $30 or ~500 operations is reached (D8, daily reset) | Global daily caps, per-op $0.50, per-user 10 operations a month, daily review in the launch period, D6 trigger | Accepted: availability only, vaults unaffected |
| R2 | Policy-less use of the public mainnet key (AA-M3), if Pimlico cannot make the policy mandatory | M | Loss of the prepaid balance (~$140) | Prepaid only, no card (no overdraft), origin restriction, low balance, weekly reconciliation of policy vs total spend | Bounded by the balance; founder accepts at G4 |
| R3 | Mainnet bytecode differs from the reviewed OP Sepolia bytecode | L | Unreviewed contracts live | D1 guard (addresses must equal `11155420.json`), deploy from a clean `vA`-equivalent tree, three explorer verifications | Low |
| R4 | Third party front-runs the CREATE2 deployment | L | None (identical code, no admin) | D1 response: verify bytecode, record by hand | None |
| R5 | Deployer keystore misuse or compromise | L | Attacker can deploy contracts from it, but holds no power over ours (no admin, no owner) | Keystore only, never a raw key in argv (`deploy.sh`), small balance | Low: the deployer has no privileges |
| R6 | Contract bug found after launch | L–M | Writes may need pausing; contracts immutable | Pause sponsorship; new versioned registry/wallet in a new change; readers keep old versions (as v1/v2 today); audit decision D7 | Accepted, disclosed as "unaudited" |
| R7 | Dishonest or stale copy (says testnet on mainnet, or drops "unaudited") | M without tests | Users misjudge risk | D6 chain-driven copy, tests on both chains, denylist, launch-day visual check | Low |
| R8 | Users' testnet vaults "disappear" from cryoshield.app | H (certain for testnet users) | Confusion; perceived loss | 90-day notice in app and FAQ, recovery tool `--testnet`, comms | Low |
| R9 | Rollback to a tag that cannot build for chain 10 | M | Failed rollback during an incident | Runbook names `vA`+ as the only valid targets; a failed first deploy rolls back to the self-contained 2026-10-05 image (D3, Sequencing B) | Low |
| R10 | Public RPC outage or rate limiting (`mainnet.optimism.io`) | M | Reads slow or fail in the web app | Recovery tool uses three RPCs with quorum; web app shows the existing error state; RPC choice in `VITE_RPC_URL` can be changed with a release | Accepted |
| R11 | Recovery tool cannot find mainnet vaults (stale preset) | L after G5 | Recovery without CryoShield broken | Preset generated from `10.json`, parity tests, launch-day recovery test | Low |
| R12 | Cross-chain linkability: the same keys give the same account address and locators on OP Sepolia and OP Mainnet | H (by construction) | A testnet user's mainnet vault is linkable to their testnet activity | Disclosed in the privacy policy's "public and permanent data" section; no secret is exposed | Accepted |
| R13 | Cross-chain replay of `executeWithoutChainIdValidation` operations (same account address on both chains) | L | A replayed owner-management call signed on one chain lands on the other | The app never signs replayable operations; only an in-place upgrade (not automated) would; replay needs the user's own signature | Low |
| R14 | Bundled legal or compliance exposure (PMLA/VDA, GDPR controllership, sanctions) | M | Regulatory | G9 gate and Q3 | Founder decision |
| R15 | Gas spike making operations exceed the $0.50 per-op cap | L | Individual saves refused ("Saving is paused") | Cap is ~135× the estimate; daily review; raise only with a recorded reason | Accepted |
| R16 | Real users reach the per-user cap (10 operations a month, D8) | M (active users) | That user is refused until the monthly reset; the message says nothing was saved and limits reset | Refusal monitoring; raise the cap with a recorded reason; reading and recovery unaffected | Accepted by the founder (D8) |
| R17 | The policy's end date (2027-10-02) passes unnoticed | L | Saving paused for everyone | Reminder 30 days before; monthly check | Low |
| R18 | The testnet bundler URL cannot be restored for a chain rollback (GitHub never returns a secret) | M without the L8 note | Chain rollback blocked | Runbook step 6 copies it from the Pimlico dashboard into the offline record before switching | Low |

## Costs

Live inputs (2026-10-08, table above): L2 gas price 1,002,688 wei; ETH $2,572.65. L1 data fees from `GasPriceOracle.getL1FeeUpperBound(size)` (an upper bound).

**Deployment (one-off, deployer pays):**

| Transaction | L2 gas (`cast estimate`) | L2 fee (wei) | L1 fee upper bound (wei, tx size) | Total ETH | USD |
|---|---|---|---|---|---|
| VaultRegistry v2 (CREATE2) | 1,137,864 | 1.141e12 | 1.356e11 (≈ 5.2 KB) | 0.00000128 | $0.0033 |
| `cryoshield.app` factory + implementation (CREATE2) | 4,250,255 | 4.262e12 | 5.307e11 (≈ 20.5 KB) | 0.00000479 | $0.0123 |
| **Total** | 5,388,119 | | | **≈ 0.0000061** | **≈ $0.016** |

The funded 0.005 ETH (≈ $12.86) covers this about 800 times, so even a 100× gas spike fits, and the rest stays for a future versioned registry.

**Per sponsored operation (Pimlico pays, billed to our prepaid balance):** L2 gas from `apps/web/docs/costs.md` (anvil, which uses the ~250k-gas software P-256 fallback; OP Mainnet has the precompile, so about 250k is subtracted) plus the VaultRegistry v2 deltas in `contracts/GAS.md`.

| Operation | Est. L2 gas | L1 fee bound | Est. cost | Policy cap (D8) |
|---|---|---|---|---|
| Create (account deploy, 2 keys, 1 KB) | ≈ 1.32M | 6.6e10 wei (≈ 2.5 KB) | ≈ 1.39e12 wei ≈ **$0.0036** | $0.50 |
| Edit (1 KB) | ≈ 0.33M | 5.3e10 wei (≈ 2 KB) | ≈ 3.8e11 wei ≈ **$0.0010** | $0.50 |
| Add key | ≈ 0.51M | 5.3e10 wei | ≈ 5.6e11 wei ≈ **$0.0015** | $0.50 |

- Pimlico's own surcharge on sponsored gas and its pre-charge at maximum cost (refunded after about 15 minutes) are **not** included; task 1.1 of `harden-gas-sponsorship` and the launch-day step 11 record the real per-op charge. Measured numbers replace these estimates in `costs.md`.
- **Budget arithmetic (founder's planned policy, D8):** the global cap allows up to $30 or about 500 operations a day; at ~$0.004 per operation the 500-operation count binds first (about $2 a day), unless gas rises about 15×. A typical user (1 create, 3 edits, 1 add-key) costs about $0.008; the 10-operation monthly per-user cap binds long before the $1 one. The ~$140 balance is more than four days at the $30 daily spend cap; it remains the bound for policy-less spend.

## Communications and copy plan

- **Principles:** say exactly what changed and what did not. Never say "audited", "guaranteed" or "can't be lost". Always pair "permanent" with "only your keys can open it; lose all of them and nobody can".
- **Before launch (S−7):** the "moving to OP Mainnet" text (`S.network.moving`), published in the README status line and a GitHub discussion. It does not appear on the live site: production stays on the 2026-10-05 build until `vA` deploys straight to OP Mainnet (D3, Sequencing B).
- **At the switch:** the D6 mainnet copy on every page; the GitHub release notes for `vA` list the network, the contract addresses with explorer links (Blockscout, Etherscan, Sourcify), the audit status and the recovery-tool version.
- **Announcement (S+7, after the soft launch):** the same facts, plus: how to back up (two keys, PIN), what CryoShield never sees, how recovery works without us, the security contact, and the cost model (CryoShield pays gas, up to limits; "Saving is paused" means the limit was reached, not that a vault is at risk).
- **Incident wording (prepared):** "Saving is paused" (budget), "We found a problem in X; your vault is safe and readable with the recovery tool; we have paused saving while we fix it" (contract), and the existing incident runbook of `add-privacy-and-compliance` for anything involving user data.
- **Where:** the site, GitHub release notes, the README status line, `docs/system-design.md` status line. No new channel is required.

## Post-launch monitoring

There is no CryoShield server, so monitoring is manual and read-only.

| What | How | Launch cadence (first 14 days) | Steady cadence | Threshold → action |
|---|---|---|---|---|
| Pimlico spend and balance | Dashboard: usage by policy, balance, daily spend against the global cap (D8) | Daily | Weekly (runbook) | Balance < $50 → review usage, then top up to ~$140; any day at the global cap → check for abuse (D6) before raising it |
| Policy-less sponsorship | Dashboard: spend not attributed to the mainnet policy | Daily | Weekly | Any → rotate the key, review AA-M3, D6 trigger |
| Per-operation cost | Dashboard; compare with the cost table | Daily | Monthly | Median > $0.03 → investigate gas; > $0.50 → operations being refused |
| Refusals | Dashboard rejected requests; user reports | Daily | Weekly | Real users at the 10-operation monthly cap, or sustained refusals → raise the cap with a recorded reason |
| Policy end date | Pimlico policy date range (ends 2027-10-02) | n/a | Monthly | 30 days before the end → extend it or record why not |
| Registry activity | `cast logs --address 0xA622…cB7 --from-block <deployBlock> --rpc-url https://mainnet.optimism.io` (vault created/updated events) | Daily | Weekly | Spikes without matching Pimlico spend → investigate (self-funded writes are allowed, but unexpected) |
| Site and release | `curl -s https://cryoshield.app/release.json` (chain 10, commit) | Daily | On each release | Mismatch → redeploy the expected tag |
| Recovery path | Run the recovery tool against the founder's mainnet vault | Day 1 and day 7 | Monthly | Failure → SEV1 per the incident runbook |
| Deployer balance | `cast balance 0x3314…26bf` | Once | Before any deploy | — |

Weekly review results go into `apps/web/docs/paymaster-policy.md`'s review log (existing `harden-gas-sponsorship` requirement). The D6 own-paymaster trigger is evaluated at each weekly review.

## Risks / Trade-offs

- **[Launching unaudited]** → D7; mitigated by honest copy, open source, vectors, internal reviews; founder decision Q1.
- **[Manual monitoring]** → a missed day can let an abuse day pass unnoticed; bounded by the daily cap and the prepaid balance.
- **[Sequencing B: no production run of `vA` on OP Sepolia]** → no production-proven chain rollback; mitigated by the dev site running the same commit on OP Sepolia, the self-contained previous image, and the saved values (D3).
- **[Recovery default switches to mainnet]** → testnet users must pass `--testnet`; the tool prints the network and the 90-day notice tells them.

## Open questions for the founder (answered 2026-10-09)

The plan asked at most five questions, each with a recommended default. The founder's answers:

1. **Q1. Audit.** Plan default: C (launch unaudited, apply to NLnet for an audit after launch). **Answer: A.** Launch unaudited; no contract audit is planned ("No audit on contracts"). The copy says "has not been independently audited" and never implies an audit is coming. See D7.
2. **Q2. Recovery tool default network.** **Answer: yes (accepted).** `op-mainnet` by default, `--testnet` for OP Sepolia, the network always printed.
3. **Q3. Compliance gate.** Answered on 2026-10-08 ("It's OSS so no company and legal"): the gate is the `mainnet-gate` review-log entry (G9), enforced in CI.
4. **Q4. Testnet vaults on cryoshield.app.** **Answer: yes (accepted).** No migration, a 90-day notice (in the app's no-vault state: D6, As implemented), recovery tool `--testnet`.
5. **Q5. Exposure.** **Answer: yes (accepted).** A 7-day soft launch with daily monitoring before the announcement.

Also decided on 2026-10-09: **no separate testnet release**, then **Sequencing B** (the mainnet values are set before the first tag, D3), and the **mainnet Pimlico policy** with monthly per-user and daily global resets and a $0.50 per-operation cap (D8).

## Security review

Two reviews, both recorded in `docs/reviews/launch-op-mainnet.md`. **Task 6.1 (pre-launch)** runs after the code tasks and before the owner broadcasts. It covers: the D1 guard, `verify-etherscan.sh` (no key in argv, logs or files), the copy honesty on both chains, the recovery preset parity, the go/no-go evidence, and that no CryoShield server, admin key or new runtime dependency was introduced. **Task 8.1 (final)** runs after the launch and checks that what is live (bytecode, verifications, `10.json`, `/release.json`, CSP, copy, Pimlico settings, recovery-tool hashes, monitoring log) matches what was reviewed.
