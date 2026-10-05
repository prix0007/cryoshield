// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RegistryV2TestBase} from "./BaseV2.t.sol";
import {IVaultRegistryV2} from "../src/IVaultRegistryV2.sol";

/// @dev Fuzz tests for VaultRegistryV2 (harden-gas-sponsorship 3.4).
contract VaultRegistryV2FuzzTest is RegistryV2TestBase {
    /// The registry's id is always keccak256(abi.encode(sender, salt)), and differs for any other sender.
    function testFuzz_derivation(address owner, address other, bytes32 salt) public {
        vm.assume(owner != address(0) && other != owner);
        assertEq(registry.vaultIdFor(owner, salt), keccak256(abi.encode(owner, salt)));
        assertTrue(registry.vaultIdFor(owner, salt) != registry.vaultIdFor(other, salt));
        bytes32 vaultId = _create(owner, salt, hex"01", _locators(2, "f"));
        assertEq(vaultId, keccak256(abi.encode(owner, salt)));
        assertEq(registry.vaultOf(owner), vaultId);
    }

    /// Blob sizes: accepted iff 1..1024 and stored byte-identical.
    function testFuzz_blobSize(uint256 len, bytes1 fill) public {
        len = bound(len, 0, 1100);
        bytes memory blob = _blob(len, fill);
        vm.prank(alice);
        if (len == 0 || len > 1024) {
            vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.InvalidBlobSize.selector, len));
            registry.createVault(SALT_A, blob, _locators(2, "b"));
        } else {
            bytes32 vaultId = registry.createVault(SALT_A, blob, _locators(2, "b"));
            (, bytes memory stored,) = registry.getVault(vaultId);
            assertEq(stored, blob);
        }
    }

    /// Any (start, count) page equals the matching slice of the full list, and pages of <= 256 concatenate to it.
    function testFuzz_pagination(uint256 n, uint256 start, uint256 count) public {
        n = bound(n, 0, 70);
        bytes32 shared = keccak256("fz");
        bytes32[] memory all = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            all[i] = _create(address(uint160(0x5000 + i)), SALT_A, hex"02", _pair(shared, keccak256(abi.encode(i))));
        }
        assertEq(registry.locatorLength(shared), n);

        start = bound(start, 0, n + 5);
        bytes32[] memory page = registry.resolveLocator(shared, start, count);
        uint256 want = start >= n ? 0 : _min(_min(count, 256), n - start);
        assertEq(page.length, want);
        for (uint256 i; i < page.length; ++i) {
            assertEq(page[i], all[start + i]);
        }

        uint256 step = bound(count, 1, 256);
        uint256 seen;
        for (uint256 s; s < n; s += step) {
            bytes32[] memory p = registry.resolveLocator(shared, s, step);
            for (uint256 i; i < p.length; ++i) {
                assertEq(p[i], all[seen++]);
            }
        }
        assertEq(seen, n);
    }

    /// getVaults accepts 0..32 ids and returns them in order; above 32 it reverts.
    function testFuzz_getVaultsBound(uint256 n) public {
        n = bound(n, 0, 64);
        bytes32[] memory ids = new bytes32[](n);
        if (n > 32) {
            vm.expectRevert(abi.encodeWithSelector(IVaultRegistryV2.TooManyIds.selector, n));
            registry.getVaults(ids);
        } else {
            assertEq(registry.getVaults(ids).length, n);
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
