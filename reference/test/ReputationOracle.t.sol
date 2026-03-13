// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/ReputationOracle.sol";
import "../contracts/TrustRegistry.sol";

contract ReputationOracleTest is Test {
    TrustRegistry trustRegistry;
    ReputationOracle oracle;

    address serviceAgreement = address(0xA001);
    address publisher  = address(0xAAAA);
    address subject    = address(0xBBBB);
    address provider   = address(0xCCCC);
    address client     = address(0xDDDD);

    bytes32 constant CAP = keccak256("legal-research");

    function setUp() public {
        trustRegistry = new TrustRegistry();
        oracle = new ReputationOracle(address(trustRegistry), serviceAgreement);

        trustRegistry.initWallet(publisher);
        trustRegistry.addUpdater(address(this));
        trustRegistry.recordSuccess(publisher, address(0xA11), "legacy", 1 ether);
        trustRegistry.recordSuccess(publisher, address(0xA11), "legacy", 1 ether);
    }

    function test_PublishEndorse() public {
        vm.prank(publisher);
        oracle.publishSignal(subject, ReputationOracle.SignalType.ENDORSE, CAP, "Great work");

        (uint256 endorsements, uint256 warnings, uint256 blocks, uint256 weighted) = oracle.getReputation(subject);

        assertEq(endorsements, 1);
        assertEq(warnings, 0);
        assertEq(blocks, 0);
        assertGt(weighted, 0);
    }

    function test_PublishWarn() public {
        vm.prank(publisher);
        oracle.publishSignal(subject, ReputationOracle.SignalType.WARN, CAP, "Delivered garbage");

        (uint256 endorsements, uint256 warnings,,) = oracle.getReputation(subject);
        assertEq(endorsements, 0);
        assertEq(warnings, 1);
    }

    function test_CannotSignalSelf() public {
        vm.prank(publisher);
        vm.expectRevert("ReputationOracle: cannot signal self");
        oracle.publishSignal(publisher, ReputationOracle.SignalType.ENDORSE, CAP, "I'm great");
    }

    function test_CannotSignalTwice() public {
        vm.prank(publisher);
        oracle.publishSignal(subject, ReputationOracle.SignalType.ENDORSE, CAP, "First");

        vm.roll(block.number + 1);
        vm.prank(publisher);
        vm.expectRevert("ReputationOracle: already signaled");
        oracle.publishSignal(subject, ReputationOracle.SignalType.WARN, CAP, "Changed my mind");
    }

    function test_WeightedScoreNetOut() public {
        address endorser = address(0xEE01);
        address warner   = address(0xEE02);

        trustRegistry.initWallet(endorser);
        trustRegistry.initWallet(warner);
        trustRegistry.recordSuccess(endorser, address(0xA12), "legacy", 1 ether);
        trustRegistry.recordSuccess(warner, address(0xA13), "legacy", 1 ether);
        trustRegistry.recordSuccess(warner, address(0xA13), "legacy", 1 ether);
        trustRegistry.recordSuccess(warner, address(0xA13), "legacy", 1 ether);

        vm.prank(endorser);
        oracle.publishSignal(subject, ReputationOracle.SignalType.ENDORSE, CAP, "Good");
        vm.roll(block.number + 1);
        vm.prank(warner);
        oracle.publishSignal(subject, ReputationOracle.SignalType.WARN, bytes32(0), "Bad general");

        (,,, uint256 weighted) = oracle.getReputation(subject);
        assertEq(weighted, 0);
    }

    function test_AutoWarn_OnlyServiceAgreement() public {
        vm.prank(address(0xBB01));
        vm.expectRevert("ReputationOracle: caller not ServiceAgreement");
        oracle.autoWarn(client, provider, CAP);
    }

    function test_AutoWarn_Published() public {
        trustRegistry.initWallet(client);

        vm.prank(serviceAgreement);
        oracle.autoWarn(client, provider, CAP);

        (uint256 endorsements, uint256 warnings,,) = oracle.getReputation(provider);
        assertEq(endorsements, 0);
        assertEq(warnings, 1);

        ReputationOracle.Signal memory sig = oracle.getSignal(provider, 0);
        assertTrue(sig.autoPublished);
    }

    function test_AutoWarn_Idempotent() public {
        trustRegistry.initWallet(client);

        vm.prank(serviceAgreement);
        oracle.autoWarn(client, provider, CAP);

        vm.roll(block.number + 1);
        vm.prank(serviceAgreement);
        oracle.autoWarn(client, provider, CAP);

        assertEq(oracle.getSignalCount(provider), 1);
    }

    function test_AutoWarn_ResetsStreak() public {
        vm.prank(serviceAgreement);
        oracle.autoRecordSuccess(client, provider, CAP);
        assertEq(oracle.successStreak(provider), 1);

        vm.roll(block.number + 1);
        trustRegistry.initWallet(client);
        vm.prank(serviceAgreement);
        oracle.autoWarn(client, provider, CAP);
        assertEq(oracle.successStreak(provider), 0);
    }

    function test_AutoWarn_WindowLimit() public {
        for (uint160 i = 1; i <= 4; i++) {
            address nextClient = address(0xD000 + i);
            trustRegistry.initWallet(nextClient);
            vm.prank(serviceAgreement);
            oracle.autoWarn(nextClient, provider, CAP);
            vm.roll(block.number + 1);
        }

        assertEq(oracle.getSignalCount(provider), 3);
    }

    function test_AutoWarn_WindowResetsAfterCooldownWindow() public {
        for (uint160 i = 1; i <= 3; i++) {
            address nextClient = address(0xE000 + i);
            trustRegistry.initWallet(nextClient);
            vm.prank(serviceAgreement);
            oracle.autoWarn(nextClient, provider, CAP);
            vm.roll(block.number + 1);
        }
        assertEq(oracle.getSignalCount(provider), 3);

        vm.warp(block.timestamp + 7 days + 1);
        trustRegistry.initWallet(address(0xE100));
        vm.prank(serviceAgreement);
        oracle.autoWarn(address(0xE100), provider, CAP);

        assertEq(oracle.getSignalCount(provider), 4);
    }

    function test_AutoEndorse_AfterStreak() public {
        trustRegistry.initWallet(client);

        for (uint256 i = 0; i < 4; i++) {
            vm.prank(serviceAgreement);
            oracle.autoRecordSuccess(address(uint160(0xF000 + i)), provider, CAP);
            vm.roll(block.number + 1);
        }
        assertEq(oracle.successStreak(provider), 4);
        assertEq(oracle.getSignalCount(provider), 0);

        vm.prank(serviceAgreement);
        oracle.autoRecordSuccess(client, provider, CAP);
        assertEq(oracle.getSignalCount(provider), 1);

        ReputationOracle.Signal memory sig = oracle.getSignal(provider, 0);
        assertEq(uint(sig.signalType), uint(ReputationOracle.SignalType.ENDORSE));
        assertTrue(sig.autoPublished);
        assertEq(oracle.successStreak(provider), 0);
    }

    function test_CapabilityReputation_FiltersByCapability() public {
        address endorser1 = address(0xFF01);
        address endorser2 = address(0xFF02);
        trustRegistry.initWallet(endorser1);
        trustRegistry.initWallet(endorser2);

        vm.prank(endorser1);
        oracle.publishSignal(subject, ReputationOracle.SignalType.ENDORSE, CAP, "Good at legal");
        vm.roll(block.number + 1);
        vm.prank(endorser2);
        oracle.publishSignal(subject, ReputationOracle.SignalType.ENDORSE, keccak256("coding"), "Good at coding");

        uint256 legalScore = oracle.getCapabilityReputation(subject, CAP);
        uint256 codingScore = oracle.getCapabilityReputation(subject, keccak256("coding"));

        assertGt(legalScore, 0);
        assertGt(codingScore, 0);
    }
}
