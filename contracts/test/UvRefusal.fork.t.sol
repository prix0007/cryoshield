// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/console.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {UserOperation} from "account-abstraction/interfaces/UserOperation.sol";
import {CryoShieldSmartWallet} from "../src/CryoShieldSmartWallet.sol";
import {CryoShieldSmartWalletFactory} from "../src/CryoShieldSmartWalletFactory.sol";
import {VaultRegistryV2} from "../src/VaultRegistryV2.sol";
import {WalletTestBase} from "./WalletBase.t.sol";

/// @dev harden-gas-sponsorship task 6.2, UV=0 refusal evidence against the DEPLOYED OP Sepolia contracts.
///      Opt-in and not part of the hermetic default suite: without CRYOSHIELD_FORK_URL every test is skipped.
///      Run against a local anvil fork of OP Sepolia (see contracts/README.md, "UV=0 refusal on a fork"):
///        anvil --fork-url https://sepolia.optimism.io --port 8546
///        CRYOSHIELD_FORK_URL=http://127.0.0.1:8546 forge test --mc UvRefusalForkTest -vv
///      Nothing is deployed or etched: EntryPoint v0.6, the dev RP ID factory/implementation and VaultRegistryV2 are
///      the on-chain bytecode at the addresses in deployments/11155420.json and test/fixtures/chain-code.json. Only the
///      fork's local state changes (vm.deal for the counterfactual account's prefund); nothing is broadcast.
contract UvRefusalForkTest is WalletTestBase {
    using stdJson for string;

    string internal constant DEV_RP_ID = "cryoshield-web-dev.fly.dev";
    uint256 internal constant OP_SEPOLIA = 11155420;

    bool internal forked;
    bytes[] internal owners;

    function setUp() public override {
        string memory url = vm.envOr("CRYOSHIELD_FORK_URL", string(""));
        if (bytes(url).length == 0) return; // tests skip themselves
        vm.createSelectFork(url);
        forked = true;
        assertEq(block.chainid, OP_SEPOLIA, "fork must be OP Sepolia");

        string memory deployments = vm.readFile("deployments/11155420.json");
        // A key with dots needs bracket syntax (as in DeployV2.t.sol).
        string memory w = string.concat(".contracts.wallets['", DEV_RP_ID, "']");
        factory = CryoShieldSmartWalletFactory(deployments.readAddress(string.concat(w, ".factory")));
        impl = CryoShieldSmartWallet(payable(deployments.readAddress(string.concat(w, ".implementation"))));
        registry = VaultRegistryV2(deployments.readAddress(".contracts.vaultRegistryV2.address"));
        entryPoint = IEntryPoint(vm.readFile("test/fixtures/chain-code.json").readAddress(".entryPoint06.address"));

        // The deployed code is what we test: no etch, no new deployment.
        assertGt(address(factory).code.length, 0, "factory not deployed");
        assertGt(address(entryPoint).code.length, 0, "EntryPoint v0.6 not deployed");
        assertGt(address(registry).code.length, 0, "registry v2 not deployed");
        assertEq(factory.implementation(), address(impl), "factory implementation");
        rpIdHash = impl.RP_ID_HASH();
        assertEq(rpIdHash, sha256(bytes(DEV_RP_ID)), "dev RP ID hash");
        assertEq(rpIdHash, deployments.readBytes32(string.concat(w, ".rpIdHash")), "record rpIdHash");

        keyA = _key("uv-fork-owner-a");
        keyB = _key("uv-fork-owner-b");
        owners.push(_ownerBytes(keyA));
        owners.push(_ownerBytes(keyB));

        console.log("fork block", block.number);
        console.log("EntryPoint v0.6", address(entryPoint));
        console.log("factory (dev RP ID)", address(factory));
        console.log("implementation", address(impl));
        console.log("VaultRegistryV2", address(registry));
    }

    modifier onFork() {
        if (!forked) vm.skip(true, "set CRYOSHIELD_FORK_URL to an OP Sepolia fork (anvil --fork-url ...)");
        _;
    }

    /// @dev A fresh counterfactual account (not yet deployed) creating a 1 KB vault with 2 locators, as the app does.
    function _createOp() internal returns (UserOperation memory op, address account) {
        account = factory.getAddress(owners, 0);
        assertEq(account.code.length, 0, "account must be counterfactual");
        vm.deal(account, 1 ether); // self-paid prefund on the fork; Pimlico's paymaster signature is not available
        bytes memory blob = new bytes(1024);
        for (uint256 i; i < blob.length; ++i) {
            blob[i] = bytes1(uint8(i));
        }
        bytes memory call = _execute(
            address(registry), abi.encodeCall(VaultRegistryV2.createVault, (bytes32(0), blob, _locators2("uv-fork")))
        );
        op = _op(account, 0, _initCode(address(factory), owners), call);
        console.log("counterfactual account", account);
    }

    function _simulate(UserOperation memory op) internal returns (bool sigFailed, uint256 preOpGas) {
        try entryPoint.simulateValidation(op) {
            revert("simulateValidation must revert");
        } catch (bytes memory err) {
            bytes4 sel = bytes4(err);
            if (sel != IEntryPoint.ValidationResult.selector) {
                console.logBytes(err);
                revert("expected ValidationResult");
            }
            bytes memory args = new bytes(err.length - 4);
            for (uint256 i; i < args.length; ++i) {
                args[i] = err[i + 4];
            }
            // ValidationResult(ReturnInfo, StakeInfo, StakeInfo, StakeInfo): only the first field is needed.
            IEntryPoint.ReturnInfo memory info = abi.decode(args, (IEntryPoint.ReturnInfo));
            return (info.sigFailed, info.preOpGas);
        }
    }

    /// @dev Bundler-side check (eth_sendUserOperation runs simulateValidation): UV=0 reports sigFailed, UV=1 does not.
    function test_fork_simulateValidation_uv0_sigFailed_uv1_ok() public onFork {
        (UserOperation memory op,) = _createOp();

        (bool failed0, uint256 gas0) = _simulate(_signed(op, keyA, 0, FLAGS_UP));
        console.log("UV=0 (flags 0x01) simulateValidation sigFailed:", failed0, "preOpGas:", gas0);
        assertTrue(failed0, "UV=0 must fail signature validation");

        (bool failed1, uint256 gas1) = _simulate(_signed(op, keyA, 0, FLAGS_UP_UV));
        console.log("UV=1 (flags 0x05) simulateValidation sigFailed:", failed1, "preOpGas:", gas1);
        assertFalse(failed1, "UV=1 control must validate");
    }

    /// @dev On-chain check: handleOps refuses UV=0 with AA24 and nothing is created; the UV=1 control is included.
    function test_fork_handleOps_uv0_AA24_uv1_included() public onFork {
        (UserOperation memory op, address account) = _createOp();

        UserOperation memory bad = _signed(op, keyA, 0, FLAGS_UP);
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        _handle(bad);
        assertEq(account.code.length, 0, "UV=0: no account deployed");
        assertEq(registry.vaultOf(account), bytes32(0), "UV=0: no vault");
        console.log("UV=0 handleOps: reverted FailedOp(0, \"AA24 signature error\"); no account, no vault");

        _handle(_signed(op, keyA, 0, FLAGS_UP_UV));
        bytes32 vaultId = registry.vaultOf(account);
        assertGt(account.code.length, 0, "UV=1: account deployed");
        assertEq(vaultId, registry.vaultIdFor(account, bytes32(0)), "UV=1: vault registered");
        console.log("UV=1 handleOps: included; account deployed, vaultId:");
        console.logBytes32(vaultId);
    }
}
