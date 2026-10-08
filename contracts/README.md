# CryoShield contracts

Foundry project for `VaultRegistry`, the immutable, ownerless on-chain store for encrypted vault blobs
(OpenSpec changes `add-vault-registry-contract`, `target-op-sepolia`). Testnet: **OP Sepolia** (11155420); mainnet
chain TBD (OP Mainnet or Arbitrum One). The same bytecode and CREATE2 address work on the OP Stack, Arbitrum, and Ethereum L1.

- Compiler: solc `0.8.28` (pinned), EVM `cancun`, optimizer 10,000 runs. No precompiles, no external calls.
- ABI (functions, events, custom errors): [`abi/VaultRegistry.json`](abi/VaultRegistry.json)
- Deployments: `deployments/<chainId>.json` = `{chainId, address, deployBlock, txHash, abiHash}`
  (`abiHash` = keccak256 of the exact bytes of `abi/VaultRegistry.json`). Start log scans at `deployBlock`.
- Gas: [`GAS.md`](GAS.md)

## Dev commands

```sh
forge build                                   # compile
forge test                                    # unit + fuzz (1,000 runs) + invariant + static immutability checks
FOUNDRY_PROFILE=mainnet forge test            # same suite under L1 settings (chain id 1, 36M block gas limit)
forge fmt                                     # format (CI: forge fmt --check)
forge coverage --no-match-coverage "test|script"   # must stay 100% lines/branches for src/VaultRegistry.sol
forge snapshot --mc GasTest                   # refresh .gas-snapshot (CI: forge snapshot --mc GasTest --check)
forge test --mc GasTest --gas-report          # per-function gas for 1 KB writes (isolated, full tx gas)
script/export-abi.sh                          # regenerate abi/VaultRegistry.json (CI: script/export-abi.sh --check)
script/anvil-e2e.sh                           # throwaway anvil: CREATE2 deploy, record check, locator-only recovery via cast
```

## Deploying

The deploy goes through the canonical CREATE2 deployer (`0x4e59b44847b379578588920cA78FbF26c0B4956C`)
with salt `keccak256("cryoshield.vault-registry.v1")`, so the address is the same on every chain.

