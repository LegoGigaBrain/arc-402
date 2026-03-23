// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title ComputeAgreement
 * @notice Session-based GPU compute rental — client deposits upfront, provider
 *         submits signed metered usage reports, settlement is per-minute.
 *
 *  Lifecycle:
 *    proposeSession  (client, with deposit)
 *    acceptSession   (provider)
 *    startSession    (provider, records block.timestamp)
 *    submitUsageReport* (provider, every 15 min)
 *    endSession      (either party) → credits provider + client; each withdraws
 *
 *  Dispute: client calls disputeSession to freeze settlement.
 *           Arbitrator (set at construction) resolves via resolveDispute.
 *           If no resolution within DISPUTE_TIMEOUT, client can force-refund.
 *
 *  Security fixes applied (2026-03-23 audit):
 *    CA-1: Pull-payment pattern — no sequential ETH pushes in endSession
 *    CA-2: Report digest dedup — same signature cannot be replayed
 *    CA-3: Session expiry — client can cancel Proposed/unstarted sessions
 *    CA-4: Dispute resolution — arbitrator + timeout fallback
 *    CA-6: Overpayment refund at propose time
 *    CA-8: consumedMinutes capped to maxHours * 60
 *    CA-9: Self-dealing prevented (provider != client)
 *    CA-10: ecrecover(0) explicitly rejected
 *    CA-11: Custom error for already-started
 *    CA-12: Pinned pragma
 *    CA-14: Period timestamps validated
 */
