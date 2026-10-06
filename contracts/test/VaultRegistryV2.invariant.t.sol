// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {VaultRegistryV2} from "../src/VaultRegistryV2.sol";

/// @dev Drives random create/update/addLocators calls against VaultRegistryV2 and mirrors every successful write in
///      ghost state. Ghost locator lists are only ever appended to, so `registry list == ghost list` proves the
///      uncapped on-chain index is append-only and prefix-preserving (harden-gas-sponsorship 3.4).
contract RegistryV2Handler is Test {
    VaultRegistryV2 public immutable registry;

    uint256 public constant ACTORS = 60;
    uint256 public constant LOCATORS = 3; // small pool, so lists grow far past v1's 16-entry cap

    mapping(bytes32 locator => bytes32[]) internal _ghostIndex;
    mapping(bytes32 vaultId => uint256) public ghostVersion;
    mapping(bytes32 vaultId => bytes32) public ghostBlobHash;
    mapping(bytes32 vaultId => uint256) public ghostLocatorCount;
    mapping(bytes32 vaultId => address) public ghostOwner;
    bytes32[] public createdVaults;

    uint256 public creates;
    uint256 public updates;
    uint256 public adds;

    constructor(VaultRegistryV2 registry_) {
        registry = registry_;
    }

    function actor(uint256 i) public pure returns (address) {
        return address(uint160(0xA000 + (i % ACTORS)));
    }

    function locator(uint256 i) public pure returns (bytes32) {
        return keccak256(abi.encode("pool-locator", i % LOCATORS));
    }

    function ghostIndex(bytes32 loc) external view returns (bytes32[] memory) {
        return _ghostIndex[loc];
    }

    function createdCount() external view returns (uint256) {
        return createdVaults.length;
    }

    function create(uint256 actorSeed, bytes32 salt, uint256 locA, uint256 blobLen) external {
        address who = actor(actorSeed);
        bytes32[] memory locs = new bytes32[](2);
        locs[0] = locator(locA);
        locs[1] = (locA >> 8) % 16 == 0 ? locs[0] : locator(locA + 1);
        bytes memory blob = new bytes(bound(blobLen, 1, 1024));
        blob[0] = bytes1(uint8(uint256(salt)));

        vm.prank(who);
        try registry.createVault(salt, blob, locs) returns (bytes32 id) {
            assertEq(id, keccak256(abi.encode(who, salt)));
            ++creates;
            createdVaults.push(id);
            ghostOwner[id] = who;
            ghostVersion[id] = 1;
            ghostBlobHash[id] = keccak256(blob);
            ghostLocatorCount[id] = 2;
            _ghostIndex[locs[0]].push(id);
            _ghostIndex[locs[1]].push(id);
        } catch {}
    }

    function update(uint256 vaultSeed, uint256 callerSeed, bool asOwner, uint256 blobLen) external {
        if (createdVaults.length == 0) return;
        bytes32 id = createdVaults[vaultSeed % createdVaults.length];
        address who = asOwner ? ghostOwner[id] : actor(callerSeed);
        bytes memory blob = new bytes(bound(blobLen, 1, 1024));
        blob[blob.length - 1] = bytes1(uint8(vaultSeed));

        vm.prank(who);
        try registry.updateVault(id, blob) {
            ++updates;
            ghostVersion[id] += 1;
            ghostBlobHash[id] = keccak256(blob);
        } catch {}
    }

    function addLocator(uint256 vaultSeed, uint256 callerSeed, bool asOwner, uint256 locSeed) external {
        if (createdVaults.length == 0) return;
        bytes32 id = createdVaults[vaultSeed % createdVaults.length];
        address who = asOwner ? ghostOwner[id] : actor(callerSeed);
        bytes32[] memory locs = new bytes32[](1);
        locs[0] = locSeed % 2 == 0 ? locator(locSeed / 2) : keccak256(abi.encode("private", locSeed));

        vm.prank(who);
        try registry.addLocators(id, locs) {
            ++adds;
            ghostLocatorCount[id] += 1;
            _ghostIndex[locs[0]].push(id);
        } catch {}
    }
}

contract VaultRegistryV2InvariantTest is Test {
    VaultRegistryV2 internal registry;
    RegistryV2Handler internal handler;

    function setUp() public {
        registry = new VaultRegistryV2();
        handler = new RegistryV2Handler(registry);
        targetContract(address(handler));
    }

    /// The locator index is exactly the append-only ghost log, and its 256-entry pages concatenate to it.
    function invariant_locatorIndexIsAppendOnlyLog() public view {
        for (uint256 i; i < handler.LOCATORS(); ++i) {
            bytes32 loc = handler.locator(i);
            bytes32[] memory ghost = handler.ghostIndex(loc);
            assertEq(registry.locatorLength(loc), ghost.length);
            uint256 seen;
            for (uint256 s; s < ghost.length; s += 256) {
                bytes32[] memory page = registry.resolveLocator(loc, s, 256);
                for (uint256 j; j < page.length; ++j) {
                    assertEq(page[j], ghost[seen++]);
                }
            }
            assertEq(seen, ghost.length);
        }
    }

    /// Every created vault keeps its owner and derived id, matches the ghost version/hash, and respects caps.
    function invariant_vaultStateMatchesGhost() public view {
        uint256 n = handler.createdCount();
        for (uint256 i; i < n; ++i) {
            bytes32 id = handler.createdVaults(i);
            (address owner, bytes memory blob, uint32 version) = registry.getVault(id);
            assertEq(owner, handler.ghostOwner(id));
            assertEq(registry.vaultOf(owner), id);
            assertEq(uint256(version), handler.ghostVersion(id));
            assertEq(keccak256(blob), handler.ghostBlobHash(id));
            assertGe(handler.ghostLocatorCount(id), registry.MIN_LOCATORS());
            assertLe(handler.ghostLocatorCount(id), registry.MAX_LOCATORS_PER_VAULT());
        }
    }

    function invariant_deployerOwnsNothing() public view {
        assertEq(registry.vaultOf(address(this)), bytes32(0));
    }

    function afterInvariant() external view {
        console.log("creates", handler.creates());
        console.log("updates", handler.updates());
        console.log("adds", handler.adds());
        console.log("longest list", registry.locatorLength(handler.locator(0)));
    }
}
