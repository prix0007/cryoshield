// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {WebAuthn} from "webauthn-sol/WebAuthn.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {UserOperation} from "account-abstraction/interfaces/UserOperation.sol";
import {CoinbaseSmartWallet} from "smart-wallet/CoinbaseSmartWallet.sol";
import {CoinbaseSmartWalletFactory} from "smart-wallet/CoinbaseSmartWalletFactory.sol";
import {CryoShieldSmartWallet} from "../src/CryoShieldSmartWallet.sol";
import {CryoShieldSmartWalletFactory} from "../src/CryoShieldSmartWalletFactory.sol";
import {VaultRegistryV2} from "../src/VaultRegistryV2.sol";

/// @dev Shared fixtures for the CryoShield wallet tests (harden-gas-sponsorship section 4).
///      The real EntryPoint v0.6 (+ SenderCreator) and Coinbase Smart Wallet v1.1 factory + implementation runtime
///      bytecode from OP Sepolia (test/fixtures/chain-code.json) are placed at their canonical addresses with vm.etch,
///      so user operations run through exactly the code production uses. WebAuthn assertions are generated
///      deterministically with vm.signP256 (the "WebAuthn fixtures" of the smart-account spec): only the property a
///      test changes (flags, rpIdHash, length) differs from the valid assertion, and each one is re-signed.
abstract contract WalletTestBase is Test {
    using stdJson for string;

    string internal constant RP_ID = "cryoshield.app";
    string internal constant ORIGIN = "https://cryoshield.app";
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    bytes1 internal constant FLAGS_UP_UV = 0x05;
    bytes1 internal constant FLAGS_UP = 0x01;
    bytes1 internal constant FLAGS_UV = 0x04;
    uint256 internal constant REPLAYABLE_NONCE_KEY = 8453;

    IEntryPoint internal entryPoint;
    address internal legacyFactoryAddr;
    address internal legacyImplAddr;

    CryoShieldSmartWalletFactory internal factory;
    CryoShieldSmartWallet internal impl;
    VaultRegistryV2 internal registry;
    bytes32 internal rpIdHash;

    address payable internal beneficiary = payable(makeAddr("beneficiary"));
    address internal deployer = makeAddr("deployer");

    struct Key {
        uint256 pk;
        bytes32 x;
        bytes32 y;
    }

    Key internal keyA;
    Key internal keyB;

    function setUp() public virtual {
        string memory json = vm.readFile("test/fixtures/chain-code.json");
        _etch(json, ".entryPoint06");
        _etch(json, ".senderCreator06");
        legacyFactoryAddr = _etch(json, ".cbswFactory11");
        legacyImplAddr = _etch(json, ".cbswImplementation11");
        entryPoint = IEntryPoint(json.readAddress(".entryPoint06.address"));

        rpIdHash = sha256(bytes(RP_ID));
        vm.prank(deployer);
        factory = new CryoShieldSmartWalletFactory(rpIdHash);
        impl = CryoShieldSmartWallet(payable(factory.implementation()));
        registry = new VaultRegistryV2();

        keyA = _key("owner-a");
        keyB = _key("owner-b");
    }

    // ---------------------------------------------------------------------
    // fixtures
    // ---------------------------------------------------------------------

    function _etch(string memory json, string memory key) internal returns (address a) {
        a = json.readAddress(string.concat(key, ".address"));
        bytes memory code = json.readBytes(string.concat(key, ".code"));
        assertEq(keccak256(code), json.readBytes32(string.concat(key, ".codeHash")), key);
        vm.etch(a, code);
    }

    function _key(string memory label) internal pure returns (Key memory k) {
        k.pk = (uint256(keccak256(bytes(label))) % (P256_N - 1)) + 1;
        (uint256 x, uint256 y) = vm.publicKeyP256(k.pk);
        k.x = bytes32(x);
        k.y = bytes32(y);
    }

    function _ownerBytes(Key memory k) internal pure returns (bytes memory) {
        return abi.encode(k.x, k.y);
    }

    function _owners2() internal view returns (bytes[] memory o) {
        o = new bytes[](2);
        o[0] = _ownerBytes(keyA);
        o[1] = _ownerBytes(keyB);
    }

    function _ownersN(uint256 n) internal pure returns (bytes[] memory o) {
        o = new bytes[](n);
        for (uint256 i; i < n; ++i) {
            o[i] = _ownerBytes(_key(string.concat("owner-", vm.toString(i))));
        }
    }

    // ---------------------------------------------------------------------
    // WebAuthn assertions
    // ---------------------------------------------------------------------

    function _clientDataJSON(bytes32 challengeHash) internal pure returns (string memory) {
        return string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encode(challengeHash)),
            '","origin":"',
            ORIGIN,
            '","crossOrigin":false}'
        );
    }

    /// @dev A WebAuthn assertion over `challengeHash` with the given flags and rpIdHash, signed by `k` (low-s).
    function _assertion(Key memory k, bytes32 challengeHash, bytes1 flags, bytes32 rpHash)
        internal
        pure
        returns (WebAuthn.WebAuthnAuth memory auth)
    {
        auth.authenticatorData = abi.encodePacked(rpHash, flags, uint32(1));
        auth.clientDataJSON = _clientDataJSON(challengeHash);
        auth.typeIndex = 1;
        auth.challengeIndex = 23;
        bytes32 digest = sha256(abi.encodePacked(auth.authenticatorData, sha256(bytes(auth.clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(k.pk, digest);
        uint256 sv = uint256(s);
        if (sv > P256_N / 2) sv = P256_N - sv;
        auth.r = uint256(r);
        auth.s = sv;
    }

    /// @dev Same as `_assertion`, but with arbitrary authenticatorData bytes (for the short-authData case).
    function _assertionRaw(Key memory k, bytes32 challengeHash, bytes memory authData)
        internal
        pure
        returns (WebAuthn.WebAuthnAuth memory auth)
    {
        auth.authenticatorData = authData;
        auth.clientDataJSON = _clientDataJSON(challengeHash);
        auth.typeIndex = 1;
        auth.challengeIndex = 23;
        bytes32 digest = sha256(abi.encodePacked(authData, sha256(bytes(auth.clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(k.pk, digest);
        uint256 sv = uint256(s);
        if (sv > P256_N / 2) sv = P256_N - sv;
        auth.r = uint256(r);
        auth.s = sv;
    }

    function _wrap(uint256 ownerIndex, WebAuthn.WebAuthnAuth memory auth) internal pure returns (bytes memory) {
        return abi.encode(CoinbaseSmartWallet.SignatureWrapper(ownerIndex, abi.encode(auth)));
    }

    function _sign(Key memory k, uint256 ownerIndex, bytes32 hash, bytes1 flags) internal view returns (bytes memory) {
        return _wrap(ownerIndex, _assertion(k, hash, flags, rpIdHash));
    }

    // ---------------------------------------------------------------------
    // user operations
    // ---------------------------------------------------------------------

    function _initCode(address factory_, bytes[] memory owners) internal pure returns (bytes memory) {
        return abi.encodePacked(factory_, abi.encodeCall(CoinbaseSmartWalletFactory.createAccount, (owners, 0)));
    }

    function _op(address sender, uint256 nonce, bytes memory initCode, bytes memory callData)
        internal
        pure
        returns (UserOperation memory op)
    {
        op.sender = sender;
        op.nonce = nonce;
        op.initCode = initCode;
        op.callData = callData;
        op.callGasLimit = 2_000_000;
        op.verificationGasLimit = 3_000_000;
        op.preVerificationGas = 100_000;
        op.maxFeePerGas = 1 gwei;
        op.maxPriorityFeePerGas = 1 gwei;
    }

    function _execute(address target, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodeCall(CoinbaseSmartWallet.execute, (target, 0, data));
    }

    function _handle(UserOperation memory op) internal {
        UserOperation[] memory ops = new UserOperation[](1);
        ops[0] = op;
        entryPoint.handleOps(ops, beneficiary);
    }

    /// @dev Signs `op` (chain-bound hash) with key `k` at `ownerIndex` and returns it.
    function _signed(UserOperation memory op, Key memory k, uint256 ownerIndex, bytes1 flags)
        internal
        view
        returns (UserOperation memory)
    {
        op.signature = _sign(k, ownerIndex, entryPoint.getUserOpHash(op), flags);
        return op;
    }

    /// @dev A deployed CryoShield account with the two default owners.
    function _deployAccount() internal returns (CryoShieldSmartWallet account) {
        account = CryoShieldSmartWallet(payable(address(factory.createAccount(_owners2(), 0))));
        vm.deal(address(account), 1 ether);
    }

    function _locators2(string memory seed) internal pure returns (bytes32[] memory l) {
        l = new bytes32[](2);
        l[0] = keccak256(abi.encode(seed, 0));
        l[1] = keccak256(abi.encode(seed, 1));
    }
}
