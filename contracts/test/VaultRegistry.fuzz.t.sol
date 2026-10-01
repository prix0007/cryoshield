// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultRegistry} from "../src/VaultRegistry.sol";
import {RegistryTestBase} from "./Base.t.sol";

/// @dev Runs with `[fuzz] runs = 1000` from foundry.toml.
contract VaultRegistryFuzzTest is RegistryTestBase {
    // ---------------------------------------------------------------------
    // 3.3 Accept/reject boundaries: blob length 0..2048, locator count 0..16
    // ---------------------------------------------------------------------

    function testFuzz_createBoundaries(uint256 blobLen, uint256 locCount) public {
        blobLen = bound(blobLen, 0, 2048);
        locCount = bound(locCount, 0, 16);
        bytes memory blob = _blob(blobLen, 0xA5);
        bytes32[] memory locs = _locators(locCount, "fuzz");

        bool blobOk = blobLen >= 1 && blobLen <= 1024;
        bool countOk = locCount >= 2 && locCount <= 8;

        if (!blobOk) {
            vm.expectRevert(abi.encodeWithSelector(VaultRegistry.InvalidBlobSize.selector, blobLen));
        } else if (locCount < 2) {
            vm.expectRevert(abi.encodeWithSelector(VaultRegistry.TooFewLocators.selector, locCount));
        } else if (locCount > 8) {
            vm.expectRevert(abi.encodeWithSelector(VaultRegistry.TooManyLocators.selector, locCount));
        }
        _create(alice, ALICE_VAULT, blob, locs);

        (address owner, bytes memory stored, uint32 version) = registry.getVault(ALICE_VAULT);
        if (blobOk && countOk) {
            assertEq(owner, alice);
            assertEq(stored, blob);
            assertEq(version, 1);
            for (uint256 i; i < locCount; ++i) {
                assertEq(registry.resolveLocator(locs[i]).length, 1);
            }
        } else {
            assertEq(owner, address(0));
            assertEq(registry.vaultOf(alice), bytes32(0));
        }
    }

    function testFuzz_updateBoundaries(uint256 blobLen) public {
        blobLen = bound(blobLen, 0, 2048);
        _createDefault(alice, ALICE_VAULT, "alice");
        bytes memory blob = _blob(blobLen, 0x5A);

        bool ok = blobLen >= 1 && blobLen <= 1024;
        if (!ok) vm.expectRevert(abi.encodeWithSelector(VaultRegistry.InvalidBlobSize.selector, blobLen));
        vm.prank(alice);
        registry.updateVault(ALICE_VAULT, blob);

        (, bytes memory stored, uint32 version) = registry.getVault(ALICE_VAULT);
        assertEq(stored, ok ? blob : bytes(hex"c0ffee"));
        assertEq(version, ok ? 2 : 1);
    }

    function testFuzz_addLocatorsCap(uint256 initial, uint256 added) public {
        initial = bound(initial, 2, 8);
        added = bound(added, 1, 16);
        _create(alice, ALICE_VAULT, hex"01", _locators(initial, "init"));
        bytes32[] memory extra = _locators(added, "extra");

        if (initial + added > 8) {
            vm.expectRevert(abi.encodeWithSelector(VaultRegistry.TooManyLocators.selector, initial + added));
        }
        vm.prank(alice);
        registry.addLocators(ALICE_VAULT, extra);

        assertEq(registry.resolveLocator(extra[0]).length, initial + added > 8 ? 0 : 1);
    }

    /// Any non-owner (including the deployer) can never update or add locators.
    function testFuzz_nonOwnerCannotWrite(address caller, bytes32 loc) public {
        vm.assume(caller != alice && loc != bytes32(0));
        _createDefault(alice, ALICE_VAULT, "alice");

        vm.startPrank(caller);
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.NotVaultOwner.selector, ALICE_VAULT, caller));
        registry.updateVault(ALICE_VAULT, hex"00");
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.NotVaultOwner.selector, ALICE_VAULT, caller));
        registry.addLocators(ALICE_VAULT, _one(loc));
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // 5.2 Arbitrary append sequences: each locator list is a prefix-preserving, append-only log
    // ---------------------------------------------------------------------

    uint256 private constant LOCATOR_POOL = 2;

    /// Each op byte encodes: bit 7 = create (0) or addLocators (1); bit 6 = which pooled locator;
    /// bits 0..5 = actor (64 actors, so the 16-entry cap is reachable and owners/ids collide).
    /// Every step may succeed or revert; either way no existing entry may move or disappear.
    function testFuzz_appendSequenceIsPrefixPreserving(uint8[] calldata ops) public {
        vm.assume(ops.length > 0);
        uint256 steps = ops.length > 96 ? 96 : ops.length;
        bytes32[LOCATOR_POOL] memory pool = [keccak256("p0"), keccak256("p1")];

        for (uint256 s; s < steps; ++s) {
            bytes32[][LOCATOR_POOL] memory before;
            for (uint256 k; k < LOCATOR_POOL; ++k) {
                before[k] = registry.resolveLocator(pool[k]);
            }

            uint8 op = ops[s];
            uint256 actor = op & 0x3f;
            address who = address(uint160(0x1000 + actor));
            bytes32 id = keccak256(abi.encode("v", actor));
            bytes32 shared = pool[(op >> 6) & 1];
            vm.prank(who);
            if (op & 0x80 == 0) {
                try registry.createVault(id, hex"01", _pair(shared, keccak256(abi.encode("own", actor)))) {} catch {}
            } else {
                try registry.addLocators(id, _one(shared)) {} catch {}
            }

            for (uint256 k; k < LOCATOR_POOL; ++k) {
                bytes32[] memory afterList = registry.resolveLocator(pool[k]);
                assertLe(afterList.length, 16);
                assertGe(afterList.length, before[k].length);
                assertLe(afterList.length - before[k].length, 1);
                for (uint256 i; i < before[k].length; ++i) {
                    assertEq(afterList[i], before[k][i]);
                }
            }
        }
    }
}