Local anvil (no keys; used by the web app's E2E tests). With `anvil` running on port 8545:

```sh
script/deploy.sh anvil                        # writes deployments/31337.json
RPC_URL=http://127.0.0.1:9545 script/deploy.sh anvil   # other port
```

Public networks are named presets (`script/deploy.sh --list-presets`):

| Preset | Chain ID | RPC env var | Verifier (Blockscout, keyless; plus Sourcify) |
|---|---:|---|---|
| `op_sepolia` (testnet) | 11155420 | `OP_SEPOLIA_RPC_URL` | `https://testnet-explorer.optimism.io/api/` |
| `op_mainnet` | 10 | `OP_MAINNET_RPC_URL` | `https://explorer.optimism.io/api/` |
| `arbitrum_sepolia` | 421614 | `ARBITRUM_SEPOLIA_RPC_URL` | `https://arbitrum-sepolia.blockscout.com/api/` |
| `arbitrum_one` | 42161 | `ARBITRUM_ONE_RPC_URL` | `https://arbitrum.blockscout.com/api/` |

Secrets come from the environment or a Foundry keystore only; never commit them (template: [`.env.example`](.env.example)).
Raw private keys are refused for every public network, because they would be visible in the process list. Only anvil
uses an unlocked dev account. Source verification is keyless: every new contract is verified on Blockscout
(`--verifier blockscout`, URL per preset) and on Sourcify (`--verifier sourcify`). No explorer API key is needed.
Verification runs after `deployments/<chainId>.json` is written. If it fails, the script exits 2, keeps the record, and
prints the retry commands. The script checks the RPC's chain ID before it simulates or sends anything.

Etherscan is optional and separate: `script/verify-etherscan.sh <chainId>` verifies the contracts of a record through
the Etherscan V2 API (forge 1.1.0's Etherscan V2 path is broken). The key comes only from `ETHERSCAN_API_KEY` in the
environment and reaches curl only through stdin (`curl --config -`); key-like arguments are refused. OP Mainnet run,
guards and the "someone deployed first" response: [`deployments/README.md`](deployments/README.md#op-mainnet-chain-10-writing-10json).

```sh
cast wallet import cryoshield-deployer --interactive   # once; key stored encrypted in ~/.foundry/keystores
set -a; source .env; set +a                   # OP_SEPOLIA_RPC_URL, DEPLOYER_ACCOUNT
script/deploy.sh op_sepolia                   # simulation only (DEPLOYER_ADDRESS=0x... also works, without a keystore)
BROADCAST=1 script/deploy.sh op_sepolia       # send, write deployments/11155420.json, verify on Blockscout + Sourcify
script/test-deploy-args.sh                    # preset/argv tests and parity with config/chain-presets.json (no keys, local anvil)
script/test-verify-etherscan.sh               # Etherscan V2 script with stub curl/forge (no network, no real key)
```

Test ETH: use the Superchain faucet (https://docs.optimism.io/app-developers/tools-sdks/faucets).

Re-running is safe. If the CREATE2 address already has code, the script checks that the on-chain runtime bytecode
matches this build and that `deployments/<chainId>.json` exists for that address. If either check fails, it exits
non-zero.

The deployer gets no privileges. After deployment, nobody (including CryoShield) can alter, freeze, or delete a vault.

## Interface summary

| Function | Notes |
|---|---|
| `createVault(bytes32 vaultId, bytes blob, bytes32[] locators)` | caller becomes owner; one vault per owner; blob 1–1024 B; 2–8 locators |
| `updateVault(bytes32 vaultId, bytes blob)` | owner only; version += 1 |
| `addLocators(bytes32 vaultId, bytes32[] locators)` | owner only; vault total ≤ 8 |
| `getVault(bytes32 vaultId) → (address owner, bytes blob, uint32 version)` | unknown id → `(0x0, "", 0)` |
| `resolveLocator(bytes32 locator) → bytes32[]` | all candidates, insertion order, ≤ 16; unknown → `[]` |
| `vaultOf(address owner) → bytes32` | owner's vaultId or zero |

Events (all index `vaultId` as the first topic): `VaultCreated(vaultId, owner, version, blobHash)`,
`VaultUpdated(vaultId, version, blobHash)`, `LocatorAdded(vaultId, locator)`.

Custom errors and selectors:

| Error | Selector |
|---|---|
| `ZeroVaultId()` | `0x1c614144` |
| `ZeroLocator()` | `0x87b18b52` |
| `VaultIdTaken(bytes32)` | `0x041e238d` |
| `OwnerAlreadyHasVault(address)` | `0xe1514fc9` |
| `InvalidBlobSize(uint256)` | `0x5b8088e5` |
| `TooFewLocators(uint256)` | `0x810e052e` |
| `TooManyLocators(uint256)` | `0x70e82a8a` |
| `DuplicateLocator(bytes32)` | `0xafc534b1` |
| `LocatorFull(bytes32)` | `0xcfe5bd5b` |
| `NotVaultOwner(bytes32,address)` | `0xa395fd86` |

## v2: VaultRegistryV2 and the CryoShield wallet (OpenSpec `harden-gas-sponsorship`)

| Contract | Purpose | ABI |
|---|---|---|
| `VaultRegistryV2` | `vaultId = keccak256(abi.encode(msg.sender, salt))` (no squatting, AA-M2); no per-locator cap, paginated `resolveLocator(locator, start, count)` (count clamped to 256), `locatorLength`, `getVaults` (≤ 32 ids) (AA-M1); every other v1 rule kept | [`abi/VaultRegistryV2.json`](abi/VaultRegistryV2.json) |
| `CryoShieldSmartWallet` | Coinbase Smart Wallet v1.1 subclass: every signature (userOp, replayable path, ERC-1271) needs UP + UV and `rpIdHash == RP_ID_HASH`; P-256 owners only, max 8 (AA-H1 part 2) | [`abi/CryoShieldSmartWallet.json`](abi/CryoShieldSmartWallet.json) |
| `CryoShieldSmartWalletFactory` | the CBSW v1.1 factory, bound to one RP ID; its constructor deploys the implementation | [`abi/CryoShieldSmartWalletFactory.json`](abi/CryoShieldSmartWalletFactory.json) |

Deployment record format and which entries exist on which chain: [`deployments/README.md`](deployments/README.md).
CBSW v1.1.0 is vendored and pruned in [`lib/cbsw-v1.1.0/`](lib/cbsw-v1.1.0/README.md).

### Deterministic addresses (same on every chain)

| Contract | Address |
|---|---|
| VaultRegistryV2 | `0xA622c92d3D5b54aeA081Cf410224a8A2eCb08cB7` |
| wallet factory / implementation, `cryoshield.app` | `0x775dc816594262274E78Ae75D97C8EdB0df5DfED` / `0x8aA76FaA6629cA1EA8ccC3F9Edf0E8D98816Acd7` |
| wallet factory / implementation, `cryoshield-web-dev.fly.dev` | `0x59454AD6Af26BEfF43851356B9Dc95a875C673d3` / `0x8bFfA95505bAbe88d86694a245E7768fa052395c` |
| wallet factory / implementation, `localhost` | `0x75Bd6e2C371b97D6c0F02D3556f3d9711b2D42fb` / `0xC813DE31caABeE21f4d4DB4CcC3540D73468B63a` |

`script/deploy.sh --predict-v2 "<rpId>[,<rpId>...]"` recomputes them offline. Any source or compiler change moves them.

### Deploy (v1 is never deployed outside anvil; never on OP Mainnet)

`script/deploy.sh <preset>` now also deploys VaultRegistryV2 and one wallet pair per RP ID (`RP_IDS`, defaults:
anvil `localhost cryoshield.app`, op_sepolia `cryoshield.app cryoshield-web-dev.fly.dev`, op_mainnet `cryoshield.app`).
On OP Sepolia it verifies the existing v1 (bytecode + record) and never redeploys it. VaultRegistry v1 is built with
the `v1` Foundry profile so its bytecode (and CREATE2 address `0xB43f…9e44`) stays byte-identical to the deployed one.
Broadcasts to any mainnet preset (every preset whose `kind` in `deploy.sh` is not `local` or `testnet`, e.g.
`op_mainnet` and `arbitrum_one`; fail-closed for presets without a kind) additionally require
`CRYOSHIELD_MAINNET_GATE=approved:<chainId>` (for example `approved:10`; task 8.1, founder approval). Transactions are
sent one at a time (`--slow`).

> **The mainnet gate is an accident guard, not access control.** It stops a mistyped preset or a copied command from
> broadcasting to a mainnet, and binding it to the chain ID stops an approval for one mainnet from opening another.
> Anyone who holds the deployer keystore and its password can set the variable: protecting that keystore is the real
> control, and the founder's recorded approval (task 8.1) is the process control.

```sh
# OP Sepolia dry run (no keys, nothing sent)
OP_SEPOLIA_RPC_URL=https://sepolia.optimism.io DEPLOYER_ADDRESS=0x33144f681d83527c0a8f364751a5d2f4505d26bf \
  script/deploy.sh op_sepolia
# OP Sepolia broadcast (prompts for the keystore password; writes and prints deployments/11155420.json; verifies
# every new contract on Blockscout and Sourcify, exit 2 + retry commands if verification fails)
OP_SEPOLIA_RPC_URL=https://sepolia.optimism.io DEPLOYER_ACCOUNT=cryoshield-deployer BROADCAST=1 \
  script/deploy.sh op_sepolia
```

### Extra checks

```sh
CRYOSHIELD_REQUIRE_TRACE=1 forge test --mc CryoShieldSmartWalletErc7562Test -vvv   # ERC-7562 traces (CI; fails without the tracer)
script/check-storage-layout.sh                          # storage layout == CBSW v1.1
script/export-abi.sh --check                            # committed ABIs are current
script/test-deploy-args.sh                              # presets, mainnet gate (fail-closed), op_mainnet guards, argv, no secrets
script/test-verify-etherscan.sh                         # Etherscan V2 script: key never in argv, env, files or output
script/anvil-e2e.sh && git diff --exit-code -- deployments/ abi/   # anvil deploy reproduces the 31337 record
script/gas-md.sh --check                                # GAS.md == snapshots/*.json (regenerate: script/gas-md.sh)
script/check-deployments.sh [chainId...]                # NETWORK: public records vs chain (code, block, tx, init code)
CRYOSHIELD_NETWORK_TESTS=1 script/test-check-deployments.sh   # NETWORK: the checker also rejects tampered records
```

All but the two NETWORK checks run in the CI `contracts` job (the offline `check-deployments.sh --offline`
completeness check and the offline part of the self-test run there too). The NETWORK checks run:
- on every PR that changes `contracts/deployments/**`, `check-deployments.sh` or `deploy.sh` (CI job
  `deployments-onchain`, part of `ci-ok`; public RPCs, no secrets);
- weekly and on demand in `.github/workflows/deployments-check.yml`. When that run fails, its `report-failure` job opens
  (or comments on) one tracking issue; it is the repository's only job with a write scope (`issues: write`).

> **Schedule caveat:** GitHub disables scheduled workflows after 60 days without repository activity. If the repository
> goes quiet, re-enable "Deployments check" in the Actions tab (or run it by hand) so the weekly check keeps running. `test/DeployV2.t.sol` pins the predicted
CREATE2 addresses to the live OP Sepolia record, so any change to `src/`, the compiler settings or the remappings
fails `forge test`.
