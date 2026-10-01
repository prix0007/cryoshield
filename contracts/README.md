# CryoShield contracts

Foundry project for `VaultRegistry`, the immutable, ownerless on-chain store for encrypted vault blobs
(OpenSpec change `add-vault-registry-contract`). Targets Arbitrum One and stays bytecode-portable to Ethereum L1.

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

Arbitrum Sepolia (chain 421614). Secrets come from the environment or a Foundry keystore only; never commit them.
Raw private keys are refused for public networks (they would be visible in the process list). Only anvil uses an
unlocked dev account.

```sh
cast wallet import cryoshield-deployer --interactive   # once; key stored encrypted in ~/.foundry/keystores
export ARBITRUM_SEPOLIA_RPC_URL=...
export DEPLOYER_ACCOUNT=cryoshield-deployer
script/deploy.sh arbitrum_sepolia             # simulation only
BROADCAST=1 ARBISCAN_API_KEY=... script/deploy.sh arbitrum_sepolia   # send, verify, write deployments/421614.json
```

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
