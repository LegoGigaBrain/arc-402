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

    struct Agreement {
        uint256 id;
        address client;           // paying agent wallet
        address provider;         // delivering agent wallet
        string serviceType;       // e.g. "text-generation"
        string description;
        uint256 price;
        address token;            // ERC-20 address or address(0) for ETH
        uint256 deadline;         // unix timestamp
        bytes32 deliverablesHash; // keccak256 of expected deliverables spec
        Status status;
        uint256 createdAt;
        uint256 resolvedAt;
        // ─── v2 fields ───────────────────────────────────────────────────────
        uint256 verifyWindowEnd;  // nonzero when in PENDING_VERIFICATION; 0 = no verify window
        bytes32 committedHash;    // hash committed by provider via commitDeliverable()
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
    }

    // ─── Core Functions ──────────────────────────────────────────────────────

    /**
     * @notice Client proposes a service agreement, locking escrow
     * @param provider The agent wallet that will deliver the service
     * @param serviceType Short type tag (e.g. "text-generation")
     * @param description Human/agent-readable description
     * @param price Payment amount in wei (ETH) or token units
     * @param token ERC-20 token address, or address(0) for ETH
     * @param deadline Unix timestamp after which client may cancel if unfulfilled
     * @param deliverablesHash keccak256 of the expected deliverables spec
     * @return agreementId The new agreement's ID (starts at 1)
     */
    function propose(
        address provider,
        string calldata serviceType,
        string calldata description,
        uint256 price,
        address token,
        uint256 deadline,
        bytes32 deliverablesHash
    ) external payable returns (uint256 agreementId);

    /**
     * @notice Provider accepts a proposed agreement
     * @param agreementId The agreement to accept
     */
    function accept(uint256 agreementId) external;

    /**
     * @notice Provider marks the agreement fulfilled and claims escrow (immediate-release path)
     * @param agreementId The agreement to fulfill
     * @param actualDeliverablesHash keccak256 of what was actually delivered
     */
    function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external;

    /**
     * @notice Provider commits deliverable hash, starting the verification window.
     *         Moves status ACCEPTED → PENDING_VERIFICATION.
     *         Client has VERIFY_WINDOW to approve or dispute; after that anyone may autoRelease.
     * @param agreementId The agreement to commit
     * @param deliverableHash keccak256 of the delivered work
     */
    function commitDeliverable(uint256 agreementId, bytes32 deliverableHash) external;

    /**
     * @notice Client approves delivery and releases escrow to provider.
     *         Only callable while status is PENDING_VERIFICATION.
     * @param agreementId The agreement to verify
     */
    function verifyDeliverable(uint256 agreementId) external;

    /**
     * @notice If client does not act within VERIFY_WINDOW, anyone may trigger auto-release.
     * @param agreementId The agreement to auto-release
     */
    function autoRelease(uint256 agreementId) external;

    /**
     * @notice Client or provider raises a dispute (escrow stays locked).
     *         Valid from ACCEPTED or PENDING_VERIFICATION status.
     * @param agreementId The agreement to dispute
     * @param reason Human/agent-readable reason
     */
    function dispute(uint256 agreementId, string calldata reason) external;

    /**
     * @notice Client cancels a PROPOSED agreement and retrieves escrow
     * @param agreementId The agreement to cancel
     */
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

    function submitDisputeEvidence(
        uint256 agreementId,
        EvidenceType evidenceType,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external;

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

    /**
     * @notice Returns a full agreement struct
     * @param id The agreement ID
     */
    function getAgreement(uint256 id) external view returns (Agreement memory);
}
