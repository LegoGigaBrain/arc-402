// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IServiceAgreement.sol";
import "./IDisputeModule.sol";
import "./IDisputeArbitration.sol";
import "./ITrustRegistry.sol";

/// @dev Minimal interface to read protocol config from ServiceAgreement.
interface ISAForDispute {
    function disputeArbitration() external view returns (address);
    function approvedArbitrators(address) external view returns (bool);
    function trustRegistry() external view returns (address);
    function minimumTrustValue() external view returns (uint256);
}

/// @title DisputeModule
/// @notice Holds all dispute/remediation/arbitration storage and logic,
///         extracted from ServiceAgreement to reduce SA bytecode size.
///         SA is the sole entry-point; DM is a trusted module (onlySA guards).
contract DisputeModule is IDisputeModule {

    address public immutable serviceAgreement;

    uint256 public constant REMEDIATION_WINDOW           = 24 hours;
    uint256 public constant DISPUTE_TIMEOUT              = 30 days;
    uint256 public constant ARBITRATION_SELECTION_WINDOW = 3 days;
    uint256 public constant ARBITRATION_DECISION_WINDOW  = 7 days;
    uint8   public constant MAX_REMEDIATION_CYCLES       = 2;
    uint8   public constant ARBITRATOR_PANEL_SIZE        = 3;
    uint8   public constant ARBITRATOR_MAJORITY          = 2;

    // ─── Storage ──────────────────────────────────────────────────────────────

    mapping(uint256 => IServiceAgreement.RemediationCase)       private _remediationCases;
    mapping(uint256 => IServiceAgreement.RemediationFeedback[]) private _remediationFeedbacks;
    mapping(uint256 => IServiceAgreement.RemediationResponse[]) private _remediationResponses;
    mapping(uint256 => IServiceAgreement.DisputeCase)           private _disputeCases;
    mapping(uint256 => IServiceAgreement.DisputeEvidence[])     private _disputeEvidence;
    mapping(uint256 => IServiceAgreement.ArbitrationCase)       private _arbitrationCases;
    mapping(uint256 => mapping(address => bool)) public disputeArbitratorNominated;
    mapping(uint256 => mapping(address => bool)) public disputeArbitratorVoted;
    mapping(uint256 => uint256) private _splitProviderVoteSum;
    mapping(uint256 => uint256) private _splitClientVoteSum;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotSA();
    error MaxRemediationCycles();
    error RemediationUnavailable();
    error RemediationWindowElapsed();
    error TranscriptChainMismatch();
    error NoRevisionRequested();
    error InvalidResponse();
    error RemediationInactive();
    error InvalidPayout();
    error InvalidStatus();
    error NoActiveDispute();
    error ArbitratorNotEligible();
    error ConflictedArbitrator();
    error ArbitrationSelectionClosed();
    error ArbitratorAlreadyNominated();
    error ArbitrationPanelFull();
    error PanelIncomplete();
    error NotPanelArbitrator();
    error VoteAlreadyCast();
    error ArbitrationDeadlinePassed();
    error InvalidVote();
    error InvalidVoteSplit();
    error ArbitrationStillActive();
    error HumanEscalationRequired();
    error HumanReviewNotRequested();
    error EvidenceRequired();
    error DisputeTimeoutNotReached();
    error RemediationFirst();
    error DirectDisputeNotAllowed();
    error ETHTransferFailed();
    error DisputeFeeError();
    error UnsupportedOutcome();

    event DisputeFeeCallFailed(uint256 indexed agreementId, bytes reason);
    event DisputeFeeResolutionFailed(uint256 indexed agreementId);

    modifier onlySA() {
        if (msg.sender != serviceAgreement) revert NotSA();
        _;
    }

    constructor(address _sa) {
        serviceAgreement = _sa;
    }

    // ─── Remediation ──────────────────────────────────────────────────────────

    function requestRevision(
        uint256 agreementId,
        address client,
        IServiceAgreement.Status currentStatus,
        bytes32 feedbackHash,
        string calldata feedbackURI,
        bytes32 previousTranscriptHash
    ) external onlySA returns (RequestRevisionResult memory result) {
        if (currentStatus == IServiceAgreement.Status.REVISION_REQUESTED) revert MaxRemediationCycles();
        if (
            currentStatus != IServiceAgreement.Status.ACCEPTED &&
            currentStatus != IServiceAgreement.Status.PENDING_VERIFICATION &&
            currentStatus != IServiceAgreement.Status.REVISED
        ) revert RemediationUnavailable();

        IServiceAgreement.RemediationCase storage rc = _remediationCases[agreementId];
        if (rc.active) {
            if (block.timestamp > rc.deadlineAt) revert RemediationWindowElapsed();
            if (rc.cycleCount >= MAX_REMEDIATION_CYCLES) revert MaxRemediationCycles();
            if (previousTranscriptHash != rc.latestTranscriptHash) revert TranscriptChainMismatch();
        } else {
            rc.openedAt   = block.timestamp;
            rc.deadlineAt = block.timestamp + REMEDIATION_WINDOW;
            rc.active     = true;
            if (previousTranscriptHash != bytes32(0)) revert TranscriptChainMismatch();
        }

        rc.cycleCount   += 1;
        rc.lastActionAt  = block.timestamp;
        bytes32 th = keccak256(abi.encodePacked(agreementId, rc.cycleCount, client, feedbackHash, bytes(feedbackURI), previousTranscriptHash));
        rc.latestTranscriptHash = th;

        _remediationFeedbacks[agreementId].push(IServiceAgreement.RemediationFeedback({
            cycle:                  rc.cycleCount,
            author:                 client,
            feedbackHash:           feedbackHash,
            feedbackURI:            feedbackURI,
            previousTranscriptHash: previousTranscriptHash,
            transcriptHash:         th,
            timestamp:              block.timestamp
        }));

        result.cycleCount     = rc.cycleCount;
        result.transcriptHash = th;
    }

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
    ) external onlySA returns (RespondResult memory result) {
        if (currentStatus != IServiceAgreement.Status.REVISION_REQUESTED) revert NoRevisionRequested();
        if (responseType == IServiceAgreement.ProviderResponseType.NONE) revert InvalidResponse();

        IServiceAgreement.RemediationCase storage rc = _remediationCases[agreementId];
        if (!rc.active) revert RemediationInactive();
        if (block.timestamp > rc.deadlineAt) revert RemediationWindowElapsed();
        if (previousTranscriptHash != rc.latestTranscriptHash) revert TranscriptChainMismatch();
        if (proposedProviderPayout > price) revert InvalidPayout();

        bytes32 th = keccak256(abi.encodePacked(agreementId, rc.cycleCount, provider, uint256(responseType), proposedProviderPayout, responseHash, bytes(responseURI), previousTranscriptHash));
        rc.lastActionAt         = block.timestamp;
        rc.latestTranscriptHash = th;

        _remediationResponses[agreementId].push(IServiceAgreement.RemediationResponse({
            cycle:                  rc.cycleCount,
            author:                 provider,
            responseType:           responseType,
            proposedProviderPayout: proposedProviderPayout,
            responseHash:           responseHash,
            responseURI:            responseURI,
            previousTranscriptHash: previousTranscriptHash,
            transcriptHash:         th,
            timestamp:              block.timestamp
        }));

        result.responseType   = responseType;
        result.transcriptHash = th;
        result.cycleCount     = rc.cycleCount;

        if (responseType == IServiceAgreement.ProviderResponseType.REVISE) {
            result.newStatus = IServiceAgreement.Status.REVISED;
        } else if (responseType == IServiceAgreement.ProviderResponseType.PARTIAL_SETTLEMENT) {
            result.newStatus = IServiceAgreement.Status.PARTIAL_SETTLEMENT;
        } else if (responseType == IServiceAgreement.ProviderResponseType.REQUEST_HUMAN_REVIEW) {
            result.newStatus = IServiceAgreement.Status.ESCALATED_TO_HUMAN;
            _ensureDisputeCase(agreementId, true);
        } else if (responseType == IServiceAgreement.ProviderResponseType.ESCALATE) {
            result.needsDispute = true;
            result.newStatus    = IServiceAgreement.Status.REVISION_REQUESTED; // placeholder
        } else {
            result.newStatus = IServiceAgreement.Status.REVISED;
        }
    }

    // ─── Dispute Opening ──────────────────────────────────────────────────────

    /// @notice Validate dispute, record state, and call DA.openDispute. Payable to forward fee.
    // slither-disable-next-line arbitrary-send-eth
    function openFormalDispute(DisputeOpenParams calldata p) external payable onlySA returns (uint256 newResolvedAt) {
        if (
            p.currentStatus != IServiceAgreement.Status.ACCEPTED &&
            p.currentStatus != IServiceAgreement.Status.PENDING_VERIFICATION &&
            p.currentStatus != IServiceAgreement.Status.REVISED &&
            p.currentStatus != IServiceAgreement.Status.REVISION_REQUESTED &&
            p.currentStatus != IServiceAgreement.Status.PARTIAL_SETTLEMENT &&
            p.currentStatus != IServiceAgreement.Status.ESCALATED_TO_HUMAN
        ) revert InvalidStatus();

        if (p.requireEligibility) {
            if (!_eligibleForEscalation(p.agreementId, p.currentStatus)) revert RemediationFirst();
        } else {
            if (!_canDirectDispute(p.currentStatus, block.timestamp, p.deadline, p.directReason)) revert DirectDisputeNotAllowed();
        }

        _ensureDisputeCase(p.agreementId, false);
        _disputeCases[p.agreementId].opener = p.caller;
        newResolvedAt = block.timestamp;

        address da = ISAForDispute(serviceAgreement).disputeArbitration();
        if (da != address(0)) {
            try IDisputeArbitration(da).openDispute{value: msg.value}(
                p.agreementId, p.daMode, p.daClass, p.caller, p.client, p.provider, p.price, p.token
            ) {} catch (bytes memory feeRevertData) {
                if (msg.value > 0) {
                    // slither-disable-next-line arbitrary-send-eth
                    (bool refunded, ) = p.caller.call{value: msg.value}("");
                    if (!refunded) revert ETHTransferFailed();
                }
                emit DisputeFeeCallFailed(p.agreementId, feeRevertData);
                revert DisputeFeeError();
            }
        }
    }

    // ─── Arbitration ──────────────────────────────────────────────────────────

    function nominateArbitrator(
        uint256 agreementId,
        address nominator,
        address arbitrator,
        IServiceAgreement.Status currentStatus,
        address client,
        address provider
    ) external onlySA returns (NominateResult memory result) {
        if (
            currentStatus != IServiceAgreement.Status.DISPUTED &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_ARBITRATION &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_HUMAN
        ) revert NoActiveDispute();

        address da = ISAForDispute(serviceAgreement).disputeArbitration();
        bool eligible = (da != address(0))
            ? IDisputeArbitration(da).isEligibleArbitrator(arbitrator)
            : ISAForDispute(serviceAgreement).approvedArbitrators(arbitrator);
        if (!eligible) revert ArbitratorNotEligible();
        if (arbitrator == client || arbitrator == provider) revert ConflictedArbitrator();

        IServiceAgreement.ArbitrationCase storage ac = _arbitrationCases[agreementId];
        if (ac.selectionDeadlineAt == 0) {
            ac.agreementId         = agreementId;
            ac.selectionDeadlineAt = block.timestamp + ARBITRATION_SELECTION_WINDOW;
        }
        if (block.timestamp > ac.selectionDeadlineAt) revert ArbitrationSelectionClosed();
        if (disputeArbitratorNominated[agreementId][arbitrator]) revert ArbitratorAlreadyNominated();
        if (ac.arbitratorCount >= ARBITRATOR_PANEL_SIZE) revert ArbitrationPanelFull();

        ac.arbitrators[ac.arbitratorCount] = arbitrator;
        ac.arbitratorCount += 1;
        disputeArbitratorNominated[agreementId][arbitrator] = true;

        result.newStatus           = IServiceAgreement.Status.ESCALATED_TO_ARBITRATION;
        result.panelSize           = ac.arbitratorCount;
        result.selectionDeadlineAt = ac.selectionDeadlineAt;

        if (ac.arbitratorCount == ARBITRATOR_PANEL_SIZE) {
            ac.decisionDeadlineAt      = block.timestamp + ARBITRATION_DECISION_WINDOW;
            result.panelComplete       = true;
            result.decisionDeadlineAt  = ac.decisionDeadlineAt;
        }
    }

    // wake-disable-next-line reentrancy
    function castArbitrationVote(
        uint256 agreementId,
        address voter,
        IServiceAgreement.Status currentStatus,
        uint256 price,
        IServiceAgreement.ArbitrationVote vote,
        uint256 providerAward,
        uint256 clientAward
    ) external onlySA returns (FinalizeResult memory result) {
        if (currentStatus != IServiceAgreement.Status.ESCALATED_TO_ARBITRATION) revert InvalidStatus();
        IServiceAgreement.ArbitrationCase storage ac = _arbitrationCases[agreementId];
        if (ac.arbitratorCount != ARBITRATOR_PANEL_SIZE) revert PanelIncomplete();
        if (!_isPanelArbitrator(ac, voter)) revert NotPanelArbitrator();
        if (disputeArbitratorVoted[agreementId][voter]) revert VoteAlreadyCast();
        if (block.timestamp > ac.decisionDeadlineAt) revert ArbitrationDeadlinePassed();
        if (vote == IServiceAgreement.ArbitrationVote.NONE) revert InvalidVote();

        disputeArbitratorVoted[agreementId][voter] = true;

        address da = ISAForDispute(serviceAgreement).disputeArbitration();
        if (da != address(0)) {
            IDisputeArbitration(da).recordArbitratorVote(agreementId, voter);
        }

        if (vote == IServiceAgreement.ArbitrationVote.PROVIDER_WINS) {
            if (providerAward != price || clientAward != 0) revert InvalidVoteSplit();
            ac.providerVotes += 1;
        } else if (vote == IServiceAgreement.ArbitrationVote.CLIENT_REFUND) {
            if (providerAward != 0 || clientAward != price) revert InvalidVoteSplit();
            ac.clientVotes += 1;
        } else if (vote == IServiceAgreement.ArbitrationVote.SPLIT) {
            if (providerAward + clientAward != price) revert InvalidVoteSplit();
            _splitProviderVoteSum[agreementId] += providerAward;
            _splitClientVoteSum[agreementId]   += clientAward;
            ac.splitVotes += 1;
        } else if (vote == IServiceAgreement.ArbitrationVote.HUMAN_REVIEW_REQUIRED) {
            if (providerAward != 0 || clientAward != 0) revert InvalidVoteSplit();
            ac.humanVotes += 1;
        }

        if (ac.providerVotes >= ARBITRATOR_MAJORITY) {
            result = _buildFinalizeResult(agreementId, IServiceAgreement.DisputeOutcome.PROVIDER_WINS, price, 0, false);
        } else if (ac.clientVotes >= ARBITRATOR_MAJORITY) {
            result = _buildFinalizeResult(agreementId, IServiceAgreement.DisputeOutcome.CLIENT_REFUND, 0, price, false);
        } else if (ac.splitVotes >= ARBITRATOR_MAJORITY) {
            uint256 avgProvider = _splitProviderVoteSum[agreementId] / ac.splitVotes;
            uint256 avgClient   = price - avgProvider;
            ac.splitProviderAward = avgProvider;
            ac.splitClientAward   = avgClient;
            result = _buildFinalizeResult(agreementId, IServiceAgreement.DisputeOutcome.PARTIAL_PROVIDER, avgProvider, avgClient, false);
        } else if (ac.humanVotes >= ARBITRATOR_MAJORITY) {
            _markHumanEscalation(agreementId);
            result.finalized = false;
            result.newStatus = IServiceAgreement.Status.ESCALATED_TO_HUMAN;
        }
    }

    function requestHumanEscalation(
        uint256 agreementId,
        IServiceAgreement.Status currentStatus
    ) external onlySA {
        if (
            currentStatus != IServiceAgreement.Status.DISPUTED &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_ARBITRATION &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_HUMAN
        ) revert NoActiveDispute();

        IServiceAgreement.ArbitrationCase storage ac = _arbitrationCases[agreementId];
        bool stalled =
            (ac.selectionDeadlineAt != 0 && ac.arbitratorCount < ARBITRATOR_PANEL_SIZE && block.timestamp > ac.selectionDeadlineAt) ||
            (ac.decisionDeadlineAt  != 0 && block.timestamp > ac.decisionDeadlineAt);
        if (!stalled && currentStatus != IServiceAgreement.Status.ESCALATED_TO_HUMAN) revert ArbitrationStillActive();
        _markHumanEscalation(agreementId);
    }

    function submitDisputeEvidence(
        uint256 agreementId,
        address submitter,
        IServiceAgreement.Status currentStatus,
        IServiceAgreement.EvidenceType evidenceType,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external onlySA returns (uint256 evidenceIndex) {
        if (
            currentStatus != IServiceAgreement.Status.DISPUTED &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_HUMAN &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_ARBITRATION
        ) revert NoActiveDispute();

        _disputeEvidence[agreementId].push(IServiceAgreement.DisputeEvidence({
            submitter:    submitter,
            evidenceType: evidenceType,
            evidenceHash: evidenceHash,
            evidenceURI:  evidenceURI,
            timestamp:    block.timestamp
        }));
        _disputeCases[agreementId].evidenceCount = _disputeEvidence[agreementId].length;
        evidenceIndex = _disputeEvidence[agreementId].length - 1;
    }

    function resolveDisputeDetailed(
        uint256 agreementId,
        IServiceAgreement.Status currentStatus,
        IServiceAgreement.DisputeOutcome outcome,
        uint256 providerAward,
        uint256 clientAward,
        uint256 price
    ) external onlySA returns (FinalizeResult memory) {
        if (
            currentStatus != IServiceAgreement.Status.DISPUTED &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_HUMAN &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_ARBITRATION
        ) revert HumanEscalationRequired();
        if (currentStatus == IServiceAgreement.Status.ESCALATED_TO_HUMAN) {
            if (!_disputeCases[agreementId].humanReviewRequested) revert HumanReviewNotRequested();
            if (_disputeEvidence[agreementId].length == 0) revert EvidenceRequired();
        }
        return _buildFinalizeResult(agreementId, outcome, providerAward, clientAward, true);
    }

    function ownerResolveDispute(
        uint256 agreementId,
        IServiceAgreement.Status currentStatus,
        bool favorProvider,
        uint256 price
    ) external onlySA returns (FinalizeResult memory) {
        if (
            currentStatus != IServiceAgreement.Status.DISPUTED &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_HUMAN &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_ARBITRATION
        ) revert InvalidStatus();
        IServiceAgreement.DisputeOutcome outcome = favorProvider
            ? IServiceAgreement.DisputeOutcome.PROVIDER_WINS
            : IServiceAgreement.DisputeOutcome.CLIENT_REFUND;
        return _buildFinalizeResult(
            agreementId, outcome,
            favorProvider ? price : 0,
            favorProvider ? 0 : price,
            false
        );
    }

    function expiredDisputeRefund(
        uint256 agreementId,
        IServiceAgreement.Status currentStatus,
        uint256 resolvedAt,
        uint256 price
    ) external onlySA returns (FinalizeResult memory result) {
        if (
            currentStatus != IServiceAgreement.Status.DISPUTED &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_HUMAN &&
            currentStatus != IServiceAgreement.Status.ESCALATED_TO_ARBITRATION
        ) revert InvalidStatus();
        // slither-disable-next-line timestamp
        if (block.timestamp <= resolvedAt + DISPUTE_TIMEOUT) revert DisputeTimeoutNotReached();

        _closeRemediationInternal(agreementId);

        result.finalized    = true;
        result.newStatus    = IServiceAgreement.Status.CANCELLED;
        result.resolvedAt   = block.timestamp;
        result.clientAmount = price;
        result.outcome      = IServiceAgreement.DisputeOutcome.CLIENT_REFUND;
        _callResolveDisputeFee(agreementId, uint8(IServiceAgreement.DisputeOutcome.CLIENT_REFUND));
    }

    function closeRemediation(uint256 agreementId) external onlySA {
        _closeRemediationInternal(agreementId);
    }

    function markDisputeResolved(uint256 agreementId) external onlySA {
        IServiceAgreement.DisputeCase storage dc = _disputeCases[agreementId];
        if (dc.openedAt != 0) {
            dc.responseDeadlineAt = block.timestamp;
        }
        _arbitrationCases[agreementId].finalized = true;
        _closeRemediationInternal(agreementId);
    }

    function canDirectDispute(
        IServiceAgreement.Status currentStatus,
        uint256 deadline,
        IServiceAgreement.DirectDisputeReason directReason
    ) external view returns (bool) {
        return _canDirectDispute(currentStatus, block.timestamp, deadline, directReason);
    }

    // wake-disable-next-line reentrancy
    function handleTrustUpdate(
        uint256 agreementId,
        address provider,
        address client,
        string calldata serviceType,
        uint256 price,
        bool success
    ) external onlySA {
        address tr = ISAForDispute(serviceAgreement).trustRegistry();
        if (tr == address(0)) return;
        if (success) {
            uint256 minTrust = ISAForDispute(serviceAgreement).minimumTrustValue();
            if (minTrust == 0 || price >= minTrust) {
                try ITrustRegistry(tr).recordSuccess(provider, client, serviceType, price) {} catch {}
            }
        } else {
            try ITrustRegistry(tr).recordAnomaly(provider, client, serviceType, price) {} catch {}
        }
    }

    // ─── View functions ──────────────────────────────────────────────────────

    function getRemediationCase(uint256 agreementId) external view returns (IServiceAgreement.RemediationCase memory) {
        return _remediationCases[agreementId];
    }

    function getRemediationFeedback(uint256 agreementId, uint256 index) external view returns (IServiceAgreement.RemediationFeedback memory) {
        return _remediationFeedbacks[agreementId][index];
    }

    function getRemediationResponse(uint256 agreementId, uint256 index) external view returns (IServiceAgreement.RemediationResponse memory) {
        return _remediationResponses[agreementId][index];
    }

    function getDisputeCase(uint256 agreementId) external view returns (IServiceAgreement.DisputeCase memory) {
        return _disputeCases[agreementId];
    }

    function getDisputeEvidence(uint256 agreementId, uint256 index) external view returns (IServiceAgreement.DisputeEvidence memory) {
        return _disputeEvidence[agreementId][index];
    }

    function getArbitrationCase(uint256 agreementId) external view returns (IServiceAgreement.ArbitrationCase memory) {
        return _arbitrationCases[agreementId];
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _ensureDisputeCase(uint256 agreementId, bool humanReviewRequested) internal {
        IServiceAgreement.DisputeCase storage dc = _disputeCases[agreementId];
        if (dc.openedAt == 0) {
            dc.agreementId          = agreementId;
            dc.openedAt             = block.timestamp;
            dc.responseDeadlineAt   = block.timestamp + DISPUTE_TIMEOUT;
            dc.outcome              = IServiceAgreement.DisputeOutcome.PENDING;
            dc.humanReviewRequested = humanReviewRequested;
            dc.evidenceCount        = _disputeEvidence[agreementId].length;
        } else if (humanReviewRequested) {
            dc.humanReviewRequested = true;
        }
    }

    function _markHumanEscalation(uint256 agreementId) internal {
        _ensureDisputeCase(agreementId, true);
    }

    function _closeRemediationInternal(uint256 agreementId) internal {
        if (_remediationCases[agreementId].active) {
            _remediationCases[agreementId].active = false;
        }
    }

    function _eligibleForEscalation(uint256 agreementId, IServiceAgreement.Status currentStatus) internal view returns (bool) {
        if (currentStatus == IServiceAgreement.Status.ESCALATED_TO_HUMAN ||
            currentStatus == IServiceAgreement.Status.PARTIAL_SETTLEMENT) return true;
        IServiceAgreement.RemediationCase storage rc = _remediationCases[agreementId];
        if (!rc.active) return false;
        if (block.timestamp > rc.deadlineAt) return true;
        if (rc.cycleCount >= MAX_REMEDIATION_CYCLES) return true;
        return false;
    }

    function _canDirectDispute(
        IServiceAgreement.Status currentStatus,
        uint256 currentTime,
        uint256 deadline,
        IServiceAgreement.DirectDisputeReason directReason
    ) internal pure returns (bool) {
        if (directReason == IServiceAgreement.DirectDisputeReason.NO_DELIVERY) {
            return currentStatus == IServiceAgreement.Status.ACCEPTED && currentTime > deadline;
        }
        if (directReason == IServiceAgreement.DirectDisputeReason.HARD_DEADLINE_BREACH) {
            return currentTime > deadline;
        }
        if (directReason == IServiceAgreement.DirectDisputeReason.INVALID_OR_FRAUDULENT_DELIVERABLE) {
            return currentStatus == IServiceAgreement.Status.PENDING_VERIFICATION;
        }
        if (directReason == IServiceAgreement.DirectDisputeReason.SAFETY_CRITICAL_VIOLATION) {
            return currentStatus == IServiceAgreement.Status.ACCEPTED ||
                   currentStatus == IServiceAgreement.Status.PENDING_VERIFICATION ||
                   currentStatus == IServiceAgreement.Status.REVISED ||
                   currentStatus == IServiceAgreement.Status.REVISION_REQUESTED;
        }
        return false;
    }

    function _isPanelArbitrator(IServiceAgreement.ArbitrationCase storage ac, address arbitrator) internal view returns (bool) {
        for (uint256 i = 0; i < ac.arbitratorCount; i++) {
            if (ac.arbitrators[i] == arbitrator) return true;
        }
        return false;
    }

    function _buildFinalizeResult(
        uint256 agreementId,
        IServiceAgreement.DisputeOutcome outcome,
        uint256 providerAward,
        uint256 clientAward,
        bool humanBackstopUsed
    ) internal returns (FinalizeResult memory result) {
        IServiceAgreement.DisputeCase storage dc = _disputeCases[agreementId];
        if (dc.openedAt == 0) {
            _ensureDisputeCase(agreementId, false);
        }
        dc.outcome            = outcome;
        dc.providerAward      = providerAward;
        dc.clientAward        = clientAward;
        dc.responseDeadlineAt = block.timestamp;

        IServiceAgreement.ArbitrationCase storage ac = _arbitrationCases[agreementId];
        ac.finalized         = outcome != IServiceAgreement.DisputeOutcome.HUMAN_REVIEW_REQUIRED;
        ac.humanBackstopUsed = humanBackstopUsed;

        _closeRemediationInternal(agreementId);

        result.finalized  = true;
        result.resolvedAt = block.timestamp;
        result.outcome    = outcome;
        _callResolveDisputeFee(agreementId, uint8(outcome));

        if (outcome == IServiceAgreement.DisputeOutcome.PROVIDER_WINS) {
            result.newStatus      = IServiceAgreement.Status.FULFILLED;
            result.providerAmount = providerAward;
            result.updateTrust    = true;
            result.trustSuccess   = true;
        } else if (outcome == IServiceAgreement.DisputeOutcome.CLIENT_REFUND) {
            result.newStatus      = IServiceAgreement.Status.CANCELLED;
            result.clientAmount   = clientAward;
            result.updateTrust    = true;
        } else if (outcome == IServiceAgreement.DisputeOutcome.PARTIAL_PROVIDER ||
                   outcome == IServiceAgreement.DisputeOutcome.PARTIAL_CLIENT) {
            result.newStatus       = IServiceAgreement.Status.FULFILLED;
            result.providerAmount  = providerAward;
            result.clientAmount    = clientAward;
            result.providerWithFee = true;
        } else if (outcome == IServiceAgreement.DisputeOutcome.MUTUAL_CANCEL) {
            result.newStatus      = IServiceAgreement.Status.MUTUAL_CANCEL;
            result.providerAmount = providerAward;
            result.clientAmount   = clientAward;
        } else if (outcome == IServiceAgreement.DisputeOutcome.HUMAN_REVIEW_REQUIRED) {
            _markHumanEscalation(agreementId);
            result.finalized = false;
            result.newStatus = IServiceAgreement.Status.ESCALATED_TO_HUMAN;
        } else {
            revert UnsupportedOutcome();
        }
    }

    function _callResolveDisputeFee(uint256 agreementId, uint8 outcome) internal {
        address da = ISAForDispute(serviceAgreement).disputeArbitration();
        if (da != address(0)) {
            try IDisputeArbitration(da).resolveDisputeFee(agreementId, outcome) {} catch {
                emit DisputeFeeResolutionFailed(agreementId);
            }
        }
    }

}
