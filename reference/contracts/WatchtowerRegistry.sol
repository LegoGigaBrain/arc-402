// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IWatchtowerRegistry.sol";

/**
 * @title WatchtowerRegistry
 * @notice Liveness protection for ARC-402 session channels.
 *         Allows channel participants to authorise a watchtower to challenge on their behalf
 *         if they go offline during the challenge window.
 *
 * Security model:
 *   - Watchtowers never hold agent keys. They hold pre-signed states and a narrow,
 *     revocable authorisation to submit them.
 *   - The worst a malicious watchtower can do is fail to challenge. It cannot steal
 *     funds or forge state.
 *   - Each channel authorisation is independent and per-channel revocable.
 *
 * STATUS: DRAFT — not audited, do not use in production
 */

/// @dev Minimal interface for querying channel client from ServiceAgreement.
///      Matches the ABI of ServiceAgreement's auto-generated `channels(bytes32)` getter.
interface IServiceAgreementForWatchtower {
    function channels(bytes32 channelId) external view returns (
        address client,
        address provider,
        address token,
        uint256 depositAmount,
        uint256 settledAmount,
        uint256 lastSequenceNumber,
        uint256 deadline,
        uint256 challengeExpiry,
        uint8 status
    );
    function challengeChannel(bytes32 channelId, bytes calldata latestStateBytes) external;
}

contract WatchtowerRegistry is IWatchtowerRegistry {

    // ─── Storage ─────────────────────────────────────────────────────────────

    /// @notice channelId => authorized watchtower address (one per channel)
    mapping(bytes32 => address) public channelWatchtower;

    /// @notice channelId => latest pre-signed state hash registered by owner
    mapping(bytes32 => bytes32) public registeredStateHash;

    /// @notice watchtower => channelIds it monitors
    mapping(address => bytes32[]) public watchedChannels;

    IServiceAgreementForWatchtower public immutable serviceAgreement;

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _serviceAgreement) {
        require(_serviceAgreement != address(0), "WatchtowerRegistry: zero service agreement");
        serviceAgreement = IServiceAgreementForWatchtower(_serviceAgreement);
    }

    // ─── Authorisation ───────────────────────────────────────────────────────

    /// @notice Authorise a watchtower to challenge on your behalf for a specific channel.
    /// @dev Only callable by the channel client (the one who opened it).
    function authorizeWatchtower(bytes32 channelId, address watchtower) external {
        require(watchtower != address(0), "WatchtowerRegistry: zero watchtower");
        _requireChannelClient(channelId);
        channelWatchtower[channelId] = watchtower;
        watchedChannels[watchtower].push(channelId);
        emit WatchtowerAuthorized(channelId, watchtower, msg.sender);
    }

    /// @notice Revoke watchtower authorisation for a channel.
    /// @dev Only callable by the channel client.
    function revokeWatchtower(bytes32 channelId) external {
        _requireChannelClient(channelId);
        delete channelWatchtower[channelId];
        emit WatchtowerRevoked(channelId);
    }

    // ─── State Registration ──────────────────────────────────────────────────

    /// @notice Client pre-registers latest doubly-signed state with the registry.
    /// @dev Only callable by the channel client. State is stored as a hash for gas efficiency.
    ///      The actual state bytes are held off-chain by the watchtower.
    function registerState(bytes32 channelId, bytes32 stateHash) external {
        _requireChannelClient(channelId);
        registeredStateHash[channelId] = stateHash;
        emit StateRegistered(channelId, stateHash);
    }

    // ─── Challenge Submission ────────────────────────────────────────────────

    /// @notice Watchtower submits a challenge on behalf of an authorised client.
    /// @dev Caller must be the authorised watchtower for this channel.
    ///      The latestState must be ABI-encoded ChannelState with both parties' signatures.
    ///      ServiceAgreement verifies signatures — watchtower cannot forge state.
    function submitChallenge(bytes32 channelId, bytes calldata latestState) external {
        require(channelWatchtower[channelId] == msg.sender, "WatchtowerRegistry: not authorized watchtower");
        serviceAgreement.challengeChannel(channelId, latestState);
        emit WatchtowerChallengeSubmitted(channelId, msg.sender);
    }

    // ─── Queries ─────────────────────────────────────────────────────────────

    /// @notice Returns true if a channel has an authorised watchtower registered.
    function isWatched(bytes32 channelId) external view returns (bool) {
        return channelWatchtower[channelId] != address(0);
    }

    /// @notice Returns all channel IDs monitored by a given watchtower.
    function getWatchedChannels(address watchtower) external view returns (bytes32[] memory) {
        return watchedChannels[watchtower];
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    /// @dev Reverts if msg.sender is not the client of the given channel.
    function _requireChannelClient(bytes32 channelId) internal view {
        (address client, , , , , , , , ) = serviceAgreement.channels(channelId);
        require(client != address(0), "WatchtowerRegistry: channel not found");
        require(msg.sender == client, "WatchtowerRegistry: not channel client");
    }
}
