// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ISubscriptionDisputeArbitration
 * @notice Minimal interface for DisputeArbitration integration with SubscriptionAgreement.
 */
interface ISubscriptionDisputeArbitration {
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
 * @title SubscriptionAgreement
 * @notice Recurring-payment billing primitive for ARC-402.
 *         Providers publish subscription offerings; subscribers deposit upfront
 *         for N periods, auto-renew each period, and cancel anytime for a
 *         pro-rata refund. Access is gated by on-chain hasAccess() checks.
 *
 *  Lifecycle:
 *    createOffering(price, period, token, contentHash, maxSubscribers)
 *    subscribe(offeringId, periods)    → deposit price × periods, first period paid to provider
 *    renewSubscription(subscriptionId) → keeper-compatible, advances period
 *    cancel(subscriptionId)            → refund remaining deposit, access until currentPeriodEnd
 *    topUp(subscriptionId, amount)     → extend deposit for future periods
 *    deactivateOffering(offeringId)    → no new subscribers, existing continue
 *    withdraw(token)                   → pull-payment of credited balance
 *
 *  Dispute:
 *    disputeSubscription(subscriptionId) → subscriber freezes renewal
 *    resolveDisputeDetailed(...)         → owner resolves with DisputeOutcome enum
 *    claimDisputeTimeout(subscriptionId) → subscriber claims refund after DISPUTE_TIMEOUT
 *    DisputeArbitration (optional)       → try/catch on DA calls
 *
 *  Payment tokens:
 *    address(0) = native ETH
 *    otherwise  = ERC-20 (e.g. USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 *    Fee-on-transfer and rebasing tokens are NOT supported.
 *
 *  Security:
 *    SA-1: Pull-payment — pendingWithdrawals double-mapping, no sequential pushes
 *    SA-2: Self-dealing prevention — subscriber != offering.provider
 *    SA-3: Exact deposit required — no overpayment for ETH
 *    SA-4: ReentrancyGuard on all state-changing functions
 *    SA-5: Checks-effects-interactions ordering throughout
 *    SA-6: MaxSubscribers cap enforced at subscribe time
 */
contract SubscriptionAgreement is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Enums ────────────────────────────────────────────────────────────────

    enum DisputeOutcome {
        PROVIDER_WINS,          // remaining deposit to provider
        SUBSCRIBER_WINS,        // remaining deposit to subscriber
        SPLIT,                  // custom providerAward/subscriberAward
        HUMAN_REVIEW_REQUIRED   // escalated — no settlement yet, stays disputed
    }

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct Offering {
        address provider;
        uint256 pricePerPeriod;     // Wei or ERC-20 amount per period
        uint256 periodSeconds;      // Duration of one period
        address token;              // address(0) = ETH, otherwise ERC-20
        bytes32 contentHash;        // keccak256 of content description
        bool    active;             // provider can deactivate (no new subscribers)
        uint256 maxSubscribers;     // 0 = unlimited
        uint256 subscriberCount;    // current active subscriber count
        uint256 createdAt;
    }

    struct Subscription {
        address subscriber;
        uint256 offeringId;
        uint256 startedAt;
        uint256 currentPeriodEnd;   // when the current paid period expires
        uint256 deposited;          // total deposited by subscriber
        uint256 consumed;           // total moved to provider (via pendingWithdrawals)
        bool    active;             // false if expired or resolved
        bool    cancelled;          // cancelled but may still have time remaining
        bool    disputed;           // frozen — awaiting owner resolution
        uint256 disputeOpenedAt;    // timestamp when dispute was opened
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Maximum allowed period for a subscription offering (365 days).
    uint256 public constant MAX_PERIOD = 365 days;

    /// @notice Minimum time that must elapse after dispute opening before owner can resolve.
    uint256 public constant DISPUTE_WINDOW = 24 hours;

    /// @notice Time after which a subscriber may claim a full refund if dispute is unresolved.
    uint256 public constant DISPUTE_TIMEOUT = 7 days;

    // ─── Storage ──────────────────────────────────────────────────────────────

    /// @notice Contract owner — resolves disputes, updates DA, approves arbitrators.
    address public owner;

    /// @notice Pending owner for two-step ownership transfer.
    address public pendingOwner;

    /// @notice DisputeArbitration contract (optional). address(0) = owner-only disputes.
    address public disputeArbitration;

    /// @notice Protocol fee in basis points (max 100 = 1%). Default: 20.
    uint256 public protocolFeeBps = 20;
    /// @notice MAX_PROTOCOL_FEE_BPS Protocol fee ceiling.
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 100;
    /// @notice Protocol treasury — receives protocol fees. address(0) = fees burned.
    address public protocolTreasury;

    /// @notice Arbitrators approved for disputes.
    mapping(address => bool) public approvedArbitrators;

    uint256 private _nextOfferingId = 1;

    mapping(uint256 => Offering)    public offerings;
    mapping(bytes32 => Subscription) public subscriptions;

    /// @notice Pull-payment balances: user => token => claimable amount.
    ///         token == address(0) for ETH.
    mapping(address => mapping(address => uint256)) public pendingWithdrawals;

    // ─── Events ───────────────────────────────────────────────────────────────

    event OfferingCreated(
        uint256 indexed offeringId,
        address indexed provider,
        uint256 pricePerPeriod,
        uint256 periodSeconds,
        address token,
        bytes32 contentHash,
        uint256 maxSubscribers
    );
    event OfferingDeactivated(uint256 indexed offeringId);
    event MaxSubscribersUpdated(uint256 indexed offeringId, uint256 newMax);
    event Subscribed(
        bytes32 indexed subscriptionId,
        uint256 indexed offeringId,
        address indexed subscriber,
        uint256 currentPeriodEnd,
        uint256 deposited
    );
    event Renewed(bytes32 indexed subscriptionId, uint256 newPeriodEnd);
    event Expired(bytes32 indexed subscriptionId);
    event SubscriptionCancelled(bytes32 indexed subscriptionId, uint256 refund);
    event ToppedUp(bytes32 indexed subscriptionId, uint256 amount, uint256 newDeposited);
    event SubscriptionDisputed(bytes32 indexed subscriptionId, address indexed disputant);
    event DetailedDisputeResolved(
        bytes32 indexed subscriptionId,
        DisputeOutcome outcome,
        uint256 providerAmount,
        uint256 subscriberAmount
    );
    event Withdrawn(address indexed recipient, address indexed token, uint256 amount);
    event ProtocolFeeUpdated(uint256 newFeeBps);
    event ProtocolTreasuryUpdated(address newTreasury);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event DisputeArbitrationUpdated(address indexed da);
    event ArbitratorApprovalUpdated(address indexed arbitrator, bool approved);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error OfferingNotFound();
    error OfferingInactive();
    error SubscriptionNotFound();
    error NotSubscriber();
    error NotProvider();
    error NotSubscriberOrProvider();
    error SelfDealing();
    error MaxSubscribersReached();
    error InsufficientDeposit(uint256 required, uint256 provided);
    error MsgValueWithToken();
    error AlreadyActive();
    error NotActive();
    error AlreadyCancelled();
    error AlreadyDisputed();
    error NotDisputed();
    error NotYetRenewable();
    error NothingToWithdraw();
    error TransferFailed();
    error InvalidSplit();
    error InvalidPeriods();
    error InvalidPeriodSeconds();
    error InvalidPrice();
    error InvalidAmount();
    error DisputeWindowNotElapsed();
    error DisputeTimeoutNotReached();
    error NewMaxBelowCount();

    // ─── Modifier ─────────────────────────────────────────────────────────────

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
        owner        = pendingOwner;
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

    /// @notice Approve or revoke an arbitrator.
    function setArbitratorApproval(address arbitrator, bool approved) external onlyOwner {
        approvedArbitrators[arbitrator] = approved;
        emit ArbitratorApprovalUpdated(arbitrator, approved);
    }

    // ─── Provider functions ───────────────────────────────────────────────────

    /**
     * @notice Provider publishes a subscription offering.
     * @param pricePerPeriod  Token units (wei or ERC-20 atoms) per period.
     * @param periodSeconds   Duration of one period (e.g. 30 days = 2592000).
     * @param token           Payment token (address(0) = ETH).
     * @param contentHash     keccak256 of content description for dispute evidence.
     * @param maxSubscribers  Cap on active subscribers (0 = unlimited).
     * @return offeringId     Assigned offering ID.
     */
    function createOffering(
        uint256 pricePerPeriod,
        uint256 periodSeconds,
        address token,
        bytes32 contentHash,
        uint256 maxSubscribers
    ) external nonReentrant returns (uint256 offeringId) {
        if (pricePerPeriod == 0) revert InvalidPrice();
        if (periodSeconds  == 0 || periodSeconds > MAX_PERIOD) revert InvalidPeriodSeconds();

        offeringId = _nextOfferingId++;

        Offering storage o = offerings[offeringId];
        o.provider       = msg.sender;
        o.pricePerPeriod = pricePerPeriod;
        o.periodSeconds  = periodSeconds;
        o.token          = token;
        o.contentHash    = contentHash;
        o.active         = true;
        o.maxSubscribers = maxSubscribers;
        o.createdAt      = block.timestamp;

        emit OfferingCreated(offeringId, msg.sender, pricePerPeriod, periodSeconds, token, contentHash, maxSubscribers);
    }

    /**
     * @notice Provider deactivates an offering — no new subscribers accepted.
     *         Existing subscriptions continue until their deposit runs out.
     */
    function deactivateOffering(uint256 offeringId) external nonReentrant {
        Offering storage o = _getOffering(offeringId);
        if (msg.sender != o.provider) revert NotProvider();
        o.active = false;
        emit OfferingDeactivated(offeringId);
    }

    /**
     * @notice Provider updates the maxSubscribers cap on an offering.
     *         newMax must be 0 (unlimited) or >= current subscriberCount.
     * @param offeringId  Target offering.
     * @param newMax      New cap (0 = unlimited).
     */
    function updateMaxSubscribers(uint256 offeringId, uint256 newMax) external nonReentrant {
        Offering storage o = _getOffering(offeringId);
        if (msg.sender != o.provider) revert NotProvider();
        if (newMax != 0 && newMax < o.subscriberCount) revert NewMaxBelowCount();
        o.maxSubscribers = newMax;
        emit MaxSubscribersUpdated(offeringId, newMax);
    }

    // ─── Subscriber functions ─────────────────────────────────────────────────

    /**
     * @notice Subscribe to an offering, depositing price × periods upfront.
     *         First period payment is immediately credited to the provider.
     *         SA-2: self-dealing — subscriber != offering.provider.
     *         SA-3: exact ETH deposit required, no overpayment.
     *         ETH: send exact msg.value. ERC-20: pre-approve this contract.
     *         Subscription ID is deterministic: keccak256(subscriber, offeringId).
     * @param offeringId  Target offering.
     * @param periods     Number of periods to deposit for (minimum 1).
     * @return subscriptionId  Deterministic subscription ID.
     */
    function subscribe(
        uint256 offeringId,
        uint256 periods
    ) external payable nonReentrant returns (bytes32 subscriptionId) {
        if (periods == 0) revert InvalidPeriods();

        Offering storage o = _getOffering(offeringId);
        if (!o.active)              revert OfferingInactive();
        if (msg.sender == o.provider) revert SelfDealing();  // SA-2

        // SA-6: enforce max subscribers cap
        if (o.maxSubscribers > 0 && o.subscriberCount >= o.maxSubscribers) {
            revert MaxSubscribersReached();
        }

        // Prevent double-subscription (must cancel or expire first)
        subscriptionId = keccak256(abi.encodePacked(msg.sender, offeringId));
        Subscription storage existing = subscriptions[subscriptionId];
        if (existing.subscriber != address(0) && existing.active && !existing.cancelled) revert AlreadyActive();

        uint256 price  = o.pricePerPeriod;
        uint256 period = o.periodSeconds;
        uint256 total  = price * periods;

        // SA-3: collect deposit
        if (o.token == address(0)) {
            if (msg.value != total) revert InsufficientDeposit(total, msg.value);
        } else {
            if (msg.value != 0) revert MsgValueWithToken();
            IERC20(o.token).safeTransferFrom(msg.sender, address(this), total);
        }

        // SA-5: effects before interactions (pendingWithdrawals credit below is an effect)
        uint256 periodEnd = block.timestamp + period;

        Subscription storage s = subscriptions[subscriptionId];
        s.subscriber      = msg.sender;
        s.offeringId      = offeringId;
        s.startedAt       = block.timestamp;
        s.currentPeriodEnd = periodEnd;
        s.deposited       = total;
        s.consumed        = price;  // first period consumed immediately
        s.active          = true;
        s.cancelled       = false;
        s.disputed        = false;
        s.disputeOpenedAt = 0;

        // Credit first period to provider (pull-payment)
        {
            uint256 fee = protocolFeeBps > 0 && protocolTreasury != address(0)
                ? (price * protocolFeeBps) / 10_000 : 0;
            if (fee > 0) pendingWithdrawals[protocolTreasury][o.token] += fee;
            pendingWithdrawals[o.provider][o.token] += price - fee;
        }

        o.subscriberCount += 1;

        emit Subscribed(subscriptionId, offeringId, msg.sender, periodEnd, total);
    }

    /**
     * @notice Advance a subscription by one period, paying the provider.
     *         Only the subscriber or the offering's provider may call.
     *         If deposit is exhausted, subscription becomes inactive.
     * @param subscriptionId  Subscription to renew.
     */
    function renewSubscription(bytes32 subscriptionId) external nonReentrant {
        Subscription storage s = _getSubscription(subscriptionId);
        Offering storage o = offerings[s.offeringId];
        if (msg.sender != s.subscriber && msg.sender != o.provider) revert NotSubscriberOrProvider();
        if (!s.active)    revert NotActive();
        if (s.cancelled)  revert AlreadyCancelled();
        if (s.disputed)   revert AlreadyDisputed();
        if (block.timestamp < s.currentPeriodEnd) revert NotYetRenewable();

        uint256 price     = o.pricePerPeriod;
        uint256 period    = o.periodSeconds;
        uint256 remaining = s.deposited - s.consumed;

        if (remaining >= price) {
            // SA-5: effects first, then credit
            // If renewal is late, anchor new period to now rather than old end
            s.consumed        += price;
            s.currentPeriodEnd = (block.timestamp > s.currentPeriodEnd
                ? block.timestamp
                : s.currentPeriodEnd) + period;
            {
                uint256 fee = protocolFeeBps > 0 && protocolTreasury != address(0)
                    ? (price * protocolFeeBps) / 10_000 : 0;
                if (fee > 0) pendingWithdrawals[protocolTreasury][o.token] += fee;
                pendingWithdrawals[o.provider][o.token] += price - fee;
            }
            emit Renewed(subscriptionId, s.currentPeriodEnd);
        } else {
            // Deposit exhausted — expire subscription
            s.active = false;
            o.subscriberCount -= 1;
            // Return any dust to subscriber
            if (remaining > 0) {
                s.consumed += remaining;
                pendingWithdrawals[s.subscriber][o.token] += remaining;
            }
            emit Expired(subscriptionId);
        }
    }

    /**
     * @notice Cancel a subscription. Refunds deposited - consumed to subscriber.
     *         Access continues until currentPeriodEnd (already-paid period).
     * @param subscriptionId  Subscription to cancel.
     */
    function cancel(bytes32 subscriptionId) external nonReentrant {
        Subscription storage s = _getSubscription(subscriptionId);
        if (msg.sender != s.subscriber) revert NotSubscriber();
        if (!s.active)   revert NotActive();
        if (s.cancelled) revert AlreadyCancelled();
        if (s.disputed)  revert AlreadyDisputed();

        // SA-5: effects before credit
        s.cancelled = true;
        s.active    = false;

        Offering storage o = offerings[s.offeringId];
        uint256 refund = s.deposited - s.consumed;

        if (refund > 0) {
            s.consumed = s.deposited;  // mark all consumed (refunded)
            pendingWithdrawals[msg.sender][o.token] += refund;
        }

        o.subscriberCount -= 1;

        emit SubscriptionCancelled(subscriptionId, refund);
    }

    /**
     * @notice Add deposit to an active subscription for future periods.
     *         ETH: send exact msg.value == amount. ERC-20: pre-approve.
     * @param subscriptionId  Subscription to top up.
     * @param amount          Tokens to add (must be > 0).
     */
    function topUp(bytes32 subscriptionId, uint256 amount) external payable nonReentrant {
        if (amount == 0) revert InvalidAmount();

        Subscription storage s = _getSubscription(subscriptionId);
        if (msg.sender != s.subscriber) revert NotSubscriber();
        if (!s.active)   revert NotActive();
        if (s.cancelled) revert AlreadyCancelled();
        if (s.disputed)  revert AlreadyDisputed();

        Offering storage o = offerings[s.offeringId];
        if (!o.active) revert OfferingInactive();

        if (o.token == address(0)) {
            if (msg.value != amount) revert InsufficientDeposit(amount, msg.value);
        } else {
            if (msg.value != 0) revert MsgValueWithToken();
            IERC20(o.token).safeTransferFrom(msg.sender, address(this), amount);
        }

        s.deposited += amount;

        emit ToppedUp(subscriptionId, amount, s.deposited);
    }

    /**
     * @notice Subscriber opens a dispute, freezing renewals.
     *         If DisputeArbitration is configured, a formal dispute is opened
     *         (forward ETH as msg.value for DA fee collection).
     */
    function disputeSubscription(bytes32 subscriptionId) external payable nonReentrant {
        Subscription storage s = _getSubscription(subscriptionId);
        if (msg.sender != s.subscriber) revert NotSubscriber();
        if (!s.active)   revert NotActive();
        if (s.cancelled) revert AlreadyCancelled();
        if (s.disputed)  revert AlreadyDisputed();

        // SA-5: effects first
        s.disputed = true;
        s.disputeOpenedAt = block.timestamp;

        Offering storage o = offerings[s.offeringId];
        _callOpenFormalDispute(subscriptionId, s, o);

        emit SubscriptionDisputed(subscriptionId, msg.sender);
    }

    /**
     * @notice Owner resolves a disputed subscription with a typed outcome.
     *         Notifies DisputeArbitration (if set) via try/catch.
     *         SPLIT: providerAward + subscriberAward must not exceed remaining deposit.
     *         PROVIDER_WINS / SUBSCRIBER_WINS: derived from remaining deposit.
     *         HUMAN_REVIEW_REQUIRED: no settlement, subscription stays disputed.
     *         Resolution can only occur after DISPUTE_WINDOW has elapsed since dispute opened.
     * @param subscriptionId  Disputed subscription to resolve.
     * @param outcome         Resolution type.
     * @param providerAward   Tokens awarded to provider (SPLIT only).
     * @param subscriberAward Tokens awarded to subscriber (SPLIT only).
     */
    function resolveDisputeDetailed(
        bytes32 subscriptionId,
        DisputeOutcome outcome,
        uint256 providerAward,
        uint256 subscriberAward
    ) external nonReentrant onlyOwner {
        Subscription storage s = _getSubscription(subscriptionId);
        if (!s.disputed) revert NotDisputed();
        if (block.timestamp < s.disputeOpenedAt + DISPUTE_WINDOW) revert DisputeWindowNotElapsed();

        if (outcome == DisputeOutcome.HUMAN_REVIEW_REQUIRED) {
            emit DetailedDisputeResolved(subscriptionId, outcome, 0, 0);
            return;
        }

        Offering storage o = offerings[s.offeringId];
        uint256 remaining = s.deposited - s.consumed;

        if (outcome == DisputeOutcome.PROVIDER_WINS) {
            providerAward   = remaining;
            subscriberAward = 0;
        } else if (outcome == DisputeOutcome.SUBSCRIBER_WINS) {
            providerAward   = 0;
            subscriberAward = remaining;
        }
        // SPLIT: use caller-supplied providerAward / subscriberAward

        if (providerAward + subscriberAward > remaining) revert InvalidSplit();

        // SA-5: effects before credits
        s.active   = false;
        s.disputed = false;
        s.consumed = s.deposited;  // mark fully settled
        o.subscriberCount -= 1;

        address tok = o.token;
        if (providerAward   > 0) pendingWithdrawals[o.provider][tok]    += providerAward;
        if (subscriberAward > 0) pendingWithdrawals[s.subscriber][tok]  += subscriberAward;

        // Remainder from SPLIT under-allocation goes to subscriber
        uint256 dust = remaining - providerAward - subscriberAward;
        if (dust > 0) pendingWithdrawals[s.subscriber][tok] += dust;

        // Notify DA to settle fees/bonds (ignore failures)
        if (disputeArbitration != address(0)) {
            try ISubscriptionDisputeArbitration(disputeArbitration).resolveDisputeFee(
                uint256(subscriptionId), uint8(outcome)
            ) {} catch {}
        }

        emit DetailedDisputeResolved(subscriptionId, outcome, providerAward, subscriberAward);
    }

    /**
     * @notice Subscriber claims a full refund if their dispute has not been resolved
     *         within DISPUTE_TIMEOUT. Settles as SUBSCRIBER_WINS automatically.
     * @param subscriptionId  Disputed subscription where timeout has elapsed.
     */
    function claimDisputeTimeout(bytes32 subscriptionId) external nonReentrant {
        Subscription storage s = _getSubscription(subscriptionId);
        if (!s.disputed) revert NotDisputed();
        if (block.timestamp < s.disputeOpenedAt + DISPUTE_TIMEOUT) revert DisputeTimeoutNotReached();

        Offering storage o = offerings[s.offeringId];
        uint256 remaining = s.deposited - s.consumed;

        s.active   = false;
        s.disputed = false;
        s.consumed = s.deposited;
        o.subscriberCount -= 1;

        address tok = o.token;
        if (remaining > 0) pendingWithdrawals[s.subscriber][tok] += remaining;

        emit DetailedDisputeResolved(subscriptionId, DisputeOutcome.SUBSCRIBER_WINS, 0, remaining);
    }

    /**
     * @notice Pull-payment: withdraw credited balance for a specific token.
     *         SA-1: pull pattern — no sequential ETH pushes.
     * @param token  Token to withdraw (address(0) = ETH).
     */
    function withdraw(address token) external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender][token];
        if (amount == 0) revert NothingToWithdraw();

        // SA-5: zero out before transfer
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
     * @notice True if subscriber has an active, non-cancelled, non-expired subscription.
     *         Use for strict access — only fully active subscribers.
     */
    function isActiveSubscriber(uint256 offeringId, address subscriber) external view returns (bool) {
        bytes32 subId = keccak256(abi.encodePacked(subscriber, offeringId));
        Subscription storage s = subscriptions[subId];
        if (s.subscriber == address(0)) return false;
        return s.active && !s.cancelled && block.timestamp <= s.currentPeriodEnd;
    }

    /**
     * @notice True if subscriber still has time remaining — includes cancelled-but-paid-up.
     *         Use for content gating (daemon checks this before serving).
     */
    function hasAccess(uint256 offeringId, address subscriber) external view returns (bool) {
        bytes32 subId = keccak256(abi.encodePacked(subscriber, offeringId));
        Subscription storage s = subscriptions[subId];
        if (s.subscriber == address(0)) return false;
        return block.timestamp <= s.currentPeriodEnd;
    }

    /// @notice Return full offering struct.
    function getOffering(uint256 offeringId) external view returns (Offering memory) {
        return offerings[offeringId];
    }

    /// @notice Return full subscription struct.
    function getSubscription(bytes32 subscriptionId) external view returns (Subscription memory) {
        return subscriptions[subscriptionId];
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _getOffering(uint256 offeringId) internal view returns (Offering storage o) {
        o = offerings[offeringId];
        if (o.provider == address(0)) revert OfferingNotFound();
    }

    function _getSubscription(bytes32 subscriptionId) internal view returns (Subscription storage s) {
        s = subscriptions[subscriptionId];
        if (s.subscriber == address(0)) revert SubscriptionNotFound();
    }

    /**
     * @dev Open a formal dispute in DisputeArbitration if configured.
     *      Uses try/catch — DA failure must not block the dispute itself.
     *
     *  SA-1 fix: ETH forwarded as dispute fee must never be silently trapped.
     *    - If DA is not configured: require msg.value == 0 (caller shouldn't
     *      send ETH when there is no DA to receive it).
     *    - If DA call reverts (caught): refund msg.value to msg.sender.
     *      Without this, the ETH would remain in this contract with no
     *      pendingWithdrawals entry and no recovery path.
     */
    function _callOpenFormalDispute(
        bytes32 subscriptionId,
        Subscription storage s,
        Offering storage o
    ) internal {
        if (disputeArbitration == address(0)) {
            // No DA configured — any ETH sent is a user error; refund it.
            if (msg.value > 0) {
                (bool ok,) = msg.sender.call{value: msg.value}("");
                if (!ok) revert TransferFailed();
            }
            return;
        }
        uint256 remaining = s.deposited - s.consumed;
        bool daCallSucceeded;
        try ISubscriptionDisputeArbitration(disputeArbitration).openDispute{value: msg.value}(
            uint256(subscriptionId),
            ISubscriptionDisputeArbitration.DisputeMode.UNILATERAL,
            ISubscriptionDisputeArbitration.DisputeClass.HARD_FAILURE,
            msg.sender,
            s.subscriber,
            o.provider,
            remaining,
            o.token
        ) {
            daCallSucceeded = true;
        } catch {}

        // If DA call failed and subscriber sent ETH for the fee, refund it.
        // Without this, msg.value would remain in this contract with no
        // withdrawal path (the EVM returns ETH from a reverted sub-call to
        // the calling contract, not to the original msg.sender).
        if (!daCallSucceeded && msg.value > 0) {
            (bool ok,) = msg.sender.call{value: msg.value}("");
            if (!ok) revert TransferFailed();
        }
    }
}
