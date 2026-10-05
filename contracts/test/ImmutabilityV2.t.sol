// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ImmutabilityHelpers} from "./Immutability.t.sol";
import {VaultRegistryV2} from "../src/VaultRegistryV2.sol";

/// @dev harden-gas-sponsorship 3.3: the v1 static immutability checks, extended to VaultRegistryV2 and its
///      interface. The only import allowed is the interface itself.
contract ImmutabilityV2Test is ImmutabilityHelpers {
    VaultRegistryV2 internal registry;

    function setUp() public {
        registry = new VaultRegistryV2();
    }

    function test_v2_bytecode_hasNoForbiddenOpcodes() public view {
        bytes memory code = _stripMetadata(address(registry).code);
        assertGt(code.length, 0);
        uint8[7] memory forbidden = [0xff, 0xf4, 0xf2, 0xf1, 0xfa, 0xf0, 0xf5];
        for (uint256 i; i < forbidden.length; ++i) {
            assertEq(_countOpcode(code, forbidden[i]), 0, vm.toString(forbidden[i]));
        }
    }

    function test_v2_source_hasNoPrivilegedOrUpgradeConstructs() public view {
        _checkSource("src/VaultRegistryV2.sol");
        _checkSource("src/IVaultRegistryV2.sol");
    }

    function test_v2_onlyImportIsTheInterface() public view {
        bytes memory src = _stripComments(bytes(vm.readFile("src/VaultRegistryV2.sol")));
        assertTrue(_contains(src, 'import {IVaultRegistryV2} from "./IVaultRegistryV2.sol";'));
        // Exactly one import statement.
        bytes memory rest =
            bytes(vm.replace(string(src), 'import {IVaultRegistryV2} from "./IVaultRegistryV2.sol";', ""));
        assertFalse(_contains(rest, "import"), "extra import");
        bytes memory iface = _stripComments(bytes(vm.readFile("src/IVaultRegistryV2.sol")));
        assertFalse(_contains(iface, "import"), "interface import");
    }

    function _checkSource(string memory path) internal view {
        bytes memory src = _stripComments(bytes(vm.readFile(path)));
        string[17] memory forbidden = [
            "selfdestruct",
            "delegatecall",
            "callcode",
            ".call",
            "staticcall",
            "Ownable",
            "onlyOwner",
            "AccessControl",
            "admin",
            "Admin",
            "Proxy",
            "upgrade",
            "Upgrade",
            "initialize",
            "pause",
            "Pause",
            "assembly"
        ];
        for (uint256 i; i < forbidden.length; ++i) {
            assertFalse(_contains(src, bytes(forbidden[i])), string.concat(path, ": ", forbidden[i]));
        }
        assertFalse(_contains(src, "constructor"), string.concat(path, ": constructor"));
    }
}
