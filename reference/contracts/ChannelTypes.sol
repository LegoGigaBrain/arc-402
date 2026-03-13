// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ChannelTypes
/// @notice Shared type definitions for session channel data structures.
///         Inherited by ServiceAgreement so tests can access types via ServiceAgreement.Channel etc.
contract ChannelTypes {
    enum ChannelStatus { OPEN, CLOSING, CHALLENGED, SETTLED }

    struct Channel {
        address client;
        address provider;
        address token;
        uint256 depositAmount;
        uint256 settledAmount;
        uint256 lastSequenceNumber;
        uint256 deadline;
        uint256 challengeExpiry;
        ChannelStatus status;
    }

    struct ChannelState {
        bytes32 channelId;
        uint256 sequenceNumber;
        uint256 callCount;
        uint256 cumulativePayment;
        address token;
        uint256 timestamp;
        bytes clientSig;
        bytes providerSig;
    }
}
