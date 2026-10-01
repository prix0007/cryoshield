// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {VaultRegistry} from "../src/VaultRegistry.sol";
import {RegistryTestBase} from "./Base.t.sol";

contract VaultRegistryTest is RegistryTestBase {
    // ---------------------------------------------------------------------
    // 2.1 Creation and uniqueness
    // ---------------------------------------------------------------------

    function test_create_storesOwnerVersionAndBlob() public {
        bytes memory blob = hex"deadbeef";
        bytes32[] memory locs = _locators(2, "alice");
        _create(alice, ALICE_VAULT, blob, locs);

        (address owner, bytes memory stored, uint32 version) = registry.getVault(ALICE_VAULT);
        assertEq(owner, alice);
        assertEq(stored, blob);
        assertEq(version, 1);
        assertEq(registry.vaultOf(alice), ALICE_VAULT);
    }

    function test_create_appendsVaultIdUnderEachLocator() public {
        bytes32[] memory locs = _locators(3, "alice");
        _create(alice, ALICE_VAULT, hex"01", locs);

        for (uint256 i; i < locs.length; ++i) {
            bytes32[] memory ids = registry.resolveLocator(locs[i]);
            assertEq(ids.length, 1);
            assertEq(ids[0], ALICE_VAULT);
        }
    }

    function test_create_emitsVaultCreatedAndLocatorAdded() public {
        bytes memory blob = hex"abcdef";
        bytes32[] memory locs = _locators(2, "alice");

        vm.expectEmit(true, true, true, true, address(registry));
        emit VaultRegistry.VaultCreated(ALICE_VAULT, alice, 1, keccak256(blob));
        vm.expectEmit(true, true, true, true, address(registry));
        emit VaultRegistry.LocatorAdded(ALICE_VAULT, locs[0]);
        vm.expectEmit(true, true, true, true, address(registry));
        emit VaultRegistry.LocatorAdded(ALICE_VAULT, locs[1]);
        _create(alice, ALICE_VAULT, blob, locs);
    }

    function test_create_revertsOnDuplicateVaultId() public {
        _createDefault(alice, ALICE_VAULT, "alice");

        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.VaultIdTaken.selector, ALICE_VAULT));
        _create(bob, ALICE_VAULT, hex"02", _locators(2, "bob"));
    }

    /// Front-run: mallory copies alice's pending vaultId and lands first.
    /// Alice's create reverts, mallory's vault is untouched, and alice retries with a fresh id.
    function test_create_frontRunVaultIdRevertsAndRetrySucceeds() public {
        bytes32[] memory aliceLocs = _locators(2, "alice");
        _create(mallory, ALICE_VAULT, hex"bad0", _locators(2, "mallory"));

        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.VaultIdTaken.selector, ALICE_VAULT));
        _create(alice, ALICE_VAULT, hex"a11ce0", aliceLocs);

        (address owner, bytes memory stored, uint32 version) = registry.getVault(ALICE_VAULT);
        assertEq(owner, mallory);
        assertEq(stored, hex"bad0");
        assertEq(version, 1);

        bytes32 fresh = keccak256("alice-vault-retry");
        _create(alice, fresh, hex"a11ce0", aliceLocs);
        (owner,,) = registry.getVault(fresh);
        assertEq(owner, alice);
    }

    function test_create_revertsOnSecondVaultFromSameOwner() public {
        _createDefault(alice, ALICE_VAULT, "alice");

        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.OwnerAlreadyHasVault.selector, alice));
        _create(alice, keccak256("alice-2"), hex"02", _locators(2, "alice-2"));
    }

    function test_create_revertsOnZeroVaultId() public {
        vm.expectRevert(VaultRegistry.ZeroVaultId.selector);
        _create(alice, bytes32(0), hex"01", _locators(2, "alice"));
    }

    function test_create_revertsOnZeroLocator() public {
        bytes32[] memory locs = _pair(keccak256("l0"), bytes32(0));
        vm.expectRevert(VaultRegistry.ZeroLocator.selector);
        _create(alice, ALICE_VAULT, hex"01", locs);
    }

    // ---------------------------------------------------------------------
    // 2.3 Event hash equals keccak256 of the stored blob
    // ---------------------------------------------------------------------

    function test_create_eventHashMatchesStoredBlob() public {
        vm.recordLogs();
        _create(alice, ALICE_VAULT, _blob(777, 0x5a), _locators(2, "alice"));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        (,, bytes32 hash) = _findVaultEvent(logs, VaultRegistry.VaultCreated.selector);
        (, bytes memory stored,) = registry.getVault(ALICE_VAULT);
        assertEq(hash, keccak256(stored));
    }

    function test_update_eventHashMatchesStoredBlob() public {
        _createDefault(alice, ALICE_VAULT, "alice");

        vm.recordLogs();
        vm.prank(alice);
        registry.updateVault(ALICE_VAULT, _blob(1024, 0x3c));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        (bytes32 id, uint32 version, bytes32 hash) = _findVaultEvent(logs, VaultRegistry.VaultUpdated.selector);
        (, bytes memory stored, uint32 storedVersion) = registry.getVault(ALICE_VAULT);
        assertEq(id, ALICE_VAULT);
        assertEq(version, storedVersion);
        assertEq(hash, keccak256(stored));
    }

    /// Every event carries vaultId as its first indexed topic, so logs can be filtered by vaultId.
    function test_events_allIndexVaultIdAsFirstTopic() public {
        _createDefault(bob, BOB_VAULT, "bob");

        vm.recordLogs();
        bytes32[] memory locs = _createDefault(alice, ALICE_VAULT, "alice");
        vm.startPrank(alice);
        registry.updateVault(ALICE_VAULT, hex"0102");
        registry.addLocators(ALICE_VAULT, _one(keccak256("alice-extra")));
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // created + 2 locators + updated + 1 locator
        assertEq(logs.length, 5);
        bool sawCreated;
        bool sawUpdated;
        uint256 locatorEvents;
        for (uint256 i; i < logs.length; ++i) {
            assertEq(logs[i].emitter, address(registry));
            assertGe(logs[i].topics.length, 2);
            assertEq(logs[i].topics[1], ALICE_VAULT);
            bytes32 sig = logs[i].topics[0];
            if (sig == VaultRegistry.VaultCreated.selector) sawCreated = true;
            else if (sig == VaultRegistry.VaultUpdated.selector) sawUpdated = true;
            else if (sig == VaultRegistry.LocatorAdded.selector) ++locatorEvents;
        }
        assertTrue(sawCreated);
        assertTrue(sawUpdated);
        assertEq(locatorEvents, 3);
        assertEq(locs.length, 2);
    }

    // ---------------------------------------------------------------------
    // 3.1 Limits
    // ---------------------------------------------------------------------

    function test_create_revertsOnEmptyBlob() public {
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.InvalidBlobSize.selector, 0));
        _create(alice, ALICE_VAULT, "", _locators(2, "alice"));
    }

    function test_create_revertsOn1025ByteBlob() public {
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.InvalidBlobSize.selector, 1025));
        _create(alice, ALICE_VAULT, _blob(1025, 0xA5), _locators(2, "alice"));
    }

    /// Test vector: 1024 bytes of 0xA5 round-trips unchanged.
    function test_create_1024ByteA5VectorRoundTrips() public {
        bytes memory vector = _blob(1024, 0xA5);
        _create(alice, ALICE_VAULT, vector, _locators(2, "alice"));

        (, bytes memory stored,) = registry.getVault(ALICE_VAULT);
        assertEq(stored.length, 1024);
        assertEq(keccak256(stored), keccak256(vector));
        assertEq(stored, vector);
    }

    function test_create_revertsOnFewerThanTwoLocators() public {
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.TooFewLocators.selector, 0));
        _create(alice, ALICE_VAULT, hex"01", new bytes32[](0));

        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.TooFewLocators.selector, 1));
        _create(alice, ALICE_VAULT, hex"01", _one(keccak256("only")));
    }

    function test_create_acceptsEightLocators() public {
        _create(alice, ALICE_VAULT, hex"01", _locators(8, "alice"));
        (address owner,,) = registry.getVault(ALICE_VAULT);
        assertEq(owner, alice);
    }

    function test_create_revertsOnMoreThanEightLocators() public {
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.TooManyLocators.selector, 9));
        _create(alice, ALICE_VAULT, hex"01", _locators(9, "alice"));
    }

    function test_create_revertsOnDuplicateLocatorWithinCall() public {
        bytes32 l = keccak256("dup");
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.DuplicateLocator.selector, l));
        _create(alice, ALICE_VAULT, hex"01", _pair(l, l));
    }

    function test_update_revertsOnEmptyAndOversizedBlob() public {
        _createDefault(alice, ALICE_VAULT, "alice");

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.InvalidBlobSize.selector, 0));
        registry.updateVault(ALICE_VAULT, "");
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.InvalidBlobSize.selector, 1025));
        registry.updateVault(ALICE_VAULT, _blob(1025, 0xA5));
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // 4.1 Owner-only updates and locator addition
    // ---------------------------------------------------------------------

    function test_update_ownerReplacesBlobAndIncrementsVersion() public {
        _createDefault(alice, ALICE_VAULT, "alice");
        bytes memory next = _blob(1024, 0x11);

        vm.expectEmit(true, true, true, true, address(registry));
        emit VaultRegistry.VaultUpdated(ALICE_VAULT, 2, keccak256(next));
        vm.prank(alice);
        registry.updateVault(ALICE_VAULT, next);

        (address owner, bytes memory stored, uint32 version) = registry.getVault(ALICE_VAULT);
        assertEq(owner, alice);
        assertEq(stored, next);
        assertEq(version, 2);

        // Shrinking the blob replaces it entirely (no stale tail bytes).
        vm.prank(alice);
        registry.updateVault(ALICE_VAULT, hex"07");
        (, stored, version) = registry.getVault(ALICE_VAULT);
        assertEq(stored, hex"07");
        assertEq(version, 3);
    }

    function test_update_revertsForNonOwnerAndLeavesVaultUnchanged() public {
        _createDefault(alice, ALICE_VAULT, "alice");

        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.NotVaultOwner.selector, ALICE_VAULT, mallory));
        vm.prank(mallory);
        registry.updateVault(ALICE_VAULT, hex"bad0");

        (address owner, bytes memory stored, uint32 version) = registry.getVault(ALICE_VAULT);
        assertEq(owner, alice);
        assertEq(stored, hex"c0ffee");
        assertEq(version, 1);
    }

    function test_update_revertsForUnknownVault() public {
        bytes32 unknown = keccak256("unknown");
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.NotVaultOwner.selector, unknown, alice));
        vm.prank(alice);
        registry.updateVault(unknown, hex"01");
    }

    function test_addLocators_revertsForNonOwner() public {
        _createDefault(alice, ALICE_VAULT, "alice");
        bytes32 l = keccak256("mallory-loc");

        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.NotVaultOwner.selector, ALICE_VAULT, mallory));
        vm.prank(mallory);
        registry.addLocators(ALICE_VAULT, _one(l));
        assertEq(registry.resolveLocator(l).length, 0);
    }

    function test_deployerHasNoSpecialPower() public {
        _createDefault(alice, ALICE_VAULT, "alice");

        vm.startPrank(deployer);
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.NotVaultOwner.selector, ALICE_VAULT, deployer));
        registry.updateVault(ALICE_VAULT, hex"00");
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.NotVaultOwner.selector, ALICE_VAULT, deployer));
        registry.addLocators(ALICE_VAULT, _one(keccak256("deployer-loc")));
        vm.stopPrank();

        (address owner, bytes memory stored, uint32 version) = registry.getVault(ALICE_VAULT);
        assertEq(owner, alice);
        assertEq(stored, hex"c0ffee");
        assertEq(version, 1);
    }

    function test_addLocators_appendsAndEmits() public {
        _createDefault(alice, ALICE_VAULT, "alice");
        bytes32 l = keccak256("alice-new");

        vm.expectEmit(true, true, true, true, address(registry));
        emit VaultRegistry.LocatorAdded(ALICE_VAULT, l);
        vm.prank(alice);
        registry.addLocators(ALICE_VAULT, _one(l));

        bytes32[] memory ids = registry.resolveLocator(l);
        assertEq(ids.length, 1);
        assertEq(ids[0], ALICE_VAULT);
        // Adding a locator does not bump the blob version.
        (,, uint32 version) = registry.getVault(ALICE_VAULT);
        assertEq(version, 1);
    }

    function test_addLocators_respectsCapOfEightPerVault() public {
        _create(alice, ALICE_VAULT, hex"01", _locators(2, "alice"));

        vm.startPrank(alice);
        registry.addLocators(ALICE_VAULT, _locators(6, "alice-more")); // 8 total

        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.TooManyLocators.selector, 9));
        registry.addLocators(ALICE_VAULT, _one(keccak256("ninth")));
        vm.stopPrank();
        assertEq(registry.resolveLocator(keccak256("ninth")).length, 0);
    }

    function test_addLocators_revertsWhenBatchExceedsCap() public {
        _create(alice, ALICE_VAULT, hex"01", _locators(2, "alice"));

        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.TooManyLocators.selector, 9));
        vm.prank(alice);
        registry.addLocators(ALICE_VAULT, _locators(7, "alice-more"));
    }

    function test_addLocators_revertsOnLocatorAlreadyOnThisVault() public {
        bytes32[] memory locs = _createDefault(alice, ALICE_VAULT, "alice");

        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.DuplicateLocator.selector, locs[0]));
        vm.prank(alice);
        registry.addLocators(ALICE_VAULT, _one(locs[0]));
    }

    function test_addLocators_revertsOnDuplicateWithinCall() public {
        _createDefault(alice, ALICE_VAULT, "alice");
        bytes32 l = keccak256("twice");

        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.DuplicateLocator.selector, l));
        vm.prank(alice);
        registry.addLocators(ALICE_VAULT, _pair(l, l));
    }

    function test_addLocators_revertsOnEmptyList() public {
        _createDefault(alice, ALICE_VAULT, "alice");

        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.TooFewLocators.selector, 0));
        vm.prank(alice);
        registry.addLocators(ALICE_VAULT, new bytes32[](0));
    }

    function test_addLocators_revertsOnZeroLocator() public {
        _createDefault(alice, ALICE_VAULT, "alice");

        vm.expectRevert(VaultRegistry.ZeroLocator.selector);
        vm.prank(alice);
        registry.addLocators(ALICE_VAULT, _one(bytes32(0)));
    }

    function test_addLocators_acceptsLocatorUsedByAnotherVault() public {
        bytes32[] memory aliceLocs = _createDefault(alice, ALICE_VAULT, "alice");
        _createDefault(bob, BOB_VAULT, "bob");

        vm.prank(bob);
        registry.addLocators(BOB_VAULT, _one(aliceLocs[0]));

        bytes32[] memory ids = registry.resolveLocator(aliceLocs[0]);
        assertEq(ids.length, 2);
        assertEq(ids[0], ALICE_VAULT);
        assertEq(ids[1], BOB_VAULT);
    }

    // ---------------------------------------------------------------------
    // 5.1 Reads
    // ---------------------------------------------------------------------

    function test_getVault_unknownReturnsEmpty() public view {
        (address owner, bytes memory blob, uint32 version) = registry.getVault(keccak256("nope"));
        assertEq(owner, address(0));
        assertEq(blob.length, 0);
        assertEq(version, 0);
    }

    function test_resolveLocator_unknownReturnsEmptyList() public view {
        bytes32[] memory ids = registry.resolveLocator(keccak256("never-registered"));
        assertEq(ids.length, 0);
    }

    function test_resolveLocator_returnsAllCandidatesInInsertionOrder() public {
        bytes32 shared = keccak256("shared");
        bytes32[] memory expected = new bytes32[](4);
        for (uint256 i; i < 4; ++i) {
            address who = makeAddr(string(abi.encode("owner", i)));
            bytes32 id = keccak256(abi.encode("vault", i));
            expected[i] = id;
            _create(who, id, hex"01", _pair(shared, keccak256(abi.encode("own", i))));
        }
        assertEq(registry.resolveLocator(shared), expected);
    }

    // ---------------------------------------------------------------------
    // 5.2 Append-only index and per-locator cap
    // ---------------------------------------------------------------------

    function test_index_seventeenthAppendReverts() public {
        bytes32 shared = keccak256("crowded");
        for (uint256 i; i < 16; ++i) {
            _create(
                makeAddr(string(abi.encode("filler", i))),
                keccak256(abi.encode("f", i)),
                hex"01",
                _pair(shared, keccak256(abi.encode("fl", i)))
            );
        }
        bytes32[] memory before = registry.resolveLocator(shared);
        assertEq(before.length, 16);

        // 17th via create.
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.LocatorFull.selector, shared));
        _create(alice, ALICE_VAULT, hex"01", _pair(keccak256("a0"), shared));

        // 17th via addLocators.
        _createDefault(bob, BOB_VAULT, "bob");
        vm.expectRevert(abi.encodeWithSelector(VaultRegistry.LocatorFull.selector, shared));
        vm.prank(bob);
        registry.addLocators(BOB_VAULT, _one(shared));

        assertEq(registry.resolveLocator(shared), before);
    }

    /// Locator-list stuffing: junk appends never remove or reorder the victim's entry.
    function test_index_junkAppendsNeverDisplaceVictim() public {
        bytes32[] memory victimLocs = _createDefault(alice, ALICE_VAULT, "alice");
        bytes32 target = victimLocs[1];

        for (uint256 i; i < 15; ++i) {
            _create(
                makeAddr(string(abi.encode("junk", i))),
                keccak256(abi.encode("j", i)),
                hex"ff",
                _pair(target, keccak256(abi.encode("jl", i)))
            );
            bytes32[] memory ids = registry.resolveLocator(target);
            assertEq(ids.length, i + 2);
            assertEq(ids[0], ALICE_VAULT);
        }
        // Victim vault itself is untouched.
        (address owner, bytes memory stored, uint32 version) = registry.getVault(ALICE_VAULT);
        assertEq(owner, alice);
        assertEq(stored, hex"c0ffee");
        assertEq(version, 1);
    }

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------

    function _findVaultEvent(Vm.Log[] memory logs, bytes32 topic0)
        internal
        view
        returns (bytes32 vaultId, uint32 version, bytes32 hash)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(registry) && logs[i].topics[0] == topic0) {
                // Both VaultCreated and VaultUpdated carry (uint32 version, bytes32 blobHash) as data.
                (version, hash) = abi.decode(logs[i].data, (uint32, bytes32));
                return (logs[i].topics[1], version, hash);
            }
        }
        revert("event not found");
    }
}
