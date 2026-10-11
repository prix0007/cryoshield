# OP Mainnet release checklist (cryoshield.app)

The launch-day runbook of OpenSpec change [`launch-op-mainnet`](../../openspec/changes/launch-op-mainnet/design.md)
(design → Go/no-go criteria, Launch-day runbook, D3 Sequencing B, D4 Rollback), as one ordered checklist. Copy the
task list into a GitHub issue on the day and tick it there. Where this file and the design disagree, the design wins;
fix this file in a PR.

**Who:**
- **Founder** = the repository owner (`prix0007`): deployer keystore, Pimlico admin, production settings, tags and
  releases.
- **Agent** = the `cryoshield` machine account: branches and PRs only.

Agents never create tags or releases, never set production variables or secrets, and never deploy contracts or
broadcast transactions.

**Never paste a secret value** (bundler URL, Pimlico or Etherscan API key, Fly token) into a chat, an issue, a PR, a
commit or a terminal log. Every check below uses names only.

**Release tag and day.** The first mainnet release is **`v1.0.0`** (founder, 2026-10-12; it replaces the design's
placeholder `vA` and the briefly planned `v0.1.0`), on **2026-10-13**, the switch day set in
`apps/web/src/config/launch.ts`. There are no tags yet (checked 2026-10-12).

**Fixed values** (all public):

| | Value |
|---|---|
| Chain | OP Mainnet, chain ID 10, RPC `https://mainnet.optimism.io` |
| Deployer | keystore `cryoshield-deployer`, address `0x33144f681d83527c0a8f364751a5d2f4505d26bf` |
| VaultRegistry v2 (predicted) | `0xA622c92d3D5b54aeA081Cf410224a8A2eCb08cB7` |
| `cryoshield.app` factory / implementation (predicted) | `0x775dc816594262274E78Ae75D97C8EdB0df5DfED` / `0x8aA76FaA6629cA1EA8ccC3F9Edf0E8D98816Acd7` |
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Pimlico paymaster | `0x6666666666667849c56f2850848ce1c4da65c68b` |
| Pimlico policy | `sp_mixed_hellion` (Disabled until phase 6) |

## 0. Before the day

