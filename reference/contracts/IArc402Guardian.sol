// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IArc402Guardian
 * @notice Minimal interface for the ARC-402 circuit breaker / emergency pause contract.
 * STATUS: DRAFT — not audited, do not use in production
 */
interface IArc402Guardian {
    function isPaused() external view returns (bool);
    function pause(string calldata reason) external;
    function unpause() external;
}
