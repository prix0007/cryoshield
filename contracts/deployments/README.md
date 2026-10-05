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

## Which entries exist where

| Chain | v1 top-level | `contracts.vaultRegistryV2` | `contracts.wallets` keys |
|---|---|---|---|
| anvil (31337) | yes | yes | `localhost` (local and E2E builds) and `cryoshield.app` (CI `verify-build`); override with `RP_IDS` |
| OP Sepolia (11155420) | yes (existing, never redeployed) | yes, once the owner broadcasts | `cryoshield.app` (production build), `cryoshield-web-dev.fly.dev` (dev build) |
| OP Mainnet (10) | **never** | yes, after the mainnet gate | `cryoshield.app` only, after the mainnet gate |

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
