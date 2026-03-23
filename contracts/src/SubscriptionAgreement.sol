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
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    /// @notice Contract owner — resolves disputes, updates DA, approves arbitrators.
    address public owner;

    /// @notice Pending owner for two-step ownership transfer.
    address public pendingOwner;

    /// @notice DisputeArbitration contract (optional). address(0) = owner-only disputes.
    address public disputeArbitration;

    /// @notice Arbitrators approved for disputes.
    mapping(address => bool) public approvedArbitrators;

    uint256 private _nextOfferingId      = 1;
    uint256 private _nextSubscriptionId  = 1;

    mapping(uint256 => Offering)     public offerings;
    mapping(uint256 => Subscription) public subscriptions;

    /// @notice Latest subscriptionId for (offeringId, subscriber). 0 = none.
    mapping(uint256 => mapping(address => uint256)) public latestSubscription;

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
        uint256 maxSubscribers
    );
    event OfferingDeactivated(uint256 indexed offeringId);
    event Subscribed(
        uint256 indexed subscriptionId,
        uint256 indexed offeringId,
        address indexed subscriber,
        uint256 currentPeriodEnd,
        uint256 deposited
    );
    event Renewed(uint256 indexed subscriptionId, uint256 newPeriodEnd);
    event Expired(uint256 indexed subscriptionId);
    event SubscriptionCancelled(uint256 indexed subscriptionId, uint256 refund);
    event ToppedUp(uint256 indexed subscriptionId, uint256 amount, uint256 newDeposited);
    event SubscriptionDisputed(uint256 indexed subscriptionId, address indexed disputant);
    event DetailedDisputeResolved(
        uint256 indexed subscriptionId,
        DisputeOutcome outcome,
        uint256 providerAmount,
        uint256 subscriberAmount
    );
    event Withdrawn(address indexed recipient, address indexed token, uint256 amount);
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
        if (periodSeconds  == 0) revert InvalidPeriodSeconds();

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

        emit OfferingCreated(offeringId, msg.sender, pricePerPeriod, periodSeconds, token, maxSubscribers);
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

    // ─── Subscriber functions ─────────────────────────────────────────────────

    /**
     * @notice Subscribe to an offering, depositing price × periods upfront.
     *         First period payment is immediately credited to the provider.
     *         SA-2: self-dealing — subscriber != offering.provider.
     *         SA-3: exact ETH deposit required, no overpayment.
     *         ETH: send exact msg.value. ERC-20: pre-approve this contract.
     * @param offeringId  Target offering.
     * @param periods     Number of periods to deposit for (minimum 1).
     * @return subscriptionId  Assigned subscription ID.
     */
    function subscribe(
        uint256 offeringId,
        uint256 periods
    ) external payable nonReentrant returns (uint256 subscriptionId) {
        if (periods == 0) revert InvalidPeriods();

        Offering storage o = _getOffering(offeringId);
        if (!o.active)              revert OfferingInactive();
        if (msg.sender == o.provider) revert SelfDealing();  // SA-2

        // SA-6: enforce max subscribers cap
        if (o.maxSubscribers > 0 && o.subscriberCount >= o.maxSubscribers) {
            revert MaxSubscribersReached();
        }

        // Prevent double-subscription (must cancel or expire first)
        uint256 existingId = latestSubscription[offeringId][msg.sender];
        if (existingId != 0) {
            Subscription storage existing = subscriptions[existingId];
            if (existing.active && !existing.cancelled) revert AlreadyActive();
        }

        uint256 total = o.pricePerPeriod * periods;

        // SA-3: collect deposit
        if (o.token == address(0)) {
            if (msg.value != total) revert InsufficientDeposit(total, msg.value);
        } else {
            if (msg.value != 0) revert MsgValueWithToken();
            IERC20(o.token).safeTransferFrom(msg.sender, address(this), total);
        }

        // SA-5: effects before interactions (pendingWithdrawals credit below is an effect)
        subscriptionId = _nextSubscriptionId++;
        uint256 periodEnd = block.timestamp + o.periodSeconds;

        Subscription storage s = subscriptions[subscriptionId];
        s.subscriber      = msg.sender;
        s.offeringId      = offeringId;
        s.startedAt       = block.timestamp;
        s.currentPeriodEnd = periodEnd;
        s.deposited       = total;
        s.consumed        = o.pricePerPeriod;  // first period consumed immediately
        s.active          = true;

        // Credit first period to provider (pull-payment)
        pendingWithdrawals[o.provider][o.token] += o.pricePerPeriod;

        o.subscriberCount += 1;
        latestSubscription[offeringId][msg.sender] = subscriptionId;

        emit Subscribed(subscriptionId, offeringId, msg.sender, periodEnd, total);
    }

    /**
     * @notice Advance a subscription by one period, paying the provider.
     *         Keeper-compatible — anyone may call (deposit is already locked).
     *         If deposit is exhausted, subscription becomes inactive.
     * @param subscriptionId  Subscription to renew.
     */
    function renewSubscription(uint256 subscriptionId) external nonReentrant {
        Subscription storage s = _getSubscription(subscriptionId);
        if (!s.active)    revert NotActive();
        if (s.cancelled)  revert AlreadyCancelled();
        if (s.disputed)   revert AlreadyDisputed();
        if (block.timestamp < s.currentPeriodEnd) revert NotYetRenewable();

        Offering storage o = offerings[s.offeringId];
        uint256 remaining = s.deposited - s.consumed;

        if (remaining >= o.pricePerPeriod) {
            // SA-5: effects first, then credit
            s.consumed         += o.pricePerPeriod;
            s.currentPeriodEnd += o.periodSeconds;
            pendingWithdrawals[o.provider][o.token] += o.pricePerPeriod;
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
    function cancel(uint256 subscriptionId) external nonReentrant {
        Subscription storage s = _getSubscription(subscriptionId);
        if (msg.sender != s.subscriber) revert NotSubscriber();
        if (!s.active)   revert NotActive();
        if (s.cancelled) revert AlreadyCancelled();
        if (s.disputed)  revert AlreadyDisputed();

        // SA-5: effects before credit
        s.cancelled = true;

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
    function topUp(uint256 subscriptionId, uint256 amount) external payable nonReentrant {
        if (amount == 0) revert InvalidAmount();

        Subscription storage s = _getSubscription(subscriptionId);
        if (msg.sender != s.subscriber) revert NotSubscriber();
        if (!s.active)   revert NotActive();
        if (s.cancelled) revert AlreadyCancelled();
        if (s.disputed)  revert AlreadyDisputed();

        Offering storage o = offerings[s.offeringId];

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
    function disputeSubscription(uint256 subscriptionId) external payable nonReentrant {
        Subscription storage s = _getSubscription(subscriptionId);
        if (msg.sender != s.subscriber) revert NotSubscriber();
        if (!s.active)   revert NotActive();
        if (s.cancelled) revert AlreadyCancelled();
        if (s.disputed)  revert AlreadyDisputed();

        // SA-5: effects first
        s.disputed = true;

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
     * @param subscriptionId  Disputed subscription to resolve.
     * @param outcome         Resolution type.
     * @param providerAward   Tokens awarded to provider (SPLIT only).
     * @param subscriberAward Tokens awarded to subscriber (SPLIT only).
     */
    function resolveDisputeDetailed(
        uint256 subscriptionId,
        DisputeOutcome outcome,
        uint256 providerAward,
        uint256 subscriberAward
    ) external onlyOwner {
        Subscription storage s = _getSubscription(subscriptionId);
        if (!s.disputed) revert NotDisputed();

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
                subscriptionId, uint8(outcome)
            ) {} catch {}
        }

        emit DetailedDisputeResolved(subscriptionId, outcome, providerAward, subscriberAward);
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
        uint256 subId = latestSubscription[offeringId][subscriber];
        if (subId == 0) return false;
        Subscription storage s = subscriptions[subId];
        return s.active && !s.cancelled && block.timestamp <= s.currentPeriodEnd;
    }

    /**
     * @notice True if subscriber still has time remaining — includes cancelled-but-paid-up.
     *         Use for content gating (daemon checks this before serving).
     */
    function hasAccess(uint256 offeringId, address subscriber) external view returns (bool) {
        uint256 subId = latestSubscription[offeringId][subscriber];
        if (subId == 0) return false;
        return block.timestamp <= subscriptions[subId].currentPeriodEnd;
    }

    /// @notice Return full offering struct.
    function getOffering(uint256 offeringId) external view returns (Offering memory) {
        return offerings[offeringId];
    }

    /// @notice Return full subscription struct.
    function getSubscription(uint256 subscriptionId) external view returns (Subscription memory) {
        return subscriptions[subscriptionId];
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _getOffering(uint256 offeringId) internal view returns (Offering storage o) {
        o = offerings[offeringId];
        if (o.provider == address(0)) revert OfferingNotFound();
    }

    function _getSubscription(uint256 subscriptionId) internal view returns (Subscription storage s) {
        s = subscriptions[subscriptionId];
        if (s.subscriber == address(0)) revert SubscriptionNotFound();
    }

    /**
     * @dev Open a formal dispute in DisputeArbitration if configured.
     *      Uses try/catch — DA failure must not block the dispute itself.
     */
    function _callOpenFormalDispute(
        uint256 subscriptionId,
        Subscription storage s,
        Offering storage o
    ) internal {
        if (disputeArbitration == address(0)) return;
        uint256 remaining = s.deposited - s.consumed;
        try ISubscriptionDisputeArbitration(disputeArbitration).openDispute{value: msg.value}(
            subscriptionId,
            ISubscriptionDisputeArbitration.DisputeMode.UNILATERAL,
            ISubscriptionDisputeArbitration.DisputeClass.HARD_FAILURE,
            msg.sender,
            s.subscriber,
            o.provider,
            remaining,
            o.token
        ) {} catch {}
    }
}
