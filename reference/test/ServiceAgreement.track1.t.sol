// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ServiceAgreement.sol";
import "../contracts/TrustRegistryV2.sol";
import "../contracts/ARC402Wallet.sol";
import "../contracts/ARC402Registry.sol";
import "../contracts/PolicyEngine.sol";
import "../contracts/IntentAttestation.sol";
import "../contracts/SettlementCoordinator.sol";

contract ServiceAgreementTrack1Test is Test {
    ServiceAgreement sa;
    TrustRegistryV2 registry;

    address client = address(0xC1);
    address provider = address(0xA1);

    bytes32 constant SPEC_HASH = keccak256("spec");
    bytes32 constant DELIVERY_HASH = keccak256("delivery");

    function setUp() public {
        registry = new TrustRegistryV2(address(0));
        sa = new ServiceAgreement(address(registry));
        registry.addUpdater(address(sa));
        sa.setApprovedArbitrator(address(0xB1), true);
        sa.setApprovedArbitrator(address(0xB2), true);
        sa.setApprovedArbitrator(address(0xB3), true);
        vm.deal(client, 100 ether);
        vm.deal(provider, 10 ether);
    }

    function _proposeAccept() internal returns (uint256 id) {
        vm.prank(client);
        id = sa.propose{value: 1 ether}(provider, "compute", "deliver a result", 1 ether, address(0), block.timestamp + 7 days, SPEC_HASH);
        vm.prank(provider);
        sa.accept(id);
    }

    function test_DisputeSetsResolvedAt() public {
        uint256 id = _proposeAccept();
        vm.warp(block.timestamp + 8 days);
        vm.prank(client);
        sa.directDispute(id, IServiceAgreement.DirectDisputeReason.NO_DELIVERY, "broken");
        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.DISPUTED));
        assertEq(ag.resolvedAt, block.timestamp);
    }

    function test_TrustRegistryV2_CompatibilityAlias() public {
        registry.initWallet(provider);
        assertEq(registry.getScore(provider), registry.getGlobalScore(provider));
    }

    function test_Remediation_TracksCyclesAndTranscriptChain() public {
        uint256 id = _proposeAccept();
        bytes32 f1 = keccak256("feedback-1");

        vm.prank(client);
        sa.requestRevision(id, f1, "ipfs://feedback-1", bytes32(0));

        IServiceAgreement.RemediationCase memory rc = sa.getRemediationCase(id);
        assertTrue(rc.active);
        assertEq(rc.cycleCount, 1);
        assertEq(rc.deadlineAt, rc.openedAt + sa.REMEDIATION_WINDOW());

        IServiceAgreement.RemediationFeedback memory feedback = sa.getRemediationFeedback(id, 0);
        assertEq(feedback.feedbackHash, f1);
        assertEq(feedback.previousTranscriptHash, bytes32(0));
        assertEq(feedback.transcriptHash, rc.latestTranscriptHash);

        vm.prank(provider);
        sa.respondToRevision(id, IServiceAgreement.ProviderResponseType.REVISE, 0, keccak256("resp-1"), "ipfs://resp-1", feedback.transcriptHash);

        IServiceAgreement.RemediationResponse memory response = sa.getRemediationResponse(id, 0);
        assertEq(uint256(response.responseType), uint256(IServiceAgreement.ProviderResponseType.REVISE));
        assertEq(response.previousTranscriptHash, feedback.transcriptHash);
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.REVISED));
    }

    function test_Remediation_MaxTwoCyclesThenEscalate() public {
        uint256 id = _proposeAccept();

        vm.prank(client);
        sa.requestRevision(id, keccak256("f1"), "uri1", bytes32(0));
        bytes32 t1 = sa.getRemediationCase(id).latestTranscriptHash;

        vm.prank(provider);
        sa.respondToRevision(id, IServiceAgreement.ProviderResponseType.DEFEND, 0, keccak256("r1"), "uri-r1", t1);
        bytes32 t2 = sa.getRemediationCase(id).latestTranscriptHash;

        vm.prank(client);
        sa.requestRevision(id, keccak256("f2"), "uri2", t2);

        bytes32 t3 = sa.getRemediationCase(id).latestTranscriptHash;
        vm.expectRevert("ServiceAgreement: max remediation cycles");
        vm.prank(client);
        sa.requestRevision(id, keccak256("f3"), "uri3", t3);

        bytes32 t4 = sa.getRemediationCase(id).latestTranscriptHash;
        vm.prank(provider);
        sa.respondToRevision(id, IServiceAgreement.ProviderResponseType.DEFEND, 0, keccak256("r2"), "uri-r2", t4);

        vm.prank(client);
        sa.escalateToDispute(id, "unresolved after two cycles");

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.DISPUTED));
        IServiceAgreement.DisputeCase memory dc = sa.getDisputeCase(id);
        assertEq(uint256(dc.outcome), uint256(IServiceAgreement.DisputeOutcome.PENDING));
        assertEq(dc.responseDeadlineAt, dc.openedAt + sa.DISPUTE_TIMEOUT());
    }

    function test_Remediation_WindowTimeoutEnablesEscalation() public {
        uint256 id = _proposeAccept();
        vm.prank(client);
        sa.requestRevision(id, keccak256("f1"), "uri1", bytes32(0));
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(client);
        sa.escalateToDispute(id, "timeout");
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.DISPUTED));
    }

    function test_DisputeEvidenceAndPartialResolution() public {
        uint256 id = _proposeAccept();
        vm.prank(client);
        sa.requestRevision(id, keccak256("f1"), "uri1", bytes32(0));
        bytes32 transcript = sa.getRemediationCase(id).latestTranscriptHash;

        vm.prank(provider);
        sa.respondToRevision(id, IServiceAgreement.ProviderResponseType.REQUEST_HUMAN_REVIEW, 0, keccak256("human"), "uri-human", transcript);

        vm.prank(client);
        sa.submitDisputeEvidence(id, IServiceAgreement.EvidenceType.DELIVERABLE, keccak256("e1"), "ipfs://e1");
        vm.prank(provider);
        sa.submitDisputeEvidence(id, IServiceAgreement.EvidenceType.COMMUNICATION, keccak256("e2"), "ipfs://e2");

        IServiceAgreement.DisputeCase memory beforeResolution = sa.getDisputeCase(id);
        assertEq(beforeResolution.evidenceCount, 2);
        assertTrue(beforeResolution.humanReviewRequested);

        uint256 providerBefore = provider.balance;
        uint256 clientBefore = client.balance;
        sa.resolveDisputeDetailed(id, IServiceAgreement.DisputeOutcome.PARTIAL_PROVIDER, 0.4 ether, 0.6 ether);

        assertEq(provider.balance, providerBefore + 0.4 ether);
        assertEq(client.balance, clientBefore + 0.6 ether);
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.FULFILLED)); // B-03: partial outcomes now terminal FULFILLED
    }

    function test_ProviderCanRequestHumanReviewHook() public {
        uint256 id = _proposeAccept();
        vm.prank(client);
        sa.requestRevision(id, keccak256("f1"), "uri1", bytes32(0));
        bytes32 transcript = sa.getRemediationCase(id).latestTranscriptHash;

        vm.prank(provider);
        sa.respondToRevision(id, IServiceAgreement.ProviderResponseType.REQUEST_HUMAN_REVIEW, 0, keccak256("human"), "uri-human", transcript);

        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.ESCALATED_TO_HUMAN));
        assertTrue(sa.getDisputeCase(id).humanReviewRequested);
    }

    function test_PeerArbitration_MajoritySplitFinalizesExactPartialOutcome() public {
        address arb1 = address(0xB1);
        address arb2 = address(0xB2);
        address arb3 = address(0xB3);

        uint256 id = _proposeAccept();
        vm.prank(client);
        sa.requestRevision(id, keccak256("f1"), "uri1", bytes32(0));
        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(client);
        sa.escalateToDispute(id, "peer arbitration needed");

        vm.prank(client);
        sa.submitDisputeEvidence(id, IServiceAgreement.EvidenceType.DELIVERABLE, keccak256("e1"), "ipfs://e1");

        vm.prank(client);
        sa.nominateArbitrator(id, arb1);
        vm.prank(provider);
        sa.nominateArbitrator(id, arb2);
        vm.prank(client);
        sa.nominateArbitrator(id, arb3);

        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.ESCALATED_TO_ARBITRATION));

        uint256 providerBefore = provider.balance;
        uint256 clientBefore = client.balance;

        vm.prank(arb1);
        sa.castArbitrationVote(id, IServiceAgreement.ArbitrationVote.SPLIT, 0.4 ether, 0.6 ether);
        vm.prank(arb2);
        sa.castArbitrationVote(id, IServiceAgreement.ArbitrationVote.SPLIT, 0.4 ether, 0.6 ether);

        assertEq(provider.balance, providerBefore + 0.4 ether);
        assertEq(client.balance, clientBefore + 0.6 ether);
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.FULFILLED)); // B-03: partial outcomes now terminal FULFILLED
    }
}

