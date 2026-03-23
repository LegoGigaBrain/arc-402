// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title IComputeDisputeArbitration
 * @notice Minimal interface for DisputeArbitration integration with ComputeAgreement.
 *         Full interface: reference/contracts/IDisputeArbitration.sol
 */
interface IComputeDisputeArbitration {
    enum DisputeMode  { UNILATERAL, MUTUAL }
    enum DisputeClass { HARD_FAILURE, AMBIGUITY_QUALITY, HIGH_SENSITIVITY }

    function openDispute(
        uint256 agreementId,
        DisputeMode mode,
        DisputeClass disputeClass,
        address opener,
        address client,
        address provider,
        uint256 agreementPrice,
        address token
    ) external payable returns (uint256 feeRequired);

    function resolveDisputeFee(uint256 agreementId, uint8 outcome) external;
    function isEligibleArbitrator(address arbitrator) external view returns (bool);
}

/**
 * @title ComputeAgreement
 * @notice Session-based GPU compute rental — client deposits upfront, provider
 *         submits signed metered usage reports, settlement is per-minute.
 *
 *  Lifecycle:
 *    proposeSession  (client, with deposit — ETH or ERC-20)
 *    acceptSession   (provider)
 *    startSession    (provider, records block.timestamp)
 *    submitUsageReport* (provider, every 15 min)
 *    endSession      (either party) → credits provider + client; each withdraws
 *
 *  Dispute: client calls disputeSession to freeze settlement.
 *           If DisputeArbitration is configured, a formal dispute with fee collection
 *           is opened on-chain. Parties nominate approved arbitrators.
 *           Owner resolves via resolveDisputeDetailed with DisputeOutcome enum.
 *           DisputeArbitration handles timeout fallback mechanism.
 *
 *  Payment tokens:
 *    address(0) = native ETH
 *    otherwise  = ERC-20 (e.g. USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 *    Fee-on-transfer and rebasing tokens are NOT supported.
 *
 *  Security fixes applied (2026-03-23 audit):
 *    CA-1: Pull-payment pattern — no sequential ETH pushes in endSession
 *    CA-2: Report digest dedup — same signature cannot be replayed
 *    CA-3: Session expiry — client can cancel Proposed/unstarted sessions
 *    CA-4: Dispute resolution — DisputeArbitration integration (trustless arbitration)
 *    CA-IND-3: Exact deposit required at propose time (no overpayment)
 *    CA-8: consumedMinutes capped to maxHours * 60
 *    CA-9: Self-dealing prevented (provider != client)
 *    CA-10: ecrecover(0) explicitly rejected
 *    CA-11: Custom error for already-started
 *    CA-12: Pinned pragma
 *    CA-14: Period timestamps validated
 */
