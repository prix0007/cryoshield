// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {WebAuthn} from "webauthn-sol/WebAuthn.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {UserOperation} from "account-abstraction/interfaces/UserOperation.sol";
import {UUPSUpgradeable} from "solady/utils/UUPSUpgradeable.sol";
import {CoinbaseSmartWallet} from "smart-wallet/CoinbaseSmartWallet.sol";
import {CoinbaseSmartWalletFactory} from "smart-wallet/CoinbaseSmartWalletFactory.sol";
import {MultiOwnable} from "smart-wallet/MultiOwnable.sol";
import {CryoShieldSmartWallet} from "../src/CryoShieldSmartWallet.sol";
import {CryoShieldSmartWalletFactory} from "../src/CryoShieldSmartWalletFactory.sol";
import {VaultRegistryV2} from "../src/VaultRegistryV2.sol";
import {WalletTestBase} from "./WalletBase.t.sol";

/// @dev harden-gas-sponsorship 4.3/4.5: one test (or more) per `smart-account` scenario.
contract CryoShieldSmartWalletTest is WalletTestBase {
    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;
    bytes4 internal constant ERC1271_FAIL = 0xffffffff;
    bytes32 internal constant MULTI_OWNABLE_SLOT = 0x97e2c6aad4ce5d562ebfaa00db6b9e0fb66ea5d8162ed5b243f51a2e03086f00;

    // ---------------------------------------------------------------------
    // Deployment shape
    // ---------------------------------------------------------------------

    function test_factory_deploysImplementationWithRpIdHash() public view {
        assertEq(impl.RP_ID_HASH(), sha256(bytes("cryoshield.app")));
        assertEq(impl.MAX_OWNERS(), 8);
        assertEq(factory.RP_ID_HASH(), rpIdHash);
        assertGt(address(impl).code.length, 0);
        // The implementation itself is locked, as in CBSW (address(0) owner set by the base constructor).
        assertEq(impl.nextOwnerIndex(), 1);
    }

    function test_factory_zeroRpIdHash_reverts() public {
        vm.expectRevert(CryoShieldSmartWallet.ZeroRpIdHash.selector);
        new CryoShieldSmartWalletFactory(bytes32(0));
    }

    function test_differentRpIds_differentAddresses() public {
        CryoShieldSmartWalletFactory dev = new CryoShieldSmartWalletFactory(sha256("cryoshield-web-dev.fly.dev"));
        assertTrue(dev.implementation() != factory.implementation());
        assertTrue(dev.getAddress(_owners2(), 0) != factory.getAddress(_owners2(), 0));
    }

    function test_counterfactualAddressMatches() public {
        address predicted = factory.getAddress(_owners2(), 0);
        CryoShieldSmartWallet account = _deployAccount();
        assertEq(address(account), predicted);
        assertEq(account.implementation(), address(impl));
        assertEq(account.entryPoint(), address(entryPoint));
        assertTrue(account.isOwnerPublicKey(keyA.x, keyA.y));
        assertTrue(account.isOwnerPublicKey(keyB.x, keyB.y));
    }

    // ---------------------------------------------------------------------
    // User verification and RP binding on every signature (validateUserOp)
    // ---------------------------------------------------------------------

    function _validate(CryoShieldSmartWallet account, UserOperation memory op, bytes32 hash)
        internal
        returns (uint256)
    {
        vm.prank(address(entryPoint));
        return account.validateUserOp(op, hash, 0);
    }

    function _opFor(CryoShieldSmartWallet account) internal view returns (UserOperation memory op, bytes32 hash) {
        op = _op(address(account), 0, "", _execute(address(registry), hex""));
        hash = entryPoint.getUserOpHash(op);
    }

    function test_validTapWithPin_validates() public {
        CryoShieldSmartWallet account = _deployAccount();
        (UserOperation memory op, bytes32 hash) = _opFor(account);
        op.signature = _sign(keyA, 0, hash, FLAGS_UP_UV);
        assertEq(_validate(account, op, hash), 0);
        op.signature = _sign(keyB, 1, hash, FLAGS_UP_UV);
        assertEq(_validate(account, op, hash), 0);
    }

    function test_stolenKeyWithoutPin_uv0_refused() public {
        CryoShieldSmartWallet account = _deployAccount();
        (UserOperation memory op, bytes32 hash) = _opFor(account);
        op.signature = _sign(keyA, 0, hash, FLAGS_UP);
        assertEq(_validate(account, op, hash), 1);
    }

    function test_up0_refused() public {
        CryoShieldSmartWallet account = _deployAccount();
        (UserOperation memory op, bytes32 hash) = _opFor(account);
        op.signature = _sign(keyA, 0, hash, FLAGS_UV);
        assertEq(_validate(account, op, hash), 1);
    }

    function test_foreignRpIdHash_refused() public {
        CryoShieldSmartWallet account = _deployAccount();
        (UserOperation memory op, bytes32 hash) = _opFor(account);
        op.signature = _wrap(0, _assertion(keyA, hash, FLAGS_UP_UV, sha256("evil.example")));
        assertEq(_validate(account, op, hash), 1);
    }

    function test_shortAuthenticatorData_refused() public {
        CryoShieldSmartWallet account = _deployAccount();
        (UserOperation memory op, bytes32 hash) = _opFor(account);
        // 36 bytes: rpIdHash + flags + 3 of the 4 counter bytes.
        bytes memory ad = abi.encodePacked(rpIdHash, FLAGS_UP_UV, bytes3(0));
        op.signature = _wrap(0, _assertionRaw(keyA, hash, ad));
        assertEq(_validate(account, op, hash), 1);
    }

    function test_malformedSignatureData_neverValidates() public {
        CryoShieldSmartWallet account = _deployAccount();
        (UserOperation memory op, bytes32 hash) = _opFor(account);
        op.signature = abi.encode(CoinbaseSmartWallet.SignatureWrapper(0, hex"deadbeef"));
        vm.prank(address(entryPoint));
        vm.expectRevert();
        account.validateUserOp(op, hash, 0);
    }

    function test_wrongSigner_refused() public {
        CryoShieldSmartWallet account = _deployAccount();
        (UserOperation memory op, bytes32 hash) = _opFor(account);
        op.signature = _sign(keyB, 0, hash, FLAGS_UP_UV); // keyB signs as owner 0 (keyA)
        assertEq(_validate(account, op, hash), 1);
    }

    function test_removedOwnerIndex_refused() public {
        CryoShieldSmartWallet account = _deployAccount();
        vm.prank(address(account));
        account.removeOwnerAtIndex(1, _ownerBytes(keyB));
        (UserOperation memory op, bytes32 hash) = _opFor(account);
        op.signature = _sign(keyB, 1, hash, FLAGS_UP_UV);
        assertEq(_validate(account, op, hash), 1);
    }

    // ---------------------------------------------------------------------
    // ERC-1271
    // ---------------------------------------------------------------------

    function test_erc1271_requiresUvAndRpId() public {
        CryoShieldSmartWallet account = _deployAccount();
        bytes32 h = keccak256("message");
        bytes32 safe = account.replaySafeHash(h);
        assertEq(account.isValidSignature(h, _sign(keyA, 0, safe, FLAGS_UP_UV)), ERC1271_MAGIC);
        assertEq(account.isValidSignature(h, _sign(keyA, 0, safe, FLAGS_UP)), ERC1271_FAIL);
        assertEq(
            account.isValidSignature(h, _wrap(0, _assertion(keyA, safe, FLAGS_UP_UV, sha256("other.app")))),
            ERC1271_FAIL
        );
    }

    // ---------------------------------------------------------------------
    // Through the real EntryPoint v0.6
    // ---------------------------------------------------------------------

    function _createVaultCall(string memory seed) internal view returns (bytes memory) {
        return _execute(
            address(registry), abi.encodeCall(VaultRegistryV2.createVault, (bytes32(0), hex"c0ffee", _locators2(seed)))
        );
    }

    function test_entryPoint_createAccountAndVault_uvSigned() public {
        address account = factory.getAddress(_owners2(), 0);
        vm.deal(account, 1 ether);
        UserOperation memory op = _op(account, 0, _initCode(address(factory), _owners2()), _createVaultCall("e2e"));
        _handle(_signed(op, keyA, 0, FLAGS_UP_UV));

        assertGt(account.code.length, 0);
        bytes32 vaultId = registry.vaultOf(account);
        assertEq(vaultId, keccak256(abi.encode(account, bytes32(0))));
        (address owner, bytes memory blob,) = registry.getVault(vaultId);
        assertEq(owner, account);
        assertEq(blob, hex"c0ffee");
    }

    function test_entryPoint_uv0_refusedAA24() public {
        address account = factory.getAddress(_owners2(), 0);
        vm.deal(account, 1 ether);
        UserOperation memory op = _op(account, 0, _initCode(address(factory), _owners2()), _createVaultCall("e2e"));
        op = _signed(op, keyA, 0, FLAGS_UP);
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        _handle(op);
        assertEq(registry.vaultOf(account), bytes32(0));
    }

    function test_entryPoint_replayablePath_uv0_refused() public {
        CryoShieldSmartWallet account = _deployAccount();
        bytes[] memory calls = new bytes[](1);
        Key memory kC = _key("owner-c");
        calls[0] = abi.encodeCall(MultiOwnable.addOwnerPublicKey, (kC.x, kC.y));
        UserOperation memory op = _op(
            address(account),
            entryPoint.getNonce(address(account), uint192(REPLAYABLE_NONCE_KEY)),
            "",
            abi.encodeCall(CoinbaseSmartWallet.executeWithoutChainIdValidation, (calls))
        );
        bytes32 hash = account.getUserOpHashWithoutChainId(op);

        op.signature = _sign(keyA, 0, hash, FLAGS_UP);
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        _handle(op);
        assertFalse(account.isOwnerPublicKey(kC.x, kC.y));

        // The same operation with UV=1 is accepted (the replayable path itself still works).
        op.signature = _sign(keyA, 0, hash, FLAGS_UP_UV);
        _handle(op);
        assertTrue(account.isOwnerPublicKey(kC.x, kC.y));
    }

    function test_entryPoint_addKeyFlow() public {
        // Add-key as the app does it: executeBatch[addOwnerPublicKey, addLocators, updateVault], UV-signed.
        address account = factory.getAddress(_owners2(), 0);
        vm.deal(account, 1 ether);
        _handle(
            _signed(
                _op(account, 0, _initCode(address(factory), _owners2()), _createVaultCall("k")), keyA, 0, FLAGS_UP_UV
            )
        );
        bytes32 vaultId = registry.vaultOf(account);

        Key memory kC = _key("owner-c");
        CoinbaseSmartWallet.Call[] memory calls = new CoinbaseSmartWallet.Call[](3);
        calls[0] = CoinbaseSmartWallet.Call(account, 0, abi.encodeCall(MultiOwnable.addOwnerPublicKey, (kC.x, kC.y)));
        bytes32[] memory loc = new bytes32[](1);
        loc[0] = keccak256("new-locator");
        calls[1] =
            CoinbaseSmartWallet.Call(address(registry), 0, abi.encodeCall(VaultRegistryV2.addLocators, (vaultId, loc)));
        calls[2] = CoinbaseSmartWallet.Call(
            address(registry), 0, abi.encodeCall(VaultRegistryV2.updateVault, (vaultId, hex"0102"))
        );
        UserOperation memory op =
            _op(account, entryPoint.getNonce(account, 0), "", abi.encodeCall(CoinbaseSmartWallet.executeBatch, (calls)));
        _handle(_signed(op, keyB, 1, FLAGS_UP_UV));

        assertTrue(CryoShieldSmartWallet(payable(account)).isOwnerPublicKey(kC.x, kC.y));
        (, bytes memory blob, uint32 version) = registry.getVault(vaultId);
        assertEq(blob, hex"0102");
        assertEq(version, 2);

        // The new key signs the next operation (UV=1) at its index (2).
        op = _op(
            account,
            entryPoint.getNonce(account, 0),
            "",
            _execute(address(registry), abi.encodeCall(VaultRegistryV2.updateVault, (vaultId, hex"03")))
        );
        _handle(_signed(op, kC, 2, FLAGS_UP_UV));
        (, blob,) = registry.getVault(vaultId);
        assertEq(blob, hex"03");
    }

    // ---------------------------------------------------------------------
    // P-256 owners only, at most eight
    // ---------------------------------------------------------------------

    function test_initialize_addressOwnerRefused() public {
        bytes[] memory owners = new bytes[](2);
        owners[0] = _ownerBytes(keyA);
        owners[1] = abi.encode(makeAddr("eoa"));
        vm.expectRevert(abi.encodeWithSelector(CryoShieldSmartWallet.NotPublicKeyOwner.selector, owners[1]));
        factory.createAccount(owners, 0);
    }

    function test_initialize_wrongLengthOwnerRefused() public {
        bytes[] memory owners = new bytes[](1);
        owners[0] = new bytes(65);
        vm.expectRevert(abi.encodeWithSelector(CryoShieldSmartWallet.NotPublicKeyOwner.selector, owners[0]));
        factory.createAccount(owners, 0);
    }

    function test_initialize_zeroOwnersRefused() public {
        vm.expectRevert(CoinbaseSmartWalletFactory.OwnerRequired.selector);
        factory.createAccount(new bytes[](0), 0);
    }

    function test_initialize_nineOwnersRefused_eightOk() public {
        vm.expectRevert(abi.encodeWithSelector(CryoShieldSmartWallet.InvalidOwnerCount.selector, 9));
        factory.createAccount(_ownersN(9), 0);
        CryoShieldSmartWallet account = CryoShieldSmartWallet(payable(address(factory.createAccount(_ownersN(8), 0))));
        assertEq(account.ownerCount(), 8);
    }

    function test_initialize_onlyOnce() public {
        CryoShieldSmartWallet account = _deployAccount();
        vm.expectRevert(CoinbaseSmartWallet.Initialized.selector);
        account.initialize(_owners2());
    }

    function test_implementation_cannotBeInitialized() public {
        vm.expectRevert(CoinbaseSmartWallet.Initialized.selector);
        impl.initialize(_owners2());
    }

    function test_addOwnerAddress_alwaysReverts() public {
        CryoShieldSmartWallet account = _deployAccount();
        vm.prank(address(account));
        vm.expectRevert(CryoShieldSmartWallet.AddressOwnersDisabled.selector);
        account.addOwnerAddress(makeAddr("eoa"));
        vm.prank(address(entryPoint));
        vm.expectRevert(CryoShieldSmartWallet.AddressOwnersDisabled.selector);
        account.addOwnerAddress(makeAddr("eoa"));
    }

    function test_addOwnerPublicKey_ninthRefused() public {
        CryoShieldSmartWallet account = CryoShieldSmartWallet(payable(address(factory.createAccount(_ownersN(7), 0))));
        Key memory k8 = _key("eighth");
        Key memory k9 = _key("ninth");
        vm.startPrank(address(account));
        account.addOwnerPublicKey(k8.x, k8.y);
        assertEq(account.ownerCount(), 8);
        vm.expectRevert(CryoShieldSmartWallet.TooManyOwners.selector);
        account.addOwnerPublicKey(k9.x, k9.y);
        vm.stopPrank();
        assertFalse(account.isOwnerPublicKey(k9.x, k9.y));
        assertEq(account.ownerCount(), 8);
    }

    function test_addOwnerPublicKey_afterRemovalAllowedAgain() public {
        CryoShieldSmartWallet account = CryoShieldSmartWallet(payable(address(factory.createAccount(_ownersN(8), 0))));
        Key memory k9 = _key("ninth");
        vm.startPrank(address(account));
        account.removeOwnerAtIndex(0, _ownersN(8)[0]);
        account.addOwnerPublicKey(k9.x, k9.y);
        vm.stopPrank();
        assertEq(account.ownerCount(), 8);
    }

    function test_addOwnerPublicKey_onlyOwner() public {
        CryoShieldSmartWallet account = _deployAccount();
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(MultiOwnable.Unauthorized.selector);
        account.addOwnerPublicKey(bytes32(uint256(1)), bytes32(uint256(2)));
    }

    // ---------------------------------------------------------------------
    // Immutable, admin-free; storage layout
    // ---------------------------------------------------------------------

    function test_deployerHasNoPowerOverAccounts() public {
        CryoShieldSmartWallet account = _deployAccount();
        vm.startPrank(deployer);
        vm.expectRevert(MultiOwnable.Unauthorized.selector);
        account.execute(address(registry), 0, "");
        vm.expectRevert(MultiOwnable.Unauthorized.selector);
        account.addOwnerPublicKey(bytes32(uint256(1)), bytes32(uint256(2)));
        vm.expectRevert(MultiOwnable.Unauthorized.selector);
        account.upgradeToAndCall(address(impl), "");
        vm.stopPrank();
    }

    function test_multiOwnableSlotConstantMatchesCbsw() public {
        // The ERC-7201 slot is a private constant (not shown by `forge inspect`): pin it against the vendored
        // CBSW v1.1 source and against live storage of both a new and a legacy account.
        string memory src = vm.readFile("lib/cbsw-v1.1.0/src/MultiOwnable.sol");
        assertTrue(vm.contains(src, vm.toString(MULTI_OWNABLE_SLOT)), "slot constant in CBSW source");

        CryoShieldSmartWallet account = _deployAccount();
        assertEq(uint256(vm.load(address(account), MULTI_OWNABLE_SLOT)), account.nextOwnerIndex());
        assertEq(uint256(vm.load(address(account), MULTI_OWNABLE_SLOT)), 2);

        address legacy = address(CoinbaseSmartWalletFactory(legacyFactoryAddr).createAccount(_owners2(), 7));
        assertEq(uint256(vm.load(legacy, MULTI_OWNABLE_SLOT)), 2);
    }

    // ---------------------------------------------------------------------
    // Legacy account upgrade path
    // ---------------------------------------------------------------------

    function test_legacyUpgrade_keepsAddressOwnersVault_thenEnforcesUv() public {
        Vm.Wallet memory eoa = vm.createWallet("legacy-eoa-owner");
        bytes[] memory owners = new bytes[](3);
        owners[0] = _ownerBytes(keyA);
        owners[1] = _ownerBytes(keyB);
        owners[2] = abi.encode(eoa.addr);
        address account = address(CoinbaseSmartWalletFactory(legacyFactoryAddr).createAccount(owners, 0));
        vm.deal(account, 1 ether);
        assertEq(CoinbaseSmartWallet(payable(account)).implementation(), legacyImplAddr);

        // Before the upgrade the legacy account accepts a UV=0 signature (audit AA-H1).
        _handle(_signed(_op(account, 0, "", _createVaultCall("legacy")), keyA, 0, FLAGS_UP));
        bytes32 vaultId = registry.vaultOf(account);
        assertTrue(vaultId != bytes32(0), "legacy accepted UV=0 before the upgrade");

        // One UV-signed upgrade operation.
        UserOperation memory up = _op(
            account,
            entryPoint.getNonce(account, 0),
            "",
            _execute(account, abi.encodeCall(UUPSUpgradeable.upgradeToAndCall, (address(impl), "")))
        );
        _handle(_signed(up, keyA, 0, FLAGS_UP_UV));

        CryoShieldSmartWallet upgraded = CryoShieldSmartWallet(payable(account));
        assertEq(upgraded.implementation(), address(impl));
        assertEq(upgraded.RP_ID_HASH(), rpIdHash);
        assertEq(upgraded.ownerCount(), 3);
        assertTrue(upgraded.isOwnerPublicKey(keyA.x, keyA.y));
        assertTrue(upgraded.isOwnerAddress(eoa.addr));
        assertEq(registry.vaultOf(account), vaultId);

        bytes memory upd = _execute(address(registry), abi.encodeCall(VaultRegistryV2.updateVault, (vaultId, hex"02")));

        // A later UV=0 signature is refused.
        UserOperation memory op = _signed(_op(account, entryPoint.getNonce(account, 0), "", upd), keyA, 0, FLAGS_UP);
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        _handle(op);

        // The legacy address owner can no longer sign.
        op = _op(account, entryPoint.getNonce(account, 0), "", upd);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoa, entryPoint.getUserOpHash(op));
        op.signature = abi.encode(CoinbaseSmartWallet.SignatureWrapper(2, abi.encodePacked(r, s, v)));
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        _handle(op);

        // UV=1 still works.
        _handle(_signed(_op(account, entryPoint.getNonce(account, 0), "", upd), keyB, 1, FLAGS_UP_UV));
        (, bytes memory blob, uint32 version) = registry.getVault(vaultId);
        assertEq(blob, hex"02");
        assertEq(version, 2);
    }

    function test_legacyEoaOwner_validBeforeUpgrade() public {
        // Control for the test above: the same ECDSA signature IS valid on CBSW v1.1 (so the refusal is ours).
        Vm.Wallet memory eoa = vm.createWallet("legacy-eoa-owner");
        bytes[] memory owners = new bytes[](2);
        owners[0] = _ownerBytes(keyA);
        owners[1] = abi.encode(eoa.addr);
        address account = address(CoinbaseSmartWalletFactory(legacyFactoryAddr).createAccount(owners, 0));
        vm.deal(account, 1 ether);
        UserOperation memory op = _op(account, 0, "", _createVaultCall("ctl"));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eoa, entryPoint.getUserOpHash(op));
        op.signature = abi.encode(CoinbaseSmartWallet.SignatureWrapper(1, abi.encodePacked(r, s, v)));
        _handle(op);
        assertTrue(registry.vaultOf(account) != bytes32(0));
    }

    // ---------------------------------------------------------------------
    // Gas: validation cost, CBSW v1.1 vs CryoShield (task 4.6)
    // ---------------------------------------------------------------------

    function test_gas_validateUserOp_cryoshield_vs_cbsw() public {
        CryoShieldSmartWallet account = _deployAccount();
        (UserOperation memory op, bytes32 hash) = _opFor(account);
        op.signature = _sign(keyA, 0, hash, FLAGS_UP_UV);
        vm.prank(address(entryPoint));
        account.validateUserOp(op, hash, 0);
        vm.snapshotGasLastCall("CryoShieldSmartWallet", "validateUserOp_cryoshield_fclFallback");

        CoinbaseSmartWallet legacy = CoinbaseSmartWalletFactory(legacyFactoryAddr).createAccount(_owners2(), 0);
        op.sender = address(legacy);
        hash = entryPoint.getUserOpHash(op);
        op.signature = _sign(keyA, 0, hash, FLAGS_UP_UV);
        vm.prank(address(entryPoint));
        legacy.validateUserOp(op, hash, 0);
        vm.snapshotGasLastCall("CryoShieldSmartWallet", "validateUserOp_cbsw11_fclFallback");
    }
}
