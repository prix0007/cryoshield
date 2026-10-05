// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CoinbaseSmartWallet} from "smart-wallet/CoinbaseSmartWallet.sol";
import {WebAuthn} from "webauthn-sol/WebAuthn.sol";

/// @title CryoShield Smart Wallet
/// @notice Coinbase Smart Wallet v1.1 that accepts only hardware-key (P-256 WebAuthn) owners and only signatures with
///         user verification (UV) for this deployment's relying party (OpenSpec `harden-gas-sponsorship`, design D7;
///         closes audit AA-H1 part 2).
/// @dev Changes versus CBSW v1.1, and nothing else:
///      - `_isValidSignature` (used by `validateUserOp`, including the replayable `executeWithoutChainIdValidation`
///        path, and by ERC-1271) requires `authenticatorData.length >= 37`, `authenticatorData[0:32] == RP_ID_HASH`,
///        and UP + UV flags (`WebAuthn.verify(..., requireUV: true, ...)`). Any other owner type is invalid.
///      - Owners are 64-byte P-256 keys only, at most `MAX_OWNERS`: enforced in `initialize`, `addOwnerPublicKey`,
///        and by `addOwnerAddress` always reverting. These checks deliberately do not live in `_addOwnerAtIndex`,
///        because the CBSW constructor locks the implementation with an address(0) owner through it.
///      - Validation reads only `ownerAtIndex(ownerIndex)` (O(1)); no owner loops, no banned ERC-7562 opcodes.
///      No storage variables are added (RP_ID_HASH is an immutable in code), so the storage layout, including the
///      ERC-7201 `MultiOwnableStorage` slot, is identical to CBSW v1.1 and legacy accounts can upgrade in place.
///      CryoShield holds no admin role: upgrade authority stays with each account's own owners, as in CBSW.
contract CryoShieldSmartWallet is CoinbaseSmartWallet {
    /// @notice Maximum number of live owners (matches the registry's 8 locators per vault).
    uint256 public constant MAX_OWNERS = 8;

    /// @notice sha256 of the WebAuthn relying-party ID this implementation accepts (for example sha256("cryoshield.app")).
    bytes32 public immutable RP_ID_HASH;

    /// @notice The relying-party ID hash must be non-zero.
    error ZeroRpIdHash();
    /// @notice Address (EOA or contract) owners are not supported.
    error AddressOwnersDisabled();
    /// @notice `initialize` needs 1..MAX_OWNERS owners.
    error InvalidOwnerCount(uint256 count);
    /// @notice Every owner must be a 64-byte P-256 public key.
    error NotPublicKeyOwner(bytes owner);
    /// @notice The account already has MAX_OWNERS owners.
    error TooManyOwners();

    constructor(bytes32 rpIdHash) {
        if (rpIdHash == bytes32(0)) revert ZeroRpIdHash();
        RP_ID_HASH = rpIdHash;
    }

    /// @notice Initializes the account with 1..8 P-256 public-key owners (each `abi.encode(x, y)`, 64 bytes).
    function initialize(bytes[] calldata owners) external payable override {
        if (nextOwnerIndex() != 0) revert Initialized();
        uint256 n = owners.length;
        if (n == 0 || n > MAX_OWNERS) revert InvalidOwnerCount(n);
        for (uint256 i; i < n; ++i) {
            if (owners[i].length != 64) revert NotPublicKeyOwner(owners[i]);
        }
        _initializeOwners(owners);
    }

    /// @notice Disabled: CryoShield accounts are owned only by hardware-key public keys.
    function addOwnerAddress(address) external pure override {
        revert AddressOwnersDisabled();
    }

    /// @notice Adds a P-256 public-key owner, up to MAX_OWNERS live owners. Owner (or self) only.
    function addOwnerPublicKey(bytes32 x, bytes32 y) external override onlyOwner {
        if (ownerCount() >= MAX_OWNERS) revert TooManyOwners();
        _addOwnerAtIndex(abi.encode(x, y), _getMultiOwnableStorage().nextOwnerIndex++);
    }

    /// @dev Valid only for a 64-byte owner whose WebAuthn assertion is for RP_ID_HASH and carries UP + UV.
    ///      Malformed `signature`/`signatureData` reverts in `abi.decode`, exactly as in CBSW v1.1; it never validates.
    function _isValidSignature(bytes32 hash, bytes calldata signature) internal view override returns (bool) {
        SignatureWrapper memory sigWrapper = abi.decode(signature, (SignatureWrapper));
        bytes memory ownerBytes = ownerAtIndex(sigWrapper.ownerIndex);
        if (ownerBytes.length != 64) return false;

        WebAuthn.WebAuthnAuth memory auth = abi.decode(sigWrapper.signatureData, (WebAuthn.WebAuthnAuth));
        bytes memory authData = auth.authenticatorData;
        // rpIdHash (32) || flags (1) || signCount (4)
        if (authData.length < 37) return false;
        if (bytes32(authData) != RP_ID_HASH) return false;

        (uint256 x, uint256 y) = abi.decode(ownerBytes, (uint256, uint256));
        return WebAuthn.verify({challenge: abi.encode(hash), requireUV: true, webAuthnAuth: auth, x: x, y: y});
    }
}
