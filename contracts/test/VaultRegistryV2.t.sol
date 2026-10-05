// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {RegistryV2TestBase} from "./BaseV2.t.sol";
import {IVaultRegistryV2} from "../src/IVaultRegistryV2.sol";

/// @dev Unit tests for VaultRegistryV2, one or more per vault-registry delta scenario (harden-gas-sponsorship 3.2).
contract VaultRegistryV2Test is RegistryV2TestBase {
    using stdJson for string;

    event VaultCreated(bytes32 indexed vaultId, address indexed owner, uint32 version, bytes32 blobHash);
    event VaultUpdated(bytes32 indexed vaultId, uint32 version, bytes32 blobHash);
    event LocatorAdded(bytes32 indexed vaultId, bytes32 indexed locator);

    // ---------------------------------------------------------------------
    // Vault creation + derivation vector
    // ---------------------------------------------------------------------

    function test_create_derivesIdFromSenderAndSalt() public {
        bytes32[] memory locs = _locators(2, "a");
        bytes32 expected = _id(alice, SALT_A);

        vm.expectEmit(true, true, false, true, address(registry));
        emit VaultCreated(expected, alice, 1, keccak256(hex"c0ffee"));
        vm.expectEmit(true, true, false, true, address(registry));
        emit LocatorAdded(expected, locs[0]);
        vm.expectEmit(true, true, false, true, address(registry));
        emit LocatorAdded(expected, locs[1]);
        bytes32 vaultId = _create(alice, SALT_A, hex"c0ffee", locs);

        assertEq(vaultId, expected);
        (address owner, bytes memory blob, uint32 version) = registry.getVault(vaultId);
        assertEq(owner, alice);
        assertEq(blob, hex"c0ffee");
        assertEq(version, 1);
        assertEq(registry.vaultOf(alice), vaultId);
        assertEq(registry.locatorLength(locs[0]), 1);
        assertEq(registry.resolveLocator(locs[0], 0, 256)[0], vaultId);
        assertEq(registry.resolveLocator(locs[1], 0, 256)[0], vaultId);
    }

    function test_vaultIdDerivation_matchesVector() public view {
        string memory json = vm.readFile("test/fixtures/vaultIdDerivation.json");
        uint256 n;
        while (json.keyExists(string.concat(".cases[", vm.toString(n), "]"))) {
            string memory p = string.concat(".cases[", vm.toString(n), "]");
            address owner = json.readAddress(string.concat(p, ".owner"));
            bytes32 salt = json.readBytes32(string.concat(p, ".salt"));
            bytes32 want = json.readBytes32(string.concat(p, ".vaultId"));
            assertEq(registry.vaultIdFor(owner, salt), want, "vaultIdFor");
            assertEq(_id(owner, salt), want, "abi.encode derivation");
            ++n;
        }
        assertEq(n, 3, "vector case count");
    }

    function test_create_vectorOwnerRegistersVectorId() public {
        string memory json = vm.readFile("test/fixtures/vaultIdDerivation.json");
        address owner = json.readAddress(".cases[1].owner");
        bytes32 salt = json.readBytes32(".cases[1].salt");
        bytes32 vaultId = _create(owner, salt, hex"01", _locators(2, "vec"));
        assertEq(vaultId, json.readBytes32(".cases[1].vaultId"));
    }

    function test_create_zeroSaltAllowed() public {
        bytes32 vaultId = _create(alice, bytes32(0), hex"01", _locators(2, "z"));
        assertEq(vaultId, _id(alice, bytes32(0)));
        assertTrue(vaultId != bytes32(0));
    }

    // ---------------------------------------------------------------------
    // Unique vault identifiers
    // ---------------------------------------------------------------------

    function test_squattingImpossible() public {
        // Mallory copies alice's pending salt and locators and lands first.
        bytes32[] memory locs = _locators(2, "victim");
        bytes32 malloryId = _create(mallory, SALT_A, hex"bad0", locs);
        bytes32 aliceId = _create(alice, SALT_A, hex"c0ffee", locs);

        assertTrue(malloryId != aliceId);
        assertEq(aliceId, _id(alice, SALT_A));
        (address owner, bytes memory blob,) = registry.getVault(aliceId);
        assertEq(owner, alice);
        assertEq(blob, hex"c0ffee");
    }

    function test_duplicateVaultId_ownerAlreadyHasVaultFiresFirst() public {
        bytes32 vaultId = _createDefault(alice, SALT_A, "a");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.OwnerAlreadyHasVault.selector, alice));
        registry.createVault(SALT_A, hex"ff", _locators(2, "other"));

        (, bytes memory blob, uint32 version) = registry.getVault(vaultId);
        assertEq(blob, hex"c0ffee");
        assertEq(version, 1);
    }

    function test_secondVaultFromSameOwner_reverts() public {
        _createDefault(alice, SALT_A, "a");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.OwnerAlreadyHasVault.selector, alice));
        registry.createVault(SALT_B, hex"ff", _locators(2, "b"));
    }

    // ---------------------------------------------------------------------
    // Blob size limit
    // ---------------------------------------------------------------------

    function test_create_emptyBlob_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.InvalidBlobSize.selector, 0));
        registry.createVault(SALT_A, "", _locators(2, "a"));
    }

    function test_create_oversizedBlob_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.InvalidBlobSize.selector, 1025));
        registry.createVault(SALT_A, _blob(1025, 0xA5), _locators(2, "a"));
    }

    function test_maxBlob_roundTrips() public {
        bytes memory blob = _blob(1024, 0xA5);
        bytes32 vaultId = _create(alice, SALT_A, blob, _locators(2, "a"));
        (, bytes memory stored,) = registry.getVault(vaultId);
        assertEq(stored, blob);
    }

    function test_update_blobLimits() public {
        bytes32 vaultId = _createDefault(alice, SALT_A, "a");
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.InvalidBlobSize.selector, 0));
        registry.updateVault(vaultId, "");
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.InvalidBlobSize.selector, 1025));
        registry.updateVault(vaultId, _blob(1025, 0x01));
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // Locator count limit
    // ---------------------------------------------------------------------

    function test_create_tooFewLocators_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.TooFewLocators.selector, 1));
        registry.createVault(SALT_A, hex"01", _locators(1, "a"));
    }

    function test_create_tooManyLocators_reverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.TooManyLocators.selector, 9));
        registry.createVault(SALT_A, hex"01", _locators(9, "a"));
    }

    function test_create_eightLocators_ok() public {
        bytes32 vaultId = _create(alice, SALT_A, hex"01", _locators(8, "a"));
        assertEq(registry.resolveLocator(_locators(8, "a")[7], 0, 1)[0], vaultId);
    }

    function test_addLocators_capAtEight() public {
        bytes32 vaultId = _create(alice, SALT_A, hex"01", _locators(7, "a"));
        vm.startPrank(alice);
        registry.addLocators(vaultId, _one(keccak256("eighth")));
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.TooManyLocators.selector, 9));
        registry.addLocators(vaultId, _one(keccak256("ninth")));
        vm.stopPrank();
    }

    function test_addLocators_empty_reverts() public {
        bytes32 vaultId = _createDefault(alice, SALT_A, "a");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.TooFewLocators.selector, 0));
        registry.addLocators(vaultId, new bytes32[](0));
    }

    function test_addLocators_alreadyOnVault_reverts() public {
        bytes32[] memory locs = _locators(2, "a");
        bytes32 vaultId = _create(alice, SALT_A, hex"01", locs);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.DuplicateLocator.selector, locs[0]));
        registry.addLocators(vaultId, _one(locs[0]));
    }

    function test_addLocators_appendsAndEmits() public {
        bytes32 vaultId = _createDefault(alice, SALT_A, "a");
        bytes32 loc = keccak256("new-key");
        vm.expectEmit(true, true, false, true, address(registry));
        emit LocatorAdded(vaultId, loc);
        vm.prank(alice);
        registry.addLocators(vaultId, _one(loc));
        assertEq(registry.resolveLocator(loc, 0, 1)[0], vaultId);
    }

    // ---------------------------------------------------------------------
    // Append-only locator index
    // ---------------------------------------------------------------------

    function test_sharedLocator_doesNotBlock() public {
        bytes32 shared = keccak256("shared");
        bytes32 a = _create(alice, SALT_A, hex"01", _pair(shared, keccak256("a2")));
        bytes32 b = _create(bob, SALT_A, hex"02", _pair(shared, keccak256("b2")));
        bytes32[] memory ids = registry.resolveLocator(shared, 0, 256);
        assertEq(ids.length, 2);
        assertEq(ids[0], a);
        assertEq(ids[1], b);
    }

    function test_existingEntriesSurviveLaterAppends() public {
        bytes32 shared = keccak256("shared");
        bytes32 victim = _create(alice, SALT_A, hex"01", _pair(shared, keccak256("a2")));
        for (uint256 i; i < 20; ++i) {
            _create(address(uint160(0x1000 + i)), SALT_A, hex"02", _pair(shared, keccak256(abi.encode("j", i))));
        }
        assertEq(registry.locatorLength(shared), 21);
        assertEq(registry.resolveLocator(shared, 0, 1)[0], victim);
    }

    /// Scenario "Per-locator cap": there is none. 1,000 entries, then a further registration succeeds.
    function test_noPerLocatorCap() public {
        bytes32 shared = keccak256("stuffed");
        for (uint256 i; i < 1000; ++i) {
            _create(address(uint160(0x10000 + i)), SALT_A, hex"02", _pair(shared, keccak256(abi.encode("s", i))));
        }
        bytes32 victim = _create(alice, SALT_A, hex"01", _pair(shared, keccak256("a2")));
        assertEq(registry.locatorLength(shared), 1001);
        assertEq(registry.resolveLocator(shared, 1000, 256)[0], victim);
    }

    /// Registration cost must not grow with the locator's list length (no scan of the shared list).
    function test_appendCostIndependentOfListLength() public {
        bytes32 shared = keccak256("stuffed");
        bytes32 fresh = keccak256("fresh");
        uint256 g0 = gasleft();
        _create(address(0xA1), SALT_A, hex"02", _pair(fresh, keccak256("x0")));
        uint256 costEmpty = g0 - gasleft();
        for (uint256 i; i < 300; ++i) {
            _create(address(uint160(0x20000 + i)), SALT_A, hex"02", _pair(shared, keccak256(abi.encode("t", i))));
        }
        g0 = gasleft();
        _create(address(0xA2), SALT_A, hex"02", _pair(shared, keccak256("x1")));
        uint256 costLong = g0 - gasleft();
        // Allow for warm/cold slot differences only (a scan of 300 entries would cost > 600k).
        assertLt(costLong, costEmpty + 25_000);
    }

    function test_duplicateWithinOneCall_reverts() public {
        bytes32 l = keccak256("dup");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.DuplicateLocator.selector, l));
        registry.createVault(SALT_A, hex"01", _pair(l, l));
    }

    function test_zeroLocator_reverts() public {
        vm.prank(alice);
        vm.expectRevert(IVaultRegistryV2.ZeroLocator.selector);
        registry.createVault(SALT_A, hex"01", _pair(bytes32(0), keccak256("x")));

        bytes32 vaultId = _createDefault(alice, SALT_A, "a");
        vm.prank(alice);
        vm.expectRevert(IVaultRegistryV2.ZeroLocator.selector);
        registry.addLocators(vaultId, _one(bytes32(0)));
    }

    // ---------------------------------------------------------------------
    // Owner-only updates
    // ---------------------------------------------------------------------

    function test_ownerUpdate_incrementsVersion() public {
        bytes32 vaultId = _createDefault(alice, SALT_A, "a");
        vm.expectEmit(true, false, false, true, address(registry));
        emit VaultUpdated(vaultId, 2, keccak256(hex"beef"));
        vm.prank(alice);
        registry.updateVault(vaultId, hex"beef");
        (, bytes memory blob, uint32 version) = registry.getVault(vaultId);
        assertEq(blob, hex"beef");
        assertEq(version, 2);
    }

    function test_nonOwner_cannotUpdateOrAdd() public {
        bytes32 vaultId = _createDefault(alice, SALT_A, "a");
        vm.startPrank(mallory);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.NotVaultOwner.selector, vaultId, mallory));
        registry.updateVault(vaultId, hex"bad0");
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.NotVaultOwner.selector, vaultId, mallory));
        registry.addLocators(vaultId, _one(keccak256("m")));
        vm.stopPrank();
        (, bytes memory blob, uint32 version) = registry.getVault(vaultId);
        assertEq(blob, hex"c0ffee");
        assertEq(version, 1);
    }

    function test_updateUnknownVault_reverts() public {
        bytes32 unknown = keccak256("nope");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.NotVaultOwner.selector, unknown, alice));
        registry.updateVault(unknown, hex"01");
    }

    function test_deployerHasNoPower() public {
        bytes32 vaultId = _createDefault(alice, SALT_A, "a");
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.NotVaultOwner.selector, vaultId, deployer));
        registry.updateVault(vaultId, hex"01");
    }

    // ---------------------------------------------------------------------
    // Public permissionless reads
    // ---------------------------------------------------------------------

    function test_unknownLocator_isEmpty() public view {
        bytes32 l = keccak256("never");
        assertEq(registry.locatorLength(l), 0);
        assertEq(registry.resolveLocator(l, 0, 256).length, 0);
        assertEq(registry.resolveLocator(l, 5, 10).length, 0);
    }

    function test_unknownVault_isZero() public view {
        (address owner, bytes memory blob, uint32 version) = registry.getVault(keccak256("x"));
        assertEq(owner, address(0));
        assertEq(blob.length, 0);
        assertEq(version, 0);
    }

    function test_pageBounds() public {
        bytes32 shared = keccak256("p");
        bytes32[] memory ids = new bytes32[](5);
        for (uint256 i; i < 5; ++i) {
            ids[i] = _create(address(uint160(0x3000 + i)), SALT_A, hex"02", _pair(shared, keccak256(abi.encode(i))));
        }
        bytes32[] memory page = registry.resolveLocator(shared, 1, 3);
        assertEq(page.length, 3);
        assertEq(page[0], ids[1]);
        assertEq(page[2], ids[3]);
        assertEq(registry.resolveLocator(shared, 3, 10).length, 2); // truncated at the end
        assertEq(registry.resolveLocator(shared, 5, 10).length, 0); // start == length
        assertEq(registry.resolveLocator(shared, 99, 10).length, 0); // start beyond length
        assertEq(registry.resolveLocator(shared, 0, 0).length, 0); // count 0
        assertEq(registry.resolveLocator(shared, 2, type(uint256).max).length, 3); // no overflow
        assertEq(registry.resolveLocator(shared, type(uint256).max, type(uint256).max).length, 0);
    }

    function test_pageCountClampedTo256() public {
        bytes32 shared = keccak256("big");
        for (uint256 i; i < 300; ++i) {
            _create(address(uint160(0x40000 + i)), SALT_A, hex"02", _pair(shared, keccak256(abi.encode("b", i))));
        }
        assertEq(registry.resolveLocator(shared, 0, 1000).length, 256);
        assertEq(registry.resolveLocator(shared, 256, 1000).length, 44);
        assertEq(registry.MAX_PAGE_SIZE(), 256);
    }

    function test_getVaults_inputOrderAndUnknowns() public {
        bytes32 a = _createDefault(alice, SALT_A, "a");
        bytes32 b = _create(bob, SALT_B, hex"0b0b", _locators(2, "b"));
        bytes32[] memory q = new bytes32[](3);
        q[0] = b;
        q[1] = keccak256("unknown");
        q[2] = a;
        IVaultRegistryV2.VaultView[] memory v = registry.getVaults(q);
        assertEq(v.length, 3);
        assertEq(v[0].owner, bob);
        assertEq(v[0].blob, hex"0b0b");
        assertEq(v[0].version, 1);
        assertEq(v[1].owner, address(0));
        assertEq(v[1].blob.length, 0);
        assertEq(v[1].version, 0);
        assertEq(v[2].owner, alice);
        assertEq(registry.getVaults(new bytes32[](0)).length, 0);
    }

    function test_getVaults_boundAt32() public {
        assertEq(registry.MAX_BATCH_IDS(), 32);
        assertEq(registry.getVaults(new bytes32[](32)).length, 32);
        vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.TooManyIds.selector, 33));
        registry.getVaults(new bytes32[](33));
    }

    // ---------------------------------------------------------------------
    // Change events: vaultId is the first indexed topic of every event
    // ---------------------------------------------------------------------

    function test_everyEventHasVaultIdTopic() public {
        vm.recordLogs();
        bytes32 vaultId = _createDefault(alice, SALT_A, "a");
        vm.startPrank(alice);
        registry.updateVault(vaultId, hex"02");
        registry.addLocators(vaultId, _one(keccak256("n")));
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 5); // created, 2x locator, updated, locator
        for (uint256 i; i < logs.length; ++i) {
            assertEq(logs[i].topics[1], vaultId);
        }
    }

    function test_constants() public view {
        assertEq(registry.MAX_BLOB_SIZE(), 1024);
        assertEq(registry.MIN_LOCATORS(), 2);
        assertEq(registry.MAX_LOCATORS_PER_VAULT(), 8);
    }
}
