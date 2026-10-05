// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VaultRegistryV2} from "../src/VaultRegistryV2.sol";
import {CryoShieldSmartWallet} from "../src/CryoShieldSmartWallet.sol";
import {CryoShieldSmartWalletFactory} from "../src/CryoShieldSmartWalletFactory.sol";

/// @notice Deterministic deploy of VaultRegistryV2 and one CryoShieldSmartWalletFactory (+ the implementation its
///         constructor creates) per WebAuthn RP ID, through the canonical CREATE2 deployer
///         (0x4e59b44847b379578588920cA78FbF26c0B4956C). OpenSpec `harden-gas-sponsorship`, task 4.7.
/// @dev Addresses depend only on the bytecode and, for wallets, on sha256(rpId) (a constructor argument, so part of the
///      init code): the same RP ID gets the same pair on every chain. A CREATE2 address commits to the full init
///      code, so code already present at a predicted address is this exact build; it is skipped (idempotent).
///      RP IDs come from the RP_IDS environment variable (comma-separated). No keys live here: the sender comes from
///      the CLI (`--unlocked --sender` on anvil, a Foundry keystore `--account` on public networks).
///      VaultRegistry v1 is NOT deployed by this script (and never to OP Mainnet). Use `script/deploy.sh`, which also
///      writes `deployments/<chainId>.json`.
contract DeployV2 is Script {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant REGISTRY_SALT = keccak256("cryoshield.vault-registry.v2");
    bytes32 internal constant WALLET_SALT = keccak256("cryoshield.wallet-factory.v1");

    error Create2DeployerMissing();
    error NoRpIds();
    error InvalidRpId(string rpId);
    error AddressMismatch(address predicted, address actual);
    error WrongRpIdHash(address factory, bytes32 expected, bytes32 actual);

    // ---------------------------------------------------------------------
    // Predictions (pure; also used by script/deploy.sh via --sig)
    // ---------------------------------------------------------------------

    function rpIdHash(string memory rpId) public pure returns (bytes32) {
        return sha256(bytes(rpId));
    }

    function registryAddress() public pure returns (address) {
        return vm.computeCreate2Address(REGISTRY_SALT, keccak256(type(VaultRegistryV2).creationCode), CREATE2_DEPLOYER);
    }

    function factoryInitCode(string memory rpId) public pure returns (bytes memory) {
        return abi.encodePacked(type(CryoShieldSmartWalletFactory).creationCode, abi.encode(rpIdHash(rpId)));
    }

    function factoryAddress(string memory rpId) public pure returns (address) {
        return vm.computeCreate2Address(WALLET_SALT, keccak256(factoryInitCode(rpId)), CREATE2_DEPLOYER);
    }

    function implementationAddress(string memory rpId) public pure returns (address) {
        bytes memory init = abi.encodePacked(type(CryoShieldSmartWallet).creationCode, abi.encode(rpIdHash(rpId)));
        return vm.computeCreate2Address(bytes32(0), keccak256(init), factoryAddress(rpId));
    }

    /// @notice Prints one line per contract: `registry <address>` and `wallet <rpId> <factory> <implementation>
    ///         <rpIdHash>`. Read by script/deploy.sh (no RPC needed).
    function predict(string memory rpIdsCsv) external pure {
        console.log(string.concat("registry ", vm.toString(registryAddress())));
        string[] memory rpIds = vm.split(rpIdsCsv, ",");
        for (uint256 i; i < rpIds.length; ++i) {
            string memory id = rpIds[i];
            _checkRpId(id);
            console.log(
                string.concat(
                    "wallet ",
                    id,
                    " ",
                    vm.toString(factoryAddress(id)),
                    " ",
                    vm.toString(implementationAddress(id)),
                    " ",
                    vm.toString(rpIdHash(id))
                )
            );
        }
    }

    // ---------------------------------------------------------------------
    // Deploy
    // ---------------------------------------------------------------------

    function run() external {
        if (CREATE2_DEPLOYER.code.length == 0) revert Create2DeployerMissing();
        string[] memory rpIds = vm.envString("RP_IDS", ",");
        if (rpIds.length == 0) revert NoRpIds();
        for (uint256 i; i < rpIds.length; ++i) {
            _checkRpId(rpIds[i]);
        }
        console.log("chainId", block.chainid);

        address registry = registryAddress();
        if (registry.code.length > 0) {
            console.log("vaultRegistryV2 already deployed", registry);
        } else {
            vm.startBroadcast();
            VaultRegistryV2 deployed = new VaultRegistryV2{salt: REGISTRY_SALT}();
            vm.stopBroadcast();
            if (address(deployed) != registry) revert AddressMismatch(registry, address(deployed));
            console.log("vaultRegistryV2 deployed", registry);
        }

        for (uint256 i; i < rpIds.length; ++i) {
            _deployWallet(rpIds[i]);
        }
    }

    function _deployWallet(string memory rpId) internal {
        bytes32 h = rpIdHash(rpId);
        address factory = factoryAddress(rpId);
        address impl = implementationAddress(rpId);
        if (factory.code.length > 0) {
            console.log(string.concat("wallet ", rpId, " already deployed"), factory);
        } else {
            vm.startBroadcast();
            CryoShieldSmartWalletFactory deployed = new CryoShieldSmartWalletFactory{salt: WALLET_SALT}(h);
            vm.stopBroadcast();
            if (address(deployed) != factory) revert AddressMismatch(factory, address(deployed));
            console.log(string.concat("wallet ", rpId, " factory deployed"), factory);
        }
        // Sanity: the pair is bound to this RP ID.
        CryoShieldSmartWalletFactory f = CryoShieldSmartWalletFactory(factory);
        if (f.RP_ID_HASH() != h) revert WrongRpIdHash(factory, h, f.RP_ID_HASH());
        if (f.implementation() != impl) revert AddressMismatch(impl, f.implementation());
        if (CryoShieldSmartWallet(payable(impl)).RP_ID_HASH() != h) {
            revert WrongRpIdHash(impl, h, CryoShieldSmartWallet(payable(impl)).RP_ID_HASH());
        }
        console.log(string.concat("wallet ", rpId, " implementation"), impl);
    }

    /// @dev Same rule as the web app's VITE_RP_ID: a bare lowercase host name (letters, digits, '-', '.'), 1..64
    ///      characters, no scheme, port or path.
    function _checkRpId(string memory rpId) internal pure {
        bytes memory b = bytes(rpId);
        if (
            b.length == 0 || b.length > 64 || b[0] == "." || b[0] == "-" || b[b.length - 1] == "."
                || b[b.length - 1] == "-"
        ) {
            revert InvalidRpId(rpId);
        }
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-" || c == ".";
            if (!ok) revert InvalidRpId(rpId);
            if (c == "." && i > 0 && (b[i - 1] == "." || b[i - 1] == "-")) revert InvalidRpId(rpId);
        }
    }
}
