// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/CapabilityRegistry.sol";
import "../contracts/AgentRegistry.sol";
import "../contracts/TrustRegistry.sol";

contract CapabilityRegistryTest is Test {
    TrustRegistry trustRegistry;
    AgentRegistry agentRegistry;
    CapabilityRegistry capabilityRegistry;

    address gov = address(0xA11CE);
    address alice = address(0x1111);
    address bob = address(0x2222);

    string[] caps;

    function setUp() public {
        trustRegistry = new TrustRegistry();
        agentRegistry = new AgentRegistry(address(trustRegistry));
        capabilityRegistry = new CapabilityRegistry(address(agentRegistry), gov);

        caps = new string[](1);
        caps[0] = "legacy-freeform";

        vm.prank(alice);
        agentRegistry.register("Alice", caps, "LLM", "https://alice.example", "ipfs://alice");
    }

    function test_GovernanceRegistersRootsAndAgentClaimsCanonicalCapability() public {
        vm.prank(gov);
        capabilityRegistry.registerRoot("legal");

        vm.prank(alice);
        capabilityRegistry.claim("legal.patent-analysis.us.v1");

        string[] memory aliceCaps = capabilityRegistry.getCapabilities(alice);
        assertEq(aliceCaps.length, 1);
        assertEq(aliceCaps[0], "legal.patent-analysis.us.v1");
        assertTrue(capabilityRegistry.isCapabilityClaimed(alice, "legal.patent-analysis.us.v1"));
    }

    function test_RevertIfRootInactive() public {
        vm.prank(gov);
        capabilityRegistry.registerRoot("legal");
        vm.prank(gov);
        capabilityRegistry.setRootStatus("legal", false);

        vm.prank(alice);
        vm.expectRevert("CapabilityRegistry: root not active");
        capabilityRegistry.claim("legal.patent-analysis.us.v1");
    }

    function test_RevertIfAgentInactive() public {
        vm.prank(gov);
        capabilityRegistry.registerRoot("legal");

        vm.prank(alice);
        agentRegistry.deactivate();

        vm.prank(alice);
        vm.expectRevert("CapabilityRegistry: inactive agent");
        capabilityRegistry.claim("legal.patent-analysis.us.v1");
    }

    function test_RevertOnInvalidCanonicalCapability() public {
        vm.prank(gov);
        capabilityRegistry.registerRoot("legal");

        vm.startPrank(alice);
        vm.expectRevert("CapabilityRegistry: invalid capability");
        capabilityRegistry.claim("Legal.Patent.v1");

        vm.expectRevert("CapabilityRegistry: invalid capability");
        capabilityRegistry.claim("legal.patent-analysis.us");
        vm.stopPrank();
    }

    function test_RevertOnDuplicateCapability() public {
        vm.prank(gov);
        capabilityRegistry.registerRoot("legal");

        vm.prank(alice);
        capabilityRegistry.claim("legal.patent-analysis.us.v1");

        vm.prank(alice);
        vm.expectRevert("CapabilityRegistry: already claimed");
        capabilityRegistry.claim("legal.patent-analysis.us.v1");
    }

    function test_RevokeCapability() public {
        vm.prank(gov);
        capabilityRegistry.registerRoot("legal");

        vm.prank(alice);
        capabilityRegistry.claim("legal.patent-analysis.us.v1");

        vm.prank(alice);
        capabilityRegistry.revoke("legal.patent-analysis.us.v1");

        assertFalse(capabilityRegistry.isCapabilityClaimed(alice, "legal.patent-analysis.us.v1"));
        assertEq(capabilityRegistry.capabilityCount(alice), 0);
    }

    function test_MaxCapabilitiesPerAgent() public {
        vm.prank(gov);
        capabilityRegistry.registerRoot("compute");

        for (uint256 i = 0; i < capabilityRegistry.MAX_CAPABILITIES_PER_AGENT(); i++) {
            vm.prank(alice);
            capabilityRegistry.claim(string.concat("compute.worker-", vm.toString(i), ".v1"));
        }

        vm.prank(alice);
        vm.expectRevert("CapabilityRegistry: too many capabilities");
        capabilityRegistry.claim("compute.worker-20.v1");
    }

    function test_UnknownRootRejected() public {
        vm.prank(alice);
        vm.expectRevert("CapabilityRegistry: root not active");
        capabilityRegistry.claim("insurance.claims.coverage.v1");

        assertEq(capabilityRegistry.capabilityCount(bob), 0);
    }

    // ─── Reverse index: getAgentsWithCapability ───────────────────────────────

    function _registerBob() internal {
        string[] memory bobCaps = new string[](1);
        bobCaps[0] = "legacy-freeform";
        vm.prank(bob);
        agentRegistry.register("Bob", bobCaps, "LLM", "https://bob.example", "ipfs://bob");
    }

    function test_GetAgentsWithCapability_returns_agent_after_claim() public {
        vm.prank(gov);
        capabilityRegistry.registerRoot("compute");

        vm.prank(alice);
        capabilityRegistry.claim("compute.gpu.inference.v1");

        address[] memory agents = capabilityRegistry.getAgentsWithCapability("compute.gpu.inference.v1");
        assertEq(agents.length, 1);
        assertEq(agents[0], alice);
    }

    function test_GetAgentsWithCapability_excludes_agent_after_revoke() public {
        vm.prank(gov);
        capabilityRegistry.registerRoot("compute");

        vm.prank(alice);
        capabilityRegistry.claim("compute.gpu.inference.v1");

        vm.prank(alice);
        capabilityRegistry.revoke("compute.gpu.inference.v1");

        address[] memory agents = capabilityRegistry.getAgentsWithCapability("compute.gpu.inference.v1");
        assertEq(agents.length, 0, "revoked agent should be removed from reverse index");
        assertFalse(capabilityRegistry.isCapabilityClaimed(alice, "compute.gpu.inference.v1"));
    }

    function test_ReverseIndex_clean_after_claim_and_revoke() public {
        vm.prank(gov);
        capabilityRegistry.registerRoot("legal");

        vm.prank(alice);
        capabilityRegistry.claim("legal.contract-review.en.v1");

        // Verify in index
        address[] memory before = capabilityRegistry.getAgentsWithCapability("legal.contract-review.en.v1");
        assertEq(before.length, 1);

        // Revoke
        vm.prank(alice);
        capabilityRegistry.revoke("legal.contract-review.en.v1");

        // Index clean
        address[] memory after_ = capabilityRegistry.getAgentsWithCapability("legal.contract-review.en.v1");
        assertEq(after_.length, 0);

        // agentCapabilityIds also cleaned
        assertEq(capabilityRegistry.capabilityCount(alice), 0);
    }

    function test_MultipleAgents_same_capability_all_returned() public {
        _registerBob();

        vm.prank(gov);
        capabilityRegistry.registerRoot("compute");

        vm.prank(alice);
        capabilityRegistry.claim("compute.gpu.inference.v1");
        vm.prank(bob);
        capabilityRegistry.claim("compute.gpu.inference.v1");

        address[] memory agents = capabilityRegistry.getAgentsWithCapability("compute.gpu.inference.v1");
        assertEq(agents.length, 2, "both agents should appear");

        bool foundAlice;
        bool foundBob;
        for (uint256 i = 0; i < agents.length; i++) {
            if (agents[i] == alice) foundAlice = true;
            if (agents[i] == bob)   foundBob   = true;
        }
        assertTrue(foundAlice, "alice should be in result");
        assertTrue(foundBob,   "bob should be in result");
    }

    function test_GetAgentsWithCapability_unknown_capability_returns_empty() public view {
        // No revert for unknown capability — returns empty array
        address[] memory agents = capabilityRegistry.getAgentsWithCapability("unknown.cap.v99");
        assertEq(agents.length, 0, "unknown capability should return empty, not revert");
    }

    function test_GetAgentsWithCapability_partial_revoke_removes_only_revoker() public {
        _registerBob();

        vm.prank(gov);
        capabilityRegistry.registerRoot("legal");

        vm.prank(alice);
        capabilityRegistry.claim("legal.ip-analysis.us.v1");
        vm.prank(bob);
        capabilityRegistry.claim("legal.ip-analysis.us.v1");

        // Alice revokes
        vm.prank(alice);
        capabilityRegistry.revoke("legal.ip-analysis.us.v1");

        address[] memory agents = capabilityRegistry.getAgentsWithCapability("legal.ip-analysis.us.v1");
        assertEq(agents.length, 1, "only bob should remain");
        assertEq(agents[0], bob);
    }
}
