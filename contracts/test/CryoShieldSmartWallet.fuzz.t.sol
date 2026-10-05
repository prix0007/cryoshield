// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UserOperation} from "account-abstraction/interfaces/UserOperation.sol";
import {CryoShieldSmartWallet} from "../src/CryoShieldSmartWallet.sol";
import {WalletTestBase} from "./WalletBase.t.sol";

/// @dev harden-gas-sponsorship 4.6: a correctly signed assertion validates iff UP and UV are set and the rpIdHash is
///      ours. Each run re-signs, so only the fuzzed property differs. Runs are reduced because every run performs a
///      software P-256 verification (no RIP-7212 precompile in the test EVM).
contract CryoShieldSmartWalletFuzzTest is WalletTestBase {
    CryoShieldSmartWallet internal account;

    function setUp() public override {
        super.setUp();
        account = _deployAccount();
    }

    /// forge-config: default.fuzz.runs = 256
    /// forge-config: mainnet.fuzz.runs = 256
    function testFuzz_flagsAndRpIdHash(uint8 flags, bytes32 rpHash, bool useOurRp) public {
        if (useOurRp) rpHash = rpIdHash;
        UserOperation memory op = _op(address(account), 0, "", _execute(address(registry), ""));
        bytes32 hash = entryPoint.getUserOpHash(op);
        op.signature = _wrap(0, _assertion(keyA, hash, bytes1(flags), rpHash));
        vm.prank(address(entryPoint));
        uint256 res = account.validateUserOp(op, hash, 0);
        bool shouldPass = (flags & 0x05) == 0x05 && rpHash == rpIdHash;
        assertEq(res, shouldPass ? 0 : 1);
    }

    /// forge-config: default.fuzz.runs = 256
    /// forge-config: mainnet.fuzz.runs = 256
    function testFuzz_authDataLength(uint8 len) public {
        bytes memory ad = new bytes(len);
        bytes memory full = abi.encodePacked(rpIdHash, FLAGS_UP_UV, uint32(1));
        for (uint256 i; i < len && i < full.length; ++i) {
            ad[i] = full[i];
        }
        UserOperation memory op = _op(address(account), 0, "", _execute(address(registry), ""));
        bytes32 hash = entryPoint.getUserOpHash(op);
        op.signature = _wrap(0, _assertionRaw(keyA, hash, ad));
        vm.prank(address(entryPoint));
        uint256 res = account.validateUserOp(op, hash, 0);
        // At least 37 bytes are needed; longer authenticatorData (extensions) is valid when the prefix is right.
        assertEq(res, len >= 37 ? 0 : 1);
    }
}
