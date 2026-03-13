// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IServiceAgreement
 * @notice Interface for bilateral agent-to-agent service agreements in ARC-402
 * STATUS: DRAFT — not audited, do not use in production
 */
interface IServiceAgreement {

    // ─── Types ───────────────────────────────────────────────────────────────

    enum Status {
        PROPOSED,
        ACCEPTED,
        PENDING_VERIFICATION,
        FULFILLED,
        DISPUTED,
        CANCELLED,
        REVISION_REQUESTED,
        REVISED,
        PARTIAL_SETTLEMENT,
        MUTUAL_CANCEL,
        ESCALATED_TO_HUMAN,
        ESCALATED_TO_ARBITRATION
    }

    enum ProviderResponseType {
        NONE,
        REVISE,
        DEFEND,
        COUNTER,
        PARTIAL_SETTLEMENT,
        REQUEST_HUMAN_REVIEW,
        ESCALATE
    }

    enum DisputeOutcome {
        NONE,
        PENDING,
        PROVIDER_WINS,
        CLIENT_REFUND,
        PARTIAL_PROVIDER,
        PARTIAL_CLIENT,
        MUTUAL_CANCEL,
        HUMAN_REVIEW_REQUIRED
    }

    enum EvidenceType {
        NONE,
        TRANSCRIPT,
        DELIVERABLE,
        ACCEPTANCE_CRITERIA,
        COMMUNICATION,
        EXTERNAL_REFERENCE,
        OTHER
    }

    enum DirectDisputeReason {
        NONE,
        NO_DELIVERY,
        HARD_DEADLINE_BREACH,
        INVALID_OR_FRAUDULENT_DELIVERABLE,
        SAFETY_CRITICAL_VIOLATION
    }

    enum ArbitrationVote {
        NONE,
        PROVIDER_WINS,
        CLIENT_REFUND,
        SPLIT,
        HUMAN_REVIEW_REQUIRED
    }

    enum DisputeMode {
        UNILATERAL, // opener pays full fee; win = 50% refund, lose = consumed
        MUTUAL      // each party pays 50%; no winner reimbursement
    }

    enum DisputeClass {
        HARD_FAILURE,      // 1.0x fee multiplier
        AMBIGUITY_QUALITY, // 1.25x fee multiplier
        HIGH_SENSITIVITY   // 1.5x fee multiplier
    }

    struct Agreement {
        uint256 id;
        address client;
        address provider;
        string serviceType;
        string description;
        uint256 price;
        address token;
        uint256 deadline;
        bytes32 deliverablesHash;
        Status status;
        uint256 createdAt;
        uint256 resolvedAt;
        uint256 verifyWindowEnd;
        bytes32 committedHash;
    }

    struct RemediationCase {
        uint8 cycleCount;
        uint256 openedAt;
        uint256 deadlineAt;
        uint256 lastActionAt;
        bytes32 latestTranscriptHash;
        bool active;
    }

    struct RemediationFeedback {
        uint8 cycle;
        address author;
        bytes32 feedbackHash;
        string feedbackURI;
        bytes32 previousTranscriptHash;
        bytes32 transcriptHash;
        uint256 timestamp;
    }

    struct RemediationResponse {
        uint8 cycle;
        address author;
        ProviderResponseType responseType;
        uint256 proposedProviderPayout;
        bytes32 responseHash;
        string responseURI;
        bytes32 previousTranscriptHash;
        bytes32 transcriptHash;
        uint256 timestamp;
    }

    struct DisputeEvidence {
        address submitter;
        EvidenceType evidenceType;
        bytes32 evidenceHash;
        string evidenceURI;
        uint256 timestamp;
    }

    struct DisputeCase {
        uint256 agreementId;
        uint256 openedAt;
        uint256 responseDeadlineAt;
        DisputeOutcome outcome;
        uint256 providerAward;
        uint256 clientAward;
        bool humanReviewRequested;
        uint256 evidenceCount;
        address opener; // party who initiated the dispute
    }

    struct ArbitrationCase {
        uint256 agreementId;
        address[3] arbitrators;
        uint8 arbitratorCount;
        uint8 providerVotes;
        uint8 clientVotes;
        uint8 splitVotes;
        uint8 humanVotes;
        uint256 selectionDeadlineAt;
        uint256 decisionDeadlineAt;
        uint256 splitProviderAward;
        uint256 splitClientAward;
        bool finalized;
        bool humanBackstopUsed;
    }

    // ─── Core Functions ──────────────────────────────────────────────────────

    function propose(
        address provider,
        string calldata serviceType,
        string calldata description,
        uint256 price,
        address token,
        uint256 deadline,
        bytes32 deliverablesHash
    ) external payable returns (uint256 agreementId);

    function accept(uint256 agreementId) external;
    function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external;
    function commitDeliverable(uint256 agreementId, bytes32 deliverableHash) external;
    function verifyDeliverable(uint256 agreementId) external;
    function autoRelease(uint256 agreementId) external;
    function dispute(uint256 agreementId, string calldata reason) external;
    function directDispute(uint256 agreementId, DirectDisputeReason directReason, string calldata reason) external;
    function cancel(uint256 agreementId) external;

    function requestRevision(
        uint256 agreementId,
        bytes32 feedbackHash,
        string calldata feedbackURI,
        bytes32 previousTranscriptHash
    ) external;

    function respondToRevision(
        uint256 agreementId,
        ProviderResponseType responseType,
        uint256 proposedProviderPayout,
        bytes32 responseHash,
        string calldata responseURI,
        bytes32 previousTranscriptHash
    ) external;

    function escalateToDispute(uint256 agreementId, string calldata reason) external;
    function canDirectDispute(uint256 agreementId, DirectDisputeReason directReason) external view returns (bool);

    function submitDisputeEvidence(
        uint256 agreementId,
        EvidenceType evidenceType,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external;

    function nominateArbitrator(uint256 agreementId, address arbitrator) external;
    function castArbitrationVote(
        uint256 agreementId,
        ArbitrationVote vote,
        uint256 providerAward,
        uint256 clientAward
    ) external;
    function requestHumanEscalation(uint256 agreementId, string calldata reason) external;

    function resolveDisputeDetailed(
        uint256 agreementId,
        DisputeOutcome outcome,
        uint256 providerAward,
        uint256 clientAward
    ) external;

    function getRemediationCase(uint256 agreementId) external view returns (RemediationCase memory);
    function getRemediationFeedback(uint256 agreementId, uint256 index) external view returns (RemediationFeedback memory);
    function getRemediationResponse(uint256 agreementId, uint256 index) external view returns (RemediationResponse memory);
    function getDisputeCase(uint256 agreementId) external view returns (DisputeCase memory);
    function getDisputeEvidence(uint256 agreementId, uint256 index) external view returns (DisputeEvidence memory);
    function getArbitrationCase(uint256 agreementId) external view returns (ArbitrationCase memory);
    function getAgreement(uint256 id) external view returns (Agreement memory);
}
