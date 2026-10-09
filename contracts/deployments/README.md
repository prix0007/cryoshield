# Deployment records: `deployments/<chainId>.json`

Written by `script/deploy.sh` (OpenSpec `harden-gas-sponsorship`, deployment-targets delta). The web app and the
recovery tool read addresses and deploy blocks **only** from these records, or from presets generated from them.

## Shape

```jsonc
{
  // VaultRegistry v1 (legacy, read-only). Present ONLY on chains where v1 exists (31337, 11155420).
  // NEVER present on OP Mainnet (10): v1 is not deployed to mainnet.
  "chainId": 11155420,
  "address": "0xB43f58cF17e64B603aE5588a1DD17E96a0849e44",
  "deployBlock": 49568053,
  "txHash": "0x…",
  "abiHash": "0x…",            // keccak256 of the exact bytes of abi/VaultRegistry.json

  "contracts": {
    "vaultRegistryV2": {
      "address": "0x…",
      "deployBlock": 123,       // start log scans here
      "txHash": "0x…",
      "abiHash": "0x…"          // keccak256 of the exact bytes of abi/VaultRegistryV2.json
    },
    "vaultRegistries": {        // VaultRegistry v3 and later (none deployed yet); see "Registry v3 and later"
      "v3": { "address": "0x…", "deployBlock": 123, "txHash": "0x…", "abiHash": "0x…" }
    },
    "wallets": {
      // One entry per RP ID: the implementation bakes in sha256(rpId), so each RP ID has its own pair.
      // Select the entry by VITE_RP_ID; a missing entry for the build's RP ID is a build error (no fallback).
      "cryoshield.app": {
        "implementation": "0x…",  // CryoShieldSmartWallet (deployed by the factory's constructor)
        "factory": "0x…",         // CryoShieldSmartWalletFactory (use for initCode / getAddress)
        "rpIdHash": "0x…",        // sha256(utf8(rpId)), equals implementation.RP_ID_HASH()
        "deployBlock": 123,
        "txHash": "0x…",          // the single tx that deployed the factory (and, inside it, the implementation)
        "abiHash": "0x…",         // keccak256 of the exact bytes of abi/CryoShieldSmartWallet.json
        "factoryAbiHash": "0x…"   // keccak256 of the exact bytes of abi/CryoShieldSmartWalletFactory.json
      },
      "cryoshield-web-dev.fly.dev": { "…": "same fields" }
    }
  }
}
```

The `abiHash` values are `cast keccak "0x$(xxd -p <file> | tr -d '\n')"`, the same as v1's.

## Registry v3 and later: `contracts.vaultRegistries.v<N>`

Decided in `recover-registry-versions` task 7.1 (design D5). Every registry version after v2 is recorded as
`contracts.vaultRegistries.v<N>` = `{address, deployBlock, txHash, abiHash}`, with exactly those four fields.

- **Old keys stay forever.** v1 keeps the top-level fields and v2 keeps `contracts.vaultRegistryV2`. Records are
  append-only history, and released tools read those keys. v1 and v2 are never repeated under `vaultRegistries`.
- **Keys** are `v3`, `v4`, … `v999`: a lowercase `v`, no leading zero. A map keyed by version, not a list, keeps
  `deploy.sh`'s "merge, keys sorted" behaviour and makes a duplicate version impossible.
- **`abiHash` is required.** It is keccak256 of the exact bytes of the registry's exported ABI, computed like the
  others. A web app or recovery tool released before vN can read vN only when vN's `abiHash` equals the hash of
  `abi/VaultRegistry.json` (read as v1) or `abi/VaultRegistryV2.json` (read as v2). Any other hash makes them refuse
  vN ("update the app" / "update cryoshield-recover"); they never guess an ABI. The hash is not checked on-chain by
  those readers: `script/check-deployments.sh` and the reviewed record PR are what bind it to the deployed code.
- **The newest registry takes every write**, so it must have the v2 (write) ABI. The web build fails otherwise.
- **Addresses are distinct** across all registry versions.
- `contracts.vaultRegistryV3`-style keys are also accepted by the web app, the recovery tool and the metrics tool
  (D5's fallback), but they are **not** used: `script/check-deployments.sh` rejects them as unknown keys, so only the
  `vaultRegistries` map can reach a committed public record.

Where it is read: the web build and the release manifest (`apps/web/vite-plugins/registries.mjs`, which also writes
`config.registries` into `/release.json`), the recovery tool (`tools/recover/src/cryoshield_recover/deployments.py`,
whose preset-vs-record parity test fails until its presets list the new version) and the metrics tool
(`tools/metrics/src/config.ts`).

Writing it: `script/deploy.sh` deploys and records v1, v2 and the wallets only. It keeps any existing
`vaultRegistries` entries when it merges. The change that adds VaultRegistry v3 to `contracts/src` also extends
`deploy.sh` to write `contracts.vaultRegistries.v3`, and `check-deployments.sh` to verify v3's init and runtime code.
Until then `check-deployments.sh` checks a v3 entry's shape offline (keys, fields, `abiHash` against the committed
ABIs, the newest-has-writes rule, distinct addresses), and its on-chain mode fails on any v3 entry, because it has no
build to compare it with.

## Which entries exist where

