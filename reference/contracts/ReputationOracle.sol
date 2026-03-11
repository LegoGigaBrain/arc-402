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
 * Signal sources:
 *   1. Auto-WARN: ServiceAgreement auto-publishes a WARN when a dispute resolves against the provider.
 *   2. Auto-ENDORSE: ServiceAgreement auto-publishes an ENDORSE after N consecutive successful deliveries.
 *   3. Manual: Any agent can publish a signal about any other agent (one signal per pair).
 *
 * Trust weighting: all scores are weighted by publisherTrustAtTime. A WARN from a trust-900 agent
 * carries 9x the weight of one from a trust-100 agent. This prevents review-bombing by low-trust Sybils.
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
        bytes32 capabilityHash; // keccak256(capability) or bytes32(0) for general signal
        string reason;
        uint256 publisherTrustAtTime; // snapshot of publisher trust at publication time
        uint256 timestamp;
        bool autoPublished;     // true if emitted by ServiceAgreement, false if manual
    }

    // ─── State ────────────────────────────────────────────────────────────────

    ITrustRegistry public immutable trustRegistry;

    /// @notice Address of the ServiceAgreement contract allowed to auto-publish signals.
    ///         Set at construction. address(0) disables auto-publishing.
    address public immutable serviceAgreement;

    /// @notice subject → all signals published about them
    mapping(address => Signal[]) private _signals;

    /// @notice publisher → subject → already signaled (one signal per pair, manual only)
    mapping(address => mapping(address => bool)) public hasSignaled;

    /// @notice subject → consecutive successful delivery count (used for auto-endorse threshold)
    mapping(address => uint256) public successStreak;

    /// @notice Minimum consecutive successes before auto-ENDORSE is published.
    uint256 public constant ENDORSE_STREAK_THRESHOLD = 5;

    // ─── Events ──────────────────────────────────────────────────────────────

    event SignalPublished(
        address indexed publisher,
        address indexed subject,
        SignalType signalType,
        bytes32 capabilityHash,
        uint256 publisherTrustAtTime,
        bool autoPublished
    );

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _trustRegistry, address _serviceAgreement) {
        require(_trustRegistry != address(0), "ReputationOracle: zero trust registry");
        trustRegistry = ITrustRegistry(_trustRegistry);
        serviceAgreement = _serviceAgreement; // may be address(0) to disable auto-publish
    }

    // ─── Manual Signal Publishing ─────────────────────────────────────────────

    /**
     * @notice Publish a trust signal about another agent.
     * @dev One signal per publisher-subject pair. The signal is weighted by the publisher's
     *      current trust score. To update a signal, the publisher would need a separate flow
     *      (not implemented — keeps state simple at launch).
     * @param subject The agent being signaled about.
     * @param signalType ENDORSE, WARN, or BLOCK.
     * @param capabilityHash keccak256(capability string) for capability-specific signal, or bytes32(0) for general.
     * @param reason Human-readable reason (max 512 chars).
     */
    function publishSignal(
        address subject,
        SignalType signalType,
        bytes32 capabilityHash,
        string calldata reason
    ) external {
        require(subject != address(0), "ReputationOracle: zero subject");
        require(subject != msg.sender, "ReputationOracle: cannot signal self");
        require(bytes(reason).length <= 512, "ReputationOracle: reason too long");
        require(!hasSignaled[msg.sender][subject], "ReputationOracle: already signaled");

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
        hasSignaled[msg.sender][subject] = true;

        emit SignalPublished(msg.sender, subject, signalType, capabilityHash, publisherTrust, false);
    }

    // ─── Auto-Publishing (ServiceAgreement integration) ───────────────────────

    modifier onlyServiceAgreement() {
        require(
            msg.sender == serviceAgreement,
            "ReputationOracle: caller not ServiceAgreement"
        );
        _;
    }

    /**
     * @notice Auto-publish a WARN signal after a dispute resolves against the provider.
     *         Called by ServiceAgreement.resolveDispute() when client wins.
     * @param client The winning party (becomes the publisher of the WARN).
     * @param provider The losing party (subject of the WARN).
     * @param capabilityHash Capability the agreement was for.
     */
    function autoWarn(
        address client,
        address provider,
        bytes32 capabilityHash
    ) external onlyServiceAgreement {
        // Reset provider success streak on dispute loss
        successStreak[provider] = 0;

        // Idempotent: if client already signaled this provider, don't double-warn.
        // The trust weight of the existing signal still stands.
        if (hasSignaled[client][provider]) return;

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
        hasSignaled[client][provider] = true;

        emit SignalPublished(client, provider, SignalType.WARN, capabilityHash, clientTrust, true);
    }

    /**
     * @notice Record a successful delivery. After ENDORSE_STREAK_THRESHOLD consecutive
     *         successes with unique counterparties, auto-publish an ENDORSE from the client.
     * @param client The paying party (becomes the publisher of any ENDORSE).
     * @param provider The delivering party (subject of the ENDORSE).
     * @param capabilityHash Capability the agreement was for.
     */
    function autoRecordSuccess(
        address client,
        address provider,
        bytes32 capabilityHash
    ) external onlyServiceAgreement {
        successStreak[provider] += 1;

        // Only auto-endorse at streak threshold and only if not already signaled
        if (successStreak[provider] < ENDORSE_STREAK_THRESHOLD) return;
        if (hasSignaled[client][provider]) return;

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
        hasSignaled[client][provider] = true;

        // Reset streak after endorsement to prevent infinite endorsement accumulation
        successStreak[provider] = 0;

        emit SignalPublished(client, provider, SignalType.ENDORSE, capabilityHash, clientTrust, true);
    }

    // ─── Reputation Queries ───────────────────────────────────────────────────

    /**
     * @notice Get the aggregate trust-weighted reputation for a subject across all capabilities.
     * @return endorsements Total number of ENDORSE signals.
     * @return warnings Total number of WARN signals.
     * @return blocks Total number of BLOCK signals.
     * @return weightedScore Net trust-weighted score: sum(endorseTrust) - sum(warnTrust) - sum(blockTrust), floor 0.
     */
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

    /**
     * @notice Get trust-weighted reputation for a specific capability.
     * @dev Includes both general signals (capabilityHash == 0) and capability-specific ones.
     */
    function getCapabilityReputation(address subject, bytes32 capabilityHash)
        external view returns (uint256 weightedScore)
    {
        Signal[] storage sigs = _signals[subject];
        uint256 positiveWeight;
        uint256 negativeWeight;

        for (uint256 i = 0; i < sigs.length; i++) {
            Signal storage s = sigs[i];
            // Include if: capability-specific match OR general signal (capabilityHash == 0)
            if (s.capabilityHash != capabilityHash && s.capabilityHash != bytes32(0)) continue;

            if (s.signalType == SignalType.ENDORSE) {
                positiveWeight += s.publisherTrustAtTime;
            } else {
                negativeWeight += s.publisherTrustAtTime;
            }
        }

        weightedScore = positiveWeight > negativeWeight ? positiveWeight - negativeWeight : 0;
    }

    /**
     * @notice Returns the total number of signals about a subject.
     */
    function getSignalCount(address subject) external view returns (uint256) {
        return _signals[subject].length;
    }

    /**
     * @notice Returns a specific signal by index.
     */
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
