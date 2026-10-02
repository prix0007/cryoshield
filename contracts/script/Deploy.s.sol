// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VaultRegistry} from "../src/VaultRegistry.sol";

/// @notice Deterministic deploy of VaultRegistry through the canonical CREATE2 deployer
///         (0x4e59b44847b379578588920cA78FbF26c0B4956C), so the address is identical on every chain
///         that has the deployer (anvil, OP Sepolia, OP Mainnet, Arbitrum Sepolia, Arbitrum One, Ethereum L1).
/// @dev No keys live here. The sender comes from the CLI: `--unlocked --sender` on anvil, or a Foundry keystore
///      (`--account "$DEPLOYER_ACCOUNT"`) on public networks. Raw private keys are refused for public networks.
///      Use `script/deploy.sh`, which also writes `deployments/<chainId>.json`.
contract Deploy is Script {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant SALT = keccak256("cryoshield.vault-registry.v1");

    error Create2DeployerMissing();
    error AddressMismatch(address predicted, address actual);

    function predictedAddress() public pure returns (address) {
        return vm.computeCreate2Address(SALT, keccak256(type(VaultRegistry).creationCode), CREATE2_DEPLOYER);
    }

    function run() external returns (VaultRegistry registry) {
        if (CREATE2_DEPLOYER.code.length == 0) revert Create2DeployerMissing();
        address predicted = predictedAddress();
        console.log("chainId", block.chainid);
        console.log("predicted", predicted);

        if (predicted.code.length > 0) {
            console.log("already deployed; nothing to do");
            return VaultRegistry(predicted);
        }

        vm.startBroadcast();
        registry = new VaultRegistry{salt: SALT}();
        vm.stopBroadcast();

        if (address(registry) != predicted) revert AddressMismatch(predicted, address(registry));
        console.log("deployed", address(registry));
    }
}
