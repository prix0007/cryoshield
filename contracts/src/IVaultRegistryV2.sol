// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CryoShield VaultRegistry v2 interface (OpenSpec change `harden-gas-sponsorship`)
/// @notice The pinned public ABI of VaultRegistryV2, for the web app and the recovery tool.
/// @dev Differences from v1:
///      - `createVault` takes a client-chosen `salt`; the registry derives
///        `vaultId = keccak256(abi.encode(msg.sender, salt))` and returns it (AA-M2: no squatting);
///      - no per-locator cap; `resolveLocator` is paginated (`count` clamped to 256), plus `locatorLength` (AA-M1);
///      - `getVaults` batch read, at most 32 ids per call.
///      Everything else (blob 1..1024 bytes, 2..8 locators per vault, one vault per owner, owner-only writes, events)
///      matches v1.
interface IVaultRegistryV2 {
    /// @notice One vault as returned by `getVaults`. Unknown ids return `(address(0), "", 0)`.
    struct VaultView {
        address owner;
        bytes blob;
        uint32 version;
    }

    error ZeroLocator();
    error OwnerAlreadyHasVault(address owner);
    error InvalidBlobSize(uint256 size);
    error TooFewLocators(uint256 count);
    error TooManyLocators(uint256 count);
    error DuplicateLocator(bytes32 locator);
    error NotVaultOwner(bytes32 vaultId, address caller);
    error TooManyIds(uint256 count);

    /// @notice Emitted once per vault. `blobHash` is keccak256 of the stored blob.
    event VaultCreated(bytes32 indexed vaultId, address indexed owner, uint32 version, bytes32 blobHash);
    /// @notice Emitted on every blob replacement. `blobHash` is keccak256 of the new blob.
    event VaultUpdated(bytes32 indexed vaultId, uint32 version, bytes32 blobHash);
    /// @notice Emitted for every locator registered to a vault, at creation and on later additions.
    event LocatorAdded(bytes32 indexed vaultId, bytes32 indexed locator);

    // Writes

    /// @notice Create the caller's vault under `vaultIdFor(msg.sender, salt)` and return its id.
    function createVault(bytes32 salt, bytes calldata blob, bytes32[] calldata locators)
        external
        returns (bytes32 vaultId);

    /// @notice Replace the vault blob. Owner only. Increments the version by exactly 1.
    function updateVault(bytes32 vaultId, bytes calldata blob) external;

    /// @notice Register additional locators for a vault. Owner only. Vault total stays <= 8.
    function addLocators(bytes32 vaultId, bytes32[] calldata locators) external;

    // Reads (plain eth_call)

    /// @notice `keccak256(abi.encode(owner, salt))`, the id `createVault(salt, ...)` from `owner` registers.
    function vaultIdFor(address owner, bytes32 salt) external pure returns (bytes32);

    /// @notice Vault by id. Unknown ids return `(address(0), "", 0)`.
    function getVault(bytes32 vaultId) external view returns (address owner, bytes memory blob, uint32 version);

    /// @notice Several vaults in one call, in input order. Reverts with `TooManyIds` above 32 ids.
    function getVaults(bytes32[] calldata vaultIds) external view returns (VaultView[] memory vaults);

    /// @notice Number of vaultIds ever registered under `locator` (0 if unknown).
    function locatorLength(bytes32 locator) external view returns (uint256);

    /// @notice Entries `[start, min(start + count, length))` of the locator's list, in insertion order.
    ///         `count` is clamped to 256; `start >= length` or `count == 0` returns [].
    function resolveLocator(bytes32 locator, uint256 start, uint256 count) external view returns (bytes32[] memory);

    /// @notice The vaultId owned by `owner`, or zero if none.
    function vaultOf(address owner) external view returns (bytes32);
}
