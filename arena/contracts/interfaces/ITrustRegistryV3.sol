// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITrustRegistryV3 {
    function getGlobalScore(address agent) external view returns (uint256);
}
