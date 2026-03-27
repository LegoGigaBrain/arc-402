// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IServiceAgreement.sol";
import "./ISessionChannels.sol";
import "./IDisputeArbitration.sol";
import "./IDisputeModule.sol";
import "./ITrustRegistry.sol";
import "./IArc402Guardian.sol";
import "./IWatchtowerRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
contract ServiceAgreement is IServiceAgreement, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public owner;
    address public pendingOwner;
    address public immutable trustRegistry;
    address public disputeArbitration;
    IArc402Guardian public guardian;
    address public watchtowerRegistry;
    address public immutable sessionChannels;
    address public immutable disputeModule;
    address public reputationOracle;

    address public constant ETH = address(0);
    uint256 public constant VERIFY_WINDOW = 3 days;
    uint256 public constant DISPUTE_TIMEOUT = 30 days;
    uint256 public constant REMEDIATION_WINDOW = 24 hours;
    uint256 public constant ARBITRATION_SELECTION_WINDOW = 3 days;
    uint256 public constant ARBITRATION_DECISION_WINDOW = 7 days;
    uint8 public constant MAX_REMEDIATION_CYCLES = 2;
    uint8 public constant ARBITRATOR_PANEL_SIZE = 3;
    uint8 public constant ARBITRATOR_MAJORITY = 2;
    uint256 public constant CHALLENGE_WINDOW = 24 hours;

    // ─── Protocol Fee ─────────────────────────────────────────────────────────
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 100; // 1% hard ceiling (immutable constant)
    uint256 public protocolFeeBps = 30;                 // 0.3% default, governance-adjustable up to ceiling
    address public protocolTreasury;

    mapping(address => bool) public allowedTokens;
    mapping(address => bool) public legacyFulfillProviders;
    mapping(address => bool) public approvedArbitrators;
    bool public legacyFulfillEnabled;
    uint256 public minimumTrustValue;
    uint256 private _nextId;

    mapping(uint256 => Agreement) private _agreements;
    mapping(address => uint256[]) private _byClient;
    mapping(address => uint256[]) private _byProvider;

    // Channel types kept here for test ABI compatibility (zero bytecode cost).
    // Channel state and funds live in the SessionChannels contract.
    enum ChannelStatus { OPEN, CLOSING, CHALLENGED, SETTLED }
    struct Channel {
        address client;
        address provider;
        address token;
        uint256 depositAmount;
        uint256 settledAmount;
        uint256 lastSequenceNumber;
        uint256 deadline;
        uint256 challengeExpiry;
        ChannelStatus status;
    }
    struct ChannelState {
        bytes32 channelId;
        uint256 sequenceNumber;
        uint256 callCount;
        uint256 cumulativePayment;
        address token;
        uint256 timestamp;
        bytes clientSig;
        bytes providerSig;
    }

    // ─── Custom Errors ────────────────────────────────────────────────────────
    error NotOwner();
    error NotParty();
    error ProtocolPaused();
    error ZeroAddress();
    error NotPendingOwner();
    error FeeExceedsCeiling();
    error StringTooLong();
    error ClientEqualsProvider();
    error ZeroPrice();
    error DeadlineInPast();
    error TokenNotAllowed();
    error ETHValueMismatch();
    error ETHWithERC20();
    error NotProvider();
    error InvalidStatus();
    error LegacyFulfillDisabled();
    error NotLegacyTrusted();
    error PastDeadline();
    error VerifyWindowOpen();
    error InvalidDirectDisputeReason();
    error NotClient();
    error MaxRemediationCycles();
    error RemediationUnavailable();
    error RemediationWindowElapsed();
    error TranscriptChainMismatch();
    error NoRevisionRequested();
    error InvalidResponse();
    error RemediationInactive();
    error InvalidPayout();
    error NotPastDeadline();
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
    error InvalidSplit();
    error ArbitrationStillActive();
    error HumanEscalationRequired();
    error HumanReviewNotRequested();
    error EvidenceRequired();
    error DisputeTimeoutNotReached();
    error NotFound();
    error ETHTransferFailed();
    error NotDisputeArbitration();
    error DANotSet();
    error NoSessionChannels();
    error ZeroAmount();
    error RemediationFirst();
    error DirectDisputeNotAllowed();
    error DisputeFeeError();
    error UnsupportedOutcome();
    error NoDisputeModule();

    event AgreementProposed(uint256 indexed id, address indexed client, address indexed provider, string serviceType, uint256 price, address token, uint256 deadline);
    event AgreementAccepted(uint256 indexed id, address indexed provider);
    event AgreementFulfilled(uint256 indexed id, address indexed provider, bytes32 deliverablesHash);
    event AgreementDisputed(uint256 indexed id, address indexed initiator, string reason);
    event DirectDisputeOpened(uint256 indexed id, address indexed initiator, DirectDisputeReason directReason, string reason);
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
    event DeliverableCommitted(uint256 indexed id, address indexed provider, bytes32 hash, uint256 verifyWindowEnd);
    event AutoReleased(uint256 indexed id, address indexed provider);
    event RevisionRequested(uint256 indexed id, uint8 indexed cycle, address indexed client, bytes32 transcriptHash);
    event RevisionResponded(uint256 indexed id, uint8 indexed cycle, address indexed provider, ProviderResponseType responseType, bytes32 transcriptHash);
    event DisputeEvidenceSubmitted(uint256 indexed id, uint256 indexed evidenceIndex, address indexed submitter, EvidenceType evidenceType, bytes32 evidenceHash);
    event DetailedDisputeResolved(uint256 indexed id, DisputeOutcome outcome, uint256 providerAward, uint256 clientAward);
    event ArbitratorApprovalUpdated(address indexed arbitrator, bool approved);
    event DisputeArbitrationUpdated(address indexed da);
    event DisputeFeeResolutionFailed(uint256 indexed agreementId);
    event DisputeFeeCallFailed(uint256 indexed agreementId, bytes reason);
    event ArbitratorNominated(uint256 indexed id, address indexed nominator, address indexed arbitrator, uint8 panelSize);
    event ArbitrationActivated(uint256 indexed id, uint256 selectionDeadlineAt, uint256 decisionDeadlineAt);
    event ArbitrationVoteCast(uint256 indexed id, address indexed arbitrator, ArbitrationVote vote, uint256 providerAward, uint256 clientAward);
    event HumanEscalationRequested(uint256 indexed id, address indexed requester, string reason);
    event GuardianUpdated(address indexed guardian);
    event WatchtowerRegistryUpdated(address indexed watchtowerRegistry);
    event ProtocolFeeUpdated(uint256 newFeeBps);
    event ProtocolTreasuryUpdated(address indexed newTreasury);
    event ReputationOracleUpdated(address indexed oracle);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyParty(uint256 agreementId) {
        Agreement storage ag = _get(agreementId);
        if (msg.sender != ag.client && msg.sender != ag.provider) revert NotParty();
        _;
    }

    modifier whenNotPaused() {
        if (address(guardian) != address(0)) {
            if (guardian.isPaused()) revert ProtocolPaused();
        }
        _;
    }

    constructor(address _trustRegistry, address _disputeModule, address _sessionChannels) {
        owner = msg.sender;
        if (_trustRegistry == address(0)) revert ZeroAddress();
        trustRegistry = _trustRegistry;
        disputeModule = _disputeModule;
        sessionChannels = _sessionChannels;
        allowedTokens[address(0)] = true;
        emit TokenAllowed(address(0));
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
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

    function setApprovedArbitrator(address arbitrator, bool approved) external onlyOwner {
        approvedArbitrators[arbitrator] = approved;
        emit ArbitratorApprovalUpdated(arbitrator, approved);
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

    function setDisputeArbitration(address da) external onlyOwner {
        if (da == address(0)) revert ZeroAddress();
        disputeArbitration = da;
        emit DisputeArbitrationUpdated(da);
    }

    function setGuardian(address _guardian) external onlyOwner {
        guardian = IArc402Guardian(_guardian);
        emit GuardianUpdated(_guardian);
    }

    function setWatchtowerRegistry(address _watchtowerRegistry) external onlyOwner {
        if (_watchtowerRegistry == address(0)) revert ZeroAddress();
        watchtowerRegistry = _watchtowerRegistry;
        emit WatchtowerRegistryUpdated(_watchtowerRegistry);
    }

    /// @notice Update protocol fee in basis points (max 1%, enforced by MAX_PROTOCOL_FEE_BPS).
    function setProtocolFee(uint256 feeBps) external onlyOwner {
        if (feeBps > MAX_PROTOCOL_FEE_BPS) revert FeeExceedsCeiling();
        protocolFeeBps = feeBps;
        emit ProtocolFeeUpdated(feeBps);
    }

    /// @notice Set the protocol treasury address that receives protocol fees.
    function setProtocolTreasury(address treasury) external onlyOwner {
        if (treasury == address(0)) revert ZeroAddress();
        protocolTreasury = treasury;
        emit ProtocolTreasuryUpdated(treasury);
    }

    function setReputationOracle(address oracle) external onlyOwner {
        reputationOracle = oracle;
        emit ReputationOracleUpdated(oracle);
    }

    function propose(address provider, string calldata serviceType, string calldata description, uint256 price, address token, uint256 deadline, bytes32 deliverablesHash) external payable nonReentrant whenNotPaused returns (uint256 agreementId) {
        if (bytes(serviceType).length > 64) revert StringTooLong();
        if (bytes(description).length > 1024) revert StringTooLong();
        if (provider == address(0)) revert ZeroAddress();
        if (provider == msg.sender) revert ClientEqualsProvider();
        if (price == 0) revert ZeroPrice();
        // slither-disable-next-line timestamp
        if (deadline <= block.timestamp) revert DeadlineInPast();
        if (!allowedTokens[token]) revert TokenNotAllowed();

        if (token == address(0)) {
            if (msg.value != price) revert ETHValueMismatch();
        } else {
            if (msg.value != 0) revert ETHWithERC20();
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
            committedHash: bytes32(0),
            protocolVersion: "1.0.0"
        });
        _byClient[msg.sender].push(agreementId);
        _byProvider[provider].push(agreementId);
        emit AgreementProposed(agreementId, msg.sender, provider, serviceType, price, token, deadline);
    }

    function accept(uint256 agreementId) external nonReentrant whenNotPaused {
        Agreement storage ag = _get(agreementId);
        if (msg.sender != ag.provider) revert NotProvider();
        if (ag.status != Status.PROPOSED) revert InvalidStatus();
        ag.status = Status.ACCEPTED;
        emit AgreementAccepted(agreementId, msg.sender);
    }

    function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external nonReentrant whenNotPaused {
        Agreement storage ag = _get(agreementId);
        if (msg.sender != ag.provider) revert NotProvider();
        if (!legacyFulfillEnabled) revert LegacyFulfillDisabled();
        if (!legacyFulfillProviders[msg.sender]) revert NotLegacyTrusted();
        if (ag.status != Status.ACCEPTED && ag.status != Status.REVISED) revert InvalidStatus();
        // slither-disable-next-line timestamp
        if (block.timestamp > ag.deadline) revert PastDeadline();
        if (disputeModule != address(0)) IDisputeModule(disputeModule).closeRemediation(agreementId);
        ag.status = Status.FULFILLED;
        ag.resolvedAt = block.timestamp;
        ag.deliverablesHash = actualDeliverablesHash;
        emit AgreementFulfilled(agreementId, msg.sender, actualDeliverablesHash);
        _releaseEscrowWithFee(ag.token, ag.provider, ag.price);
        _updateTrust(agreementId, ag, true);
    }

    function commitDeliverable(uint256 agreementId, bytes32 deliverableHash) external nonReentrant whenNotPaused {
        Agreement storage ag = _get(agreementId);
        if (msg.sender != ag.provider) revert NotProvider();
        if (ag.status != Status.ACCEPTED && ag.status != Status.REVISED) revert InvalidStatus();
        // slither-disable-next-line timestamp
        if (block.timestamp > ag.deadline) revert PastDeadline();
        if (disputeModule != address(0)) IDisputeModule(disputeModule).closeRemediation(agreementId);
        ag.status = Status.PENDING_VERIFICATION;
        ag.committedHash = deliverableHash;
        ag.verifyWindowEnd = block.timestamp + VERIFY_WINDOW;
        ag.deliverablesHash = deliverableHash;
        emit DeliverableCommitted(agreementId, msg.sender, deliverableHash, ag.verifyWindowEnd);
    }

    function verifyDeliverable(uint256 agreementId) external nonReentrant whenNotPaused {
        Agreement storage ag = _get(agreementId);
        if (msg.sender != ag.client) revert NotClient();
        if (ag.status != Status.PENDING_VERIFICATION) revert InvalidStatus();
        if (disputeModule != address(0)) IDisputeModule(disputeModule).closeRemediation(agreementId);
        ag.status = Status.FULFILLED;
        ag.resolvedAt = block.timestamp;
        emit AgreementFulfilled(agreementId, ag.provider, ag.committedHash);
        _releaseEscrowWithFee(ag.token, ag.provider, ag.price);
        _updateTrust(agreementId, ag, true);
    }

    function autoRelease(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        if (ag.status != Status.PENDING_VERIFICATION) revert InvalidStatus();
        // slither-disable-next-line timestamp
        if (block.timestamp <= ag.verifyWindowEnd) revert VerifyWindowOpen();
        if (disputeModule != address(0)) IDisputeModule(disputeModule).closeRemediation(agreementId);
        ag.status = Status.FULFILLED;
        ag.resolvedAt = block.timestamp;
        emit AgreementFulfilled(agreementId, ag.provider, ag.committedHash);
        emit AutoReleased(agreementId, ag.provider);
        _releaseEscrowWithFee(ag.token, ag.provider, ag.price);
        _updateTrust(agreementId, ag, true);
    }

    function dispute(uint256 agreementId, string calldata reason) external payable {
        _callOpenFormalDispute(agreementId, reason, true, DirectDisputeReason.NONE, IDisputeArbitration.DisputeMode.UNILATERAL, IDisputeArbitration.DisputeClass.HARD_FAILURE);
    }

    function directDispute(uint256 agreementId, DirectDisputeReason directReason, string calldata reason) external payable {
        if (directReason == DirectDisputeReason.NONE) revert InvalidDirectDisputeReason();
        _callOpenFormalDispute(agreementId, reason, false, directReason, IDisputeArbitration.DisputeMode.UNILATERAL, IDisputeArbitration.DisputeClass.HARD_FAILURE);
    }


    function requestRevision(uint256 agreementId, bytes32 feedbackHash, string calldata feedbackURI, bytes32 previousTranscriptHash) external {
        if (bytes(feedbackURI).length > 512) revert StringTooLong();
        Agreement storage ag = _get(agreementId);
        if (msg.sender != ag.client) revert NotClient();
        _requireDisputeModule();
        IDisputeModule.RequestRevisionResult memory r = IDisputeModule(disputeModule).requestRevision(
            agreementId, msg.sender, ag.status, feedbackHash, feedbackURI, previousTranscriptHash
        );
        ag.status = Status.REVISION_REQUESTED;
        emit RevisionRequested(agreementId, r.cycleCount, msg.sender, r.transcriptHash);
    }

    function respondToRevision(uint256 agreementId, ProviderResponseType responseType, uint256 proposedProviderPayout, bytes32 responseHash, string calldata responseURI, bytes32 previousTranscriptHash) external {
        Agreement storage ag = _get(agreementId);
        if (msg.sender != ag.provider) revert NotProvider();
        _requireDisputeModule();
        IDisputeModule.RespondResult memory r = IDisputeModule(disputeModule).respondToRevision(
            agreementId, msg.sender, ag.price, ag.status, responseType,
            proposedProviderPayout, responseHash, responseURI, previousTranscriptHash
        );
        if (r.needsDispute) {
            _callOpenFormalDispute(agreementId, "provider escalation", true, DirectDisputeReason.NONE, IDisputeArbitration.DisputeMode.UNILATERAL, IDisputeArbitration.DisputeClass.HARD_FAILURE);
            return;
        }
        ag.status = r.newStatus;
        emit RevisionResponded(agreementId, r.cycleCount, msg.sender, responseType, r.transcriptHash);
    }

    function escalateToDispute(uint256 agreementId, string calldata reason) external payable {
        _callOpenFormalDispute(agreementId, reason, true, DirectDisputeReason.NONE, IDisputeArbitration.DisputeMode.UNILATERAL, IDisputeArbitration.DisputeClass.HARD_FAILURE);
    }

    function canDirectDispute(uint256 agreementId, DirectDisputeReason directReason) external view returns (bool) {
        if (disputeModule == address(0)) return false;
        Agreement storage ag = _get(agreementId);
        return IDisputeModule(disputeModule).canDirectDispute(ag.status, ag.deadline, directReason);
    }

    function cancel(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        if (msg.sender != ag.client) revert NotClient();
        if (ag.status != Status.PROPOSED) revert InvalidStatus();
        if (disputeModule != address(0)) IDisputeModule(disputeModule).closeRemediation(agreementId);
        ag.status = Status.CANCELLED;
        ag.resolvedAt = block.timestamp;
        emit AgreementCancelled(agreementId, msg.sender);
        _releaseEscrow(ag.token, ag.client, ag.price);
    }

    function expiredCancel(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        if (msg.sender != ag.client) revert NotClient();
        if (
            ag.status != Status.ACCEPTED &&
            ag.status != Status.REVISED &&
            ag.status != Status.REVISION_REQUESTED &&
            ag.status != Status.ESCALATED_TO_HUMAN
        ) revert InvalidStatus(); // B-03: removed PARTIAL_SETTLEMENT
        // slither-disable-next-line timestamp
        if (block.timestamp <= ag.deadline) revert NotPastDeadline();
        if (disputeModule != address(0)) IDisputeModule(disputeModule).closeRemediation(agreementId);
        ag.status = Status.CANCELLED;
        ag.resolvedAt = block.timestamp;
        emit AgreementCancelled(agreementId, msg.sender);
        _releaseEscrow(ag.token, ag.client, ag.price);
    }

    function nominateArbitrator(uint256 agreementId, address arbitrator) external onlyParty(agreementId) {
        _requireDisputeModule();
        Agreement storage ag = _get(agreementId);
        IDisputeModule.NominateResult memory r = IDisputeModule(disputeModule).nominateArbitrator(
            agreementId, msg.sender, arbitrator, ag.status, ag.client, ag.provider
        );
        ag.status = r.newStatus;
        emit ArbitratorNominated(agreementId, msg.sender, arbitrator, r.panelSize);
        if (r.panelComplete) {
            emit ArbitrationActivated(agreementId, r.selectionDeadlineAt, r.decisionDeadlineAt);
        }
    }

    // wake-disable-next-line reentrancy
    // @dev Called only from nonReentrant-guarded entry points. Reentrancy path blocked upstream.
    function castArbitrationVote(uint256 agreementId, ArbitrationVote vote, uint256 providerAward, uint256 clientAward) external {
        _requireDisputeModule();
        Agreement storage ag = _get(agreementId);
        IDisputeModule.FinalizeResult memory r = IDisputeModule(disputeModule).castArbitrationVote(
            agreementId, msg.sender, ag.status, ag.price, vote, providerAward, clientAward
        );
        emit ArbitrationVoteCast(agreementId, msg.sender, vote, providerAward, clientAward);
        if (r.finalized) {
            _applyFinalizeResult(agreementId, ag, r);
        } else if (r.newStatus == Status.ESCALATED_TO_HUMAN) {
            ag.status = Status.ESCALATED_TO_HUMAN;
        }
    }

    function requestHumanEscalation(uint256 agreementId, string calldata reason) external onlyParty(agreementId) {
        if (bytes(reason).length > 512) revert StringTooLong();
        _requireDisputeModule();
        Agreement storage ag = _get(agreementId);
        IDisputeModule(disputeModule).requestHumanEscalation(agreementId, ag.status);
        ag.status = Status.ESCALATED_TO_HUMAN;
        emit HumanEscalationRequested(agreementId, msg.sender, reason);
    }

    /// @notice R-06: Owner can resolve a basic DISPUTED or ESCALATED_TO_HUMAN agreement.
    function ownerResolveDispute(uint256 agreementId, bool favorProvider) external nonReentrant onlyOwner {
        _requireDisputeModule();
        Agreement storage ag = _get(agreementId);
        IDisputeModule.FinalizeResult memory r = IDisputeModule(disputeModule).ownerResolveDispute(
            agreementId, ag.status, favorProvider, ag.price
        );
        _applyFinalizeResult(agreementId, ag, r);
        emit DisputeResolved(agreementId, favorProvider);
    }

    function submitDisputeEvidence(uint256 agreementId, EvidenceType evidenceType, bytes32 evidenceHash, string calldata evidenceURI) external {
        Agreement storage ag = _get(agreementId);
        if (msg.sender != ag.client && msg.sender != ag.provider) revert NotParty();
        _requireDisputeModule();
        uint256 evidenceIndex = IDisputeModule(disputeModule).submitDisputeEvidence(
            agreementId, msg.sender, ag.status, evidenceType, evidenceHash, evidenceURI
        );
        emit DisputeEvidenceSubmitted(agreementId, evidenceIndex, msg.sender, evidenceType, evidenceHash);
    }

    function resolveDisputeDetailed(uint256 agreementId, DisputeOutcome outcome, uint256 providerAward, uint256 clientAward) public nonReentrant onlyOwner {
        _requireDisputeModule();
        Agreement storage ag = _get(agreementId);
        if (providerAward + clientAward != ag.price && outcome != DisputeOutcome.HUMAN_REVIEW_REQUIRED) revert InvalidSplit();
        IDisputeModule.FinalizeResult memory r = IDisputeModule(disputeModule).resolveDisputeDetailed(
            agreementId, ag.status, outcome, providerAward, clientAward, ag.price
        );
        _applyFinalizeResult(agreementId, ag, r);
    }

    function expiredDisputeRefund(uint256 agreementId) external nonReentrant {
        _requireDisputeModule();
        Agreement storage ag = _get(agreementId);
        IDisputeModule.FinalizeResult memory r = IDisputeModule(disputeModule).expiredDisputeRefund(
            agreementId, ag.status, ag.resolvedAt, ag.price
        );
        ag.status = r.newStatus;
        ag.resolvedAt = r.resolvedAt;
        emit AgreementCancelled(agreementId, ag.client);
        emit DisputeTimedOut(agreementId, ag.client);
        _releaseEscrow(ag.token, ag.client, ag.price);
    }

    function getAgreement(uint256 id) external view returns (Agreement memory) {
        if (_agreements[id].id == 0) revert NotFound();
        return _agreements[id];
    }


    function getAgreementsByClient(address client) external view returns (uint256[] memory) { return _byClient[client]; }
    function getAgreementsByProvider(address provider) external view returns (uint256[] memory) { return _byProvider[provider]; }
    function agreementCount() external view returns (uint256) { return _nextId; }

    // ─── Internal: delegate dispute opening to DisputeModule ─────────────────

    function _callOpenFormalDispute(
        uint256 agreementId,
        string memory reason,
        bool requireEligibility,
        DirectDisputeReason directReason,
        IDisputeArbitration.DisputeMode daMode,
        IDisputeArbitration.DisputeClass daClass
    ) internal {
        if (bytes(reason).length > 512) revert StringTooLong();
        if (disputeModule == address(0)) revert NoDisputeModule();
        Agreement storage ag = _get(agreementId);
        if (msg.sender != ag.client && msg.sender != ag.provider) revert NotParty();

        // DM validates eligibility, creates dispute case, calls DA for fee, returns timestamp
        uint256 newResolvedAt = IDisputeModule(disputeModule).openFormalDispute{value: msg.value}(
            IDisputeModule.DisputeOpenParams({
                agreementId:        agreementId,
                caller:             msg.sender,
                currentStatus:      ag.status,
                requireEligibility: requireEligibility,
                directReason:       directReason,
                daMode:             daMode,
                daClass:            daClass,
                client:             ag.client,
                provider:           ag.provider,
                price:              ag.price,
                token:              ag.token,
                deadline:           ag.deadline
            })
        );

        ag.status = Status.DISPUTED;
        if (ag.resolvedAt == 0) {
            ag.resolvedAt = newResolvedAt; // B-06: only set once
        }
        emit AgreementDisputed(agreementId, msg.sender, reason);
        if (directReason != DirectDisputeReason.NONE) {
            emit DirectDisputeOpened(agreementId, msg.sender, directReason, reason);
        }
    }

    // ─── Internal: apply finalization results from DisputeModule ─────────────

    // wake-disable-next-line reentrancy
    function _applyFinalizeResult(uint256 agreementId, Agreement storage ag, IDisputeModule.FinalizeResult memory r) internal {
        // R-06: Capture pre-finalize status before overwriting. When an agreement went through
        // formal dispute arbitration (DISPUTED / ESCALATED_TO_ARBITRATION) and DisputeArbitration
        // is wired, DA's resolveDisputeFee() already wrote trust in the same transaction.
        // SA must not double-write — that hits the noFlashLoan guard and emits spurious
        // TrustUpdateFailed events.
        // ESCALATED_TO_HUMAN: DA is not involved; SA trust write proceeds normally.
        bool wasFormallyDisputedViaDA = (disputeArbitration != address(0)) && (
            ag.status == Status.DISPUTED ||
            ag.status == Status.ESCALATED_TO_ARBITRATION
        );

        ag.status = r.newStatus;
        ag.resolvedAt = r.resolvedAt;

        if (r.providerAmount > 0) {
            if (r.providerWithFee) {
                _releaseEscrowWithFee(ag.token, ag.provider, r.providerAmount);
            } else {
                _releaseEscrow(ag.token, ag.provider, r.providerAmount);
            }
        }
        if (r.clientAmount > 0) {
            _releaseEscrow(ag.token, ag.client, r.clientAmount);
        }

        // R-06: Skip SA trust write when DA already handled it for formally-disputed agreements.
        if (r.updateTrust && !wasFormallyDisputedViaDA) {
            _updateTrust(agreementId, ag, r.trustSuccess);
        }

        emit DetailedDisputeResolved(agreementId, r.outcome, r.providerAmount, r.clientAmount);

        if (r.newStatus == Status.FULFILLED) {
            emit AgreementFulfilled(agreementId, ag.provider, ag.deliverablesHash);
        } else if (r.newStatus == Status.CANCELLED || r.newStatus == Status.MUTUAL_CANCEL) {
            emit AgreementCancelled(agreementId, ag.client);
        }

    }

    function _get(uint256 id) internal view returns (Agreement storage) {
        if (_agreements[id].id == 0) revert NotFound();
        return _agreements[id];
    }

    function _requireDisputeModule() private view {
        if (disputeModule == address(0)) revert NoDisputeModule();
    }

    // wake-disable-next-line reentrancy
    // @dev Called only from nonReentrant-guarded entry points. Reentrancy path blocked upstream.
    // slither-disable-next-line arbitrary-send-eth
    function _releaseEscrow(address token, address recipient, uint256 amount) internal {
        // slither-disable-next-line incorrect-equality
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok, ) = recipient.call{value: amount}("");
            if (!ok) revert ETHTransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    /// @dev Release escrow to provider after deducting the protocol fee.
    function _releaseEscrowWithFee(address token, address provider, uint256 amount) internal {
        // slither-disable-next-line incorrect-equality
        if (amount == 0) return;
        if (protocolFeeBps > 0 && protocolTreasury != address(0)) {
            uint256 fee = (amount * protocolFeeBps) / 10_000;
            if (fee > 0) {
                _releaseEscrow(token, protocolTreasury, fee);
            }
            _releaseEscrow(token, provider, amount - fee);
        } else {
            _releaseEscrow(token, provider, amount);
        }
    }

    // wake-disable-next-line reentrancy
    // @dev Called only from nonReentrant-guarded entry points. Reentrancy path blocked upstream.
    function _updateTrust(uint256 agreementId, Agreement storage ag, bool success) internal {
        if (trustRegistry == address(0)) return;
        if (success) {
            if (minimumTrustValue == 0 || ag.price >= minimumTrustValue) {
                try ITrustRegistry(trustRegistry).recordSuccess(ag.provider, ag.client, ag.serviceType, ag.price, ag.resolvedAt) {} catch {
                    emit TrustUpdateFailed(agreementId, ag.provider, "fulfill");
                }
            }
        } else {
            try ITrustRegistry(trustRegistry).recordAnomaly(ag.provider, ag.client, ag.serviceType, ag.price) {} catch {
                emit TrustUpdateFailed(agreementId, ag.provider, "resolveDispute:anomaly");
            }
        }
        // Reputation oracle calls deferred — interface definition needed (v2)
    }

    // ─── Session Channels (delegated to SessionChannels contract) ────────────

    function openSessionChannel(
        address provider,
        address token,
        uint256 maxAmount,
        uint256 ratePerCall,
        uint256 deadline
    ) external payable nonReentrant whenNotPaused returns (bytes32 channelId) {
        if (sessionChannels == address(0)) revert NoSessionChannels();
        if (provider == address(0)) revert ZeroAddress();
        if (provider == msg.sender) revert ClientEqualsProvider();
        if (deadline <= block.timestamp) revert DeadlineInPast();
        if (maxAmount == 0) revert ZeroAmount();
        if (!allowedTokens[token]) revert TokenNotAllowed();
        if (token == address(0)) {
            if (msg.value != maxAmount) revert ETHValueMismatch();
        } else {
            if (msg.value != 0) revert ETHWithERC20();
            IERC20(token).safeTransferFrom(msg.sender, sessionChannels, maxAmount);
        }
        return ISessionChannels(sessionChannels).openSessionChannel{value: msg.value}(
            msg.sender, provider, token, maxAmount, ratePerCall, deadline
        );
    }

    function closeChannel(bytes32 channelId, bytes calldata finalStateBytes) external nonReentrant whenNotPaused {
        ISessionChannels(sessionChannels).closeChannel(msg.sender, channelId, finalStateBytes);
    }

    function challengeChannel(bytes32 channelId, bytes calldata latestStateBytes) external nonReentrant whenNotPaused {
        ISessionChannels(sessionChannels).challengeChannel(msg.sender, channelId, latestStateBytes);
    }

    function finaliseChallenge(bytes32 channelId) external nonReentrant {
        ISessionChannels(sessionChannels).finaliseChallenge(msg.sender, channelId);
    }

    function reclaimExpiredChannel(bytes32 channelId) external nonReentrant {
        ISessionChannels(sessionChannels).reclaimExpiredChannel(msg.sender, channelId);
    }

    function getChannel(bytes32 channelId) external view returns (Channel memory ch) {
        bytes memory data = ISessionChannels(sessionChannels).getChannelEncoded(channelId);
        ch = abi.decode(data, (Channel));
    }

    function getChannelsByClient(address client) external view returns (bytes32[] memory) {
        return ISessionChannels(sessionChannels).getChannelsByClient(client);
    }

    function getChannelsByProvider(address provider) external view returns (bytes32[] memory) {
        return ISessionChannels(sessionChannels).getChannelsByProvider(provider);
    }

    receive() external payable {}
}
