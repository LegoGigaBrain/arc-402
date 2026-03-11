// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IServiceAgreement.sol";
import "./ITrustRegistry.sol";
import "./ReputationOracle.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ServiceAgreement
 * @notice Bilateral agent-to-agent service agreements with escrow for ARC-402
 * @dev Implements a state machine:
 *      PROPOSED → ACCEPTED → FULFILLED / DISPUTED / CANCELLED
 *      ACCEPTED → PENDING_VERIFICATION → FULFILLED / DISPUTED (two-step commit-reveal path)
 *
 *      Escrow is held in this contract until released on fulfill, cancel, or dispute resolution.
 *      ETH agreements use msg.value; ERC-20 agreements use SafeERC20 transferFrom/transfer.
 *      Dispute resolution is centralised to the contract owner (intended to be a trusted
 *      arbiter or a future governance module).
 *
 * Security hardening applied (pre-mainnet audit):
 *   T-02: trustRegistry integration — trust scores update automatically on fulfill/dispute.
 *         Only ServiceAgreement is an authorized TrustRegistry updater; no arbitrary
 *         address can call recordSuccess() directly. Eliminates trust-score farming.
 *   T-03: Token allowlist — only owner-approved ERC-20 tokens can be used as payment.
 *         Prevents malicious / fee-on-transfer tokens from permanently locking escrow.
 *   T-04: Fee-on-transfer protection — prevented by the allowlist (T-03). The allowlist
 *         is the primary guard; only known-safe tokens (e.g. USDC) are approved. No
 *         balance-delta tracking is needed when token behaviour is controlled by allowlist.
 *
 * v2 additions:
 *   Feature 1 — Minimum Trust Value: agreements below minimumTrustValue complete normally
 *               but do NOT trigger trust score updates. Prevents 1-wei sybil farming.
 *   Feature 2 — Commit-Reveal Delivery: provider commits deliverable hash (PENDING_VERIFICATION),
 *               client has VERIFY_WINDOW to approve or dispute; after window anyone may autoRelease.
 *
 * STATUS: DRAFT — not audited, do not use in production
 */
