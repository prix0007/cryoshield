// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RegistryTestBase} from "./Base.t.sol";

/// @dev Task 7.1 gas measurement for the three sponsored write paths. Each test records the gas of exactly
///      one registry call into snapshots/VaultRegistry.json (via snapshotGasLastCall), independent of setup.
///      Isolation runs each call as its own transaction, so the figures are full L2 execution gas
///      (21k intrinsic + calldata + cold storage), matching what a real transaction pays.
/// forge-config: default.isolate = true
/// forge-config: mainnet.isolate = true
contract GasTest is RegistryTestBase {
    function test_gas_create_1024B_2locators() public {
        bytes memory blob = _blob(1024, 0xA5);
        bytes32[] memory locs = _locators(2, "gas");
        vm.prank(alice);
        registry.createVault(ALICE_VAULT, blob, locs);
        vm.snapshotGasLastCall("VaultRegistry", "createVault_1024B_2locators");
    }

    function test_gas_update_1024B() public {
        _create(alice, ALICE_VAULT, _blob(1024, 0xA5), _locators(2, "gas"));
        bytes memory next = _blob(1024, 0x5A);
        vm.prank(alice);
        registry.updateVault(ALICE_VAULT, next);
        vm.snapshotGasLastCall("VaultRegistry", "updateVault_1024B");
    }

    function test_gas_addLocator_1() public {
        _create(alice, ALICE_VAULT, _blob(1024, 0xA5), _locators(2, "gas"));
        bytes32[] memory one = _one(keccak256("gas-extra"));
        vm.prank(alice);
        registry.addLocators(ALICE_VAULT, one);
        vm.snapshotGasLastCall("VaultRegistry", "addLocators_1");
    }
}
