// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CoinbaseSmartWalletFactory} from "smart-wallet/CoinbaseSmartWalletFactory.sol";
import {CryoShieldSmartWallet} from "./CryoShieldSmartWallet.sol";

/// @title CryoShield Smart Wallet factory
/// @notice The Coinbase Smart Wallet v1.1 factory, unchanged, bound to a `CryoShieldSmartWallet` implementation for one
///         relying party (OpenSpec `harden-gas-sponsorship`, design D7). The constructor deploys the implementation
///         (CREATE2, salt 0) so one transaction yields the pair; deploying the factory itself through a CREATE2
///         deployer makes both addresses deterministic per RP ID and identical on every chain.
/// @dev No storage, no admin. `createAccount`, `getAddress`, `initCodeHash` and `implementation` are CBSW v1.1's.
contract CryoShieldSmartWalletFactory is CoinbaseSmartWalletFactory {
    /// @notice sha256 of the relying-party ID of this factory's implementation.
    bytes32 public immutable RP_ID_HASH;

    constructor(bytes32 rpIdHash)
        payable
        CoinbaseSmartWalletFactory(address(new CryoShieldSmartWallet{salt: bytes32(0)}(rpIdHash)))
    {
        RP_ID_HASH = rpIdHash;
    }
}