contract ComputeAgreement {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Time after proposal that provider must accept before client can cancel.
    uint256 public constant PROPOSAL_TTL = 48 hours;

    // ─── Enums ────────────────────────────────────────────────────────────────

    enum SessionStatus { Proposed, Active, Completed, Disputed, Cancelled }

    enum DisputeOutcome {
        PROVIDER_WINS,          // full deposit to provider
        CLIENT_WINS,            // full deposit to client
        SPLIT,                  // custom providerAward/clientAward
        HUMAN_REVIEW_REQUIRED   // escalated — no settlement yet, remains Disputed
    }

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct ComputeSession {
        address client;
        address provider;
        address token;              // address(0) = ETH, otherwise ERC-20
        uint256 ratePerHour;        // Token units per GPU-hour
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

    /// @notice Contract owner — resolves disputes, updates DA, approves arbitrators.
    address public owner;

    /// @notice Pending owner for two-step ownership transfer.
    address public pendingOwner;

    /// @notice DisputeArbitration contract — handles fees, bonds, and timeout fallback.
    ///         Updatable by owner. If address(0), disputes resolved by owner only.
    address public disputeArbitration;

    /// @notice Protocol fee in basis points (max 100 = 1%). Default: 15.
    uint256 public protocolFeeBps = 15;
    /// @notice MAX_PROTOCOL_FEE_BPS Protocol fee ceiling.
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 100;
    /// @notice Protocol treasury — receives protocol fees. address(0) = fees burned.
    address public protocolTreasury;

    /// @notice Arbitrators approved for nomination in disputed sessions.
    mapping(address => bool) public approvedArbitrators;

    /// @notice Tracks arbitrators nominated per session (sessionId => arbitrator => nominated).
    mapping(bytes32 => mapping(address => bool)) public disputeArbitratorNominated;

    mapping(bytes32 => ComputeSession) public sessions;
    mapping(bytes32 => UsageReport[])  public usageReports;

    /// @dev CA-2: tracks consumed report digests to prevent signature replay.
    mapping(bytes32 => bool) public reportDigestUsed;

    /// @dev CA-1: pull-payment balances; user => token => claimable amount.
    ///      token == address(0) for ETH.
    mapping(address => mapping(address => uint256)) public pendingWithdrawals;

    // ─── Events ───────────────────────────────────────────────────────────────

    event SessionProposed(
        bytes32 indexed sessionId,
        address indexed client,
        address indexed provider,
        uint256 ratePerHour,
        uint256 maxHours,
        address token
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
    event DetailedDisputeResolved(
        bytes32 indexed sessionId,
        DisputeOutcome outcome,
        uint256 providerAmount,
        uint256 clientAmount
    );
    event Withdrawn(address indexed recipient, address indexed token, uint256 amount);
    event ProtocolFeeUpdated(uint256 newFeeBps);
    event ProtocolTreasuryUpdated(address newTreasury);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event DisputeArbitrationUpdated(address indexed da);
    event ArbitratorApprovalUpdated(address indexed arbitrator, bool approved);
    event ArbitratorNominated(
        bytes32 indexed sessionId,
        address indexed nominator,
        address indexed arbitrator
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error SessionAlreadyExists();
    error SessionNotFound();
    error WrongStatus(SessionStatus current, SessionStatus expected);
    error NotProvider();
    error NotClient();
    error NotParty();
    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error InsufficientDeposit(uint256 required, uint256 provided);
    error TransferFailed();
    error InvalidSignature();
    error AlreadyStarted();
    error SelfDealing();
    error ProposalNotExpired();
    error InvalidPeriod();
    error ExceedsMaxMinutes();
    error ReportAlreadySubmitted();
    error NothingToWithdraw();
    error InvalidSplit();
    error MsgValueWithToken();
    error ArbitratorNotApproved();
    error ArbitratorAlreadyNominated();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─── Owner management ─────────────────────────────────────────────────────

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

    /// @notice Set the DisputeArbitration contract (pass address(0) to unset).
    function setDisputeArbitration(address da) external onlyOwner {
        disputeArbitration = da;
        emit DisputeArbitrationUpdated(da);
    }

    function setProtocolFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= MAX_PROTOCOL_FEE_BPS, 'Fee exceeds ceiling');
        protocolFeeBps = feeBps;
        emit ProtocolFeeUpdated(feeBps);
    }

    function setProtocolTreasury(address treasury) external onlyOwner {
        protocolTreasury = treasury;
        emit ProtocolTreasuryUpdated(treasury);
    }

    /// @notice Approve or revoke an arbitrator for nomination.
    function setArbitratorApproval(address arbitrator, bool approved) external onlyOwner {
        approvedArbitrators[arbitrator] = approved;
        emit ArbitratorApprovalUpdated(arbitrator, approved);
    }

    // ─── Public functions ─────────────────────────────────────────────────────

    /**
     * @notice Client proposes a compute session and deposits exactly the maximum cost.
     *         CA-IND-3: exact deposit required — no overpayment accepted.
     *         CA-9: self-dealing prevention.
     *         ERC-20: pass token != address(0) and pre-approve this contract.
     *         ETH: pass token == address(0) and send msg.value == required.
     *         NOTE: fee-on-transfer and rebasing tokens are not supported.
     * @param sessionId   Unique identifier (keccak256 of client + nonce).
     * @param provider    GPU provider's address.
     * @param ratePerHour Token units per GPU-hour.
     * @param maxHours    Maximum session length in hours.
     * @param gpuSpecHash keccak256 of the agreed GPU spec JSON.
     * @param token       Payment token (address(0) = ETH).
     */
    function proposeSession(
        bytes32 sessionId,
        address provider,
        uint256 ratePerHour,
        uint256 maxHours,
        bytes32 gpuSpecHash,
        address token
    ) external payable {
        // CA-9: prevent self-dealing
        if (provider == msg.sender) revert SelfDealing();
        if (sessions[sessionId].client != address(0)) revert SessionAlreadyExists();

        uint256 required = ratePerHour * maxHours;

        if (token == address(0)) {
            // ETH path: exact msg.value required
            if (msg.value != required) revert InsufficientDeposit(required, msg.value);
        } else {
            // ERC-20 path: no ETH should be sent
            if (msg.value != 0) revert MsgValueWithToken();
            IERC20(token).safeTransferFrom(msg.sender, address(this), required);
        }

        // Direct field assignment to avoid stack-too-deep with struct literal (13 fields).
        ComputeSession storage s = sessions[sessionId];
        s.client          = msg.sender;
        s.provider        = provider;
        s.token           = token;
        s.ratePerHour     = ratePerHour;
        s.maxHours        = maxHours;
        s.depositAmount   = required;
        s.proposedAt      = block.timestamp;
        s.gpuSpecHash     = gpuSpecHash;
        s.status          = SessionStatus.Proposed;
        // startedAt, endedAt, consumedMinutes, disputedAt remain 0 (default)

        emit SessionProposed(sessionId, msg.sender, provider, ratePerHour, maxHours, token);
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
     *         CA-1: pull-payment pattern — no sequential pushes.
     */
    function endSession(bytes32 sessionId) external {
        ComputeSession storage s = _getSession(sessionId);
        if (msg.sender != s.client && msg.sender != s.provider) revert NotParty();
        if (s.status != SessionStatus.Active) revert WrongStatus(s.status, SessionStatus.Active);

        s.status  = SessionStatus.Completed;
        s.endedAt = block.timestamp;

        uint256 cost    = calculateCost(sessionId);
        uint256 deposit = s.depositAmount;
        address tok     = s.token;

        // Clamp to deposit (can't exceed what was deposited)
        if (cost > deposit) cost = deposit;
        uint256 refund = deposit - cost;

        // CA-1: credit balances instead of push-transfers
        if (cost > 0) {
            uint256 fee = protocolFeeBps > 0 && protocolTreasury != address(0)
                ? (cost * protocolFeeBps) / 10_000 : 0;
            if (fee > 0) pendingWithdrawals[protocolTreasury][tok] += fee;
            pendingWithdrawals[s.provider][tok] += cost - fee;
        }
        if (refund > 0) pendingWithdrawals[s.client][tok] += refund;

        emit SessionCompleted(sessionId, s.consumedMinutes, cost, refund);
    }

    /**
     * @notice Client disputes the session — freezes settlement pending arbitration.
     *         If DisputeArbitration is configured, opens a formal dispute with fee
     *         collection (forward ETH as msg.value for ETH-denominated DA fees).
     *         If DA is not set, dispute is simple — owner resolves via resolveDisputeDetailed.
     */
    function disputeSession(bytes32 sessionId) external payable {
        ComputeSession storage s = _getSession(sessionId);
        if (msg.sender != s.client) revert NotClient();
        if (s.status != SessionStatus.Active) revert WrongStatus(s.status, SessionStatus.Active);

        s.status     = SessionStatus.Disputed;
        s.disputedAt = block.timestamp;

        _callOpenFormalDispute(sessionId, s);

        emit SessionDisputed(sessionId, msg.sender);
    }

    /**
     * @notice Either party nominates an approved arbitrator for their disputed session.
     *         If DisputeArbitration is configured, also checks DA eligibility.
     * @param sessionId  The disputed session.
     * @param arbitrator An address in the approvedArbitrators allowlist.
     */
    function nominateArbitrator(bytes32 sessionId, address arbitrator) external {
        ComputeSession storage s = _getSession(sessionId);
        if (msg.sender != s.client && msg.sender != s.provider) revert NotParty();
        if (s.status != SessionStatus.Disputed) revert WrongStatus(s.status, SessionStatus.Disputed);
        if (!approvedArbitrators[arbitrator]) revert ArbitratorNotApproved();
        if (disputeArbitratorNominated[sessionId][arbitrator]) revert ArbitratorAlreadyNominated();

        // If DA is configured, additionally verify DA-level eligibility
        if (disputeArbitration != address(0)) {
            if (!IComputeDisputeArbitration(disputeArbitration).isEligibleArbitrator(arbitrator)) {
                revert ArbitratorNotApproved();
            }
        }

        disputeArbitratorNominated[sessionId][arbitrator] = true;
        emit ArbitratorNominated(sessionId, msg.sender, arbitrator);
    }

    /**
     * @notice Owner resolves a disputed session with a typed outcome.
     *         Notifies DisputeArbitration (if set) to settle fees and bonds.
     *         SPLIT: providerAward + clientAward must not exceed depositAmount;
     *                any remainder automatically goes to client.
     *         PROVIDER_WINS / CLIENT_WINS: amounts are derived from depositAmount.
     *         HUMAN_REVIEW_REQUIRED: emits event without settling; session stays Disputed.
     * @param sessionId     The disputed session to resolve.
     * @param outcome       Resolution type.
     * @param providerAward Token units awarded to provider (SPLIT only).
     * @param clientAward   Token units awarded to client (SPLIT only).
     */
    function resolveDisputeDetailed(
        bytes32 sessionId,
        DisputeOutcome outcome,
        uint256 providerAward,
        uint256 clientAward
    ) external onlyOwner {
        ComputeSession storage s = _getSession(sessionId);
        if (s.status != SessionStatus.Disputed) revert WrongStatus(s.status, SessionStatus.Disputed);

        if (outcome == DisputeOutcome.HUMAN_REVIEW_REQUIRED) {
            // Signal escalation — no settlement yet; session remains Disputed
            emit DetailedDisputeResolved(sessionId, outcome, 0, 0);
            return;
        }

        if (outcome == DisputeOutcome.PROVIDER_WINS) {
            providerAward = s.depositAmount;
            clientAward   = 0;
        } else if (outcome == DisputeOutcome.CLIENT_WINS) {
            providerAward = 0;
            clientAward   = s.depositAmount;
        }
        // SPLIT: use caller-supplied providerAward/clientAward

        if (providerAward + clientAward > s.depositAmount) revert InvalidSplit();

        s.status  = SessionStatus.Completed;
        s.endedAt = block.timestamp;

        address tok = s.token;
        if (providerAward > 0) {
            uint256 fee = protocolFeeBps > 0 && protocolTreasury != address(0)
                ? (providerAward * protocolFeeBps) / 10_000 : 0;
            if (fee > 0) pendingWithdrawals[protocolTreasury][tok] += fee;
            pendingWithdrawals[s.provider][tok] += providerAward - fee;
        }
        if (clientAward   > 0) pendingWithdrawals[s.client][tok]   += clientAward;

        // Remainder (from SPLIT under-allocation) goes to client
        uint256 remainder = s.depositAmount - providerAward - clientAward;
        if (remainder > 0) pendingWithdrawals[s.client][tok] += remainder;

        // Notify DA to settle fees and arbitrator bonds (ignore failures)
        if (disputeArbitration != address(0)) {
            try IComputeDisputeArbitration(disputeArbitration).resolveDisputeFee(
                uint256(sessionId), uint8(outcome)
            ) {} catch {}
        }

        emit DetailedDisputeResolved(sessionId, outcome, providerAward, clientAward);
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
            if (block.timestamp >= s.proposedAt + PROPOSAL_TTL) {
                canCancel = true;
            }
        } else if (s.status == SessionStatus.Active && s.startedAt == 0) {
            canCancel = true;
        }

        if (!canCancel) revert ProposalNotExpired();

        s.status = SessionStatus.Cancelled;
        pendingWithdrawals[s.client][s.token] += s.depositAmount;

        emit SessionCancelled(sessionId);
    }

    /**
     * @notice Pull-payment: withdraw credited balance for a specific token.
     *         CA-1: pull pattern eliminates push-payment griefing vector.
     * @param token Payment token to withdraw (address(0) = ETH).
     */
    function withdraw(address token) external {
        uint256 amount = pendingWithdrawals[msg.sender][token];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender][token] = 0;

        if (token == address(0)) {
            (bool ok,) = msg.sender.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }

        emit Withdrawn(msg.sender, token, amount);
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
     * @dev Open a formal dispute in DisputeArbitration if configured.
     *      If DA is not set, the dispute is simple — owner resolves.
     *      Uses try/catch so a DA failure does not revert the dispute itself.
     */
    function _callOpenFormalDispute(bytes32 sessionId, ComputeSession storage s) internal {
        if (disputeArbitration == address(0)) return;
        try IComputeDisputeArbitration(disputeArbitration).openDispute{value: msg.value}(
            uint256(sessionId),
            IComputeDisputeArbitration.DisputeMode.UNILATERAL,
            IComputeDisputeArbitration.DisputeClass.HARD_FAILURE,
            msg.sender,
            s.client,
            s.provider,
            s.depositAmount,
            s.token
        ) {} catch {}
    }

    /**
     * @dev EIP-191 personal_sign digest for a usage report.
     *      CA-IND-1: includes block.chainid and address(this) to prevent cross-chain
     *      and cross-contract signature replay.
     *      CA-IND-7: uses abi.encode (no hash-collision risk from dynamic packing).
     *      Matches the TypeScript signing in compute-metering.ts.
     */
    function _reportDigest(
        bytes32 sessionId,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 computeMinutes,
        uint256 avgUtilization,
        bytes32 metricsHash
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            block.chainid,
            address(this),
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
     *      CA-IND-2: rejects malleable s-values (s > secp256k1n/2) and invalid v.
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
        require(uint256(sv) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "Invalid s");
        require(v == 27 || v == 28, "Invalid v");
        return ecrecover(digest, v, r, sv);
    }
}
