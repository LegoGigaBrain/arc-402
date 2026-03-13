// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPolicyEngine {
    function validateSpend(
        address wallet,
        string calldata category,
        uint256 amount,
        bytes32 contextId
    ) external view returns (bool valid, string memory reason);

    function recordSpend(
        address wallet,
        string calldata category,
        uint256 amount,
        bytes32 contextId
    ) external;
}