contract ARC402WalletRegistryPendingTest is Test {
    ARC402Wallet wallet;
    ARC402Registry reg;

    function setUp() public {
        PolicyEngine pe = new PolicyEngine();
        TrustRegistryV2 tr = new TrustRegistryV2(address(0));
        IntentAttestation ia = new IntentAttestation();
        SettlementCoordinator sc = new SettlementCoordinator();
        reg = new ARC402Registry(address(pe), address(tr), address(ia), address(sc), "v1");
        wallet = new ARC402Wallet(address(reg), address(this));
    }

    function _deployReg(string memory version) internal returns (ARC402Registry) {
        PolicyEngine pe = new PolicyEngine();
        TrustRegistryV2 tr = new TrustRegistryV2(address(0));
        IntentAttestation ia = new IntentAttestation();
        SettlementCoordinator sc = new SettlementCoordinator();
        return new ARC402Registry(address(pe), address(tr), address(ia), address(sc), version);
    }

    function test_RegistryTimelock_RejectsReproposalWhilePending() public {
        ARC402Registry reg2 = _deployReg("v2");
        ARC402Registry reg3 = _deployReg("v3");
        wallet.proposeRegistryUpdate(address(reg2));
        vm.expectRevert("ARC402: upgrade already pending - cancel first");
        wallet.proposeRegistryUpdate(address(reg3));
    }
}
