# Proposal: The web app reads every registry version

## Why

Founder decision (2026-10-08): registries are immutable and versioned (v1, v2, a future v3, …). Clients read every
version, and the newest registry holding a vault ID is authoritative. `recover-registry-versions` made the recovery tool
generic (PR #48) and left the web app as follow-up 7.2: "Make the web app and `release-manifest.mjs` read a registry
list (`config.registries`), through its own change." This is that change.

Today the web app is hard-wired to two versions:
- the build reads only the top-level v1 and `contracts.vaultRegistryV2` (`vite-plugins/deployment.ts`), and the runtime
  config has fixed `registryV1`/`registryV2` fields;
- `RegistryVersion` is `'v1' | 'v2'`; reads, dates, the vault list, the vault-location panel and the write gating all
  compare against those two literals;
- `release-manifest.mjs` publishes only `config.registry` (v1) and `config.registryV2`;
- the architecture page, its freshness tests and the smoke test know exactly two rows.

A v3 record entry would be silently ignored by the build, so users whose vault moved to v3 would be shown a stale v2
copy, and new vaults would still be written to v2.

## What Changes

- **Build config: an ordered registry list.** One parser (`vite-plugins/registries.mjs`), shared by the Vite plugin and
  `release-manifest.mjs`, reads `contracts/deployments/<chainId>.json`: the top-level entry as v1,
  `contracts.vaultRegistryV2` as v2, and the proposed `contracts.vaultRegistries.v<N>` (and `contracts.vaultRegistryV<N>`)
  for later versions. ABI kinds stay explicit: v1 is kind 1, v2 is kind 2, and v3+ gets a kind only when its `abiHash`
  equals the keccak256 of `VaultRegistry.json` or `VaultRegistryV2.json` byte for byte. Anything else fails the build
  with "update the app". The newest registry must have the v2 (write) interface.
- **Reads:** every registry, newest first. The newest registry holding a vault ID is authoritative; an older copy of
  that ID is ignored. If a newer registry can't confirm whether it holds the ID, the read fails
  (`RegistryUnconfirmedError`) instead of falling back to the older copy. For v1 + v2 this is today's behaviour exactly.
- **Writes** go to the newest registry only. Vaults in any older registry are read-only in the app.
- **`/release.json` and the release manifest** publish `config.registries`
  (`[{version, address, deployBlock, abiHash}]`, newest first). `config.registry` and `config.registryV2` stay for this
  release, so the deploy smoke test and older recovery-tool versions keep working.
- **Pages:** the architecture page lists one row per registry, with its version, newest first. The vault-location panel
  names the vault's registry version and says when it is read-only. The build and E2E freshness tests check every row.
- **Smoke test** (`.github/scripts/deploy/smoke.sh`): also checks `config.registries` (shape, order, v1/v2 equal to the
  record, every listed registry shown on `/architecture`) and, when the optional `REGISTRIES` list is given, that it is
  exactly the record's list. The deploy workflows are not changed here (their run steps are digest-pinned; see design D6).

**Runtime dependencies:** none added. No CryoShield-operated backend: the app still talks only to the public RPC, the
third-party bundler/paymaster and Arweave.

**Out of scope:**
- any change to `contracts/` (records, ABIs, `deploy.sh`) or to the record key decision (follow-up 7.1, contracts);
- user-facing copy for "older" vaults beyond the version label (today's "older test vault" wording stays; it only
  becomes visible for a non-v1 vault once a v3 exists, which is a product decision for that release);
- migrating vaults between registries;
- wiring `REGISTRIES` into the deploy workflows (needs a reviewed digest update of `privileged-run-steps.json`).

## Impact

- `apps/web`: build plugins, runtime config shape, `src/chain/registry.ts`, `src/chain/history.ts`, UI write gating,
  the vault-location panel, the architecture page, `deploy/release-manifest.mjs`, tests.
- `.github/scripts/deploy/smoke.sh` and `.github/scripts/test/deploy-scripts.test.mjs`.
- Specs: `vault-web-app`, `architecture-page`, `web-hosting`, `continuous-deployment`.
