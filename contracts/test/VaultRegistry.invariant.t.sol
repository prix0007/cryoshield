// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {VaultRegistry} from "../src/VaultRegistry.sol";

/// @dev Drives random create/update/addLocators calls and mirrors every successful write in ghost state.
///      Ghost locator lists are only ever appended to, so `registry list == ghost list` proves the on-chain
///      index is append-only (no removal, reorder, or overwrite).
contract RegistryHandler is Test {
    VaultRegistry public immutable registry;

    uint256 public constant ACTORS = 40;
    uint256 public constant LOCATORS = 3; // small pool so the 16-entry cap is hit regularly

    mapping(bytes32 locator => bytes32[]) internal _ghostIndex;
    mapping(bytes32 vaultId => uint256) public ghostVersion;
    mapping(bytes32 vaultId => bytes32) public ghostBlobHash;
    mapping(bytes32 vaultId => uint256) public ghostLocatorCount;
    mapping(bytes32 vaultId => address) public ghostOwner;
    bytes32[] public createdVaults;

    uint256 public creates;
    uint256 public updates;
    uint256 public adds;
    uint256 public locatorFullReverts;

    constructor(VaultRegistry registry_) {
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

    function create(uint256 actorSeed, uint256 idSeed, uint256 locA, uint256 blobLen) external {
        address who = actor(actorSeed);
        // Small id space so front-run / duplicate ids collide.
        bytes32 id = keccak256(abi.encode("id", idSeed % (ACTORS * 2)));
        bytes32[] memory locs = new bytes32[](2);
        locs[0] = locator(locA);
        // Occasionally (1 in 16) submit a duplicate pair to exercise DuplicateLocator; otherwise two distinct
        // pooled locators.
        locs[1] = (locA >> 8) % 16 == 0 ? locs[0] : locator(locA + 1);
        bytes memory blob = new bytes(bound(blobLen, 1, 1024));
        blob[0] = bytes1(uint8(idSeed));

        vm.prank(who);
        try registry.createVault(id, blob, locs) {
            ++creates;
            createdVaults.push(id);
            ghostOwner[id] = who;
            ghostVersion[id] = 1;
            ghostBlobHash[id] = keccak256(blob);
            ghostLocatorCount[id] = 2;
            _ghostIndex[locs[0]].push(id);
            _ghostIndex[locs[1]].push(id);
        } catch (bytes memory reason) {
            _countFull(reason);
        }
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
        // Mix pooled locators (cap pressure) and private ones (vault cap pressure).
        locs[0] = locSeed % 2 == 0 ? locator(locSeed / 2) : keccak256(abi.encode("private", locSeed));

        vm.prank(who);
        try registry.addLocators(id, locs) {
            ++adds;
            ghostLocatorCount[id] += 1;
            _ghostIndex[locs[0]].push(id);
        } catch (bytes memory reason) {
            _countFull(reason);
        }
    }

    function _countFull(bytes memory reason) private {
        if (reason.length >= 4 && bytes4(reason) == VaultRegistry.LocatorFull.selector) ++locatorFullReverts;
    }
}

contract VaultRegistryInvariantTest is Test {
    VaultRegistry internal registry;
    RegistryHandler internal handler;

    function setUp() public {
        registry = new VaultRegistry();
        handler = new RegistryHandler(registry);
        targetContract(address(handler));
    }

    /// Locator index is exactly the append-only ghost log, and never exceeds 16 entries.
    function invariant_locatorIndexIsAppendOnlyLog() public view {
        for (uint256 i; i < handler.LOCATORS(); ++i) {
            bytes32 loc = handler.locator(i);
            bytes32[] memory onChain = registry.resolveLocator(loc);
            assertEq(onChain, handler.ghostIndex(loc));
            assertLe(onChain.length, registry.MAX_VAULTS_PER_LOCATOR());
        }
    }

    /// Every created vault keeps its owner, matches the ghost version/hash, and respects caps.
    function invariant_vaultStateMatchesGhost() public view {
        uint256 n = handler.createdCount();
        for (uint256 i; i < n; ++i) {
            bytes32 id = handler.createdVaults(i);
            (address owner, bytes memory blob, uint32 version) = registry.getVault(id);
            assertEq(owner, handler.ghostOwner(id));
            assertEq(registry.vaultOf(owner), id);
            assertEq(uint256(version), handler.ghostVersion(id));
            assertEq(keccak256(blob), handler.ghostBlobHash(id));
            assertGe(blob.length, 1);
            assertLe(blob.length, registry.MAX_BLOB_SIZE());
            assertGe(handler.ghostLocatorCount(id), registry.MIN_LOCATORS());
            assertLe(handler.ghostLocatorCount(id), registry.MAX_LOCATORS_PER_VAULT());
        }
    }

    /// The deployer (this test contract) never gains a vault or any control.
    function invariant_deployerOwnsNothing() public view {
        assertEq(registry.vaultOf(address(this)), bytes32(0));
    }

    /// Call summary (run with -vv) to confirm the handler exercises success paths and the per-locator cap.
    function afterInvariant() external view {
        console.log("creates", handler.creates());
        console.log("updates", handler.updates());
        console.log("adds", handler.adds());
        console.log("locatorFullReverts", handler.locatorFullReverts());
    }
}
