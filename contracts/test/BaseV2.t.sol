// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VaultRegistryV2} from "../src/VaultRegistryV2.sol";

/// @dev Shared fixtures for VaultRegistryV2 tests (harden-gas-sponsorship section 3).
abstract contract RegistryV2TestBase is Test {
    VaultRegistryV2 internal registry;

    address internal deployer = makeAddr("deployer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal mallory = makeAddr("mallory");

    bytes32 internal constant SALT_A = keccak256("salt-a");
    bytes32 internal constant SALT_B = keccak256("salt-b");

    function setUp() public virtual {
        vm.prank(deployer);
        registry = new VaultRegistryV2();
    }

    function _id(address owner, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt));
    }

    /// @dev `len` bytes of `fill`.
    function _blob(uint256 len, bytes1 fill) internal pure returns (bytes memory b) {
        b = new bytes(len);
        for (uint256 i; i < len; ++i) {
            b[i] = fill;
        }
    }

    /// @dev `n` distinct non-zero locators derived from `seed`.
    function _locators(uint256 n, string memory seed) internal pure returns (bytes32[] memory l) {
        l = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            l[i] = keccak256(abi.encode(seed, i));
        }
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory l) {
        l = new bytes32[](2);
        l[0] = a;
        l[1] = b;
    }

    function _one(bytes32 a) internal pure returns (bytes32[] memory l) {
        l = new bytes32[](1);
        l[0] = a;
    }

    function _create(address who, bytes32 salt, bytes memory blob, bytes32[] memory locs)
        internal
        returns (bytes32 vaultId)
    {
        vm.prank(who);
        vaultId = registry.createVault(salt, blob, locs);
    }

    function _createDefault(address who, bytes32 salt, string memory seed) internal returns (bytes32 vaultId) {
        vaultId = _create(who, salt, hex"c0ffee", _locators(2, seed));
    }
}
