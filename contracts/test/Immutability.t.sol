// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VaultRegistry} from "../src/VaultRegistry.sol";

/// @dev Bytecode and source helpers shared by the v1 and v2 immutability checks.
abstract contract ImmutabilityHelpers is Test {
    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------

    /// @dev Solidity appends CBOR metadata followed by its 2-byte big-endian length.
    function _stripMetadata(bytes memory code) internal pure returns (bytes memory out) {
        uint256 n = code.length;
        uint256 metaLen = (uint256(uint8(code[n - 2])) << 8) | uint256(uint8(code[n - 1]));
        uint256 keep = n - 2 - metaLen;
        out = new bytes(keep);
        for (uint256 i; i < keep; ++i) {
            out[i] = code[i];
        }
    }

    function _countOpcode(bytes memory code, uint8 target) internal pure returns (uint256 count) {
        uint256 i;
        while (i < code.length) {
            uint8 op = uint8(code[i]);
            if (op == target) ++count;
            if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
            ++i;
        }
    }

    function _stripComments(bytes memory s) internal pure returns (bytes memory out) {
        out = new bytes(s.length);
        uint256 o;
        uint256 i;
        while (i < s.length) {
            if (i + 1 < s.length && s[i] == "/" && s[i + 1] == "/") {
                while (i < s.length && s[i] != "\n") ++i;
            } else if (i + 1 < s.length && s[i] == "/" && s[i + 1] == "*") {
                i += 2;
                while (i + 1 < s.length && !(s[i] == "*" && s[i + 1] == "/")) ++i;
                i += 2;
            } else {
                out[o++] = s[i++];
            }
        }
        assembly {
            mstore(out, o)
        }
    }

    function _contains(bytes memory hay, bytes memory needle) internal pure returns (bool) {
        return vm.indexOf(string(hay), string(needle)) != type(uint256).max;
    }
}

/// @dev Task 6.1: static checks that the registry has no self-destruct, delegatecall, proxy, external calls
///      (so no precompiles such as ArbSys), or privileged role, in either the deployed bytecode or the source.
contract ImmutabilityTest is ImmutabilityHelpers {
    VaultRegistry internal registry;

    function setUp() public {
        registry = new VaultRegistry();
    }

    // ---------------------------------------------------------------------
    // Bytecode
    // ---------------------------------------------------------------------

    function test_bytecode_hasNoForbiddenOpcodes() public view {
        bytes memory code = _stripMetadata(address(registry).code);
        assertGt(code.length, 0);

        uint256 i;
        while (i < code.length) {
            uint8 op = uint8(code[i]);
            assertTrue(op != 0xff, "SELFDESTRUCT");
            assertTrue(op != 0xf4, "DELEGATECALL");
            assertTrue(op != 0xf2, "CALLCODE");
            assertTrue(op != 0xf1, "CALL");
            assertTrue(op != 0xfa, "STATICCALL");
            assertTrue(op != 0xf0, "CREATE");
            assertTrue(op != 0xf5, "CREATE2");
            // PUSH1..PUSH32 carry inline data that must not be decoded as opcodes.
            if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
            ++i;
        }
    }

    /// The opcode walk must actually detect forbidden opcodes (guards against a vacuous check).
    function test_bytecode_walkerDetectsSelfdestruct() public pure {
        // PUSH1 0xff (data, must be skipped) ; SELFDESTRUCT ; then a 2-byte metadata-length suffix of 0.
        bytes memory code = hex"60ffff0000";
        bytes memory stripped = _stripMetadata(code);
        assertEq(stripped.length, 3);
        assertEq(_countOpcode(stripped, 0xff), 1);
    }

    // ---------------------------------------------------------------------
    // Source
    // ---------------------------------------------------------------------

    function test_source_hasNoPrivilegedOrUpgradeConstructs() public view {
        bytes memory src = _stripComments(bytes(vm.readFile("src/VaultRegistry.sol")));
        string[18] memory forbidden = [
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
            "import",
            "assembly"
        ];
        for (uint256 i; i < forbidden.length; ++i) {
            assertFalse(_contains(src, bytes(forbidden[i])), forbidden[i]);
        }
        // No constructor, so the deployer cannot be captured as a privileged address.
        assertFalse(_contains(src, "constructor"), "constructor");
    }

    function test_source_commentStripperKeepsCode() public pure {
        bytes memory s = _stripComments("a // selfdestruct\nb /* Proxy */ c");
        assertFalse(_contains(s, "selfdestruct"));
        assertFalse(_contains(s, "Proxy"));
        assertTrue(_contains(s, "a"));
        assertTrue(_contains(s, "c"));
    }
}
