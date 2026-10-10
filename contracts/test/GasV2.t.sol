// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RegistryV2TestBase} from "./BaseV2.t.sol";

/// @dev harden-gas-sponsorship 3.5: gas of the VaultRegistryV2 write paths and the paginated/batched reads.
///      Each test records exactly one registry call into snapshots/VaultRegistryV2.json. Isolation runs each call as
///      its own transaction (21k intrinsic + calldata + cold storage), as a real transaction pays.
/// forge-config: default.isolate = true
/// forge-config: mainnet.isolate = true
contract GasV2Test is RegistryV2TestBase {
    function test_gasV2_create_1024B_2locators() public {
        bytes memory blob = _blob(1024, 0xA5);
        bytes32[] memory locs = _locators(2, "gas");
        vm.prank(alice);
        registry.createVault(SALT_A, blob, locs);
        vm.snapshotGasLastCall("VaultRegistryV2", "createVault_1024B_2locators");
    }

    function test_gasV2_update_1024B() public {
        bytes32 vaultId = _create(alice, SALT_A, _blob(1024, 0xA5), _locators(2, "gas"));
        bytes memory next = _blob(1024, 0x5A);
        vm.prank(alice);
        registry.updateVault(vaultId, next);
        vm.snapshotGasLastCall("VaultRegistryV2", "updateVault_1024B");
    }

    /// @dev pad-to-max-payload 4.1: the blob sizes before and after padding to the maximum. 526 bytes is a 2-key
    ///      vault (64-byte credential IDs) holding a 12-word seed phrase with 64-byte-step padding; 974 bytes is every
    ///      2-key vault with 64-byte credential IDs once the payload is padded to the maximum.
    function test_gasV2_create_526B_2locators() public {
        bytes memory blob = _blob(526, 0xA5);
        bytes32[] memory locs = _locators(2, "gas");
        vm.prank(alice);
        registry.createVault(SALT_A, blob, locs);
        vm.snapshotGasLastCall("VaultRegistryV2", "createVault_526B_2locators");
    }

    function test_gasV2_create_974B_2locators() public {
        bytes memory blob = _blob(974, 0xA5);
        bytes32[] memory locs = _locators(2, "gas");
        vm.prank(alice);
        registry.createVault(SALT_A, blob, locs);
        vm.snapshotGasLastCall("VaultRegistryV2", "createVault_974B_2locators");
    }

    function test_gasV2_update_526B() public {
        bytes32 vaultId = _create(alice, SALT_A, _blob(526, 0xA5), _locators(2, "gas"));
        bytes memory next = _blob(526, 0x5A);
        vm.prank(alice);
        registry.updateVault(vaultId, next);
        vm.snapshotGasLastCall("VaultRegistryV2", "updateVault_526B");
    }

    function test_gasV2_update_974B() public {
        bytes32 vaultId = _create(alice, SALT_A, _blob(974, 0xA5), _locators(2, "gas"));
        bytes memory next = _blob(974, 0x5A);
        vm.prank(alice);
        registry.updateVault(vaultId, next);
        vm.snapshotGasLastCall("VaultRegistryV2", "updateVault_974B");
    }

    function test_gasV2_addLocator_1() public {
        bytes32 vaultId = _create(alice, SALT_A, _blob(1024, 0xA5), _locators(2, "gas"));
        bytes32[] memory one = _one(keccak256("gas-extra"));
        vm.prank(alice);
        registry.addLocators(vaultId, one);
        vm.snapshotGasLastCall("VaultRegistryV2", "addLocators_1");
    }

    function test_gasV2_resolveLocator_page256() public {
        bytes32 shared = keccak256("gas-shared");
        for (uint256 i; i < 256; ++i) {
            _create(address(uint160(0x9000 + i)), SALT_A, hex"02", _pair(shared, keccak256(abi.encode(i))));
        }
        registry.resolveLocator(shared, 0, 256);
        vm.snapshotGasLastCall("VaultRegistryV2", "resolveLocator_page256");
    }

    function test_gasV2_getVaults_32x1024B() public {
        bytes32[] memory ids = new bytes32[](32);
        for (uint256 i; i < 32; ++i) {
            ids[i] = _create(address(uint160(0x9000 + i)), SALT_A, _blob(1024, 0xA5), _locators(2, vm.toString(i)));
        }
        registry.getVaults(ids);
        vm.snapshotGasLastCall("VaultRegistryV2", "getVaults_32x1024B");
    }
}
