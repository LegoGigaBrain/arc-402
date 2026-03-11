// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ARC402Registry
 * @notice Canonical registry of ARC-402 infrastructure addresses.
 *         When ARC-402 deploys new contract versions, it updates the registry.
 *         Wallet owners opt into new versions by calling setRegistry().
 *         Nobody can force a wallet upgrade.
 */
contract ARC402Registry {
    // Immutable owner — intentional. Registry upgrade requires deploying a new registry
    // and updating wallet pointers. This is stronger than Ownable2Step for a canonical
    // registry: no phishing/key-compromise path can silently redirect ARC-402 infrastructure.
    address public immutable owner;

    address public policyEngine;
    address public trustRegistry;
    address public intentAttestation;
    address public settlementCoordinator;
    string public version;

    event ContractsUpdated(string version, address policyEngine, address trustRegistry, address intentAttestation, address settlementCoordinator);

    constructor(
        address _policyEngine,
        address _trustRegistry,
        address _intentAttestation,
        address _settlementCoordinator,
        string memory _version
    ) {
        require(_policyEngine != address(0), "Registry: zero policyEngine");
        require(_trustRegistry != address(0), "Registry: zero trustRegistry");
        require(_intentAttestation != address(0), "Registry: zero intentAttestation");
        require(_settlementCoordinator != address(0), "Registry: zero settlementCoordinator");
        owner = msg.sender;
        policyEngine = _policyEngine;
        trustRegistry = _trustRegistry;
        intentAttestation = _intentAttestation;
        settlementCoordinator = _settlementCoordinator;
        version = _version;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Registry: not owner");
        _;
    }

    function update(
        address _policyEngine,
        address _trustRegistry,
        address _intentAttestation,
        address _settlementCoordinator,
        string memory _version
    ) external onlyOwner {
        require(_policyEngine != address(0), "Registry: zero policyEngine");
        require(_trustRegistry != address(0), "Registry: zero trustRegistry");
        require(_intentAttestation != address(0), "Registry: zero intentAttestation");
        require(_settlementCoordinator != address(0), "Registry: zero settlementCoordinator");
        policyEngine = _policyEngine;
        trustRegistry = _trustRegistry;
        intentAttestation = _intentAttestation;
        settlementCoordinator = _settlementCoordinator;
        version = _version;
        emit ContractsUpdated(_version, _policyEngine, _trustRegistry, _intentAttestation, _settlementCoordinator);
    }
}