| Chain | v1 top-level | `contracts.vaultRegistryV2` | `contracts.wallets` keys |
|---|---|---|---|
| anvil (31337) | yes | yes | `localhost` (local and E2E builds) and `cryoshield.app` (CI `verify-build`); override with `RP_IDS` |
| OP Sepolia (11155420) | yes (existing, never redeployed) | yes: `0xA622c92d3D5b54aeA081Cf410224a8A2eCb08cB7`, block 49755277 (source verified on Blockscout 2026-10-06; `script/check-deployments.sh 11155420` all ok on 2026-10-09) | `cryoshield.app` (production build), `cryoshield-web-dev.fly.dev` (dev build) |
| OP Mainnet (10) | **never** | yes, after the mainnet gate | `cryoshield.app` only, after the mainnet gate |

`contracts.vaultRegistries` exists on no chain yet.

## OP Mainnet (chain 10): writing `10.json`

OpenSpec `launch-op-mainnet` (design D1, D2 and the launch-day runbook). Only the founder broadcasts, and only after
the go/no-go is recorded. `script/deploy.sh op_mainnet` checks, **before any RPC call**:

- **RP IDs:** only `cryoshield.app` (the default). Any other `RP_IDS`, including the dev RP ID
  `cryoshield-web-dev.fly.dev`, is refused.
- **No v1:** a `10.json` with a top-level `address` is refused.
- **D1 address parity:** the predicted VaultRegistryV2, `cryoshield.app` factory and implementation must equal
  `11155420.json` (`0xA622c92d3D5b54aeA081Cf410224a8A2eCb08cB7`, `0x775dc816594262274E78Ae75D97C8EdB0df5DfED`,
  `0x8aA76FaA6629cA1EA8ccC3F9Edf0E8D98816Acd7`). CREATE2 addresses depend only on the canonical CREATE2 deployer, the
  constant salts and the init code, so a mismatch means `contracts/src`, the solc settings, the metadata or the
  remappings drifted from the reviewed OP Sepolia build. The script names the contract and stops. Deploy from a clean
  tree of the release commit; never edit `11155420.json` to make it pass.

Then the run:

1. **Simulate:** `DEPLOYER_ACCOUNT=cryoshield-deployer OP_MAINNET_RPC_URL=https://mainnet.optimism.io script/deploy.sh op_mainnet`.
   It prints `parity=ok …`, `v1: not deployed on op_mainnet (by design)`, the three addresses and
   "simulation complete; nothing sent, no record written".
2. **Broadcast:** the same command plus `BROADCAST=1 CRYOSHIELD_MAINNET_GATE=approved:10` (the gate value is bound to
   the chain ID; plain `approved` is refused). It writes `10.json` with `chainId` 10, `contracts.vaultRegistryV2` and
   `contracts.wallets["cryoshield.app"]` only.
3. **Verify (keyless, automatic, after the record is written):** every new contract on Blockscout
   (`https://explorer.optimism.io/api/`) and on Sourcify. Exit 2 means "deployed and recorded, verification failed":
   run the printed retry lines; the contracts are immutable, so nothing needs rolling back.
4. **Etherscan (optional, never required):** put the key in the environment, never on the command line
   (`read -rs ETHERSCAN_API_KEY && export ETHERSCAN_API_KEY`), then `script/verify-etherscan.sh 10`. It verifies the
   contracts in `10.json` through the Etherscan V2 API (`https://api.etherscan.io/v2/api?chainid=10`), passes the key to
   curl only through stdin, treats "Already Verified" as success, and exits 2 with a key-free retry command on failure.
5. Commit `10.json` in its own PR (CI's mainnet gate and `script/check-deployments.sh 10` check it against the chain).

**Someone deployed first.** Anyone can send our init code to the CREATE2 deployer. The result is our exact contracts at
our addresses, with no owner and no admin, so it is harmless. `deploy.sh` then stops with "already deployed … but
deployments/10.json has no matching …", because it never adopts a deployment silently. Write `10.json` by hand with
the actual deploy transaction hash and block, run `script/check-deployments.sh 10` (deploy tx went to the CREATE2
deployer, init code is this build's, runtime code including immutables matches), and review it in the record PR.

## ABIs (`contracts/abi/`)

| File | Contract |
|---|---|
| `VaultRegistry.json` | v1 (legacy reads) |
| `VaultRegistryV2.json` | v2 (all writes; reads v2, then v1) |
| `CryoShieldSmartWallet.json` | account implementation: the CBSW v1.1 ABI plus `RP_ID_HASH()` and `MAX_OWNERS()` |
| `CryoShieldSmartWalletFactory.json` | factory: the CBSW v1.1 factory ABI (`createAccount(bytes[],uint256)`, `getAddress(bytes[],uint256)`, `implementation()`, `initCodeHash()`) |

## Writing the record

`script/deploy.sh <preset>` with `BROADCAST=1` (always on anvil) merges the new entries into
`deployments/<chainId>.json` (existing entries are kept; keys sorted) and prints it. The file is then committed like
any other change (PR, review). It holds only public data: addresses, blocks, tx hashes and ABI hashes.
Already-deployed contracts are never adopted silently: if code exists at a predicted address but the record lacks the
matching entry, the script fails and asks for the record to be restored from the explorer.
