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
    /// @notice Immutable owner — intentional by design.
    ///
    /// @dev MA-16 NOTE: The immutable owner is a deliberate security property, not an oversight.
    ///      This is stronger than Ownable2Step: no phishing or key-compromise attack can silently
    ///      redirect ARC-402 infrastructure by transferring ownership.
    ///
    ///      Recovery path (if owner key is lost):
    ///        1. Deploy a new ARC402Registry with the correct infrastructure addresses.
    ///        2. ARC402Wallet owners opt into the new registry via proposeRegistryUpdate()
    ///           followed by executeRegistryUpdate() after the 2-day timelock.
    ///      There is no admin backdoor. Migration is always owner-initiated and timelocked.
    address public immutable owner;

    address public policyEngine;
    address public trustRegistry;
    address public intentAttestation;
    address public settlementCoordinator;
    string public version;

    event ContractsUpdated(string version, address indexed policyEngine, address indexed trustRegistry, address indexed intentAttestation, address settlementCoordinator);

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
