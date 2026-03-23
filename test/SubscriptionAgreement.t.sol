// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "../contracts/src/SubscriptionAgreement.sol";

// ─── Helpers ──────────────────────────────────────────────────────────────────

contract MockERC20 {
    string  public name      = "MockUSDC";
    string  public symbol    = "mUSDC";
    uint8   public decimals  = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply   += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @notice Reentrancy attacker — tries to re-enter withdraw on ETH receipt.
contract ReentrancyAttacker {
    SubscriptionAgreement internal sa;
    bool internal attacked;

    constructor(SubscriptionAgreement _sa) { sa = _sa; }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            try sa.withdraw(address(0)) {} catch {}
        }
    }

    function attack() external {
        sa.withdraw(address(0));
    }
}

// ─── Main test contract ───────────────────────────────────────────────────────

contract SubscriptionAgreementTest is Test {
    SubscriptionAgreement internal sa;
    MockERC20             internal token;

    address internal owner    = address(this);
    address internal provider = address(0x1);
    address internal alice    = address(0x2);
    address internal bob      = address(0x3);
    address internal keeper   = address(0x4);

    uint256 internal constant PRICE  = 1 ether;
    uint256 internal constant PERIOD = 30 days;
    bytes32 internal constant HASH   = keccak256("daily trading signals v1");

    function setUp() public {
        sa    = new SubscriptionAgreement();
        token = new MockERC20();

        // Fund test accounts
        vm.deal(alice,    100 ether);
        vm.deal(bob,      100 ether);
        vm.deal(provider, 10 ether);

        // Mint ERC-20
        token.mint(alice,    1_000_000e6);
        token.mint(bob,      1_000_000e6);
        token.mint(provider, 1_000_000e6);
    }

    // ─── createOffering ───────────────────────────────────────────────────────

    function test_createOffering_ETH() public {
        vm.prank(provider);
        uint256 id = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);
        assertEq(id, 1);

        SubscriptionAgreement.Offering memory o = sa.getOffering(id);
        assertEq(o.provider,       provider);
        assertEq(o.pricePerPeriod, PRICE);
        assertEq(o.periodSeconds,  PERIOD);
        assertEq(o.token,          address(0));
        assertEq(o.contentHash,    HASH);
        assertTrue(o.active);
        assertEq(o.maxSubscribers, 0);
        assertEq(o.subscriberCount, 0);
    }

    function test_createOffering_ERC20() public {
        vm.prank(provider);
        uint256 id = sa.createOffering(100e6, PERIOD, address(token), HASH, 50);

        SubscriptionAgreement.Offering memory o = sa.getOffering(id);
        assertEq(o.token,          address(token));
        assertEq(o.pricePerPeriod, 100e6);
        assertEq(o.maxSubscribers, 50);
    }

    function test_createOffering_incrementsId() public {
        vm.startPrank(provider);
        uint256 id1 = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);
        uint256 id2 = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);
        vm.stopPrank();
        assertEq(id1, 1);
        assertEq(id2, 2);
    }

    function test_createOffering_revert_zeroPrice() public {
        vm.prank(provider);
        vm.expectRevert(SubscriptionAgreement.InvalidPrice.selector);
        sa.createOffering(0, PERIOD, address(0), HASH, 0);
    }

    function test_createOffering_revert_zeroPeriod() public {
        vm.prank(provider);
        vm.expectRevert(SubscriptionAgreement.InvalidPeriodSeconds.selector);
        sa.createOffering(PRICE, 0, address(0), HASH, 0);
    }

    // ─── subscribe (ETH) ──────────────────────────────────────────────────────

    function test_subscribe_ETH_onePeriod() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);
        assertEq(subId, 1);

        // Deposit deducted from alice
        assertEq(alice.balance, aliceBefore - PRICE);

        SubscriptionAgreement.Subscription memory s = sa.getSubscription(subId);
        assertEq(s.subscriber,      alice);
        assertEq(s.offeringId,      offeringId);
        assertEq(s.deposited,       PRICE);
        assertEq(s.consumed,        PRICE);    // first period consumed
        assertTrue(s.active);
        assertFalse(s.cancelled);

        // First period credited to provider
        assertEq(sa.pendingWithdrawals(provider, address(0)), PRICE);

        // Access granted
        assertTrue(sa.hasAccess(offeringId, alice));
        assertTrue(sa.isActiveSubscriber(offeringId, alice));

        // Subscriber count updated
        assertEq(sa.getOffering(offeringId).subscriberCount, 1);
    }

    function test_subscribe_ETH_multiplePeriods() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        sa.subscribe{value: 3 * PRICE}(offeringId, 3);

        SubscriptionAgreement.Subscription memory s = sa.getSubscription(1);
        assertEq(s.deposited, 3 * PRICE);
        assertEq(s.consumed,  PRICE);     // only first period consumed at subscribe

        // Provider only receives first period
        assertEq(sa.pendingWithdrawals(provider, address(0)), PRICE);
    }

    function test_subscribe_ERC20() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(100e6, PERIOD, address(token), HASH, 0);

        vm.startPrank(alice);
        token.approve(address(sa), 300e6);
        uint256 subId = sa.subscribe(offeringId, 3);
        vm.stopPrank();

        SubscriptionAgreement.Subscription memory s = sa.getSubscription(subId);
        assertEq(s.deposited, 300e6);
        assertEq(s.consumed,  100e6);

        // Provider balance in ERC-20
        assertEq(sa.pendingWithdrawals(provider, address(token)), 100e6);
        // Contract holds the 3 periods worth
        assertEq(token.balanceOf(address(sa)), 300e6);
    }

    function test_subscribe_revert_selfDealing() public {
        vm.startPrank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);
        vm.expectRevert(SubscriptionAgreement.SelfDealing.selector);
        sa.subscribe{value: PRICE}(offeringId, 1);
        vm.stopPrank();
    }

    function test_subscribe_revert_insufficientDeposit() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                SubscriptionAgreement.InsufficientDeposit.selector, PRICE, PRICE - 1
            )
        );
        sa.subscribe{value: PRICE - 1}(offeringId, 1);
    }

    function test_subscribe_revert_inactiveOffering() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(provider);
        sa.deactivateOffering(offeringId);

        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.OfferingInactive.selector);
        sa.subscribe{value: PRICE}(offeringId, 1);
    }

    function test_subscribe_revert_alreadyActive() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.AlreadyActive.selector);
        sa.subscribe{value: PRICE}(offeringId, 1);
    }

    function test_subscribe_revert_zeroPeriods() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.InvalidPeriods.selector);
        sa.subscribe{value: 0}(offeringId, 0);
    }

    function test_subscribe_revert_msgValueWithToken() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(100e6, PERIOD, address(token), HASH, 0);

        vm.startPrank(alice);
        token.approve(address(sa), 100e6);
        vm.expectRevert(SubscriptionAgreement.MsgValueWithToken.selector);
        sa.subscribe{value: 1 ether}(offeringId, 1);
        vm.stopPrank();
    }

    // ─── maxSubscribers cap ───────────────────────────────────────────────────

    function test_maxSubscribers_cap() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 1);

        vm.prank(alice);
        sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(bob);
        vm.expectRevert(SubscriptionAgreement.MaxSubscribersReached.selector);
        sa.subscribe{value: PRICE}(offeringId, 1);
    }

    function test_maxSubscribers_unlimited() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        // Both can subscribe
        vm.prank(alice);
        sa.subscribe{value: PRICE}(offeringId, 1);
        vm.prank(bob);
        sa.subscribe{value: PRICE}(offeringId, 1);

        assertEq(sa.getOffering(offeringId).subscriberCount, 2);
    }

    // ─── Multiple subscribers ─────────────────────────────────────────────────

    function test_multipleSubscribers() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(bob);
        sa.subscribe{value: PRICE}(offeringId, 1);

        assertTrue(sa.hasAccess(offeringId, alice));
        assertTrue(sa.hasAccess(offeringId, bob));

        // Two separate subscription IDs
        assertEq(sa.latestSubscription(offeringId, alice), 1);
        assertEq(sa.latestSubscription(offeringId, bob),   2);

        // Provider credited for both
        assertEq(sa.pendingWithdrawals(provider, address(0)), 2 * PRICE);
    }

    // ─── renewSubscription ────────────────────────────────────────────────────

    function test_renew_advances_period() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 3 * PRICE}(offeringId, 3);

        // Before period ends — cannot renew
        vm.prank(keeper);
        vm.expectRevert(SubscriptionAgreement.NotYetRenewable.selector);
        sa.renewSubscription(subId);

        // Skip to after period end
        skip(PERIOD + 1);

        uint256 prevPeriodEnd = sa.getSubscription(subId).currentPeriodEnd;
        vm.prank(keeper);
        sa.renewSubscription(subId);

        SubscriptionAgreement.Subscription memory s = sa.getSubscription(subId);
        assertEq(s.consumed,        2 * PRICE);  // two periods consumed
        assertEq(s.currentPeriodEnd, prevPeriodEnd + PERIOD);

        // Provider credited for second period
        assertEq(sa.pendingWithdrawals(provider, address(0)), 2 * PRICE);
    }

    function test_renew_byAnyone_keeper_compatible() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 2 * PRICE}(offeringId, 2);

        skip(PERIOD + 1);

        // Keeper (unrelated address) can renew
        vm.prank(keeper);
        sa.renewSubscription(subId);

        assertTrue(sa.getSubscription(subId).active);
    }

    function test_renew_exhausted_deposit_expires() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        // Subscribe for exactly 1 period
        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        // No deposit left after first period
        assertEq(sa.getSubscription(subId).deposited - sa.getSubscription(subId).consumed, 0);

        skip(PERIOD + 1);

        vm.prank(keeper);
        sa.renewSubscription(subId);

        SubscriptionAgreement.Subscription memory s = sa.getSubscription(subId);
        assertFalse(s.active);

        // Subscriber count decremented
        assertEq(sa.getOffering(offeringId).subscriberCount, 0);
    }

    function test_renew_exhausted_returns_dust() public {
        // Strategy: subscribe 2 periods (deposited=2P, consumed=P, remaining=P),
        // topUp P/2 (deposited=2.5P, remaining=1.5P),
        // renew period 2 (consumed=2P, remaining=0.5P),
        // renew again → 0.5P < P → expires, dust 0.5P refunded to alice.
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 2 * PRICE}(offeringId, 2);
        // deposited=2P, consumed=P (first period), remaining=P

        // Add dust: topUp P/2 → deposited=2.5P, remaining=1.5P
        vm.prank(alice);
        sa.topUp{value: PRICE / 2}(subId, PRICE / 2);

        // Advance past period 1 end, renew period 2
        skip(PERIOD + 1);
        vm.prank(keeper);
        sa.renewSubscription(subId);
        // consumed=2P, remaining=0.5P, currentPeriodEnd advanced by PERIOD

        // Advance past period 2 end, renew → insufficient deposit → expires, refund dust
        skip(PERIOD + 1);
        uint256 aliceBefore = sa.pendingWithdrawals(alice, address(0));
        vm.prank(keeper);
        sa.renewSubscription(subId);

        uint256 aliceAfter = sa.pendingWithdrawals(alice, address(0));
        assertEq(aliceAfter - aliceBefore, PRICE / 2);
        assertFalse(sa.getSubscription(subId).active);
    }

    function test_renew_revert_cancelled() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 2 * PRICE}(offeringId, 2);

        vm.prank(alice);
        sa.cancel(subId);

        skip(PERIOD + 1);

        vm.prank(keeper);
        vm.expectRevert(SubscriptionAgreement.AlreadyCancelled.selector);
        sa.renewSubscription(subId);
    }

    // ─── cancel ───────────────────────────────────────────────────────────────

    function test_cancel_refundsUnconsumed() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        // Subscribe for 3 periods: deposited = 3*PRICE, consumed = PRICE (first period)
        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 3 * PRICE}(offeringId, 3);

        vm.prank(alice);
        sa.cancel(subId);

        SubscriptionAgreement.Subscription memory s = sa.getSubscription(subId);
        assertTrue(s.cancelled);
        assertTrue(s.active); // still active (has remaining time)

        // 2 periods refunded
        assertEq(sa.pendingWithdrawals(alice, address(0)), 2 * PRICE);

        // Subscriber still has access until currentPeriodEnd
        assertTrue(sa.hasAccess(offeringId, alice));

        // Count decremented
        assertEq(sa.getOffering(offeringId).subscriberCount, 0);
    }

    function test_cancel_accessExpiresAfterPeriodEnd() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(alice);
        sa.cancel(subId);

        // Access still works within period
        assertTrue(sa.hasAccess(offeringId, alice));

        // After period ends: no access
        skip(PERIOD + 1);
        assertFalse(sa.hasAccess(offeringId, alice));
    }

    function test_cancel_ERC20_refund() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(100e6, PERIOD, address(token), HASH, 0);

        vm.startPrank(alice);
        token.approve(address(sa), 300e6);
        uint256 subId = sa.subscribe(offeringId, 3);

        sa.cancel(subId);
        vm.stopPrank();

        // 200e6 refunded to alice's pending
        assertEq(sa.pendingWithdrawals(alice, address(token)), 200e6);
    }

    function test_cancel_revert_notSubscriber() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(bob);
        vm.expectRevert(SubscriptionAgreement.NotSubscriber.selector);
        sa.cancel(subId);
    }

    function test_cancel_revert_alreadyCancelled() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(alice);
        sa.cancel(subId);

        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.AlreadyCancelled.selector);
        sa.cancel(subId);
    }

    // ─── topUp ────────────────────────────────────────────────────────────────

    function test_topUp_ETH() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(alice);
        sa.topUp{value: 2 * PRICE}(subId, 2 * PRICE);

        assertEq(sa.getSubscription(subId).deposited, 3 * PRICE);
    }

    function test_topUp_ERC20() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(100e6, PERIOD, address(token), HASH, 0);

        vm.startPrank(alice);
        token.approve(address(sa), 500e6);
        uint256 subId = sa.subscribe(offeringId, 1);

        sa.topUp(subId, 200e6);
        vm.stopPrank();

        assertEq(sa.getSubscription(subId).deposited, 300e6);
    }

    function test_topUp_revert_notSubscriber() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(bob);
        vm.expectRevert(SubscriptionAgreement.NotSubscriber.selector);
        sa.topUp{value: PRICE}(subId, PRICE);
    }

    function test_topUp_revert_zeroAmount() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.InvalidAmount.selector);
        sa.topUp{value: 0}(subId, 0);
    }

    // ─── deactivateOffering ───────────────────────────────────────────────────

    function test_deactivateOffering_blocksNewSubscribers() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        // Alice subscribes before deactivation
        vm.prank(alice);
        sa.subscribe{value: PRICE}(offeringId, 1);

        // Provider deactivates
        vm.prank(provider);
        sa.deactivateOffering(offeringId);

        assertFalse(sa.getOffering(offeringId).active);

        // Bob cannot subscribe
        vm.prank(bob);
        vm.expectRevert(SubscriptionAgreement.OfferingInactive.selector);
        sa.subscribe{value: PRICE}(offeringId, 1);

        // Alice still has access
        assertTrue(sa.hasAccess(offeringId, alice));
    }

    function test_deactivateOffering_revert_notProvider() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.NotProvider.selector);
        sa.deactivateOffering(offeringId);
    }

    // ─── Access checks ────────────────────────────────────────────────────────

    function test_hasAccess_noSubscription() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);
        assertFalse(sa.hasAccess(offeringId, alice));
    }

    function test_hasAccess_cancelledWithRemainingTime() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(alice);
        sa.cancel(subId);

        // Cancelled but still has time → hasAccess returns true
        assertTrue(sa.hasAccess(offeringId, alice));
        // isActiveSubscriber returns false (cancelled)
        assertFalse(sa.isActiveSubscriber(offeringId, alice));
    }

    function test_isActiveSubscriber_expiredFalse() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        sa.subscribe{value: PRICE}(offeringId, 1);

        skip(PERIOD + 1);

        assertFalse(sa.isActiveSubscriber(offeringId, alice));
        assertFalse(sa.hasAccess(offeringId, alice));
    }

    function test_resubscribe_afterCancel() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 sub1 = sa.subscribe{value: PRICE}(offeringId, 1);

        skip(PERIOD + 1); // let period expire
        vm.prank(alice);
        sa.cancel(sub1);  // cancel (0 refund, already expired)

        // Re-subscribe
        vm.prank(alice);
        uint256 sub2 = sa.subscribe{value: PRICE}(offeringId, 1);

        assertTrue(sub2 > sub1);
        assertEq(sa.latestSubscription(offeringId, alice), sub2);
        assertTrue(sa.hasAccess(offeringId, alice));
    }

    // ─── withdraw ─────────────────────────────────────────────────────────────

    function test_withdraw_ETH() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        sa.subscribe{value: PRICE}(offeringId, 1);

        uint256 balBefore = provider.balance;
        vm.prank(provider);
        sa.withdraw(address(0));

        assertEq(provider.balance, balBefore + PRICE);
        assertEq(sa.pendingWithdrawals(provider, address(0)), 0);
    }

    function test_withdraw_ERC20() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(100e6, PERIOD, address(token), HASH, 0);

        vm.startPrank(alice);
        token.approve(address(sa), 100e6);
        sa.subscribe(offeringId, 1);
        vm.stopPrank();

        uint256 balBefore = token.balanceOf(provider);
        vm.prank(provider);
        sa.withdraw(address(token));

        assertEq(token.balanceOf(provider), balBefore + 100e6);
    }

    function test_withdraw_revert_nothingToWithdraw() public {
        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.NothingToWithdraw.selector);
        sa.withdraw(address(0));
    }

    function test_withdraw_specificToken_notOther() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(100e6, PERIOD, address(token), HASH, 0);

        vm.startPrank(alice);
        token.approve(address(sa), 100e6);
        sa.subscribe(offeringId, 1);
        vm.stopPrank();

        // Provider has ERC-20 pending, not ETH
        assertEq(sa.pendingWithdrawals(provider, address(0)), 0);
        assertEq(sa.pendingWithdrawals(provider, address(token)), 100e6);

        // Withdraw ETH (nothing there)
        vm.prank(provider);
        vm.expectRevert(SubscriptionAgreement.NothingToWithdraw.selector);
        sa.withdraw(address(0));

        // Withdraw ERC-20 (works)
        vm.prank(provider);
        sa.withdraw(address(token));
        assertEq(sa.pendingWithdrawals(provider, address(token)), 0);
    }

    function test_withdraw_reentrancyGuard() public {
        ReentrancyAttacker attacker = new ReentrancyAttacker(sa);
        address attackerAddr = address(attacker);

        // Use a dedicated provider so attacker can subscribe (SA-2: subscriber != provider)
        address provider2 = address(0x99);
        vm.prank(provider2);
        uint256 offeringId2 = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        // Subscribe 2 periods, then cancel → credits 1 period refund to attacker
        vm.deal(attackerAddr, 2 * PRICE);
        vm.prank(attackerAddr);
        uint256 subId = sa.subscribe{value: 2 * PRICE}(offeringId2, 2);

        vm.prank(attackerAddr);
        sa.cancel(subId); // refund = PRICE credited to attacker

        assertEq(sa.pendingWithdrawals(attackerAddr, address(0)), PRICE);

        // Reentrancy attack — ReentrancyGuard must block double-withdraw
        vm.prank(attackerAddr);
        attacker.attack();

        // Balance zeroed; inner reentrant call was blocked
        assertEq(sa.pendingWithdrawals(attackerAddr, address(0)), 0);
    }

    // ─── Dispute flow ─────────────────────────────────────────────────────────

    function test_dispute_providerWins() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 3 * PRICE}(offeringId, 3);
        // consumed = PRICE, remaining = 2*PRICE

        vm.prank(alice);
        sa.disputeSubscription(subId);

        assertTrue(sa.getSubscription(subId).disputed);

        // Renew blocked
        skip(PERIOD + 1);
        vm.expectRevert(SubscriptionAgreement.AlreadyDisputed.selector);
        sa.renewSubscription(subId);

        // Owner resolves: provider wins remaining deposit
        uint256 providerBefore = sa.pendingWithdrawals(provider, address(0));
        sa.resolveDisputeDetailed(subId, SubscriptionAgreement.DisputeOutcome.PROVIDER_WINS, 0, 0);

        assertEq(sa.pendingWithdrawals(provider, address(0)), providerBefore + 2 * PRICE);
        assertFalse(sa.getSubscription(subId).active);
        assertFalse(sa.getSubscription(subId).disputed);
    }

    function test_dispute_subscriberWins() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 3 * PRICE}(offeringId, 3);

        vm.prank(alice);
        sa.disputeSubscription(subId);

        sa.resolveDisputeDetailed(subId, SubscriptionAgreement.DisputeOutcome.SUBSCRIBER_WINS, 0, 0);

        // Remaining 2*PRICE refunded to alice
        assertEq(sa.pendingWithdrawals(alice, address(0)), 2 * PRICE);
    }

    function test_dispute_split() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 3 * PRICE}(offeringId, 3);
        // remaining = 2*PRICE

        vm.prank(alice);
        sa.disputeSubscription(subId);

        // Split 50/50
        uint256 provBefore = sa.pendingWithdrawals(provider, address(0));
        sa.resolveDisputeDetailed(subId, SubscriptionAgreement.DisputeOutcome.SPLIT, PRICE, PRICE);

        assertEq(sa.pendingWithdrawals(provider, address(0)), provBefore + PRICE);
        assertEq(sa.pendingWithdrawals(alice,    address(0)), PRICE);
    }

    function test_dispute_split_underAllocation_dustToSubscriber() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 3 * PRICE}(offeringId, 3);
        // remaining = 2*PRICE

        vm.prank(alice);
        sa.disputeSubscription(subId);

        // SPLIT: only allocate half — dust goes to subscriber
        sa.resolveDisputeDetailed(subId, SubscriptionAgreement.DisputeOutcome.SPLIT, PRICE / 2, PRICE / 2);

        // Dust = 2*PRICE - PRICE = PRICE → to alice
        assertEq(sa.pendingWithdrawals(alice, address(0)), PRICE / 2 + PRICE);
    }

    function test_dispute_split_revert_exceedsRemaining() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 3 * PRICE}(offeringId, 3);
        // remaining = 2*PRICE

        vm.prank(alice);
        sa.disputeSubscription(subId);

        vm.expectRevert(SubscriptionAgreement.InvalidSplit.selector);
        sa.resolveDisputeDetailed(subId, SubscriptionAgreement.DisputeOutcome.SPLIT, 2 * PRICE, PRICE);
    }

    function test_dispute_humanReview_staysDisputed() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(alice);
        sa.disputeSubscription(subId);

        sa.resolveDisputeDetailed(
            subId,
            SubscriptionAgreement.DisputeOutcome.HUMAN_REVIEW_REQUIRED,
            0, 0
        );

        // Still disputed
        assertTrue(sa.getSubscription(subId).disputed);
        assertTrue(sa.getSubscription(subId).active);
    }

    function test_dispute_revert_notSubscriber() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(bob);
        vm.expectRevert(SubscriptionAgreement.NotSubscriber.selector);
        sa.disputeSubscription(subId);
    }

    function test_dispute_revert_alreadyDisputed() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(alice);
        sa.disputeSubscription(subId);

        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.AlreadyDisputed.selector);
        sa.disputeSubscription(subId);
    }

    function test_resolveDispute_revert_notOwner() public {
        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offeringId, 1);

        vm.prank(alice);
        sa.disputeSubscription(subId);

        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.NotOwner.selector);
        sa.resolveDisputeDetailed(subId, SubscriptionAgreement.DisputeOutcome.SUBSCRIBER_WINS, 0, 0);
    }

    // ─── Owner management ─────────────────────────────────────────────────────

    function test_transferOwnership_twoStep() public {
        sa.transferOwnership(alice);
        assertEq(sa.pendingOwner(), alice);

        vm.prank(alice);
        sa.acceptOwnership();

        assertEq(sa.owner(), alice);
        assertEq(sa.pendingOwner(), address(0));
    }

    function test_transferOwnership_revert_zeroAddress() public {
        vm.expectRevert(SubscriptionAgreement.ZeroAddress.selector);
        sa.transferOwnership(address(0));
    }

    function test_acceptOwnership_revert_notPendingOwner() public {
        sa.transferOwnership(alice);

        vm.prank(bob);
        vm.expectRevert(SubscriptionAgreement.NotPendingOwner.selector);
        sa.acceptOwnership();
    }

    function test_setDisputeArbitration() public {
        sa.setDisputeArbitration(address(0x1234));
        assertEq(sa.disputeArbitration(), address(0x1234));
    }

    function test_setArbitratorApproval() public {
        sa.setArbitratorApproval(alice, true);
        assertTrue(sa.approvedArbitrators(alice));

        sa.setArbitratorApproval(alice, false);
        assertFalse(sa.approvedArbitrators(alice));
    }

    // ─── Fuzz tests ───────────────────────────────────────────────────────────

    function testFuzz_subscribe_ETH(uint64 priceRaw, uint8 periodsRaw) public {
        vm.assume(priceRaw > 0 && priceRaw < 1e18);
        vm.assume(periodsRaw > 0 && periodsRaw < 20);

        uint256 price   = uint256(priceRaw);
        uint256 periods = uint256(periodsRaw);
        uint256 total   = price * periods;

        vm.assume(total <= 100 ether);

        vm.prank(provider);
        uint256 offeringId = sa.createOffering(price, PERIOD, address(0), HASH, 0);

        vm.deal(alice, total + 1 ether);
        vm.prank(alice);
        uint256 subId = sa.subscribe{value: total}(offeringId, periods);

        SubscriptionAgreement.Subscription memory s = sa.getSubscription(subId);
        assertEq(s.deposited, total);
        assertEq(s.consumed,  price);                    // first period
        assertEq(sa.pendingWithdrawals(provider, address(0)), price);
    }

    function testFuzz_subscribe_ERC20(uint32 priceRaw, uint8 periodsRaw) public {
        vm.assume(priceRaw > 0);
        vm.assume(periodsRaw > 0 && periodsRaw < 20);

        uint256 price   = uint256(priceRaw);
        uint256 periods = uint256(periodsRaw);
        uint256 total   = price * periods;

        vm.prank(provider);
        uint256 offeringId = sa.createOffering(price, PERIOD, address(token), HASH, 0);

        token.mint(alice, total);
        vm.startPrank(alice);
        token.approve(address(sa), total);
        uint256 subId = sa.subscribe(offeringId, periods);
        vm.stopPrank();

        assertEq(sa.getSubscription(subId).deposited, total);
        assertEq(sa.pendingWithdrawals(provider, address(token)), price);
    }

    function testFuzz_cancel_refundCorrect(uint8 periodsRaw) public {
        vm.assume(periodsRaw > 1 && periodsRaw < 50);

        uint256 periods = uint256(periodsRaw);
        uint256 total   = PRICE * periods;

        vm.prank(provider);
        uint256 offeringId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.deal(alice, total);
        vm.prank(alice);
        uint256 subId = sa.subscribe{value: total}(offeringId, periods);

        vm.prank(alice);
        sa.cancel(subId);

        // Refund = deposited - consumed = total - PRICE = (periods-1)*PRICE
        assertEq(sa.pendingWithdrawals(alice, address(0)), (periods - 1) * PRICE);
    }
}
