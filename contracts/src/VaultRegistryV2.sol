// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVaultRegistryV2} from "./IVaultRegistryV2.sol";

/// @title CryoShield VaultRegistry v2
/// @notice Permanent, ownerless registry of encrypted vault blobs and an append-only, uncapped locator index.
/// @dev Immutable by design: no admin, no proxy, no pause, no self-destruct, no external calls.
///      v2 (OpenSpec `harden-gas-sponsorship`) closes audit AA-M2 by deriving `vaultId` from the caller, and AA-M1 by
///      dropping the per-locator cap: a locator's list can grow without bound, reads are paginated, and registering a
///      locator never scans the shared list (duplicates are detected with a per-vault set instead).
contract VaultRegistryV2 is IVaultRegistryV2 {
    /// @notice Maximum blob size in bytes (inclusive). Blobs must be non-empty.
    uint256 public constant MAX_BLOB_SIZE = 1024;
    /// @notice Minimum number of locators at vault creation.
    uint256 public constant MIN_LOCATORS = 2;
    /// @notice Maximum locators per vault, counting initial locators and later additions.
    uint256 public constant MAX_LOCATORS_PER_VAULT = 8;
    /// @notice Maximum entries returned by one `resolveLocator` page (larger `count` values are clamped).
    uint256 public constant MAX_PAGE_SIZE = 256;
    /// @notice Maximum ids accepted by one `getVaults` call (about 36 KB of 1 KB blobs per response).
    uint256 public constant MAX_BATCH_IDS = 32;

    struct Vault {
        address owner;
        uint32 version;
        uint8 locatorCount;
        bytes blob;
    }

    mapping(bytes32 vaultId => Vault) private _vaults;
    mapping(bytes32 locator => bytes32[] vaultIds) private _locatorIndex;
    mapping(bytes32 vaultId => mapping(bytes32 locator => bool)) private _hasLocator;

    /// @inheritdoc IVaultRegistryV2
    mapping(address owner => bytes32 vaultId) public vaultOf;

    // ---------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------

    /// @inheritdoc IVaultRegistryV2
    function createVault(bytes32 salt, bytes calldata blob, bytes32[] calldata locators)
        external
        returns (bytes32 vaultId)
    {
        // One vault per owner. The id is derived from msg.sender, so an existing id implies an existing vault for
        // this sender: this check also rules out any id reuse.
        if (vaultOf[msg.sender] != bytes32(0)) revert OwnerAlreadyHasVault(msg.sender);
        _checkBlob(blob);
        uint256 n = locators.length;
        if (n < MIN_LOCATORS) revert TooFewLocators(n);
        if (n > MAX_LOCATORS_PER_VAULT) revert TooManyLocators(n);

        vaultId = vaultIdFor(msg.sender, salt);
        Vault storage v = _vaults[vaultId];
        v.owner = msg.sender;
        v.version = 1;
        v.locatorCount = uint8(n);
        v.blob = blob;
        vaultOf[msg.sender] = vaultId;
        emit VaultCreated(vaultId, msg.sender, 1, keccak256(blob));

        _appendLocators(vaultId, locators);
    }

    /// @inheritdoc IVaultRegistryV2
    function updateVault(bytes32 vaultId, bytes calldata blob) external {
        Vault storage v = _ownedVault(vaultId);
        _checkBlob(blob);

        uint32 version = v.version + 1;
        v.version = version;
        v.blob = blob;
        emit VaultUpdated(vaultId, version, keccak256(blob));
    }

    /// @inheritdoc IVaultRegistryV2
    function addLocators(bytes32 vaultId, bytes32[] calldata locators) external {
        Vault storage v = _ownedVault(vaultId);
        uint256 n = locators.length;
        if (n == 0) revert TooFewLocators(0);
        uint256 total = uint256(v.locatorCount) + n;
        if (total > MAX_LOCATORS_PER_VAULT) revert TooManyLocators(total);

        v.locatorCount = uint8(total);
        _appendLocators(vaultId, locators);
    }

    // ---------------------------------------------------------------------
    // Reads (plain eth_call, no infrastructure needed)
    // ---------------------------------------------------------------------

    /// @inheritdoc IVaultRegistryV2
    function vaultIdFor(address owner, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt));
    }

    /// @inheritdoc IVaultRegistryV2
    function getVault(bytes32 vaultId) external view returns (address owner, bytes memory blob, uint32 version) {
        Vault storage v = _vaults[vaultId];
        return (v.owner, v.blob, v.version);
    }

    /// @inheritdoc IVaultRegistryV2
    function getVaults(bytes32[] calldata vaultIds) external view returns (VaultView[] memory vaults) {
        uint256 n = vaultIds.length;
        if (n > MAX_BATCH_IDS) revert TooManyIds(n);
        vaults = new VaultView[](n);
        for (uint256 i; i < n; ++i) {
            Vault storage v = _vaults[vaultIds[i]];
            vaults[i] = VaultView(v.owner, v.blob, v.version);
        }
    }

    /// @inheritdoc IVaultRegistryV2
    function locatorLength(bytes32 locator) external view returns (uint256) {
        return _locatorIndex[locator].length;
    }

    /// @inheritdoc IVaultRegistryV2
    function resolveLocator(bytes32 locator, uint256 start, uint256 count)
        external
        view
        returns (bytes32[] memory page)
    {
        bytes32[] storage ids = _locatorIndex[locator];
        uint256 len = ids.length;
        if (start >= len) return new bytes32[](0);
        uint256 remaining = len - start;
        if (count > MAX_PAGE_SIZE) count = MAX_PAGE_SIZE;
        if (count > remaining) count = remaining;
        page = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            page[i] = ids[start + i];
        }
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _ownedVault(bytes32 vaultId) private view returns (Vault storage v) {
        v = _vaults[vaultId];
        if (v.owner != msg.sender) revert NotVaultOwner(vaultId, msg.sender);
    }

    function _checkBlob(bytes calldata blob) private pure {
        uint256 size = blob.length;
        if (size == 0 || size > MAX_BLOB_SIZE) revert InvalidBlobSize(size);
    }

    /// @dev Appends `vaultId` to each locator's list. A locator already registered for this vault (earlier, or
    ///      repeated within this call) reverts with DuplicateLocator. The check uses a per-vault set, so the cost is
    ///      constant however long the shared list is (a stuffed locator cannot make registration expensive).
    function _appendLocators(bytes32 vaultId, bytes32[] calldata locators) private {
        mapping(bytes32 => bool) storage has = _hasLocator[vaultId];
        for (uint256 i; i < locators.length; ++i) {
            bytes32 locator = locators[i];
            if (locator == bytes32(0)) revert ZeroLocator();
            if (has[locator]) revert DuplicateLocator(locator);
            has[locator] = true;
            _locatorIndex[locator].push(vaultId);
            emit LocatorAdded(vaultId, locator);
        }
    }
}
