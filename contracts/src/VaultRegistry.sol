// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CryoShield VaultRegistry
/// @notice Permanent, ownerless registry of encrypted vault blobs and an append-only locator index.
/// @dev Immutable by design: no admin, no proxy, no pause, no self-destruct, no external calls.
///      Blobs are opaque ciphertext; the registry never parses them. Locators are 32-byte HKDF outputs
///      derived client-side from a hardware key's PRF; the index is non-exclusive so a front-runner
///      cannot block a registration.
contract VaultRegistry {
    /// @notice Maximum blob size in bytes (inclusive). Blobs must be non-empty.
    uint256 public constant MAX_BLOB_SIZE = 1024;
    /// @notice Minimum number of locators at vault creation.
    uint256 public constant MIN_LOCATORS = 2;
    /// @notice Maximum locators per vault, counting initial locators and later additions.
    uint256 public constant MAX_LOCATORS_PER_VAULT = 8;
    /// @notice Maximum vaultIds recorded under a single locator.
    uint256 public constant MAX_VAULTS_PER_LOCATOR = 16;

    struct Vault {
        address owner;
        uint32 version;
        uint8 locatorCount;
        bytes blob;
    }

    error ZeroVaultId();
    error ZeroLocator();
    error VaultIdTaken(bytes32 vaultId);
    error OwnerAlreadyHasVault(address owner);
    error InvalidBlobSize(uint256 size);
    error TooFewLocators(uint256 count);
    error TooManyLocators(uint256 count);
    error DuplicateLocator(bytes32 locator);
    error LocatorFull(bytes32 locator);
    error NotVaultOwner(bytes32 vaultId, address caller);

    /// @notice Emitted once per vault. `blobHash` is keccak256 of the stored blob.
    event VaultCreated(bytes32 indexed vaultId, address indexed owner, uint32 version, bytes32 blobHash);
    /// @notice Emitted on every blob replacement. `blobHash` is keccak256 of the new blob.
    event VaultUpdated(bytes32 indexed vaultId, uint32 version, bytes32 blobHash);
    /// @notice Emitted for every locator registered to a vault, at creation and on later additions.
    event LocatorAdded(bytes32 indexed vaultId, bytes32 indexed locator);

    mapping(bytes32 vaultId => Vault) private _vaults;
    mapping(bytes32 locator => bytes32[] vaultIds) private _locatorIndex;

    /// @notice The vaultId owned by `owner`, or zero if none.
    mapping(address owner => bytes32 vaultId) public vaultOf;

    // ---------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------

    /// @notice Create a vault owned by `msg.sender`.
    /// @param vaultId Client-chosen unique non-zero id (random, or keccak256(owner, nonce)).
    /// @param blob Opaque ciphertext, 1..1024 bytes.
    /// @param locators 2..8 distinct non-zero locators; `vaultId` is appended to each locator's list.
    function createVault(bytes32 vaultId, bytes calldata blob, bytes32[] calldata locators) external {
        if (vaultId == bytes32(0)) revert ZeroVaultId();
        Vault storage v = _vaults[vaultId];
        if (v.owner != address(0)) revert VaultIdTaken(vaultId);
        if (vaultOf[msg.sender] != bytes32(0)) revert OwnerAlreadyHasVault(msg.sender);
        _checkBlob(blob);
        uint256 n = locators.length;
        if (n < MIN_LOCATORS) revert TooFewLocators(n);
        if (n > MAX_LOCATORS_PER_VAULT) revert TooManyLocators(n);

        v.owner = msg.sender;
        v.version = 1;
        v.locatorCount = uint8(n);
        v.blob = blob;
        vaultOf[msg.sender] = vaultId;
        emit VaultCreated(vaultId, msg.sender, 1, keccak256(blob));

        _appendLocators(vaultId, locators);
    }

    /// @notice Replace the vault blob. Owner only. Increments the version by exactly 1.
    function updateVault(bytes32 vaultId, bytes calldata blob) external {
        Vault storage v = _ownedVault(vaultId);
        _checkBlob(blob);

        uint32 version = v.version + 1;
        v.version = version;
        v.blob = blob;
        emit VaultUpdated(vaultId, version, keccak256(blob));
    }

    /// @notice Register additional locators for a vault. Owner only. Never removes existing entries.
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

    /// @notice Vault by id. Unknown ids return (address(0), "", 0).
    function getVault(bytes32 vaultId) external view returns (address owner, bytes memory blob, uint32 version) {
        Vault storage v = _vaults[vaultId];
        return (v.owner, v.blob, v.version);
    }

    /// @notice Every vaultId ever registered under `locator`, in insertion order. Unknown locators return [].
    function resolveLocator(bytes32 locator) external view returns (bytes32[] memory) {
        return _locatorIndex[locator];
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

    /// @dev Appends `vaultId` to each locator's list. A locator whose list already contains `vaultId`
    ///      (already on this vault, or repeated within this call) reverts with DuplicateLocator. The scan
    ///      is bounded by MAX_VAULTS_PER_LOCATOR and avoids a separate per-vault locator set in storage.
    function _appendLocators(bytes32 vaultId, bytes32[] calldata locators) private {
        for (uint256 i; i < locators.length; ++i) {
            bytes32 locator = locators[i];
            if (locator == bytes32(0)) revert ZeroLocator();
            bytes32[] storage ids = _locatorIndex[locator];
            uint256 len = ids.length;
            if (len >= MAX_VAULTS_PER_LOCATOR) revert LocatorFull(locator);
            for (uint256 j; j < len; ++j) {
                if (ids[j] == vaultId) revert DuplicateLocator(locator);
            }
            ids.push(vaultId);
            emit LocatorAdded(vaultId, locator);
        }
    }
}
