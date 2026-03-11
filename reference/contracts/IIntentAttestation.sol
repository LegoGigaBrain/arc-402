// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IIntentAttestation {
    function attest(
        bytes32 attestationId,
        string calldata action,
        string calldata reason,
        address recipient,
        uint256 amount,
        address token,
        uint256 expiresAt
    ) external;

    function verify(
        bytes32 attestationId,
        address wallet,
        address recipient,
        uint256 amount,
        address token
    ) external view returns (bool);

    function consume(bytes32 attestationId) external;

    function isExpired(bytes32 attestationId) external view returns (bool);
}
