// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {DeployV2} from "../script/DeployV2.s.sol";

/// @dev Guards for script/DeployV2.s.sol (harden-gas-sponsorship 4.7, security review C8).
///      The predicted CREATE2 addresses are pinned to the LIVE OP Sepolia record: any change to contracts/src, the
///      compiler settings or the remappings moves them and fails here, before anything can be redeployed elsewhere.
contract DeployV2Test is Test {
    using stdJson for string;

    DeployV2 internal d;

    function setUp() public {
        d = new DeployV2();
    }

    function test_predictionsMatchLiveOpSepoliaRecord() public view {
        string memory rec = vm.readFile("deployments/11155420.json");
        assertEq(d.registryAddress(), rec.readAddress(".contracts.vaultRegistryV2.address"), "VaultRegistryV2");
        string[2] memory ids = ["cryoshield.app", "cryoshield-web-dev.fly.dev"];
        for (uint256 i; i < ids.length; ++i) {
            string memory p = string.concat(".contracts.wallets['", ids[i], "']");
            assertEq(d.factoryAddress(ids[i]), rec.readAddress(string.concat(p, ".factory")), ids[i]);
            assertEq(d.implementationAddress(ids[i]), rec.readAddress(string.concat(p, ".implementation")), ids[i]);
            assertEq(d.rpIdHash(ids[i]), rec.readBytes32(string.concat(p, ".rpIdHash")), ids[i]);
            assertEq(d.rpIdHash(ids[i]), sha256(bytes(ids[i])), ids[i]);
        }
    }

    function test_predictionsMatchAnvilRecord() public view {
        string memory rec = vm.readFile("deployments/31337.json");
        assertEq(d.registryAddress(), rec.readAddress(".contracts.vaultRegistryV2.address"));
        assertEq(d.factoryAddress("localhost"), rec.readAddress(".contracts.wallets.localhost.factory"));
        assertEq(d.implementationAddress("localhost"), rec.readAddress(".contracts.wallets.localhost.implementation"));
    }

    function test_validRpIds() public view {
        d.predict("cryoshield.app,cryoshield-web-dev.fly.dev,localhost,a,a1-b.c2");
    }

    function test_invalidRpIds_revert() public {
        string[12] memory bad = [
            "",
            "a.-b",
            "a-.b",
            "-a",
            "a-",
            ".a",
            "a.",
            "a..b",
            "A.b",
            "a_b",
            "https://cryoshield.app",
            "cryoshield.app:443"
        ];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(DeployV2.InvalidRpId.selector, bad[i]));
            d.predict(bad[i]);
        }
    }

    function test_rpIdTooLong_reverts() public {
        string memory long = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 65 chars
        vm.expectRevert(abi.encodeWithSelector(DeployV2.InvalidRpId.selector, long));
        d.predict(long);
    }
}
