// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IServiceAgreement.sol";
import "./ITrustRegistry.sol";
import "./ReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ServiceAgreement is IServiceAgreement, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public owner;
    address public pendingOwner;
    ReputationOracle public reputationOracle;
    address public immutable trustRegistry;

    address public constant ETH = address(0);
    uint256 public constant VERIFY_WINDOW = 3 days;
    uint256 public constant DISPUTE_TIMEOUT = 30 days;
    uint256 public constant REMEDIATION_WINDOW = 24 hours;
    uint8 public constant MAX_REMEDIATION_CYCLES = 2;

    mapping(address => bool) public allowedTokens;
    mapping(address => bool) public legacyFulfillProviders;
    bool public legacyFulfillEnabled;
    uint256 public minimumTrustValue;
    uint256 private _nextId;

    mapping(uint256 => Agreement) private _agreements;
    mapping(address => uint256[]) private _byClient;
    mapping(address => uint256[]) private _byProvider;

    mapping(uint256 => RemediationCase) private _remediationCases;
    mapping(uint256 => RemediationFeedback[]) private _remediationFeedbacks;
    mapping(uint256 => RemediationResponse[]) private _remediationResponses;
    mapping(uint256 => DisputeCase) private _disputeCases;
    mapping(uint256 => DisputeEvidence[]) private _disputeEvidence;

    event AgreementProposed(uint256 indexed id, address indexed client, address indexed provider, string serviceType, uint256 price, address token, uint256 deadline);
    event AgreementAccepted(uint256 indexed id, address indexed provider);
    event AgreementFulfilled(uint256 indexed id, address indexed provider, bytes32 deliverablesHash);
    event AgreementDisputed(uint256 indexed id, address indexed initiator, string reason);
    event AgreementCancelled(uint256 indexed id, address indexed client);
    event DisputeResolved(uint256 indexed id, bool favorProvider);
    event DisputeTimedOut(uint256 indexed id, address indexed beneficiary);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event TokenAllowed(address indexed token);
    event TokenDisallowed(address indexed token);
    event TrustUpdateFailed(uint256 indexed agreementId, address indexed wallet, string context);
    event MinimumTrustValueUpdated(uint256 newValue);
    event LegacyFulfillModeUpdated(bool enabled);
    event LegacyFulfillProviderUpdated(address indexed provider, bool allowed);
    event ReputationOracleUpdated(address indexed oracle);
    event DeliverableCommitted(uint256 indexed id, address indexed provider, bytes32 hash, uint256 verifyWindowEnd);
    event AutoReleased(uint256 indexed id, address indexed provider);
    event RevisionRequested(uint256 indexed id, uint8 indexed cycle, address indexed client, bytes32 transcriptHash);
    event RevisionResponded(uint256 indexed id, uint8 indexed cycle, address indexed provider, ProviderResponseType responseType, bytes32 transcriptHash);
    event DisputeEvidenceSubmitted(uint256 indexed id, uint256 indexed evidenceIndex, address indexed submitter, EvidenceType evidenceType, bytes32 evidenceHash);
    event DetailedDisputeResolved(uint256 indexed id, DisputeOutcome outcome, uint256 providerAward, uint256 clientAward);

    modifier onlyOwner() {
        require(msg.sender == owner, "ServiceAgreement: not owner");
        _;
    }

    constructor(address _trustRegistry) {
        owner = msg.sender;
        trustRegistry = _trustRegistry;
        allowedTokens[address(0)] = true;
        emit TokenAllowed(address(0));
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ServiceAgreement: zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "ServiceAgreement: not pending owner");
        address old = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(old, owner);
    }

    function allowToken(address token) external onlyOwner {
        allowedTokens[token] = true;
        emit TokenAllowed(token);
    }

    function disallowToken(address token) external onlyOwner {
        allowedTokens[token] = false;
        emit TokenDisallowed(token);
    }

    function setMinimumTrustValue(uint256 value) external onlyOwner {
        minimumTrustValue = value;
        emit MinimumTrustValueUpdated(value);
    }

    function setLegacyFulfillMode(bool enabled) external onlyOwner {
        legacyFulfillEnabled = enabled;
        emit LegacyFulfillModeUpdated(enabled);
    }

    function setLegacyFulfillProvider(address provider, bool allowed) external onlyOwner {
        legacyFulfillProviders[provider] = allowed;
        emit LegacyFulfillProviderUpdated(provider, allowed);
    }

    function setReputationOracle(address oracle) external onlyOwner {
        reputationOracle = ReputationOracle(oracle);
        emit ReputationOracleUpdated(oracle);
    }

    function propose(address provider, string calldata serviceType, string calldata description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash) external payable nonReentrant returns (uint256 agreementId) {
        require(bytes(serviceType).length <= 64, "ServiceAgreement: serviceType too long");
        require(bytes(description).length <= 1024, "ServiceAgreement: description too long");
        require(provider != address(0), "ServiceAgreement: zero provider");
        require(provider != msg.sender, "ServiceAgreement: client == provider");
        require(price > 0, "ServiceAgreement: zero price");
        require(deadline > block.timestamp, "ServiceAgreement: deadline in past");
        require(allowedTokens[token], "ServiceAgreement: token not allowed");

        if (token == address(0)) {
            require(msg.value == price, "ServiceAgreement: ETH value != price");
        } else {
            require(msg.value == 0, "ServiceAgreement: ETH sent with ERC-20 agreement");
            IERC20(token).safeTransferFrom(msg.sender, address(this), price);
        }

        unchecked { _nextId++; }
        agreementId = _nextId;
        _agreements[agreementId] = Agreement({
            id: agreementId,
            client: msg.sender,
            provider: provider,
            serviceType: serviceType,
            description: description,
            price: price,
            token: token,
            deadline: deadline,
            deliverablesHash: deliverablesHash,
            status: Status.PROPOSED,
            createdAt: block.timestamp,
            resolvedAt: 0,
            verifyWindowEnd: 0,
            committedHash: bytes32(0)
        });
        _byClient[msg.sender].push(agreementId);
        _byProvider[provider].push(agreementId);
        emit AgreementProposed(agreementId, msg.sender, provider, serviceType, price, token, deadline);
    }

    function accept(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.provider, "ServiceAgreement: not provider");
        require(ag.status == Status.PROPOSED, "ServiceAgreement: not PROPOSED");
        ag.status = Status.ACCEPTED;
        emit AgreementAccepted(agreementId, msg.sender);
    }

    function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.provider, "ServiceAgreement: not provider");
        require(legacyFulfillEnabled, "ServiceAgreement: legacy fulfill disabled");
        require(legacyFulfillProviders[msg.sender], "ServiceAgreement: provider not legacy trusted");
        require(ag.status == Status.ACCEPTED || ag.status == Status.REVISED, "ServiceAgreement: not ACCEPTED");
        require(block.timestamp <= ag.deadline, "ServiceAgreement: past deadline");
        _closeRemediation(agreementId);
        ag.status = Status.FULFILLED;
        ag.resolvedAt = block.timestamp;
        ag.deliverablesHash = actualDeliverablesHash;
        emit AgreementFulfilled(agreementId, msg.sender, actualDeliverablesHash);
        _releaseEscrow(ag.token, ag.provider, ag.price);
        _updateTrust(agreementId, ag, true);
    }

    function commitDeliverable(uint256 agreementId, bytes32 deliverableHash) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.provider, "ServiceAgreement: not provider");
        require(ag.status == Status.ACCEPTED || ag.status == Status.REVISED, "ServiceAgreement: not ACCEPTED");
        require(block.timestamp <= ag.deadline, "ServiceAgreement: past deadline");
        _closeRemediation(agreementId);
        ag.status = Status.PENDING_VERIFICATION;
        ag.committedHash = deliverableHash;
        ag.verifyWindowEnd = block.timestamp + VERIFY_WINDOW;
        ag.deliverablesHash = deliverableHash;
        emit DeliverableCommitted(agreementId, msg.sender, deliverableHash, ag.verifyWindowEnd);
    }

    function verifyDeliverable(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.client, "ServiceAgreement: not client");
        require(ag.status == Status.PENDING_VERIFICATION, "ServiceAgreement: not PENDING_VERIFICATION");
        _closeRemediation(agreementId);
        ag.status = Status.FULFILLED;
        ag.resolvedAt = block.timestamp;
        emit AgreementFulfilled(agreementId, ag.provider, ag.committedHash);
        _releaseEscrow(ag.token, ag.provider, ag.price);
        _updateTrust(agreementId, ag, true);
    }

    function autoRelease(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(ag.status == Status.PENDING_VERIFICATION, "ServiceAgreement: not PENDING_VERIFICATION");
        require(block.timestamp > ag.verifyWindowEnd, "ServiceAgreement: verify window open");
        _closeRemediation(agreementId);
        ag.status = Status.FULFILLED;
        ag.resolvedAt = block.timestamp;
        emit AgreementFulfilled(agreementId, ag.provider, ag.committedHash);
        emit AutoReleased(agreementId, ag.provider);
        _releaseEscrow(ag.token, ag.provider, ag.price);
        _updateTrust(agreementId, ag, true);
    }

    function dispute(uint256 agreementId, string calldata reason) external {
        _openFormalDispute(agreementId, reason, false);
    }

    function requestRevision(uint256 agreementId, bytes32 feedbackHash, string calldata feedbackURI, bytes32 previousTranscriptHash) external {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.client, "ServiceAgreement: not client");
        require(ag.status != Status.REVISION_REQUESTED, "ServiceAgreement: max remediation cycles");
        require(
            ag.status == Status.ACCEPTED ||
            ag.status == Status.PENDING_VERIFICATION ||
            ag.status == Status.REVISED,
            "ServiceAgreement: remediation unavailable"
        );

        RemediationCase storage rc = _remediationCases[agreementId];
        if (rc.active) {
            require(block.timestamp <= rc.deadlineAt, "ServiceAgreement: remediation window elapsed");
            require(rc.cycleCount < MAX_REMEDIATION_CYCLES, "ServiceAgreement: max remediation cycles");
            require(previousTranscriptHash == rc.latestTranscriptHash, "ServiceAgreement: transcript chain mismatch");
        } else {
            rc.openedAt = block.timestamp;
            rc.deadlineAt = block.timestamp + REMEDIATION_WINDOW;
            rc.active = true;
            require(previousTranscriptHash == bytes32(0), "ServiceAgreement: transcript chain mismatch");
        }

        rc.cycleCount += 1;
        rc.lastActionAt = block.timestamp;
        bytes32 transcriptHash = keccak256(abi.encodePacked(agreementId, rc.cycleCount, msg.sender, feedbackHash, bytes(feedbackURI), previousTranscriptHash));
        rc.latestTranscriptHash = transcriptHash;

        _remediationFeedbacks[agreementId].push(RemediationFeedback({
            cycle: rc.cycleCount,
            author: msg.sender,
            feedbackHash: feedbackHash,
            feedbackURI: feedbackURI,
            previousTranscriptHash: previousTranscriptHash,
            transcriptHash: transcriptHash,
            timestamp: block.timestamp
        }));

        ag.status = Status.REVISION_REQUESTED;
        emit RevisionRequested(agreementId, rc.cycleCount, msg.sender, transcriptHash);
    }

    function respondToRevision(uint256 agreementId, ProviderResponseType responseType, uint256 proposedProviderPayout, bytes32 responseHash, string calldata responseURI, bytes32 previousTranscriptHash) external {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.provider, "ServiceAgreement: not provider");
        require(ag.status == Status.REVISION_REQUESTED, "ServiceAgreement: no revision requested");
        require(responseType != ProviderResponseType.NONE, "ServiceAgreement: invalid response");

        RemediationCase storage rc = _remediationCases[agreementId];
        require(rc.active, "ServiceAgreement: remediation inactive");
        require(block.timestamp <= rc.deadlineAt, "ServiceAgreement: remediation window elapsed");
        require(previousTranscriptHash == rc.latestTranscriptHash, "ServiceAgreement: transcript chain mismatch");
        require(proposedProviderPayout <= ag.price, "ServiceAgreement: invalid payout");

        bytes32 transcriptHash = keccak256(abi.encodePacked(agreementId, rc.cycleCount, msg.sender, uint256(responseType), proposedProviderPayout, responseHash, bytes(responseURI), previousTranscriptHash));
        rc.lastActionAt = block.timestamp;
        rc.latestTranscriptHash = transcriptHash;

        _remediationResponses[agreementId].push(RemediationResponse({
            cycle: rc.cycleCount,
            author: msg.sender,
            responseType: responseType,
            proposedProviderPayout: proposedProviderPayout,
            responseHash: responseHash,
            responseURI: responseURI,
            previousTranscriptHash: previousTranscriptHash,
            transcriptHash: transcriptHash,
            timestamp: block.timestamp
        }));

        if (responseType == ProviderResponseType.REVISE) {
            ag.status = Status.REVISED;
        } else if (responseType == ProviderResponseType.PARTIAL_SETTLEMENT) {
            ag.status = Status.PARTIAL_SETTLEMENT;
        } else if (responseType == ProviderResponseType.REQUEST_HUMAN_REVIEW) {
            ag.status = Status.ESCALATED_TO_HUMAN;
            _ensureDisputeCase(agreementId, true);
        } else if (responseType == ProviderResponseType.ESCALATE) {
            _openFormalDispute(agreementId, "provider escalation", true);
            return;
        } else {
            ag.status = Status.REVISED;
        }

        emit RevisionResponded(agreementId, rc.cycleCount, msg.sender, responseType, transcriptHash);
    }

    function escalateToDispute(uint256 agreementId, string calldata reason) external {
        _openFormalDispute(agreementId, reason, true);
    }

    function cancel(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.client, "ServiceAgreement: not client");
        require(ag.status == Status.PROPOSED, "ServiceAgreement: not PROPOSED");
        _closeRemediation(agreementId);
        ag.status = Status.CANCELLED;
        ag.resolvedAt = block.timestamp;
        emit AgreementCancelled(agreementId, msg.sender);
        _releaseEscrow(ag.token, ag.client, ag.price);
    }

    function expiredCancel(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.client, "ServiceAgreement: not client");
        require(ag.status == Status.ACCEPTED || ag.status == Status.REVISED || ag.status == Status.REVISION_REQUESTED || ag.status == Status.PARTIAL_SETTLEMENT || ag.status == Status.ESCALATED_TO_HUMAN, "ServiceAgreement: not ACCEPTED");
        require(block.timestamp > ag.deadline, "ServiceAgreement: not past deadline");
        _closeRemediation(agreementId);
        ag.status = Status.CANCELLED;
        ag.resolvedAt = block.timestamp;
        emit AgreementCancelled(agreementId, msg.sender);
        _releaseEscrow(ag.token, ag.client, ag.price);
    }

    function resolveDispute(uint256 agreementId, bool favorProvider) external onlyOwner {
        resolveDisputeDetailed(
            agreementId,
            favorProvider ? DisputeOutcome.PROVIDER_WINS : DisputeOutcome.CLIENT_REFUND,
            favorProvider ? _get(agreementId).price : 0,
            favorProvider ? 0 : _get(agreementId).price
        );
        emit DisputeResolved(agreementId, favorProvider);
    }

    function submitDisputeEvidence(uint256 agreementId, EvidenceType evidenceType, bytes32 evidenceHash, string calldata evidenceURI) external {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.client || msg.sender == ag.provider, "ServiceAgreement: not a party");
        require(ag.status == Status.DISPUTED || ag.status == Status.ESCALATED_TO_HUMAN || ag.status == Status.ESCALATED_TO_ARBITRATION, "ServiceAgreement: no active dispute");
        _disputeEvidence[agreementId].push(DisputeEvidence({
            submitter: msg.sender,
            evidenceType: evidenceType,
            evidenceHash: evidenceHash,
            evidenceURI: evidenceURI,
            timestamp: block.timestamp
        }));
        _disputeCases[agreementId].evidenceCount = _disputeEvidence[agreementId].length;
        emit DisputeEvidenceSubmitted(agreementId, _disputeEvidence[agreementId].length - 1, msg.sender, evidenceType, evidenceHash);
    }

    function resolveDisputeDetailed(uint256 agreementId, DisputeOutcome outcome, uint256 providerAward, uint256 clientAward) public onlyOwner nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(ag.status == Status.DISPUTED || ag.status == Status.ESCALATED_TO_HUMAN || ag.status == Status.ESCALATED_TO_ARBITRATION, "ServiceAgreement: not DISPUTED");
        require(providerAward + clientAward == ag.price, "ServiceAgreement: invalid split");

        DisputeCase storage dc = _disputeCases[agreementId];
        if (dc.openedAt == 0) {
            _ensureDisputeCase(agreementId, ag.status == Status.ESCALATED_TO_HUMAN);
        }
        dc.outcome = outcome;
        dc.providerAward = providerAward;
        dc.clientAward = clientAward;
        dc.responseDeadlineAt = block.timestamp;

        _closeRemediation(agreementId);
        ag.resolvedAt = block.timestamp;

        if (outcome == DisputeOutcome.PROVIDER_WINS) {
            ag.status = Status.FULFILLED;
            if (providerAward > 0) _releaseEscrow(ag.token, ag.provider, providerAward);
            _updateTrust(agreementId, ag, true);
        } else if (outcome == DisputeOutcome.CLIENT_REFUND) {
            ag.status = Status.CANCELLED;
            if (clientAward > 0) _releaseEscrow(ag.token, ag.client, clientAward);
            _updateTrust(agreementId, ag, false);
        } else if (outcome == DisputeOutcome.PARTIAL_PROVIDER || outcome == DisputeOutcome.PARTIAL_CLIENT) {
            ag.status = Status.PARTIAL_SETTLEMENT;
            if (providerAward > 0) _releaseEscrow(ag.token, ag.provider, providerAward);
            if (clientAward > 0) _releaseEscrow(ag.token, ag.client, clientAward);
        } else if (outcome == DisputeOutcome.MUTUAL_CANCEL) {
            ag.status = Status.MUTUAL_CANCEL;
            if (clientAward > 0) _releaseEscrow(ag.token, ag.client, clientAward);
            if (providerAward > 0) _releaseEscrow(ag.token, ag.provider, providerAward);
        } else if (outcome == DisputeOutcome.HUMAN_REVIEW_REQUIRED) {
            ag.status = Status.ESCALATED_TO_HUMAN;
            dc.humanReviewRequested = true;
        } else {
            revert("ServiceAgreement: unsupported outcome");
        }

        emit DetailedDisputeResolved(agreementId, outcome, providerAward, clientAward);
    }

    function expiredDisputeRefund(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(ag.status == Status.DISPUTED || ag.status == Status.ESCALATED_TO_HUMAN || ag.status == Status.ESCALATED_TO_ARBITRATION, "ServiceAgreement: not DISPUTED");
        require(block.timestamp > ag.resolvedAt + DISPUTE_TIMEOUT, "ServiceAgreement: dispute timeout not reached");
        _closeRemediation(agreementId);
        ag.status = Status.CANCELLED;
        ag.resolvedAt = block.timestamp;
        emit AgreementCancelled(agreementId, ag.client);
        emit DisputeTimedOut(agreementId, ag.client);
        _releaseEscrow(ag.token, ag.client, ag.price);
    }

    function getAgreement(uint256 id) external view returns (Agreement memory) {
        require(_agreements[id].id != 0, "ServiceAgreement: not found");
        return _agreements[id];
    }

    function getRemediationCase(uint256 agreementId) external view returns (RemediationCase memory) {
        return _remediationCases[agreementId];
    }

    function getRemediationFeedback(uint256 agreementId, uint256 index) external view returns (RemediationFeedback memory) {
        return _remediationFeedbacks[agreementId][index];
    }

    function getRemediationResponse(uint256 agreementId, uint256 index) external view returns (RemediationResponse memory) {
        return _remediationResponses[agreementId][index];
    }

    function getDisputeCase(uint256 agreementId) external view returns (DisputeCase memory) {
        return _disputeCases[agreementId];
    }

    function getDisputeEvidence(uint256 agreementId, uint256 index) external view returns (DisputeEvidence memory) {
        return _disputeEvidence[agreementId][index];
    }

    function getAgreementsByClient(address client) external view returns (uint256[] memory) { return _byClient[client]; }
    function getAgreementsByProvider(address provider) external view returns (uint256[] memory) { return _byProvider[provider]; }
    function agreementCount() external view returns (uint256) { return _nextId; }

    function _openFormalDispute(uint256 agreementId, string memory reason, bool requireEligibility) internal {
        require(bytes(reason).length <= 512, "ServiceAgreement: reason too long");
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.client || msg.sender == ag.provider, "ServiceAgreement: not a party");
        if (requireEligibility) {
            require(_eligibleForEscalation(ag, agreementId), "ServiceAgreement: remediation first");
        } else {
            require(ag.status == Status.ACCEPTED || ag.status == Status.PENDING_VERIFICATION || ag.status == Status.REVISED || ag.status == Status.REVISION_REQUESTED || ag.status == Status.PARTIAL_SETTLEMENT || ag.status == Status.ESCALATED_TO_HUMAN, "ServiceAgreement: not ACCEPTED");
        }
        _ensureDisputeCase(agreementId, false);
        ag.status = Status.DISPUTED;
        ag.resolvedAt = block.timestamp;
        emit AgreementDisputed(agreementId, msg.sender, reason);
    }

    function _eligibleForEscalation(Agreement storage ag, uint256 agreementId) internal view returns (bool) {
        if (ag.status == Status.ESCALATED_TO_HUMAN || ag.status == Status.PARTIAL_SETTLEMENT) return true;
        RemediationCase storage rc = _remediationCases[agreementId];
        if (!rc.active) return false;
        if (block.timestamp > rc.deadlineAt) return true;
        if (rc.cycleCount >= MAX_REMEDIATION_CYCLES) return true;
        return false;
    }

    function _ensureDisputeCase(uint256 agreementId, bool humanReviewRequested) internal {
        DisputeCase storage dc = _disputeCases[agreementId];
        if (dc.openedAt == 0) {
            dc.agreementId = agreementId;
            dc.openedAt = block.timestamp;
            dc.responseDeadlineAt = block.timestamp + DISPUTE_TIMEOUT;
            dc.outcome = DisputeOutcome.PENDING;
            dc.humanReviewRequested = humanReviewRequested;
            dc.evidenceCount = _disputeEvidence[agreementId].length;
        } else if (humanReviewRequested) {
            dc.humanReviewRequested = true;
        }
    }

    function _closeRemediation(uint256 agreementId) internal {
        if (_remediationCases[agreementId].active) {
            _remediationCases[agreementId].active = false;
        }
    }

    function _get(uint256 id) internal view returns (Agreement storage) {
        require(_agreements[id].id != 0, "ServiceAgreement: not found");
        return _agreements[id];
    }

    function _releaseEscrow(address token, address recipient, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok, ) = recipient.call{value: amount}("");
            require(ok, "ServiceAgreement: ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    function _updateTrust(uint256 agreementId, Agreement storage ag, bool success) internal {
        bytes32 capabilityHash = keccak256(bytes(ag.serviceType));
        if (trustRegistry != address(0)) {
            if (success) {
                if (minimumTrustValue == 0 || ag.price >= minimumTrustValue) {
                    try ITrustRegistry(trustRegistry).recordSuccess(ag.provider, ag.client, ag.serviceType, ag.price) {} catch {
                        emit TrustUpdateFailed(agreementId, ag.provider, "fulfill");
                    }
                }
            } else {
                try ITrustRegistry(trustRegistry).recordAnomaly(ag.provider, ag.client, ag.serviceType, ag.price) {} catch {
                    emit TrustUpdateFailed(agreementId, ag.provider, "resolveDispute:anomaly");
                }
            }
        }
        if (address(reputationOracle) != address(0)) {
            if (success) {
                try reputationOracle.autoRecordSuccess(ag.client, ag.provider, capabilityHash) {} catch {}
            } else {
                try reputationOracle.autoWarn(ag.client, ag.provider, capabilityHash) {} catch {}
            }
        }
    }

    receive() external payable {}
}
