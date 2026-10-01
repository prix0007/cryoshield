// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VaultRegistry} from "../src/VaultRegistry.sol";

/// @dev Shared fixtures for VaultRegistry tests.
abstract contract RegistryTestBase is Test {
    VaultRegistry internal registry;

    address internal deployer = makeAddr("deployer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal mallory = makeAddr("mallory");

    bytes32 internal constant ALICE_VAULT = keccak256("alice-vault");
    bytes32 internal constant BOB_VAULT = keccak256("bob-vault");

    function setUp() public virtual {
        vm.prank(deployer);
        registry = new VaultRegistry();
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

    function _create(address who, bytes32 vaultId, bytes memory blob, bytes32[] memory locs) internal {
        vm.prank(who);
        registry.createVault(vaultId, blob, locs);
    }

    function _createDefault(address who, bytes32 vaultId, string memory seed)
        internal
        returns (bytes32[] memory locs)
    {
        locs = _locators(2, seed);
        _create(who, vaultId, hex"c0ffee", locs);
    }
}