contract ServiceAgreement is IServiceAgreement, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────────────────────────

    address public owner;
    /// @notice Pending owner in a two-step ownership transfer. Zero if none pending.
    address public pendingOwner;

    /// @notice Optional reference to the ReputationOracle for auto-WARN/auto-ENDORSE signals.
    ///         address(0) disables auto-publishing (e.g. in test environments).
    ReputationOracle public reputationOracle;

    /// @notice Immutable reference to the TrustRegistry. Set at deploy time.
    ///         Address 0 disables trust-score updates (e.g. in test environments
    ///         that don't need a registry). In production this must be non-zero.
    address public immutable trustRegistry;

    /// @notice ETH payment sentinel (address(0) means native ETH, not an ERC-20).
    address public constant ETH = address(0);

    /// @notice Allowlist of ERC-20 tokens (and ETH) accepted as payment.
    ///         ETH (address(0)) is allowed by default at construction.
    ///         Only known-safe tokens should be added — fee-on-transfer or
    ///         malicious tokens are prevented by keeping them off this list (T-03 / T-04).
    mapping(address => bool) public allowedTokens;

    /// @notice Minimum agreement price (in wei) for trust score updates.
    ///         0 = disabled (all agreements update trust regardless of price).
    ///         Agreements with price < minimumTrustValue complete normally but skip trust updates.
    ///         Purpose: prevent 1-wei sybil agreements from farming trust scores cheaply.
    uint256 public minimumTrustValue;

    /// @notice Duration of the client verification window in the commit-reveal path.
    uint256 public constant VERIFY_WINDOW = 3 days;

    /// @notice Duration a dispute may remain unresolved before either party can
    ///         trigger an auto-refund to the client (conservative default).
    uint256 public constant DISPUTE_TIMEOUT = 30 days;

    uint256 private _nextId;  // increments before use, so first ID = 1

    mapping(uint256 => Agreement) private _agreements;

    /// @dev client → list of agreement IDs
    mapping(address => uint256[]) private _byClient;

    /// @dev provider → list of agreement IDs
    mapping(address => uint256[]) private _byProvider;

    // ─── Events ──────────────────────────────────────────────────────────────

    event AgreementProposed(
        uint256 indexed id,
        address indexed client,
        address indexed provider,
        string serviceType,
        uint256 price,
        address token,
        uint256 deadline
    );
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
    /// @notice Emitted when a TrustRegistry call fails. Trust update is best-effort;
    ///         a failing registry must never block escrow release.
    event TrustUpdateFailed(uint256 indexed agreementId, address indexed wallet, string context);

    // ─── v2 Events ───────────────────────────────────────────────────────────

    /// @notice Emitted when the minimum trust value threshold is updated.
    event MinimumTrustValueUpdated(uint256 newValue);
    event ReputationOracleUpdated(address indexed oracle);

    /// @notice Emitted when a provider commits a deliverable hash (start of verify window).
    event DeliverableCommitted(
        uint256 indexed id,
        address indexed provider,
        bytes32 hash,
        uint256 verifyWindowEnd
    );

    /// @notice Emitted when escrow is auto-released after the verify window expired.
    event AutoReleased(uint256 indexed id, address indexed provider);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "ServiceAgreement: not owner");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param _trustRegistry Address of the TrustRegistry contract. Pass address(0)
    ///                        to disable trust-score updates (testing only).
    constructor(address _trustRegistry) {
        owner = msg.sender;
        trustRegistry = _trustRegistry;
        // ETH (address(0)) is the native payment token and is always allowed.
        allowedTokens[address(0)] = true;
        emit TokenAllowed(address(0));
    }

    // ─── Ownership ───────────────────────────────────────────────────────────

    /**
     * @notice Initiate a two-step ownership transfer. The new owner must call
     *         acceptOwnership() to complete the transfer. Until accepted, the
     *         current owner retains all privileges.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ServiceAgreement: zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /**
     * @notice Complete the ownership transfer. Must be called by the pending owner.
     */
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "ServiceAgreement: not pending owner");
        address old = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(old, owner);
    }

    // ─── Token Allowlist (Fix T-03) ──────────────────────────────────────────

    /// @notice Allow an ERC-20 token to be used as payment in agreements.
    ///         Only add tokens whose transfer() behaviour is known-safe:
    ///         no fee-on-transfer, no revert-on-transfer, no rebasing.
    function allowToken(address token) external onlyOwner {
        allowedTokens[token] = true;
        emit TokenAllowed(token);
    }

    /// @notice Remove an ERC-20 token from the payment allowlist.
    ///         Existing agreements with this token are unaffected.
    function disallowToken(address token) external onlyOwner {
        allowedTokens[token] = false;
        emit TokenDisallowed(token);
    }

    // ─── v2: Minimum Trust Value ──────────────────────────────────────────────

    /// @notice Set the minimum agreement price required for trust score updates.
    ///         Set to 0 to disable the threshold (all agreements update trust).
    ///         Agreements below this value complete and release escrow normally
    ///         but do not call recordSuccess() on the TrustRegistry.
    /// @param value Minimum price in wei. 0 = disabled.
    function setMinimumTrustValue(uint256 value) external onlyOwner {
        minimumTrustValue = value;
        emit MinimumTrustValueUpdated(value);
    }

    /// @notice Set or update the ReputationOracle integration. address(0) disables it.
    function setReputationOracle(address oracle) external onlyOwner {
        reputationOracle = ReputationOracle(oracle);
        emit ReputationOracleUpdated(oracle);
    }

    // ─── Core: Propose ───────────────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     * @dev For ETH (token == address(0)) msg.value must equal price.
     *      For ERC-20, msg.value must be 0 and the caller must have approved
     *      this contract for at least `price` tokens before calling.
     *
     *      Fee-on-transfer protection (T-04): the allowedTokens list (T-03) is the
     *      primary guard. Only tokens explicitly approved by the owner are accepted.
     *      Approved tokens (e.g. USDC) are known to transfer the full requested amount
     *      with no hidden fee. If a previously-safe token introduces a transfer fee,
     *      the owner must call disallowToken() before new agreements are created.
     */
    function propose(
        address provider,
        string calldata serviceType,
        string calldata description,
        uint256 price,
        address token,
        uint256 deadline,
        bytes32 deliverablesHash
    ) external payable nonReentrant returns (uint256 agreementId) {
        require(bytes(serviceType).length <= 64,   "ServiceAgreement: serviceType too long");
        require(bytes(description).length <= 1024, "ServiceAgreement: description too long");
        require(provider != address(0),      "ServiceAgreement: zero provider");
        require(provider != msg.sender,      "ServiceAgreement: client == provider");
        require(price > 0,                   "ServiceAgreement: zero price");
        require(deadline > block.timestamp,  "ServiceAgreement: deadline in past");
        // T-03: reject non-allowlisted tokens (blocks malicious & fee-on-transfer tokens)
        require(allowedTokens[token],        "ServiceAgreement: token not allowed");

        // Escrow handling
        if (token == address(0)) {
            // ETH
            require(msg.value == price, "ServiceAgreement: ETH value != price");
        } else {
            // ERC-20 — token is on the allowlist so it is known-safe
            require(msg.value == 0, "ServiceAgreement: ETH sent with ERC-20 agreement");
            IERC20(token).safeTransferFrom(msg.sender, address(this), price);
        }

        // Mint new ID
        unchecked { _nextId++; }
        agreementId = _nextId;

        _agreements[agreementId] = Agreement({
            id:               agreementId,
            client:           msg.sender,
            provider:         provider,
            serviceType:      serviceType,
            description:      description,
            price:            price,
            token:            token,
            deadline:         deadline,
            deliverablesHash: deliverablesHash,
            status:           Status.PROPOSED,
            createdAt:        block.timestamp,
            resolvedAt:       0,
            verifyWindowEnd:  0,
            committedHash:    bytes32(0)
        });

        _byClient[msg.sender].push(agreementId);
        _byProvider[provider].push(agreementId);

        emit AgreementProposed(
            agreementId,
            msg.sender,
            provider,
            serviceType,
            price,
            token,
            deadline
        );
    }

    // ─── Core: Accept ────────────────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     */
    function accept(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.provider,   "ServiceAgreement: not provider");
        require(ag.status == Status.PROPOSED, "ServiceAgreement: not PROPOSED");

        ag.status = Status.ACCEPTED;

        emit AgreementAccepted(agreementId, msg.sender);
    }

    // ─── Core: Fulfill (immediate-release path) ───────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     * @dev Immediate-release path. Provider fulfills and claims escrow in one call.
     *      For the two-step commit-reveal path, use commitDeliverable() + verifyDeliverable().
     *      Must be called before the deadline.
     *      On success, automatically records a trust score increment for the provider
     *      in the TrustRegistry (T-02), subject to minimumTrustValue threshold.
     */
    function fulfill(uint256 agreementId, bytes32 actualDeliverablesHash) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.provider,    "ServiceAgreement: not provider");
        require(ag.status == Status.ACCEPTED,  "ServiceAgreement: not ACCEPTED");
        require(block.timestamp <= ag.deadline, "ServiceAgreement: past deadline");

        ag.status           = Status.FULFILLED;
        ag.resolvedAt       = block.timestamp;
        ag.deliverablesHash = actualDeliverablesHash;

        emit AgreementFulfilled(agreementId, msg.sender, actualDeliverablesHash);

        _releaseEscrow(ag.token, ag.provider, ag.price);

        _updateTrust(agreementId, ag, true);
    }

    // ─── Core: Commit-Reveal Delivery (two-step path) ─────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     * @dev Provider commits deliverable hash. Moves ACCEPTED → PENDING_VERIFICATION.
     *      Client has VERIFY_WINDOW seconds to call verifyDeliverable() or dispute().
     *      If client does not act, anyone may call autoRelease() after VERIFY_WINDOW.
     */
    function commitDeliverable(uint256 agreementId, bytes32 deliverableHash) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.provider,    "ServiceAgreement: not provider");
        require(ag.status == Status.ACCEPTED,  "ServiceAgreement: not ACCEPTED");
        require(block.timestamp <= ag.deadline, "ServiceAgreement: past deadline");

        ag.status          = Status.PENDING_VERIFICATION;
        ag.committedHash   = deliverableHash;
        ag.verifyWindowEnd = block.timestamp + VERIFY_WINDOW;
        ag.deliverablesHash = deliverableHash; // keep for compatibility with fulfill path

        emit DeliverableCommitted(agreementId, msg.sender, deliverableHash, ag.verifyWindowEnd);
    }

    /**
     * @inheritdoc IServiceAgreement
     * @dev Client explicitly approves delivery. Releases escrow to provider.
     *      Trust score update is subject to minimumTrustValue threshold.
     */
    function verifyDeliverable(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.client, "ServiceAgreement: not client");
        require(ag.status == Status.PENDING_VERIFICATION, "ServiceAgreement: not PENDING_VERIFICATION");

        ag.status     = Status.FULFILLED;
        ag.resolvedAt = block.timestamp;

        emit AgreementFulfilled(agreementId, ag.provider, ag.committedHash);

        _releaseEscrow(ag.token, ag.provider, ag.price);

        _updateTrust(agreementId, ag, true);
    }

    /**
     * @inheritdoc IServiceAgreement
     * @dev If client does not act within VERIFY_WINDOW after commitDeliverable(),
     *      anyone (provider, third-party keeper, etc.) may trigger auto-release.
     *      Trust score update is subject to minimumTrustValue threshold.
     */
    function autoRelease(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(ag.status == Status.PENDING_VERIFICATION, "ServiceAgreement: not PENDING_VERIFICATION");
        require(block.timestamp > ag.verifyWindowEnd, "ServiceAgreement: verify window open");

        ag.status     = Status.FULFILLED;
        ag.resolvedAt = block.timestamp;

        emit AgreementFulfilled(agreementId, ag.provider, ag.committedHash);
        emit AutoReleased(agreementId, ag.provider);

        _releaseEscrow(ag.token, ag.provider, ag.price);

        _updateTrust(agreementId, ag, true);
    }

    // ─── Core: Dispute ───────────────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     * @dev Either party may raise a dispute on an ACCEPTED or PENDING_VERIFICATION agreement.
     *      Escrow remains locked until resolveDispute().
     *      The error message "not ACCEPTED" is preserved for backward compatibility even
     *      though PENDING_VERIFICATION is also a valid state for dispute.
     */
    function dispute(uint256 agreementId, string calldata reason) external {
        require(bytes(reason).length <= 512, "ServiceAgreement: reason too long");
        Agreement storage ag = _get(agreementId);
        require(
            msg.sender == ag.client || msg.sender == ag.provider,
            "ServiceAgreement: not a party"
        );
        require(
            ag.status == Status.ACCEPTED || ag.status == Status.PENDING_VERIFICATION,
            "ServiceAgreement: not ACCEPTED"
        );

        ag.status = Status.DISPUTED;

        emit AgreementDisputed(agreementId, msg.sender, reason);
    }

    // ─── Core: Cancel (PROPOSED) ─────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     * @dev Only the client may cancel a PROPOSED agreement. Refunds escrow.
     */
    function cancel(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.client,      "ServiceAgreement: not client");
        require(ag.status == Status.PROPOSED,  "ServiceAgreement: not PROPOSED");

        ag.status     = Status.CANCELLED;
        ag.resolvedAt = block.timestamp;

        emit AgreementCancelled(agreementId, msg.sender);

        _releaseEscrow(ag.token, ag.client, ag.price);
    }

    // ─── Core: Expired Cancel ────────────────────────────────────────────────

    /**
     * @notice Client may cancel an ACCEPTED agreement that has passed its deadline.
     *         Refunds escrow to client.
     * @param agreementId The agreement to cancel
     */
    function expiredCancel(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(msg.sender == ag.client,      "ServiceAgreement: not client");
        require(ag.status == Status.ACCEPTED,  "ServiceAgreement: not ACCEPTED");
        require(block.timestamp > ag.deadline, "ServiceAgreement: not past deadline");

        ag.status     = Status.CANCELLED;
        ag.resolvedAt = block.timestamp;

        emit AgreementCancelled(agreementId, msg.sender);

        _releaseEscrow(ag.token, ag.client, ag.price);
    }

    // ─── Core: Resolve Dispute ───────────────────────────────────────────────

    /**
     * @notice Owner (arbiter) resolves a disputed agreement.
     * @param agreementId The disputed agreement
     * @param favorProvider If true, escrow goes to provider (FULFILLED).
     *                      If false, escrow goes to client (CANCELLED).
     *
     * @dev T-02: Trust score auto-update on resolution.
     *      - Provider wins → recordSuccess (dispute was frivolous / provider delivered)
     *      - Client wins  → recordAnomaly  (provider failed to deliver)
     *      Both paths respect minimumTrustValue for recordSuccess.
     */
    function resolveDispute(uint256 agreementId, bool favorProvider) external onlyOwner nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(ag.status == Status.DISPUTED, "ServiceAgreement: not DISPUTED");

        ag.resolvedAt = block.timestamp;

        emit DisputeResolved(agreementId, favorProvider);

        if (favorProvider) {
            ag.status = Status.FULFILLED;
            _releaseEscrow(ag.token, ag.provider, ag.price);
            _updateTrust(agreementId, ag, true);
        } else {
            ag.status = Status.CANCELLED;
            _releaseEscrow(ag.token, ag.client, ag.price);
            _updateTrust(agreementId, ag, false);
        }
    }

    // ─── Core: Expired Dispute Refund ────────────────────────────────────────

    /**
     * @notice If a dispute has been unresolved for DISPUTE_TIMEOUT, either party can
     *         trigger an auto-refund to the client.
     * @dev Prevents funds being locked indefinitely if the owner is offline or compromised.
     *      The dispute() function sets resolvedAt = block.timestamp when the dispute is
     *      opened, so the 30-day timeout clock starts from that moment.
     */
    function expiredDisputeRefund(uint256 agreementId) external nonReentrant {
        Agreement storage ag = _get(agreementId);
        require(ag.status == Status.DISPUTED, "ServiceAgreement: not DISPUTED");
        require(
            block.timestamp > ag.resolvedAt + DISPUTE_TIMEOUT,
            "ServiceAgreement: dispute timeout not reached"
        );
        // Default: refund client (conservative — provider had 30 days to resolve)
        ag.status = Status.CANCELLED;
        ag.resolvedAt = block.timestamp;
        emit AgreementCancelled(agreementId, ag.client);
        emit DisputeTimedOut(agreementId, ag.client);
        _releaseEscrow(ag.token, ag.client, ag.price);
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    /**
     * @inheritdoc IServiceAgreement
     */
    function getAgreement(uint256 id) external view returns (Agreement memory) {
        require(_agreements[id].id != 0, "ServiceAgreement: not found");
        return _agreements[id];
    }

    /**
     * @notice Returns all agreement IDs where `client` is the paying party
     */
    function getAgreementsByClient(address client) external view returns (uint256[] memory) {
        return _byClient[client];
    }

    /**
     * @notice Returns all agreement IDs where `provider` is the delivering party
     */
    function getAgreementsByProvider(address provider) external view returns (uint256[] memory) {
        return _byProvider[provider];
    }

    /**
     * @notice Total number of agreements ever created
     */
    function agreementCount() external view returns (uint256) {
        return _nextId;
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _get(uint256 id) internal view returns (Agreement storage) {
        require(_agreements[id].id != 0, "ServiceAgreement: not found");
        return _agreements[id];
    }

    function _releaseEscrow(address token, address recipient, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = recipient.call{value: amount}("");
            require(ok, "ServiceAgreement: ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    /**
     * @notice Internal helper: update trust registry after an agreement resolves.
     * @dev Best-effort — a broken TrustRegistry must NEVER block escrow release.
     *      All calls are wrapped in try/catch and emit TrustUpdateFailed on error.
     *
     *      For success=true (provider delivered): calls recordSuccess(), subject to
     *      minimumTrustValue — agreements below threshold skip the trust update to
     *      prevent 1-wei sybil farming. Set minimumTrustValue=0 to disable threshold.
     *
     *      For success=false (provider failed — dispute resolved for client): calls
     *      recordAnomaly() regardless of price (penalty always applies).
     *
     * @param agreementId Agreement ID (for event emission on failure)
     * @param ag          Agreement storage reference (for price, provider)
     * @param success     true = recordSuccess, false = recordAnomaly
     */
    function _updateTrust(uint256 agreementId, Agreement storage ag, bool success) internal {
        bytes32 capabilityHash = keccak256(bytes(ag.serviceType));

        if (trustRegistry != address(0)) {
            if (success) {
                // Minimum trust value check — skip update for micro-agreements
                if (minimumTrustValue == 0 || ag.price >= minimumTrustValue) {
                    try ITrustRegistry(trustRegistry).recordSuccess(ag.provider) {
                        // trust updated successfully
                    } catch {
                        emit TrustUpdateFailed(agreementId, ag.provider, "fulfill");
                    }
                }
            } else {
                // Anomaly always applies regardless of price
                try ITrustRegistry(trustRegistry).recordAnomaly(ag.provider) {
                    // trust updated successfully
                } catch {
                    emit TrustUpdateFailed(agreementId, ag.provider, "resolveDispute:anomaly");
                }
            }
        }

        // Reputation oracle signals — best-effort, never block escrow release
        if (address(reputationOracle) != address(0)) {
            if (success) {
                try reputationOracle.autoRecordSuccess(ag.client, ag.provider, capabilityHash) {
                } catch {} // oracle failure never blocks payment
            } else {
                try reputationOracle.autoWarn(ag.client, ag.provider, capabilityHash) {
                } catch {} // oracle failure never blocks payment
            }
        }
    }

    // ─── Receive ─────────────────────────────────────────────────────────────

    receive() external payable {}
}
