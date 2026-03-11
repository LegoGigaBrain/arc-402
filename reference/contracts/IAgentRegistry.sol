// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAgentRegistry
 * @notice Interface for the ARC-402 agent discovery and capability registry
 * STATUS: DRAFT — not audited, do not use in production
 */
interface IAgentRegistry {
    struct AgentInfo {
        address wallet;
        string name;
        string[] capabilities;  // e.g. ["text-generation", "code-review"]
        string serviceType;     // e.g. "LLM", "oracle", "compute", "storage"
        string endpoint;        // discovery endpoint (URL or IPFS CID)
        string metadataURI;
        bool active;
        uint256 registeredAt;
        uint256 endpointChangedAt;   // timestamp of last endpoint change (0 = never changed)
        uint256 endpointChangeCount; // total number of endpoint changes since registration
    }

    function register(
        string calldata name,
        string[] calldata capabilities,
        string calldata serviceType,
        string calldata endpoint,
        string calldata metadataURI
    ) external;

    function update(
        string calldata name,
        string[] calldata capabilities,
        string calldata serviceType,
        string calldata endpoint,
        string calldata metadataURI
    ) external;

    function deactivate() external;

    function getAgent(address wallet) external view returns (AgentInfo memory);

    function isRegistered(address wallet) external view returns (bool);

    function isActive(address wallet) external view returns (bool);
}
