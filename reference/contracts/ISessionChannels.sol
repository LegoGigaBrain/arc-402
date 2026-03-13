// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISessionChannels {

    function openSessionChannel(
        address client,
        address provider,
        address token,
        uint256 maxAmount,
        uint256 ratePerCall,
        uint256 deadline
    ) external payable returns (bytes32 channelId);

    function closeChannel(
        address caller,
        bytes32 channelId,
        bytes calldata finalStateBytes
    ) external;

    function challengeChannel(
        address caller,
        bytes32 channelId,
        bytes calldata latestStateBytes
    ) external;

    function finaliseChallenge(address caller, bytes32 channelId) external;

    function reclaimExpiredChannel(address caller, bytes32 channelId) external;

    /// @dev Returns ABI-encoded Channel struct. SA stub decodes to its own Channel type.
    function getChannelEncoded(bytes32 channelId) external view returns (bytes memory);

    function getChannelsByClient(address client) external view returns (bytes32[] memory);

    function getChannelsByProvider(address provider) external view returns (bytes32[] memory);
}
