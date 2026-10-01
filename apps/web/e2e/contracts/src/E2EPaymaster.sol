// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// ERC-4337 v0.6 UserOperation layout.
struct UserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 verificationGasLimit;
    uint256 preVerificationGas;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    bytes paymasterAndData;
    bytes signature;
}

/// LOCAL E2E ONLY. Sponsors every user operation EntryPoint v0.6 hands it. The sponsorship *policy*
/// (allowlist, caps) is emulated by the dev bundler's pm_* methods, the way Pimlico enforces it off-chain.
contract E2EPaymaster {
    address public immutable entryPoint;

    constructor(address entryPoint_) {
        entryPoint = entryPoint_;
    }

    function validatePaymasterUserOp(UserOperation calldata, bytes32, uint256)
        external
        view
        returns (bytes memory context, uint256 validationData)
    {
        require(msg.sender == entryPoint, "only entry point");
        return ("", 0);
    }

    function postOp(uint8, bytes calldata, uint256) external view {
        require(msg.sender == entryPoint, "only entry point");
    }
}
