// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IServiceAgreement.sol";
import "./IDisputeArbitration.sol";

/**
 * @title IDisputeModule
 * @notice Interface for the DisputeModule contract that holds all dispute/remediation/arbitration
 *         state and logic extracted from ServiceAgreement to reduce SA bytecode size.
 */
interface IDisputeModule {

    // ─── Result structs returned to SA ───────────────────────────────────────

    struct FinalizeResult {
        bool finalized;
        IServiceAgreement.Status newStatus;
        uint256 resolvedAt;
        uint256 providerAmount;
        uint256 clientAmount;
        bool providerWithFee;
        bool updateTrust;
        bool trustSuccess;
        IServiceAgreement.DisputeOutcome outcome;
    }

    struct RequestRevisionResult {
        uint8 cycleCount;
        bytes32 transcriptHash;
    }

    struct RespondResult {
        IServiceAgreement.Status newStatus;
        IServiceAgreement.ProviderResponseType responseType;
        bytes32 transcriptHash;
        bool needsDispute;
        uint8 cycleCount;
    }

    struct NominateResult {
        IServiceAgreement.Status newStatus;
        uint8 panelSize;
        bool panelComplete;
        uint256 selectionDeadlineAt;
        uint256 decisionDeadlineAt;
    }

    /// @dev Struct to avoid stack-too-deep on openFormalDispute.
    struct DisputeOpenParams {
        uint256 agreementId;
        address caller;
        IServiceAgreement.Status currentStatus;
        bool requireEligibility;
        IServiceAgreement.DirectDisputeReason directReason;
        IDisputeArbitration.DisputeMode daMode;
        IDisputeArbitration.DisputeClass daClass;
        address client;
        address provider;
        uint256 price;
        address token;
        uint256 deadline;
    }

    // ─── Functions ───────────────────────────────────────────────────────────

    function requestRevision(
        uint256 agreementId,
        address client,
        IServiceAgreement.Status currentStatus,
        bytes32 feedbackHash,
        string calldata feedbackURI,
        bytes32 previousTranscriptHash
    ) external returns (RequestRevisionResult memory);

    function respondToRevision(
        uint256 agreementId,
        address provider,
        uint256 price,
        IServiceAgreement.Status currentStatus,
        IServiceAgreement.ProviderResponseType responseType,
        uint256 proposedProviderPayout,
        bytes32 responseHash,
        string calldata responseURI,
        bytes32 previousTranscriptHash
    ) external returns (RespondResult memory);

    function openFormalDispute(DisputeOpenParams calldata p) external payable returns (uint256 newResolvedAt);

    function nominateArbitrator(
        uint256 agreementId,
        address nominator,
        address arbitrator,
        IServiceAgreement.Status currentStatus,
        address client,
        address provider
    ) external returns (NominateResult memory);

    function castArbitrationVote(
        uint256 agreementId,
        address voter,
        IServiceAgreement.Status currentStatus,
        uint256 price,
        IServiceAgreement.ArbitrationVote vote,
        uint256 providerAward,
        uint256 clientAward
    ) external returns (FinalizeResult memory);

    function requestHumanEscalation(
        uint256 agreementId,
        IServiceAgreement.Status currentStatus
    ) external;

    function submitDisputeEvidence(
        uint256 agreementId,
        address submitter,
        IServiceAgreement.Status currentStatus,
        IServiceAgreement.EvidenceType evidenceType,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external returns (uint256 evidenceIndex);

    function resolveDisputeDetailed(
        uint256 agreementId,
        IServiceAgreement.Status currentStatus,
        IServiceAgreement.DisputeOutcome outcome,
        uint256 providerAward,
        uint256 clientAward,
        uint256 price
    ) external returns (FinalizeResult memory);

    function ownerResolveDispute(
        uint256 agreementId,
        IServiceAgreement.Status currentStatus,
        bool favorProvider,
        uint256 price
    ) external returns (FinalizeResult memory);

    function expiredDisputeRefund(
        uint256 agreementId,
        IServiceAgreement.Status currentStatus,
        uint256 resolvedAt,
        uint256 price
    ) external returns (FinalizeResult memory);

    function closeRemediation(uint256 agreementId) external;

    function markDisputeResolved(uint256 agreementId) external;

    function canDirectDispute(
        IServiceAgreement.Status currentStatus,
        uint256 deadline,
        IServiceAgreement.DirectDisputeReason directReason
    ) external view returns (bool);

    // ─── View functions ──────────────────────────────────────────────────────

    function getRemediationCase(uint256 agreementId) external view returns (IServiceAgreement.RemediationCase memory);
    function getRemediationFeedback(uint256 agreementId, uint256 index) external view returns (IServiceAgreement.RemediationFeedback memory);
    function getRemediationResponse(uint256 agreementId, uint256 index) external view returns (IServiceAgreement.RemediationResponse memory);
    function getDisputeCase(uint256 agreementId) external view returns (IServiceAgreement.DisputeCase memory);
    function getDisputeEvidence(uint256 agreementId, uint256 index) external view returns (IServiceAgreement.DisputeEvidence memory);
    function getArbitrationCase(uint256 agreementId) external view returns (IServiceAgreement.ArbitrationCase memory);
    function disputeArbitratorNominated(uint256 agreementId, address arbitrator) external view returns (bool);
    function disputeArbitratorVoted(uint256 agreementId, address arbitrator) external view returns (bool);
}
