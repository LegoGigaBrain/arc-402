// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ITrustRegistry.sol";

/**
 * @title ReputationOracle
 * @notice Social trust layer for ARC-402. Agents publish trust signals (ENDORSE, WARN, BLOCK)
 *         about other agents. Signals are weighted by the publisher's trust score at the time
 *         of publication. This creates the marketplace immune system: bad actors accumulate
 *         weighted WARN signals that make them effectively unhireable, without any central authority.
 *
 * STATUS: DRAFT — not audited, do not use in production
 */
contract ReputationOracle {

    // ─── Types ────────────────────────────────────────────────────────────────

    enum SignalType { ENDORSE, WARN, BLOCK }

    struct Signal {
        address publisher;
        address subject;
        SignalType signalType;
        bytes32 capabilityHash;
        string reason;
        uint256 publisherTrustAtTime;
        uint256 timestamp;
        bool autoPublished;
    }

    struct AutoWarnWindow {
        uint64 windowStartedAt;
        uint32 warnCount;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    ITrustRegistry public immutable trustRegistry;
    address public immutable serviceAgreement;

    uint256 public constant ENDORSE_STREAK_THRESHOLD = 5;
    uint256 public constant AUTO_WARN_COOLDOWN = 1 days;
    uint256 public constant AUTO_WARN_WINDOW = 7 days;
    uint256 public constant AUTO_WARN_MAX_PER_WINDOW = 3;

    mapping(address => Signal[]) private _signals;
    mapping(address => mapping(address => bool)) public hasManualSignaled;

    /// @dev Flash loan resistance: tracks the last block a subject's reputation was written.
    mapping(address => uint256) private _lastUpdateBlock;
    mapping(address => mapping(address => bool)) public hasAutoSignaled;
    mapping(address => uint256) public successStreak;
    mapping(address => mapping(address => uint256)) public lastAutoWarnAt;
    mapping(address => AutoWarnWindow) public autoWarnWindows;

    // ─── Events ──────────────────────────────────────────────────────────────

    event SignalPublished(
        address indexed publisher,
        address indexed subject,
        SignalType signalType,
        bytes32 capabilityHash,
        uint256 publisherTrustAtTime,
        bool autoPublished
    );
    event AutoWarnSuppressed(
        address indexed client,
        address indexed provider,
        bytes32 capabilityHash,
        bytes32 reasonCode
    );

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _trustRegistry, address _serviceAgreement) {
        require(_trustRegistry != address(0), "ReputationOracle: zero trust registry");
        require(_serviceAgreement != address(0), "ReputationOracle: zero service agreement");
        trustRegistry = ITrustRegistry(_trustRegistry);
        serviceAgreement = _serviceAgreement;
    }

    // ─── Flash Loan Resistance ────────────────────────────────────────────────

    /// @dev Prevents same-block multi-write attacks on a subject's reputation.
    modifier noFlashLoan(address subject) {
        require(block.number > _lastUpdateBlock[subject], "ReputationOracle: flash loan protection");
        _lastUpdateBlock[subject] = block.number;
        _;
    }

    // ─── Manual Signal Publishing ─────────────────────────────────────────────

    function publishSignal(
        address subject,
        SignalType signalType,
        bytes32 capabilityHash,
        string calldata reason
    ) external noFlashLoan(subject) {
        require(subject != address(0), "ReputationOracle: zero subject");
        require(subject != msg.sender, "ReputationOracle: cannot signal self");
        require(bytes(reason).length <= 512, "ReputationOracle: reason too long");
        require(!hasManualSignaled[msg.sender][subject], "ReputationOracle: already signaled");

        uint256 publisherTrust = _getTrust(msg.sender);

        _signals[subject].push(Signal({
            publisher: msg.sender,
            subject: subject,
            signalType: signalType,
            capabilityHash: capabilityHash,
            reason: reason,
            publisherTrustAtTime: publisherTrust,
            timestamp: block.timestamp,
            autoPublished: false
        }));
        hasManualSignaled[msg.sender][subject] = true;

        emit SignalPublished(msg.sender, subject, signalType, capabilityHash, publisherTrust, false);
    }

    // ─── Auto-Publishing (ServiceAgreement integration) ───────────────────────

    modifier onlyServiceAgreement() {
        require(msg.sender == serviceAgreement, "ReputationOracle: caller not ServiceAgreement");
        _;
    }

    function autoWarn(
        address client,
        address provider,
        bytes32 capabilityHash
    ) external onlyServiceAgreement noFlashLoan(provider) {
        successStreak[provider] = 0;

        if (hasAutoSignaled[client][provider]) {
            emit AutoWarnSuppressed(client, provider, capabilityHash, keccak256("ALREADY_SIGNALED"));
            return;
        }

        if (lastAutoWarnAt[client][provider] != 0 && block.timestamp < lastAutoWarnAt[client][provider] + AUTO_WARN_COOLDOWN) {
            emit AutoWarnSuppressed(client, provider, capabilityHash, keccak256("CLIENT_COOLDOWN"));
            return;
        }

        AutoWarnWindow storage window = autoWarnWindows[provider];
        if (window.windowStartedAt == 0 || block.timestamp >= uint256(window.windowStartedAt) + AUTO_WARN_WINDOW) {
            window.windowStartedAt = uint64(block.timestamp);
            window.warnCount = 0;
        }

        if (window.warnCount >= AUTO_WARN_MAX_PER_WINDOW) {
            emit AutoWarnSuppressed(client, provider, capabilityHash, keccak256("WINDOW_LIMIT"));
            return;
        }

        uint256 clientTrust = _getTrust(client);

        _signals[provider].push(Signal({
            publisher: client,
            subject: provider,
            signalType: SignalType.WARN,
            capabilityHash: capabilityHash,
            reason: "Dispute resolved against provider",
            publisherTrustAtTime: clientTrust,
            timestamp: block.timestamp,
            autoPublished: true
        }));
        hasAutoSignaled[client][provider] = true;
        lastAutoWarnAt[client][provider] = block.timestamp;
        window.warnCount += 1;

        emit SignalPublished(client, provider, SignalType.WARN, capabilityHash, clientTrust, true);
    }

    function autoRecordSuccess(
        address client,
        address provider,
        bytes32 capabilityHash
    ) external onlyServiceAgreement noFlashLoan(provider) {
        successStreak[provider] += 1;

        if (successStreak[provider] < ENDORSE_STREAK_THRESHOLD) return;
        if (hasAutoSignaled[client][provider]) return;

        uint256 clientTrust = _getTrust(client);

        _signals[provider].push(Signal({
            publisher: client,
            subject: provider,
            signalType: SignalType.ENDORSE,
            capabilityHash: capabilityHash,
            reason: "Consecutive successful deliveries (auto-endorsed)",
            publisherTrustAtTime: clientTrust,
            timestamp: block.timestamp,
            autoPublished: true
        }));
        hasAutoSignaled[client][provider] = true;
        successStreak[provider] = 0;

        emit SignalPublished(client, provider, SignalType.ENDORSE, capabilityHash, clientTrust, true);
    }

    // ─── Reputation Queries ───────────────────────────────────────────────────

    function getReputation(address subject) external view returns (
        uint256 endorsements,
        uint256 warnings,
        uint256 blocks,
        uint256 weightedScore
    ) {
        Signal[] storage sigs = _signals[subject];
        uint256 positiveWeight;
        uint256 negativeWeight;

        for (uint256 i = 0; i < sigs.length; i++) {
            Signal storage s = sigs[i];
            if (s.signalType == SignalType.ENDORSE) {
                endorsements++;
                positiveWeight += s.publisherTrustAtTime;
            } else if (s.signalType == SignalType.WARN) {
                warnings++;
                negativeWeight += s.publisherTrustAtTime;
            } else {
                blocks++;
                negativeWeight += s.publisherTrustAtTime;
            }
        }

        weightedScore = positiveWeight > negativeWeight ? positiveWeight - negativeWeight : 0;
    }

    function getCapabilityReputation(address subject, bytes32 capabilityHash)
        external view returns (uint256 weightedScore)
    {
        Signal[] storage sigs = _signals[subject];
        uint256 positiveWeight;
        uint256 negativeWeight;

        for (uint256 i = 0; i < sigs.length; i++) {
            Signal storage s = sigs[i];
            if (s.capabilityHash != capabilityHash && s.capabilityHash != bytes32(0)) continue;

            if (s.signalType == SignalType.ENDORSE) {
                positiveWeight += s.publisherTrustAtTime;
            } else {
                negativeWeight += s.publisherTrustAtTime;
            }
        }

        weightedScore = positiveWeight > negativeWeight ? positiveWeight - negativeWeight : 0;
    }

    function getSignalCount(address subject) external view returns (uint256) {
        return _signals[subject].length;
    }

    function getSignal(address subject, uint256 index) external view returns (Signal memory) {
        require(index < _signals[subject].length, "ReputationOracle: out of bounds");
        return _signals[subject][index];
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _getTrust(address wallet) internal view returns (uint256) {
        try trustRegistry.getScore(wallet) returns (uint256 score) {
            return score;
        } catch {
            return 0;
        }
    }
}
