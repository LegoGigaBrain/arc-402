// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ARC402Wallet.sol";
import "../contracts/ARC402RegistryV2.sol";
import "../contracts/PolicyEngine.sol";
import "../contracts/TrustRegistry.sol";
import "../contracts/IntentAttestation.sol";
import "../contracts/SettlementCoordinator.sol";
import "../contracts/AgentRegistry.sol";

/// @notice Tests that protocol contracts (those registered in ARC402RegistryV2)
///         can be called via executeContractCall without PolicyEngine whitelisting.
contract ARC402WalletProtocolBypassTest is Test {
    PolicyEngine policyEngine;
    TrustRegistry trustRegistry;
    IntentAttestation intentAttestation;
    SettlementCoordinator settlementCoordinator;
    ARC402RegistryV2 reg;
    ARC402Wallet wallet;
    AgentRegistry agentRegistry;

    address walletOwner = address(this);

    function setUp() public {
        policyEngine = new PolicyEngine();
        trustRegistry = new TrustRegistry();
        intentAttestation = new IntentAttestation();
        settlementCoordinator = new SettlementCoordinator();

        reg = new ARC402RegistryV2(
            address(policyEngine),
            address(trustRegistry),
            address(intentAttestation),
            address(settlementCoordinator),
            "v1.0.0"
        );

        wallet = new ARC402Wallet(address(reg), walletOwner, address(0xE4337));
        trustRegistry.addUpdater(address(wallet));

        // Deploy AgentRegistry and register it in the protocol registry
        agentRegistry = new AgentRegistry(address(trustRegistry));

        ARC402RegistryV2.ProtocolContracts memory pc = ARC402RegistryV2.ProtocolContracts({
            policyEngine:         address(policyEngine),
            trustRegistry:        address(trustRegistry),
            intentAttestation:    address(intentAttestation),
            serviceAgreement:     address(0),
            sessionChannels:      address(0),
            agentRegistry:        address(agentRegistry),
            reputationOracle:     address(0),
            settlementCoordinator: address(settlementCoordinator),
            vouchingRegistry:     address(0),
            migrationRegistry:    address(0)
        });
        reg.update(pc, "v1.1.0");
    }

    /// @notice A wallet can call AgentRegistry.register() via executeContractCall
    ///         WITHOUT having whitelisted it on PolicyEngine first.
    ///         The protocol contract bypass allows this unconditionally.
    function test_ProtocolBypass_AgentRegistry_NoWhitelistRequired() public {
        // Sanity check: agentRegistry is NOT whitelisted on PolicyEngine
        // (we never called walletPolicyEngine.whitelistContract — so calling it as
        // a regular DeFi contract would revert with "PolicyEngine: contract not whitelisted")

        string[] memory caps = new string[](0);
        bytes memory callData = abi.encodeWithSignature(
            "register(string,string[],string,string,string)",
            "TestAgent",
            caps,
            "inference",
            "https://agent.example.com",
            ""
        );

        ARC402Wallet.ContractCallParams memory params = ARC402Wallet.ContractCallParams({
            target:            address(agentRegistry),
            data:              callData,
            value:             0,
            minReturnValue:    0,
            maxApprovalAmount: 0,
            approvalToken:     address(0)
        });

        // Must succeed even though agentRegistry was never whitelisted on PolicyEngine
        wallet.executeContractCall(params);

        // Verify the wallet is now registered in AgentRegistry
        assertTrue(agentRegistry.isRegistered(address(wallet)));
    }

    /// @notice Non-protocol contracts still require PolicyEngine whitelisting.
    ///         This test verifies the bypass is scoped to protocol contracts only.
    function test_NonProtocolContract_StillRequiresWhitelist() public {
        address randomTarget = address(0xDEAD);
        bytes memory callData = abi.encodeWithSignature("foo()");

        ARC402Wallet.ContractCallParams memory params = ARC402Wallet.ContractCallParams({
            target:            randomTarget,
            data:              callData,
            value:             0,
            minReturnValue:    0,
            maxApprovalAmount: 0,
            approvalToken:     address(0)
        });

        // Must revert — random contract is not in the registry and not whitelisted
        vm.expectRevert("PolicyEngine: contract not whitelisted");
        wallet.executeContractCall(params);
    }
}
