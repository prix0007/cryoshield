# Vendored: Coinbase Smart Wallet v1.1.0 (pruned)

Source for `CryoShieldSmartWallet` / `CryoShieldSmartWalletFactory` (OpenSpec `harden-gas-sponsorship`, design D7).
Installed with `forge install coinbase/smart-wallet@v1.1.0 --no-git`, then pruned to the files the build reaches
transitively (no tests, scripts or audits). Files are byte-identical to upstream except ONE line:

- `src/CoinbaseSmartWallet.sol` line 2: upstream `pragma solidity 0.8.23;` is relaxed to `pragma solidity ^0.8.23;`
  (with an inline comment), so the whole project compiles under its single pinned compiler (solc 0.8.28, EVM cancun;
  0.8.23 cannot target cancun). No code changes. Upstream file sha256: `d315d57cb6cbaf657a1ca04b6eb2ef157afe4025a00ec7e5f04b94639e3a5eb3`.
  Our accounts run our own compiled bytecode; legacy-upgrade tests use Coinbase's real deployed v1.1 bytecode.

| Path | Upstream | Commit |
|---|---|---|
| `src/` | coinbase/smart-wallet tag `v1.1.0` | `a8c6456f3a6d5d2dea08d6336b3be13395cacd42` |
| `lib/account-abstraction/contracts/{core/Helpers.sol,interfaces/}` | eth-infinitism/account-abstraction (v0.6.0) | `abff2aca61a8f0934e533d0d352978055fddbd96` |
| `lib/solady/src/` | vectorized/solady | `c4c96607cb3aa3807b14c81ae2015bcba061f8fc` |
| `lib/openzeppelin-contracts/contracts/utils/Base64.sol` | OpenZeppelin/openzeppelin-contracts (5.0.2) | `5705e8208bc92cd82c7bcdfeac8dbc7377767d96` |
| `lib/webauthn-sol/src/WebAuthn.sol` | base-org/webauthn-sol | `619f20ab0f074fef41066ee4ab24849a913263b2` |
| `lib/webauthn-sol/lib/FreshCryptoLib/solidity/src/` | rdubois-crypto/FreshCryptoLib | `76f3f135b7b27d2aa519f265b56bfc49a2573ab5` |

Licenses: each upstream's license file is kept next to its sources (account-abstraction files carry their SPDX
headers, GPL-3.0). Remappings live in `contracts/foundry.toml`.

Update procedure: re-run the install at a new tag, re-run the import-closure prune, update this table, and run the
full test suite (the storage-layout and slot-constant tests in `test/CryoShieldSmartWallet.t.sol` must still pass).