- [ ] **0.1 Founder: sign the gate (PR #80).**
  - **Do:**
    - Sign the risk register and confirm the sanctions stance (`docs/compliance/legal-analysis.md` §6).
    - Sign the `mainnet-gate` entry in `docs/compliance/review-log.md`.
    - Fill in "Founder go decision" in `docs/reviews/launch-op-mainnet.md`.
    - Remove the `hold` label and merge #80.
  - **Check:** #80 is merged and every G1–G11 row has evidence or is marked "on the day".
  - **If it fails:** do not continue. Nothing is deployed yet.
- [ ] **0.2 Founder: check the 30-day window.** CI fails the PR that adds `contracts/deployments/10.json` unless
  `review-log.md` has a `mainnet-gate` entry dated within the previous 30 days (`.github/scripts/mainnet-gate.mjs`).
  - **Check:** the entry's date + 30 days is after the day the `10.json` PR (phase 3) will run CI.
  - **If it fails:** add a new, dated, signed `mainnet-gate` entry first.
- [ ] **0.3 Founder: G7 monitoring reminders.** Put the cadence of `apps/web/docs/paymaster-policy.md` §7a in your
  calendar:
  - daily for the first 14 days, then weekly;
  - monthly checks;
  - a reminder 30 days before the policy ends (**2027-10-02**);
  - the Fly token rotation before **2027-10-05**.
  - **Check:** G7 marked done in the launch record.
- [ ] **0.4 Founder: G1 owner gate, 2FA and CI-H1.**
  - **Do:**
    - Confirm hardware-key 2FA on GitHub and Cloudflare.
    - Run `.github/rulesets/apply.sh --with-ecc-review --environments`.
    - As the machine account, run `gh api user --jq .login` and
      `gh api repos/prix0007/cryoshield --jq .permissions`.
  - **Check:**
    - `apply.sh` prints no diff (`release-tags` in sync).
    - The login is `cryoshield`, with `admin: false, maintain: false`.
  - **If it fails:** fix the setting first. Never run the probes as the owner.
- [ ] **0.5 Founder: G2, dev is not under `cryoshield.app`.** Run `dig +short dev.cryoshield.app A`, then `AAAA` and
  `CNAME`.
  - **Check:** all three print nothing.
  - **If it fails:** delete the record before continuing.
- [ ] **0.6 Founder: G3 sponsorship approval.** Record approval of `harden-gas-sponsorship` task 8.1 (the D8 values) in
  `docs/reviews/launch-op-mainnet.md`. The design requires it before the broadcast (runbook step 2).
- [ ] **0.7 Founder: "moving" notice, a few days before.** Publish the "Before the switch" text of
  [`op-mainnet-comms.md`](op-mainnet-comms.md) in the README status line and a GitHub discussion. It does not appear
  on the live site (Sequencing B).
- [x] **0.8 Agent: launch-dates PR.** Set `switchDate` (and `moveNoticeFrom` if wanted) in
  `apps/web/src/config/launch.ts` to the founder's chosen day, in a normal PR. It must merge before the tag (phase 5).
  While `switchDate` is `null`, the chain-10 build shows the testnet-vaults help with no 90-day end.
  - **Done (2026-10-12):** `switchDate: '2026-10-13'` (founder's day), `moveNoticeFrom: null` (only a production
    testnet build could show that notice, and none is released before the switch). The chain-10 build shows the
    testnet-vaults help until 2027-01-11 00:00 UTC. If the release slips past 2026-10-13, the 90 days still count from
    the 13th; update the date in a new PR if that matters.
- [ ] **0.9 Either: `main` is green on dev.**
  - **Do:** `curl -s https://cryoshield-web-dev.fly.dev/release.json`.
  - **Check:**
    - its `commit` is `main`'s HEAD;
    - the last `deploy-dev.yml` run passed.
  - The commit you tag in phase 5 must have run on dev (G8).

## 1. Chain checks, on the day (task 1.1, G11)

All read-only, against `https://mainnet.optimism.io`. Record each value and the date in the launch record.

- [ ] **1.1 Founder: chain ID.** `cast chain-id --rpc-url https://mainnet.optimism.io` prints `10`.
- [ ] **1.2 Founder: deployer.** Run `cast balance` and `cast nonce` for
  `0x33144f681d83527c0a8f364751a5d2f4505d26bf`.
  - **Check:** balance ≥ **0.001 ETH**; the nonce is noted.
  - **If it fails:** stop, and top up from your own wallet.
- [ ] **1.3 Founder: dependencies have code.** `cast code <address>` for the CREATE2 deployer, EntryPoint v0.6 and the
  Pimlico paymaster (table above).
  - **Check:** none is `0x`. Expected sizes on 2026-10-12: 69, ~23.7k and ~15.1k bytes.
  - **If it fails:** stop. A missing dependency is a no-go.
- [ ] **1.4 Founder: P-256 precompile (RIP-7212 at `0x100`) with a fresh signature.**
  - **Do:** save this as `p256input.py`. It makes a new key, signs a random hash, and prints the precompile input
    `hash‖r‖s‖x‖y`.

    ```python
    import os, hashlib
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, Prehashed
    k = ec.generate_private_key(ec.SECP256R1())
    h = hashlib.sha256(os.urandom(32)).digest()
    r, s = decode_dss_signature(k.sign(h, ec.ECDSA(Prehashed(hashes.SHA256()))))
    n = k.public_key().public_numbers()
    print("0x" + h.hex() + "".join(f"{v:064x}" for v in (r, s, n.x, n.y)))
    ```

    Then run:

    ```sh
    cd tools/recover && uv run python /path/to/p256input.py > /tmp/p256.in
    cast call 0x0000000000000000000000000000000000000100 "$(cat /tmp/p256.in)" --rpc-url https://mainnet.optimism.io
    ```
  - **Check:**
    - The valid input returns `0x…0001`.
    - The same input with the first hash byte changed returns `0x` (empty).
    - Both results were confirmed on 2026-10-12.
  - **If it fails:** stop. The wallets rely on the precompile.
- [ ] **1.5 Founder: predicted addresses are empty.**
  - **Do:** `cast code` for the registry v2, factory and implementation above, and for the v1 address in
    `contracts/deployments/11155420.json`.
  - **Check:** all four return `0x`.
  - **If it fails:** someone deployed first. That is harmless, because the code is identical and has no admin.
    Follow design D1:
    - compare `cast code` with `forge inspect … deployedBytecode`;
    - write `10.json` by hand from the actual transactions, reviewed in the phase 3 PR.
- [ ] **1.6 Founder: gas.** Run `cast gas-price --rpc-url https://mainnet.optimism.io` and note the value.
  - **Check:** roughly the design's 2026-10-08 figure (~0.001 gwei).
  - **If it fails:** a large spike is a reason to wait, not to continue.
- [ ] **1.7 Founder: record G11.** The values and the date go in `docs/reviews/launch-op-mainnet.md` (the launch-day
  log).

## 2. Deploy the contracts (Founder only; tasks 7.1–7.2)

- [ ] **2.1 Founder: G1–G11 complete.** Every go/no-go row has evidence (task 7.1). Any "no" stops the launch.
- [ ] **2.2 Founder: simulate,** from a clean checkout of `main`:

  ```sh
  DEPLOYER_ACCOUNT=cryoshield-deployer OP_MAINNET_RPC_URL=https://mainnet.optimism.io contracts/script/deploy.sh op_mainnet
  ```

  - **Check:** the output shows:
    - the three predicted addresses above;
    - `v1: not deployed on op_mainnet (by design)`;
    - "simulation complete; nothing sent".
  - **If it fails:** the D1 guard stops on any address mismatch and names the contract. Deploy from a clean tree of the
    release commit. Never edit the record to match.
- [ ] **2.3 Founder: broadcast.** Run the same command with `BROADCAST=1 CRYOSHIELD_MAINNET_GATE=approved:10`.
  - **Check:**
    - `contracts/deployments/10.json` has only `contracts.vaultRegistryV2` and `contracts.wallets["cryoshield.app"]` at
      the predicted addresses, and no top-level `address`;
    - Blockscout and Sourcify verifications pass.
  - **If it fails:** exit code 2 means deployed and recorded, but verification failed. Run the printed retry commands.
    Contracts are immutable and unused, so there is nothing to roll back.
- [ ] **2.4 Founder: Etherscan verification (optional).**
  - **Do:** put `ETHERSCAN_API_KEY` in the environment by typing it, not as an argument. Then run
    `contracts/script/verify-etherscan.sh 10`.
  - **Check:** all three contracts show "Pass - Verified" on Optimistic Etherscan.
  - **If it fails:** retry later. This does not block the launch if Blockscout and Sourcify pass.
- [ ] **2.5 Founder: bytecode matches.** For each contract, compare `cast code <addr> --rpc-url
  https://mainnet.optimism.io` with `forge inspect <Contract> deployedBytecode`.
  - **Check:** they are equal.
  - **If it fails:** stop and open a security review before anything points at these addresses.
- [ ] **2.6 Founder: hand over `10.json`.** It holds only public data. Either open the phase 3 PR yourself, or give the
  file to the agent.

## 3. Mainnet config and recovery tool (tasks 7.3–7.4)

- [ ] **3.1 Agent: one PR with `contracts/deployments/10.json`** plus the recovery branch `feat/mainnet-recovery-default`
  (`40b5cc1`: default network `op-mainnet`, `--testnet` for OP Sepolia). In the same PR, regenerate the `op-mainnet`
  preset from `10.json`.
  - **Check:**
    - CI is green, including the mainnet gate (0.2), the recovery preset-parity tests (task 3.1) and the web parity
      tests;
    - the ECC review has no blocking findings;
    - after the merge, the dev deploy is green and **still on OP Sepolia**.
  - **If it fails:** fix forward. Nothing on production has changed.
- [ ] **3.2 Founder: release the recovery tool (task 7.4). Decision needed. No documented procedure exists:**
  - `cryoshield-recover` is **not on PyPI** (404, 2026-10-12), so the plain `uvx cryoshield-recover` in task 7.4 and
    in the tool's README does not work today.
  - Publishing *any* GitHub Release starts `deploy.yml`, so a separate tool release named `v*` would deploy
    production. A non-`v*` tag fails at `detect`.
  - Pick one and record it in the launch record:
    - **A (no extra tag):**
      - the source install is pinned to the `v0.1.0` tag:
        `uvx --from "git+https://github.com/prix0007/cryoshield@v0.1.0#subdirectory=tools/recover" cryoshield-recover`;
      - the Linux binary is built from that tag with `tools/recover/scripts/build-binary.sh --docker --check`;
      - the binary and its SHA-256 are attached to the `v0.1.0` release.
      - Before tagging, the design's "hold the switch until the tool is out" (runbook step 5) is met by running the
        same `uvx --from git+…@<main commit sha>` from `main`.
    - **B:** publish to PyPI (trusted publishing). This needs a new workflow, which the owner adds through an OpenSpec
      change.
  - **Check:**
    - `--version` works;
    - `--network op-mainnet` shows registry v2 `0xA622…cB7` and no v1;
    - a run with no network flag says it uses `op-mainnet`.
  - **If it fails:** hold the switch until it works.

## 4. Production settings (Founder only; task 7.5, G8)

- [ ] **4.1 Founder: save the current values offline** (G8, review L8).
  - **Do:**
    - Copy the values of `gh variable list --env production-build` into your offline record.
    - Copy the **testnet** `VITE_BUNDLER_URL` from the **Pimlico dashboard**, because GitHub never returns a secret's
      value.
  - **Check:** the offline record has all four testnet values: `VITE_CHAIN_ID`, `VITE_RPC_URL`,
    `VITE_SPONSORSHIP_POLICY_ID` and `VITE_BUNDLER_URL`.
  - **If it fails:** do not set anything until the record is complete. Without it, a chain rollback is impossible.
- [ ] **4.2 Founder: set the mainnet values.** Enter each value at the prompt; never paste one into a shared place.
  - `gh variable set VITE_CHAIN_ID --env production-build --body 10`
  - `gh variable set VITE_RPC_URL --env production-build --body https://mainnet.optimism.io`
  - `gh variable set VITE_SPONSORSHIP_POLICY_ID --env production-build --body sp_mixed_hellion`
  - `gh secret set VITE_BUNDLER_URL --env production-build` (the bundler URL of the `cryoshield-mainnet` key, pasted at
    the prompt)
  - **Check:**
    - `gh variable list --env production-build` shows the three mainnet values;
    - `gh secret list --env production-build` lists only `VITE_BUNDLER_URL`;
    - `gh secret list --repo prix0007/cryoshield` lists no `VITE_BUNDLER_URL` or `FLY_API_TOKEN`.
  - **If it fails, or the launch is called off:** restore the saved values (D4: "Mainnet values set, `v1.0.0` not yet
    tagged").

## 5. Release (Founder only; task 7.5 = runbook step 7, the switch)

- [ ] **5.1 Founder: what you ship.** Run `git fetch origin && git log --oneline origin/main -5`.
  - **Check:** HEAD includes the phase 3 PR and the 0.8 dates PR, and dev runs it (0.9).
- [ ] **5.2 Founder: publish the release.**

  ```sh
  gh release create v1.0.0 --target main --generate-notes
  gh run watch "$(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
  ```

  - **Check:**
    - `deploy.yml` passes: `detect`, `config`, the full CI, the chain-10 build, `release` and the smoke test.
    - `curl -s https://cryoshield.app/release.json` shows the tagged commit, chain `10`, registry v2 `0xA622…cB7` and
      `registry: null` (no v1).
    - The landing page shows "OP Mainnet" and "not been independently audited", with no testnet banner.
  - **If it fails:**
    - a build failure deploys nothing;
    - a deploy or smoke failure rolls back automatically to the self-contained 2026-10-05 OP Sepolia image.
    - Then fix forward with a new tag, or restore the saved values (4.1) **before** any redeploy.
- [ ] **5.3 Founder: release notes.** Replace the generated notes with the `v1.0.0` template from
  [`op-mainnet-comms.md`](op-mainnet-comms.md), filled in from `10.json` and phase 3.2. Optionally add the live
  `treeHash` from `/release.json` (tabletop gap G2, accepted, so not required).

## 6. Turn on sponsorship (Founder only; runbook step 8)

Enabled after the chain-10 smoke test is green, and before your smoke test, which needs sponsorship.

- [ ] **6.1 Founder: enable `sp_mixed_hellion`** in the Pimlico dashboard.
  - **Check:**
    - it is Enabled, Optimism (10) only;
    - per user $1 and 10 operations, reset monthly;
    - global $30 and 500 operations, reset daily;
    - $0.50 per operation;
    - 2026-10-10 to 2027-10-02;
    - the balance is the prepaid amount, with no card.
  - **If it fails:** disable it again (`paymaster-policy.md` §2a).

## 7. Smoke tests (Founder only; tasks 7.7–7.8, G5)

- [ ] **7.1 Founder: two-key smoke on https://cryoshield.app:**
  1. create a vault with two YubiKeys;
  2. lock, then unlock with each key;
  3. edit and save;
  4. add a key (optional);
  5. check the Arweave copy.
  - **Check:**
    - every operation is included;
    - explorer links go to `explorer.optimism.io`;
    - "Where your vault is stored" names OP Mainnet.
  - **If it fails, before the announcement:** chain rollback per D4. Restore the saved testnet values and redeploy
    `v1.0.0` (`gh workflow run deploy.yml --ref v1.0.0`). Your test vault stays readable with the recovery tool.
- [ ] **7.2 Founder: recovery tool against the new vault.**
  - **Do:**
    - first with no network flag and `--no-arweave` (public RPCs only);
    - then with `--no-chain` (Arweave only).
  - **Check:** the vault unlocks both ways, the secrets match, and the tool says it uses `op-mainnet`.
  - **If it fails:** the same rollback as 7.1. Recovery without CryoShield is a launch requirement (G5).
- [ ] **7.3 Founder: Pimlico dashboard.**
  - **Check:**
    - every smoke operation is under `sp_mixed_hellion`;
    - there is no spend without a policy;
    - each operation costs well under $0.50. Record the cost.
  - **If it fails:** disable the policy (§2a) and investigate.
- [ ] **7.4 Founder: record it.** Write the launch-day log in `docs/reviews/launch-op-mainnet.md`: the transactions,
  costs and recovery results.

## 8. After the switch

- [ ] **8.1 Agent: measured costs PR (task 7.9).**
  - `apps/web/docs/costs.md` with the mainnet numbers from 7.3;
  - the `/devices` YubiKey row (date, flows tested on mainnet);
  - the launch record entries.
- [ ] **8.2 Founder: 7-day soft launch (task 7.10, Q5).**
  - Daily monitoring per `paymaster-policy.md` §7a:
    - balance;
    - spend without a policy;
    - cost per operation;
    - refusals;
    - registry events;
    - `/release.json`.
  - Record each day in its mainnet review log.
  - Then publish the announcement and the final `v1.0.0` notes (`op-mainnet-comms.md`).
- [ ] **8.3 Agent with the security reviewer: final security review (task 8.1).** The live bytecode, the verifications,
  `10.json`, `/release.json`, CSP, copy, the Pimlico settings (no secrets) and the recovery-tool hashes match what was
  reviewed.
- [ ] **8.4 Founder: recovery check again** on day 7, then monthly (§7a).
- [ ] **8.5 Agent: archive the finished OpenSpec changes,** in follow-up PRs (`/opsx:archive`): `launch-op-mainnet`
  after 8.3, and `harden-gas-sponsorship` before it (archive order in the proposal).
- [ ] **8.6 Founder: dev Pimlico key hardening.** On the `ct5x` key: account APIs off, origin
  `https://cryoshield-web-dev.fly.dev`.
- [ ] **8.7 Optional:** rename the production variables with a `PROD_` prefix. This changes workflows, so it needs its
  own OpenSpec change.

## Abort and rollback

| Situation | Action | Who |
|---|---|---|
| Any go/no-go row is "no" | Stop. Nothing is deployed | Founder |
| Contracts deployed, nothing else done | Nothing to undo. The contracts are immutable and unused | — |
| Mainnet values set, not tagged | Restore the saved values (4.1) | Founder |
| First chain-10 deploy or smoke test fails | Automatic image rollback to the 2026-10-05 OP Sepolia build. Restore the values or fix forward before any redeploy | Founder |
| Defect before the announcement | Restore the saved testnet values, then `gh workflow run deploy.yml --ref v1.0.0`. `v1.0.0` contains `11155420.json`, so it builds for OP Sepolia | Founder |
| Front-end defect after the announcement | `gh workflow run deploy.yml --ref <last good mainnet tag>`. **Do not** roll the chain back: users' mainnet vaults would disappear from the web app (they stay readable with the recovery tool) | Founder |
| Sponsorship abuse, spend without a policy, or a contract problem | Pause sponsorship: disable `sp_mixed_hellion`, and delete or rotate the key if it was abused (`paymaster-policy.md` §2a). Reading and recovery keep working | Founder |
| Site down | Nothing is at risk. Vaults are on chain and the recovery tool works without the site | — |

**What cannot be rolled back:**
- deployed contracts: there is no admin, no upgrade and no pause in the contracts;
- vault blobs once published on chain or Arweave: every version stays public forever;
- the deployer's spent gas.

Only `v1.0.0` and later tags can be rollback targets after the switch, because older tags have no `10.json` and cannot
build for chain 10.
