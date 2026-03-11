// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/SponsorshipAttestation.sol";

contract SponsorshipAttestationTest is Test {
    SponsorshipAttestation sa;
    address sponsor = address(0xAAAA);
    address agent1  = address(0xBBBB);
    address agent2  = address(0xCCCC);

    function setUp() public {
        sa = new SponsorshipAttestation();
    }

    function test_Publish_Works() public {
        vm.prank(sponsor);
        bytes32 id = sa.publish(agent1, 0);

        assertTrue(sa.isActive(id));
        assertEq(sa.getActiveAttestation(sponsor, agent1), id);
    }

    function test_Publish_WithExpiry() public {
        vm.prank(sponsor);
        bytes32 id = sa.publish(agent1, block.timestamp + 30 days);
        assertTrue(sa.isActive(id));

        vm.warp(block.timestamp + 31 days);
        assertFalse(sa.isActive(id));
        assertEq(sa.getActiveAttestation(sponsor, agent1), bytes32(0));
    }

    function test_CannotSelfAttest() public {
        vm.prank(sponsor);
        vm.expectRevert("SponsorshipAttestation: self-attestation");
        sa.publish(sponsor, 0);
    }

    function test_CannotDoubleAttest() public {
        vm.prank(sponsor);
        sa.publish(agent1, 0);

        vm.prank(sponsor);
        vm.expectRevert("SponsorshipAttestation: active attestation exists, revoke first");
        sa.publish(agent1, 0);
    }

    function test_Revoke() public {
        vm.prank(sponsor);
        bytes32 id = sa.publish(agent1, 0);
        assertTrue(sa.isActive(id));

        vm.prank(sponsor);
        sa.revoke(id);

        assertFalse(sa.isActive(id));
        assertEq(sa.getActiveAttestation(sponsor, agent1), bytes32(0));
    }

    function test_RevokeAndReissue() public {
        vm.prank(sponsor);
        bytes32 id1 = sa.publish(agent1, 0);

        vm.prank(sponsor);
        sa.revoke(id1);

        // After revoke, can publish again
        vm.prank(sponsor);
        bytes32 id2 = sa.publish(agent1, 0);

        assertFalse(sa.isActive(id1));
        assertTrue(sa.isActive(id2));
        assertTrue(id1 != id2);
    }

    function test_OnlySponsorsCanRevoke() public {
        vm.prank(sponsor);
        bytes32 id = sa.publish(agent1, 0);

        vm.prank(address(0xDEAD));
        vm.expectRevert("SponsorshipAttestation: not sponsor");
        sa.revoke(id);
    }

    function test_ActiveSponsorCount() public {
        vm.prank(sponsor);
        sa.publish(agent1, 0);
        vm.prank(sponsor);
        sa.publish(agent2, 0);

        assertEq(sa.activeSponsorCount(sponsor), 2);

        bytes32 id1 = sa.getActiveAttestation(sponsor, agent1);
        vm.prank(sponsor);
        sa.revoke(id1);

        assertEq(sa.activeSponsorCount(sponsor), 1);
    }

    function test_AgentCanHaveMultipleSponsors() public {
        address sponsor2 = address(0xDD01);

        vm.prank(sponsor);
        sa.publish(agent1, 0);
        vm.prank(sponsor2);
        sa.publish(agent1, 0);

        bytes32[] memory attestations = sa.getAgentAttestations(agent1);
        assertEq(attestations.length, 2);
    }
}
