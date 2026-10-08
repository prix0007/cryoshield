// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {UserOperation} from "account-abstraction/interfaces/UserOperation.sol";
import {CryoShieldSmartWallet} from "../src/CryoShieldSmartWallet.sol";
import {WalletTestBase} from "./WalletBase.t.sol";

/// @dev harden-gas-sponsorship 4.4: account validation and account creation stay inside the ERC-7562 rules a public
///      bundler enforces. Each test traces the call opcode by opcode (vm.startDebugTraceRecording) and checks:
///      - no opcode banned in validation (OP-011, OP-080 for an unstaked entity);
///      - GAS is only used immediately before a *CALL (OP-012);
///      - CREATE/CREATE2 only in the factory, at most once (OP-031);
///      - storage is only touched on the account itself (STO-010; the account is the sender).
///      forge only records debug traces when its tracer is on, so run these with:
///          forge test --mc CryoShieldSmartWalletErc7562Test -vvv
///      Under a plain `forge test` they are SKIPPED (reported as skipped, never as passed). CI runs them with -vvv and
///      CRYOSHIELD_REQUIRE_TRACE=1, which turns a missing tracer into a failure.
contract CryoShieldSmartWalletErc7562Test is WalletTestBase {
    address internal constant P256_PRECOMPILE = address(0x100);

    /// @dev Stand-in for the RIP-7212 precompile (OP Stack has the real one; it executes no EVM opcodes): returns 1.
    ///      Without it, the software P-256 fallback produces a trace too large to return to the test. Real signature
    ///      verification is covered by the functional tests, which run without this stub.
    function setUp() public override {
        super.setUp();
        vm.etch(P256_PRECOMPILE, hex"600160005260206000f3");
    }

    /// @dev Starts trace recording, or skips the test when the tracer is off (no -vvv).
    function _startTrace() internal {
        try vm.startDebugTraceRecording() {}
        catch {
            // CI sets CRYOSHIELD_REQUIRE_TRACE=1 so a missing tracer fails the job instead of skipping silently.
            if (vm.envOr("CRYOSHIELD_REQUIRE_TRACE", false)) {
                revert("forge tracer required (CRYOSHIELD_REQUIRE_TRACE=1): run with -vvv");
            }
            vm.skip(true, "needs the forge tracer: forge test --mc CryoShieldSmartWalletErc7562Test -vvv");
        }
    }

    function _isBanned(uint8 op) internal pure returns (bool) {
        return op == 0x32 // ORIGIN
            || op == 0x3a // GASPRICE
            || op == 0x40 // BLOCKHASH
            || op == 0x41 // COINBASE
            || op == 0x42 // TIMESTAMP
            || op == 0x43 // NUMBER
            || op == 0x44 // PREVRANDAO
            || op == 0x45 // GASLIMIT
            || op == 0x48 // BASEFEE
            || op == 0x49 // BLOBHASH
            || op == 0x4a // BLOBBASEFEE
            || op == 0x31 // BALANCE
            || op == 0x47 // SELFBALANCE
            || op == 0xff; // SELFDESTRUCT
    }

    function _isCall(uint8 op) internal pure returns (bool) {
        return op == 0xf1 || op == 0xf2 || op == 0xf4 || op == 0xfa;
    }

    /// @dev Asserts the ERC-7562 opcode/storage rules over `steps`. `creates` = CREATE/CREATE2 opcodes allowed.
    function _assertCompliant(Vm.DebugStep[] memory steps, address storageOwner, uint256 creates) internal view {
        assertGt(steps.length, 100, "trace recorded");
        uint256 seenCreates;
        for (uint256 i; i < steps.length; ++i) {
            // Only the account/factory side: not the test itself, cheatcodes, the EntryPoint (the prefund deposit is
            // the EntryPoint's own code), or the precompile stand-in.
            address ctx = steps[i].contractAddr;
            if (ctx == address(this) || ctx == address(vm) || ctx == address(entryPoint) || ctx == P256_PRECOMPILE) {
                continue;
            }
            uint8 op = steps[i].opcode;
            assertFalse(_isBanned(op), string.concat("banned opcode 0x", vm.toString(abi.encodePacked(op))));
            if (op == 0x5a) {
                // OP-012: GAS must be immediately followed by a call at the same depth.
                assertTrue(i + 1 < steps.length && _isCall(steps[i + 1].opcode), "GAS not followed by *CALL");
            }
            if (op == 0xf0 || op == 0xf5) ++seenCreates;
            if (op == 0x54 || op == 0x55) {
                assertEq(steps[i].contractAddr, storageOwner, "storage access outside the sender");
            }
        }
        assertLe(seenCreates, creates, "CREATE/CREATE2 count");
    }

    function test_validateUserOp_trace_validSignature() public {
        _traceValidation(FLAGS_UP_UV, rpIdHash, 0);
    }

    function test_validateUserOp_trace_uv0() public {
        _traceValidation(FLAGS_UP, rpIdHash, 1);
    }

    function test_validateUserOp_trace_foreignRp() public {
        _traceValidation(FLAGS_UP_UV, sha256("evil.example"), 1);
    }

    function test_validateUserOp_trace_withPrefund() public {
        CryoShieldSmartWallet account = _deployAccount();
        UserOperation memory op = _op(address(account), 0, "", _execute(address(registry), ""));
        bytes32 hash = entryPoint.getUserOpHash(op);
        op.signature = _sign(keyA, 0, hash, FLAGS_UP_UV);
        _startTrace();
        vm.prank(address(entryPoint));
        uint256 res = account.validateUserOp(op, hash, 1 gwei);
        Vm.DebugStep[] memory steps = vm.stopAndReturnDebugTraceRecording();
        assertEq(res, 0);
        _assertCompliant(steps, address(account), 0);
    }

    function _traceValidation(bytes1 flags, bytes32 rpHash, uint256 want) internal {
        CryoShieldSmartWallet account = _deployAccount();
        UserOperation memory op = _op(address(account), 0, "", _execute(address(registry), ""));
        bytes32 hash = entryPoint.getUserOpHash(op);
        op.signature = _wrap(0, _assertion(keyA, hash, flags, rpHash));
        _startTrace();
        vm.prank(address(entryPoint));
        uint256 res = account.validateUserOp(op, hash, 0);
        Vm.DebugStep[] memory steps = vm.stopAndReturnDebugTraceRecording();
        assertEq(res, want);
        _assertCompliant(steps, address(account), 0);
    }

    /// The initCode path: the factory deploys and initializes the account (one CREATE2, account storage only).
    function test_factoryCreateAccount_trace() public {
        address predicted = factory.getAddress(_owners2(), 0);
        bytes[] memory owners = _owners2();
        _startTrace();
        factory.createAccount(owners, 0);
        Vm.DebugStep[] memory steps = vm.stopAndReturnDebugTraceRecording();
        _assertCompliant(steps, predicted, 1);
    }

    /// Non-vacuity: the recorder sees a TIMESTAMP executed inside a called contract, and _isBanned flags it.
    function test_checker_detectsTimestampInCallee() public {
        address probe = makeAddr("timestamp-probe");
        vm.etch(probe, hex"4260005260206000f3"); // TIMESTAMP; PUSH1 0; MSTORE; PUSH1 32; PUSH1 0; RETURN
        _startTrace();
        (bool ok,) = probe.call("");
        Vm.DebugStep[] memory steps = vm.stopAndReturnDebugTraceRecording();
        assertTrue(ok);
        uint256 banned;
        for (uint256 i; i < steps.length; ++i) {
            if (steps[i].contractAddr == probe && _isBanned(steps[i].opcode)) ++banned;
        }
        assertEq(banned, 1);
    }
}
