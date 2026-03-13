// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IWatchtowerRegistry
 * @notice Minimal interface for the ARC-402 watchtower liveness protection registry.
 * STATUS: DRAFT — not audited, do not use in production
 */
interface IWatchtowerRegistry {
    function channelWatchtower(bytes32 channelId) external view returns (address);
    function registeredStateHash(bytes32 channelId) external view returns (bytes32);
    function authorizeWatchtower(bytes32 channelId, address watchtower) external;
    function revokeWatchtower(bytes32 channelId) external;
    function registerState(bytes32 channelId, bytes32 stateHash) external;
    function submitChallenge(bytes32 channelId, bytes calldata latestState) external;
    function isWatched(bytes32 channelId) external view returns (bool);
    function getWatchedChannels(address watchtower) external view returns (bytes32[] memory);

    event WatchtowerAuthorized(bytes32 indexed channelId, address indexed watchtower, address indexed authorizer);
    event WatchtowerRevoked(bytes32 indexed channelId);
    event StateRegistered(bytes32 indexed channelId, bytes32 stateHash);
    event WatchtowerChallengeSubmitted(bytes32 indexed channelId, address indexed watchtower);
}