contract ComputeAgreement {
    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Time after proposal that provider must accept before client can cancel.
    uint256 public constant PROPOSAL_TTL    = 48 hours;
    /// @notice Time after dispute before client can force-refund if unresolved.
    uint256 public constant DISPUTE_TIMEOUT = 7 days;

    // ─── Enums ────────────────────────────────────────────────────────────────

    enum SessionStatus { Proposed, Active, Completed, Disputed, Cancelled }

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct ComputeSession {
        address client;
        address provider;
        uint256 ratePerHour;        // Wei per GPU-hour
        uint256 maxHours;
        uint256 depositAmount;      // Total deposited by client (ratePerHour * maxHours)
        uint256 startedAt;          // block.timestamp when startSession called
        uint256 endedAt;            // block.timestamp when endSession called (0 = active)
        uint256 consumedMinutes;    // Accumulated GPU-minutes from all usage reports
        uint256 proposedAt;         // block.timestamp when proposeSession called
        uint256 disputedAt;         // block.timestamp when disputeSession called (0 = no dispute)
        bytes32 gpuSpecHash;        // keccak256 of GPU spec JSON
        SessionStatus status;
    }

    struct UsageReport {
        uint256 periodStart;
        uint256 periodEnd;
        uint256 computeMinutes;
        uint256 avgUtilization;     // 0–100
        bytes   providerSignature;
        bytes32 metricsHash;        // keccak256 of raw metrics JSON for dispute evidence
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    /// @notice Designated arbitrator for dispute resolution.
    address public immutable arbitrator;

    mapping(bytes32 => ComputeSession) public sessions;
    mapping(bytes32 => UsageReport[])  public usageReports;

    /// @dev CA-2: tracks consumed report digests to prevent signature replay.
    mapping(bytes32 => bool) public reportDigestUsed;

    /// @dev CA-1: pull-payment balances; party => claimable ETH.
    mapping(address => uint256) public pendingWithdrawals;

    // ─── Events ───────────────────────────────────────────────────────────────

    event SessionProposed(
        bytes32 indexed sessionId,
        address indexed client,
        address indexed provider,
        uint256 ratePerHour,
        uint256 maxHours
    );
    event SessionAccepted(bytes32 indexed sessionId);
    event SessionStarted(bytes32 indexed sessionId, uint256 startedAt);
    event UsageReported(
        bytes32 indexed sessionId,
        uint256 computeMinutes,
        uint256 periodEnd
    );
    event SessionCompleted(
        bytes32 indexed sessionId,
        uint256 totalMinutes,
        uint256 totalPaid,
        uint256 refunded
    );
    event SessionDisputed(bytes32 indexed sessionId, address disputant);
    event SessionCancelled(bytes32 indexed sessionId);
    event DisputeResolved(bytes32 indexed sessionId, uint256 providerAmount, uint256 clientAmount);
    event Withdrawn(address indexed recipient, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error SessionAlreadyExists();
    error SessionNotFound();
    error WrongStatus(SessionStatus current, SessionStatus expected);
    error NotProvider();
    error NotClient();
    error NotParty();
    error NotArbitrator();
    error InsufficientDeposit(uint256 required, uint256 provided);
    error TransferFailed();
    error InvalidSignature();
    error AlreadyStarted();
    error SelfDealing();
    error ProposalNotExpired();
    error DisputeNotExpired();
    error InvalidPeriod();
    error ExceedsMaxMinutes();
    error ReportAlreadySubmitted();
    error NothingToWithdraw();
    error InvalidSplit();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _arbitrator) {
        arbitrator = _arbitrator;
    }

    // ─── Public functions ─────────────────────────────────────────────────────

    /**
     * @notice Client proposes a compute session and deposits exactly the maximum cost.
     *         Any excess msg.value beyond ratePerHour * maxHours is refunded immediately.
     *         CA-6: overpayment refund; CA-9: self-dealing prevention.
     * @param sessionId   Unique identifier (keccak256 of client + nonce).
     * @param provider    GPU provider's address.
     * @param ratePerHour Wei per GPU-hour.
     * @param maxHours    Maximum session length in hours.
     * @param gpuSpecHash keccak256 of the agreed GPU spec JSON.
     */
    function proposeSession(
        bytes32 sessionId,
        address provider,
        uint256 ratePerHour,
        uint256 maxHours,
        bytes32 gpuSpecHash
    ) external payable {
        // CA-9: prevent self-dealing
        if (provider == msg.sender) revert SelfDealing();
        if (sessions[sessionId].client != address(0)) revert SessionAlreadyExists();

        uint256 required = ratePerHour * maxHours;
        if (msg.value < required) revert InsufficientDeposit(required, msg.value);

        sessions[sessionId] = ComputeSession({
            client:          msg.sender,
            provider:        provider,
            ratePerHour:     ratePerHour,
            maxHours:        maxHours,
            depositAmount:   required,   // CA-6: store exactly required, not msg.value
            startedAt:       0,
            endedAt:         0,
            consumedMinutes: 0,
            proposedAt:      block.timestamp,
            disputedAt:      0,
            gpuSpecHash:     gpuSpecHash,
            status:          SessionStatus.Proposed
        });

        emit SessionProposed(sessionId, msg.sender, provider, ratePerHour, maxHours);

        // CA-6: refund any overpayment immediately
        uint256 excess = msg.value - required;
        if (excess > 0) {
            (bool ok,) = msg.sender.call{value: excess}("");
            if (!ok) revert TransferFailed();
        }
    }

    /**
     * @notice Provider accepts the proposed session (moves to Active).
     */
    function acceptSession(bytes32 sessionId) external {
        ComputeSession storage s = _getSession(sessionId);
        if (msg.sender != s.provider) revert NotProvider();
        if (s.status != SessionStatus.Proposed) revert WrongStatus(s.status, SessionStatus.Proposed);

        s.status = SessionStatus.Active;
        emit SessionAccepted(sessionId);
    }

    /**
     * @notice Provider starts the session — records block.timestamp.
     *         Must have been accepted first.
     *         CA-11: uses custom error AlreadyStarted.
     */
    function startSession(bytes32 sessionId) external {
        ComputeSession storage s = _getSession(sessionId);
        if (msg.sender != s.provider) revert NotProvider();
        if (s.status != SessionStatus.Active) revert WrongStatus(s.status, SessionStatus.Active);
        if (s.startedAt != 0) revert AlreadyStarted();

        s.startedAt = block.timestamp;
        emit SessionStarted(sessionId, block.timestamp);
    }

    /**
     * @notice Provider submits a signed usage report for a metering period.
     *         CA-2: digest dedup prevents replay.
     *         CA-8: consumedMinutes capped to maxHours * 60.
     *         CA-10: ecrecover(0) explicitly rejected.
     *         CA-14: period timestamps validated.
     */
    function submitUsageReport(
        bytes32 sessionId,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 computeMinutes,
        uint256 avgUtilization,
        bytes calldata providerSignature,
        bytes32 metricsHash
    ) external {
        ComputeSession storage s = _getSession(sessionId);
        if (msg.sender != s.provider) revert NotProvider();
        if (s.status != SessionStatus.Active) revert WrongStatus(s.status, SessionStatus.Active);
        require(s.startedAt > 0, "Session not started");
        require(avgUtilization <= 100, "Utilization out of range");

        // CA-14: validate period timestamps
        if (periodEnd <= periodStart) revert InvalidPeriod();
        if (periodStart < s.startedAt) revert InvalidPeriod();
        if (periodEnd > block.timestamp) revert InvalidPeriod();

        // CA-8: enforce cap on total consumed minutes
        uint256 maxMinutes = s.maxHours * 60;
        if (s.consumedMinutes + computeMinutes > maxMinutes) revert ExceedsMaxMinutes();

        // Verify provider signature over the report fields
        bytes32 digest = _reportDigest(
            sessionId, periodStart, periodEnd, computeMinutes, avgUtilization, metricsHash
        );

        // CA-2: reject replayed report digests
        if (reportDigestUsed[digest]) revert ReportAlreadySubmitted();
        reportDigestUsed[digest] = true;

        address recovered = _recoverSigner(digest, providerSignature);
        // CA-10: reject ecrecover returning address(0)
        if (recovered == address(0) || recovered != s.provider) revert InvalidSignature();

        s.consumedMinutes += computeMinutes;

        usageReports[sessionId].push(UsageReport({
            periodStart:       periodStart,
            periodEnd:         periodEnd,
            computeMinutes:    computeMinutes,
            avgUtilization:    avgUtilization,
            providerSignature: providerSignature,
            metricsHash:       metricsHash
        }));

        emit UsageReported(sessionId, computeMinutes, periodEnd);
    }

    /**
     * @notice Either party ends the session. Calculates cost from consumedMinutes,
     *         credits provider and client balances for independent withdrawal.
     *         CA-1: pull-payment pattern — no sequential ETH pushes.
     */
    function endSession(bytes32 sessionId) external {
        ComputeSession storage s = _getSession(sessionId);
        if (msg.sender != s.client && msg.sender != s.provider) revert NotParty();
        if (s.status != SessionStatus.Active) revert WrongStatus(s.status, SessionStatus.Active);

        s.status  = SessionStatus.Completed;
        s.endedAt = block.timestamp;

        uint256 cost    = calculateCost(sessionId);
        uint256 deposit = s.depositAmount;

        // Clamp to deposit (can't exceed what was deposited)
        if (cost > deposit) cost = deposit;
        uint256 refund = deposit - cost;

        // CA-1: credit balances instead of push-transfers
        if (cost > 0)   pendingWithdrawals[s.provider] += cost;
        if (refund > 0) pendingWithdrawals[s.client]   += refund;

        emit SessionCompleted(sessionId, s.consumedMinutes, cost, refund);
    }

    /**
     * @notice Client disputes the session — freezes settlement pending arbitration.
     */
    function disputeSession(bytes32 sessionId) external {
        ComputeSession storage s = _getSession(sessionId);
        if (msg.sender != s.client) revert NotClient();
        if (s.status != SessionStatus.Active) revert WrongStatus(s.status, SessionStatus.Active);

        s.status    = SessionStatus.Disputed;
        s.disputedAt = block.timestamp;
        emit SessionDisputed(sessionId, msg.sender);
    }

    /**
     * @notice Arbitrator resolves a disputed session by specifying split.
     *         CA-4: provides an actual resolution path.
     * @param providerAmount ETH to credit to provider.
     * @param clientAmount   ETH to credit to client.
     */
    function resolveDispute(
        bytes32 sessionId,
        uint256 providerAmount,
        uint256 clientAmount
    ) external {
        if (msg.sender != arbitrator) revert NotArbitrator();
        ComputeSession storage s = _getSession(sessionId);
        if (s.status != SessionStatus.Disputed) revert WrongStatus(s.status, SessionStatus.Disputed);

        if (providerAmount + clientAmount > s.depositAmount) revert InvalidSplit();

        s.status  = SessionStatus.Completed;
        s.endedAt = block.timestamp;

        if (providerAmount > 0) pendingWithdrawals[s.provider] += providerAmount;
        if (clientAmount   > 0) pendingWithdrawals[s.client]   += clientAmount;

        // Any remainder goes back to client (rounding safety)
        uint256 remainder = s.depositAmount - providerAmount - clientAmount;
        if (remainder > 0) pendingWithdrawals[s.client] += remainder;

        emit DisputeResolved(sessionId, providerAmount, clientAmount);
    }

    /**
     * @notice Client force-refunds after DISPUTE_TIMEOUT with no arbitrator resolution.
     *         CA-4: timeout fallback so funds never lock permanently.
     */
    function claimDisputeTimeout(bytes32 sessionId) external {
        ComputeSession storage s = _getSession(sessionId);
        if (msg.sender != s.client) revert NotClient();
        if (s.status != SessionStatus.Disputed) revert WrongStatus(s.status, SessionStatus.Disputed);
        if (block.timestamp < s.disputedAt + DISPUTE_TIMEOUT) revert DisputeNotExpired();

        s.status  = SessionStatus.Completed;
        s.endedAt = block.timestamp;

        pendingWithdrawals[s.client] += s.depositAmount;

        emit DisputeResolved(sessionId, 0, s.depositAmount);
    }

    /**
     * @notice Client cancels a session that is still Proposed and past PROPOSAL_TTL,
     *         or that was accepted but never started (Active with startedAt == 0).
     *         CA-3: prevents deposit lockup from unresponsive providers.
     */
    function cancelSession(bytes32 sessionId) external {
        ComputeSession storage s = _getSession(sessionId);
        if (msg.sender != s.client) revert NotClient();

        bool canCancel = false;

        if (s.status == SessionStatus.Proposed) {
            // Allow immediate cancel if past proposal TTL, OR immediately if provider hasn't acted
            if (block.timestamp >= s.proposedAt + PROPOSAL_TTL) {
                canCancel = true;
            }
        } else if (s.status == SessionStatus.Active && s.startedAt == 0) {
            // Accepted but never started — client can cancel at any time
            canCancel = true;
        }

        if (!canCancel) revert ProposalNotExpired();

        s.status = SessionStatus.Cancelled;
        pendingWithdrawals[s.client] += s.depositAmount;

        emit SessionCancelled(sessionId);
    }

    /**
     * @notice Pull-payment: any party withdraws their credited balance.
     *         CA-1: pull pattern eliminates provider-griefs-client vector.
     */
    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /**
     * @notice Calculate cost based on consumedMinutes.
     *         cost = (consumedMinutes * ratePerHour) / 60
     */
    function calculateCost(bytes32 sessionId) public view returns (uint256) {
        ComputeSession storage s = sessions[sessionId];
        if (s.client == address(0)) return 0;
        return (s.consumedMinutes * s.ratePerHour) / 60;
    }

    /**
     * @notice Return full session struct.
     */
    function getSession(bytes32 sessionId) external view returns (ComputeSession memory) {
        return sessions[sessionId];
    }

    /**
     * @notice Return all usage reports for a session.
     */
    function getUsageReports(bytes32 sessionId) external view returns (UsageReport[] memory) {
        return usageReports[sessionId];
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _getSession(bytes32 sessionId) internal view returns (ComputeSession storage s) {
        s = sessions[sessionId];
        if (s.client == address(0)) revert SessionNotFound();
    }

    /**
     * @dev EIP-191 personal_sign digest for a usage report.
     *      Matches the TypeScript signing in compute-metering.ts.
     */
    function _reportDigest(
        bytes32 sessionId,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 computeMinutes,
        uint256 avgUtilization,
        bytes32 metricsHash
    ) internal pure returns (bytes32) {
        bytes32 structHash = keccak256(abi.encodePacked(
            sessionId,
            periodStart,
            periodEnd,
            computeMinutes,
            avgUtilization,
            metricsHash
        ));
        // Wrap in EIP-191 personal_sign prefix so ethers.js signMessage matches
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", structHash));
    }

    /**
     * @dev Recover signer from an EIP-191 signature.
     *      CA-10: caller must check recovered != address(0).
     */
    function _recoverSigner(bytes32 digest, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid sig length");
        bytes32 r;
        bytes32 sv;
        uint8 v;
        assembly {
            r  := mload(add(sig, 32))
            sv := mload(add(sig, 64))
            v  := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, sv);
    }
}
