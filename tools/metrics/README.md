# `@cryoshield/metrics`

Aggregate, identifier-free CryoShield product metrics, computed only from **public** data: VaultRegistry events,
the cleartext key count in each vault blob's header, the public Arweave mirror and EntryPoint gas logs. No backend, no
tracking, no secrets. OpenSpec change `add-privacy-preserving-analytics` (spec `product-metrics`, design D1/D2).

## Run it

From the repository root (Node 22.18 or later, pnpm):

```sh
pnpm install --frozen-lockfile
pnpm metrics --network op-sepolia --out metrics.json   # or omit --out to print the JSON
```

Against the local chain (anvil) with a deployment record of your own, for example the test fixture's:

```sh
pnpm metrics --network anvil --rpc http://127.0.0.1:8545 --deployment path/to/31337.json --no-mirror --out metrics.json
```

`test/anvil.test.ts` runs exactly that command against a freshly seeded anvil chain (3 vaults with 2, 2 and 3 keys,
one updated twice in 2026-W41) and checks the report, so the documented command is tested.

| Option | Meaning |
|---|---|
| `--network NAME` | a preset from `config/chain-presets.json` (default `op-sepolia`) |
| `--rpc URL` | public RPC instead of the preset's `rpcs.json` list (repeatable) |
| `--deployment FILE` | deployment record instead of `contracts/deployments/<chainId>.json` |
| `--to-block N` | last block to read (default: head) |
| `--arweave URL` | gateway for mirror coverage (repeatable; default `https://arweave.net`, `https://turbo-gateway.com`) |
| `--no-mirror`, `--no-gas` | skip mirror coverage or sponsored gas |
| `--out FILE` | write the report to a file |

Exit codes: `0` report written, `1` failure, `2` usage or configuration error, `3` an RPC reports a different chain ID
(checked on every configured RPC before any log is read).

## What it reads

- **Every registry version** in `contracts/deployments/<chainId>.json`: v1 at the top-level `address`,
  `contracts.vaultRegistryV<N>`, and `contracts.vaultRegistries.v<N>`. A version is read with the v1 or v2 ABI by its
  `abiHash`; an unknown ABI is refused, never guessed.
- `VaultCreated`, `VaultUpdated` and `LocatorAdded` logs from each registry's deploy block, paged adaptively
  (10k blocks, halved on a range error, like `tools/recover`).
- The latest blob of each vault at the report's last block (`getVault`, or `getVaults` in batches of 32 on v2), for
  the key count N (byte 8 of the header). Nothing else in the blob is read.
- Arweave GraphQL by `CryoShield-Vault-Id` + `CryoShield-Version` of the latest version; an item counts only when its
  data (at most 1024 bytes) hashes to the on-chain `blobHash`.
- EntryPoint v0.6 `UserOperationEvent` logs filtered by vault-owner `sender`; gas counts as sponsored only when the
  `paymaster` is listed in `paymasters.json` (with its source). Other paymasters and unsponsored operations are
  reported separately.

## What it reports

One JSON object (`schema: cryoshield-metrics/1`): the network, chain ID and each registry's address and block range;
`vaults_total`, `vaults_by_registry`, `created`, `updates_total`, `updates`, `weekly_active` (ISO weeks), `keys_per_vault`,
`mirror_coverage` and `sponsored_gas` (wei and ETH, total and per week).

**Privacy rules** (all enforced in `src/report.ts` and tested):

- No address, vaultId, locator, credential ID, transaction hash, blob byte or per-vault row. Before anything is written,
  the report is scanned and refused if it holds any 20- or 32-byte hex value other than the registry addresses.
- On every public network (every chain except anvil, 31337), a weekly or distribution bucket, or a total, that covers 1
  or 2 vaults (for gas: 1 or 2 accounts) is shown as `"<3"`.
- Complementary suppression: if exactly one cell of a family that sums to a published total is hidden, the next-smallest
  cell is hidden too, so the hidden one can't be recovered by subtraction.

## Scheduled run

`.github/workflows/metrics.yml` runs `pnpm metrics --network op-sepolia` weekly (and on manual dispatch) with a
read-only token and no secrets, and uploads `metrics.json` as a workflow artifact kept for 90 days. It never commits,
pushes or deploys.

## Tests

```sh
pnpm --filter @cryoshield/metrics test        # unit tests + the anvil test (skipped without Foundry)
pnpm --filter @cryoshield/metrics typecheck
```

Set `CRYOSHIELD_REQUIRE_FOUNDRY=1` to fail instead of skipping when `anvil`/`forge` are missing (CI does).
