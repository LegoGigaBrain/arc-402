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

        // Give publisher some trust
        trustRegistry.initWallet(publisher);
        trustRegistry.addUpdater(address(this));
        trustRegistry.recordSuccess(publisher);
        trustRegistry.recordSuccess(publisher);
        // publisher trust = ~120
    }

    // ─── Manual signals ───────────────────────────────────────────────────────

    function test_PublishEndorse() public {
        vm.prank(publisher);
        oracle.publishSignal(subject, ReputationOracle.SignalType.ENDORSE, CAP, "Great work");

        (uint256 endorsements, uint256 warnings, uint256 blocks, uint256 weighted) =
            oracle.getReputation(subject);

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

        vm.prank(publisher);
        vm.expectRevert("ReputationOracle: already signaled");
        oracle.publishSignal(subject, ReputationOracle.SignalType.WARN, CAP, "Changed my mind");
    }

    function test_WeightedScoreNetOut() public {
        // One endorser, one warner with higher trust — net score should be 0
        address endorser = address(0xEE01);
        address warner   = address(0xEE02);

        trustRegistry.initWallet(endorser);
        trustRegistry.initWallet(warner);
        trustRegistry.recordSuccess(endorser); // ~110 trust
        trustRegistry.recordSuccess(warner);
        trustRegistry.recordSuccess(warner);
        trustRegistry.recordSuccess(warner); // higher trust

        vm.prank(endorser);
        oracle.publishSignal(subject, ReputationOracle.SignalType.ENDORSE, CAP, "Good");
        vm.prank(warner);
        oracle.publishSignal(subject, ReputationOracle.SignalType.WARN, bytes32(0), "Bad general");

        (,,, uint256 weighted) = oracle.getReputation(subject);
        // Warner has more trust — net weighted should be 0 (floored)
        assertEq(weighted, 0);
    }

    // ─── Auto-publishing ──────────────────────────────────────────────────────

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

        // Auto-warn should be marked autoPublished
        ReputationOracle.Signal memory sig = oracle.getSignal(provider, 0);
        assertTrue(sig.autoPublished);
    }

    function test_AutoWarn_Idempotent() public {
        trustRegistry.initWallet(client);

        vm.prank(serviceAgreement);
        oracle.autoWarn(client, provider, CAP);

        // Second call — already signaled, should not add another
        vm.prank(serviceAgreement);
        oracle.autoWarn(client, provider, CAP);

        assertEq(oracle.getSignalCount(provider), 1);
    }

    function test_AutoWarn_ResetsStreak() public {
        vm.prank(serviceAgreement);
        oracle.autoRecordSuccess(client, provider, CAP);
        assertEq(oracle.successStreak(provider), 1);

        trustRegistry.initWallet(client);
        vm.prank(serviceAgreement);
        oracle.autoWarn(client, provider, CAP);
        assertEq(oracle.successStreak(provider), 0);
    }

    function test_AutoEndorse_AfterStreak() public {
        trustRegistry.initWallet(client);

        // Need 5 consecutive successes — but hasSignaled prevents multiple from same client
        // Use different clients for each success
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(serviceAgreement);
            oracle.autoRecordSuccess(address(uint160(0xF000 + i)), provider, CAP);
        }
        assertEq(oracle.successStreak(provider), 4);
        assertEq(oracle.getSignalCount(provider), 0); // not yet

        vm.prank(serviceAgreement);
        oracle.autoRecordSuccess(client, provider, CAP);
        assertEq(oracle.getSignalCount(provider), 1);

        ReputationOracle.Signal memory sig = oracle.getSignal(provider, 0);
        assertEq(uint(sig.signalType), uint(ReputationOracle.SignalType.ENDORSE));
        assertTrue(sig.autoPublished);
        // Streak reset after endorse
        assertEq(oracle.successStreak(provider), 0);
    }

    // ─── Capability reputation ────────────────────────────────────────────────

    function test_CapabilityReputation_FiltersByCapability() public {
        address endorser1 = address(0xFF01);
        address endorser2 = address(0xFF02);
        trustRegistry.initWallet(endorser1);
        trustRegistry.initWallet(endorser2);

        vm.prank(endorser1);
        oracle.publishSignal(subject, ReputationOracle.SignalType.ENDORSE, CAP, "Good at legal");
        vm.prank(endorser2);
        oracle.publishSignal(subject, ReputationOracle.SignalType.ENDORSE, keccak256("coding"), "Good at coding");

        uint256 legalScore = oracle.getCapabilityReputation(subject, CAP);
        uint256 codingScore = oracle.getCapabilityReputation(subject, keccak256("coding"));

        assertGt(legalScore, 0);
        assertGt(codingScore, 0);
        // General signal (bytes32(0)) would appear in both — no general signal here so they're isolated
    }
}
