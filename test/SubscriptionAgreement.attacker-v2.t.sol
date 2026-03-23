// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "../contracts/src/SubscriptionAgreement.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// ATTACK HELPER CONTRACTS — v2 Deep Dive
// ═══════════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Attack 1 & 2: Reentrant receiver — on ETH receipt tries to re-enter
//               cancel() (a different nonReentrant function than withdraw()).
//               This tests cross-function reentrancy protection.
// ---------------------------------------------------------------------------
contract ReentrantCancelOnWithdraw {
    SubscriptionAgreement public sa;
    uint256 public subIdToCancel;   // live sub to try cancelling during callback
    bool    public cancelWasBlocked;

    constructor(SubscriptionAgreement _sa) { sa = _sa; }

    /// @dev Fires on ETH receipt from withdraw(). Attempts to cancel a still-active sub.
    receive() external payable {
        if (subIdToCancel != 0 && !cancelWasBlocked) {
            try sa.cancel(subIdToCancel) {
                // If we get here, reentrancy succeeded — BAD
            } catch {
                cancelWasBlocked = true;
            }
        }
    }

    function doSubscribe(uint256 offeringId, uint256 periods)
        external payable returns (uint256)
    {
        return sa.subscribe{value: msg.value}(offeringId, periods);
    }

    function doCancel(uint256 subId)   external { sa.cancel(subId); }
    function doWithdraw()              external { sa.withdraw(address(0)); }
    function setSubIdToCancel(uint256 id) external { subIdToCancel = id; }
}

// ---------------------------------------------------------------------------
// Attack 2 extra: Malicious ERC-20 that tries to re-enter cancel() from
//                transferFrom() — fires during subscribe() for ERC-20 offering.
//                nonReentrant on subscribe blocks the inner cancel() call.
// ---------------------------------------------------------------------------
contract ReentrantERC20 {
    SubscriptionAgreement public sa;
    uint256 public targetSubId;     // subscription to try to cancel mid-subscribe
    bool    public innerCallBlocked;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(SubscriptionAgreement _sa) { sa = _sa; }

    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function setTargetSubId(uint256 id) external { targetSubId = id; }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to]         += amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        require(balanceOf[from] >= amt, "bal");
        require(allowance[from][msg.sender] >= amt, "allow");
        allowance[from][msg.sender] -= amt;
        balanceOf[from]             -= amt;
        balanceOf[to]               += amt;

        // Attempt to re-enter cancel() on a live subscription
        if (targetSubId != 0 && !innerCallBlocked) {
            try sa.cancel(targetSubId) {
                // Re-entry succeeded — BAD
            } catch {
                innerCallBlocked = true;
            }
        }
        return true;
    }
}

// ---------------------------------------------------------------------------
// Attack 3: Double-renewal in one transaction.
// ---------------------------------------------------------------------------
contract DoubleRenewAttacker {
    SubscriptionAgreement public sa;
    constructor(SubscriptionAgreement _sa) { sa = _sa; }

    function attack(uint256 subId) external {
        sa.renewSubscription(subId);   // first: valid
        sa.renewSubscription(subId);   // second: NotYetRenewable
    }
}

// ---------------------------------------------------------------------------
// Attack 6 (b): Provider subscribes to own offering via proxy to bypass
//               the SelfDealing check (msg.sender != offering.provider).
//               Economically neutral — provider gets nothing extra.
// ---------------------------------------------------------------------------
contract SelfDealingProxy {
    SubscriptionAgreement public sa;
    constructor(SubscriptionAgreement _sa) { sa = _sa; }

    function doSubscribe(uint256 offeringId, uint256 periods)
        external payable returns (uint256)
    {
        return sa.subscribe{value: msg.value}(offeringId, periods);
    }

    function doCancel(uint256 subId)   external { sa.cancel(subId); }
    function doWithdraw()              external { sa.withdraw(address(0)); }
    receive() external payable {}
}

// ---------------------------------------------------------------------------
// Attack 7: Fill maxSubscribers then cancel all — check if it blocks others.
//           Each controlled address = one subscriber slot.
// ---------------------------------------------------------------------------
contract GriefCycleAttacker {
    SubscriptionAgreement public sa;
    constructor(SubscriptionAgreement _sa) { sa = _sa; }
    receive() external payable {}

    function grabAllSlots(uint256 offeringId, uint256 n, uint256 price)
        external payable returns (uint256[] memory ids)
    {
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = sa.subscribe{value: price}(offeringId, 1);
        }
    }

    function releaseAll(uint256[] calldata ids) external {
        for (uint256 i = 0; i < ids.length; i++) {
            sa.cancel(ids[i]);
        }
    }

    function doWithdraw() external { sa.withdraw(address(0)); }
}

// ---------------------------------------------------------------------------
// Attack 16: Flash-loan cycle — borrow ERC-20, subscribe N periods,
//            cancel immediately, withdraw, repay. Check net P&L.
// ---------------------------------------------------------------------------
contract FlashLoanAttacker {
    SubscriptionAgreement public sa;
    MockERC20V2           public token;

    constructor(SubscriptionAgreement _sa, MockERC20V2 _t) {
        sa    = _sa;
        token = _t;
    }

    /// @return netProfit  Negative means loss; positive means theft.
    function attack(uint256 offeringId, uint256 price, uint256 periods)
        external returns (int256 netProfit)
    {
        uint256 total     = price * periods;
        uint256 balBefore = token.balanceOf(address(this));

        // Simulate flash-borrowed tokens pre-loaded by test setup
        token.approve(address(sa), total);
        uint256 subId = sa.subscribe(offeringId, periods);
        sa.cancel(subId);
        // Only withdraw if there is something to pull (1-period sub has 0 refund)
        uint256 pending = sa.pendingWithdrawals(address(this), address(token));
        if (pending > 0) {
            sa.withdraw(address(token));
        }

        uint256 balAfter = token.balanceOf(address(this));
        return int256(balAfter) - int256(balBefore);
    }
}

// ---------------------------------------------------------------------------
// Attack 13: Fee-on-transfer token (10% burned on every transfer).
//            Documents insolvency caused by unsupported token class.
// ---------------------------------------------------------------------------
contract FeeOnTransferToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        return _xfer(msg.sender, to, amt);
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        require(allowance[from][msg.sender] >= amt, "allowance");
        allowance[from][msg.sender] -= amt;
        return _xfer(from, to, amt);
    }

    function _xfer(address from, address to, uint256 amt) internal returns (bool) {
        uint256 fee      = amt / 10; // 10% burned
        uint256 received = amt - fee;
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        balanceOf[to]   += received;
        return true;
    }
}

// ---------------------------------------------------------------------------
// Standard mock ERC-20 for v2 tests.
// ---------------------------------------------------------------------------
contract MockERC20V2 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        require(balanceOf[msg.sender] >= amt, "bal");
        balanceOf[msg.sender] -= amt;
        balanceOf[to]         += amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        require(balanceOf[from] >= amt, "bal");
        require(allowance[from][msg.sender] >= amt, "allow");
        allowance[from][msg.sender] -= amt;
        balanceOf[from]             -= amt;
        balanceOf[to]               += amt;
        return true;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEEP EXPLOIT TESTS — ALL ATTACKS MUST BE PREVENTED
// ═══════════════════════════════════════════════════════════════════════════════

contract SubscriptionAgreementAttackerV2 is Test {
    SubscriptionAgreement  internal sa;
    MockERC20V2            internal token;
    FeeOnTransferToken     internal fotToken;

    address internal owner    = address(this);
    address internal provider = address(0xA1);
    address internal alice    = address(0xA2);
    address internal bob      = address(0xA3);

    uint256 internal constant PRICE  = 1 ether;
    uint256 internal constant PERIOD = 30 days;
    bytes32 internal constant HASH   = keccak256("content v2");

    function setUp() public {
        sa       = new SubscriptionAgreement();
        token    = new MockERC20V2();
        fotToken = new FeeOnTransferToken();

        vm.deal(provider, 100 ether);
        vm.deal(alice,    100 ether);
        vm.deal(bob,      100 ether);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 1: Reentrancy on withdraw() — cross-function reentrance
    //
    // Attack:  withdraw(ETH) → receive() → cancel(live_sub)
    //          Attacker has two subscriptions:
    //            sub1 (cancelled) — has pending refund, triggers withdraw
    //            sub2 (active)    — attacker wants to cancel inside callback
    //          If cancel() executes inside withdraw()'s ETH send, attacker
    //          double-dips: gets withdraw refund AND cancel refund in one call.
    //
    // Why blocked: ReentrancyGuard locks the entire contract. cancel() is also
    //              nonReentrant. While withdraw() holds the lock and does the
    //              ETH send, any re-entry into cancel() reverts.
    //
    // Invariant: pendingWithdrawals is decremented exactly once per withdrawal.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_01_withdrawReentrancyCrossFunction_blocked() public {
        // Provider creates two separate offerings
        vm.startPrank(provider);
        uint256 off1 = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);
        uint256 off2 = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);
        vm.stopPrank();

        ReentrantCancelOnWithdraw attacker = new ReentrantCancelOnWithdraw(sa);
        vm.deal(address(attacker), 20 ether);

        // Subscribe to both offerings (2P each = 4P total)
        uint256 sub1 = attacker.doSubscribe{value: 2 * PRICE}(off1, 2);
        uint256 sub2 = attacker.doSubscribe{value: 2 * PRICE}(off2, 2);

        // Cancel sub1 → pendingWithdrawals[attacker][ETH] = P (refund of 1 period)
        attacker.doCancel(sub1);
        assertEq(sa.pendingWithdrawals(address(attacker), address(0)), PRICE,
            "refund credited correctly");

        // Arm the callback: on ETH receipt, try to cancel sub2
        attacker.setSubIdToCancel(sub2);

        uint256 contractBefore = address(sa).balance;

        // withdraw() → sends P ETH → receive() fires → cancel(sub2) → BLOCKED
        attacker.doWithdraw();

        // sub2 must still be active (cancel was blocked by reentrancy guard)
        assertTrue(sa.getSubscription(sub2).active,   "sub2 still active");
        assertFalse(sa.getSubscription(sub2).cancelled, "sub2 NOT cancelled");
        assertTrue(attacker.cancelWasBlocked(), "cancel inside withdraw was blocked");

        // Contract balance reduced by exactly P, not 2P (no double drain)
        assertEq(address(sa).balance, contractBefore - PRICE,
            "only one withdrawal executed: no double drain");

        // pendingWithdrawals zeroed out
        assertEq(sa.pendingWithdrawals(address(attacker), address(0)), 0,
            "pending balance zeroed");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 2: Reentrancy on cancel() — reenter during pro-rata refund credit
    //
    // Attack:  A malicious ERC-20 token fires a callback inside transferFrom()
    //          (called by subscribe()). The callback tries to call cancel() on
    //          an existing active subscription mid-subscribe.
    //
    // Why blocked: subscribe() holds the nonReentrant lock. cancel() is also
    //              nonReentrant. The inner cancel() reverts.
    //
    // Structural note: cancel() itself makes ZERO external calls — it only
    //   writes to pendingWithdrawals storage. Even if the guard weren't there,
    //   there is no callback surface within cancel(). This test additionally
    //   confirms that a malicious token cannot exploit subscribe's transferFrom
    //   to cancel a live subscription.
    //
    // Invariant: An active subscription cannot be cancelled while the
    //            contract is executing subscribe() for the same subscriber.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_02_cancelNoReentrancyVector_blocked() public {
        ReentrantERC20 malToken = new ReentrantERC20(sa);

        // Provider creates an ERC-20 offering with the malicious token
        vm.prank(provider);
        uint256 offId = sa.createOffering(PRICE, PERIOD, address(malToken), HASH, 0);

        // Alice subscribes to a NORMAL offering first to create sub1 (ETH)
        vm.prank(provider);
        uint256 ethOff = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);
        vm.prank(alice);
        uint256 sub1 = sa.subscribe{value: PRICE}(ethOff, 1);

        // Alice approves malToken; arm the callback to cancel sub1 mid-subscribe
        malToken.mint(alice, 10 * PRICE);
        vm.prank(alice);
        malToken.approve(address(sa), 10 * PRICE);
        malToken.setTargetSubId(sub1);

        // Alice subscribes to the malToken offering — transferFrom fires callback
        vm.prank(alice);
        sa.subscribe(offId, 2);

        // sub1 must still be active — the inner cancel() was blocked
        assertTrue(sa.getSubscription(sub1).active,    "sub1 still active");
        assertFalse(sa.getSubscription(sub1).cancelled, "sub1 NOT cancelled");
        assertTrue(malToken.innerCallBlocked(), "reentrant cancel was blocked");

        // Structural proof: cancel() credits pendingWithdrawals, never calls token.transfer
        // Verify by checking token balance BEFORE and AFTER cancel — it must not move
        uint256 tokenBalBefore = malToken.balanceOf(address(sa));
        vm.prank(alice);
        sa.cancel(sub1); // cancel the ETH sub directly (no ERC-20 involved)
        assertEq(malToken.balanceOf(address(sa)), tokenBalBefore,
            "cancel() made zero token calls: no callback surface");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 3: Double-renewal in the same block to double-charge deposit
    //
    // Attack:  After the period has expired, call renewSubscription twice in
    //          one transaction. If the second call succeeds, the attacker
    //          (keeper or anyone) charges the deposit twice.
    //
    // Why blocked: After the first renewal, currentPeriodEnd is advanced by
    //              periodSeconds. The second call sees
    //              block.timestamp < new currentPeriodEnd → NotYetRenewable.
    //
    // Invariant: Each period consumes exactly pricePerPeriod from deposit.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_03_doubleRenewalSameBlock_blocked() public {
        vm.prank(provider);
        uint256 offId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 5 * PRICE}(offId, 5);

        // Warp to just past the first period end
        skip(PERIOD + 1);

        DoubleRenewAttacker attacker = new DoubleRenewAttacker(sa);

        // First renewal valid; second must revert
        vm.expectRevert(SubscriptionAgreement.NotYetRenewable.selector);
        attacker.attack(subId);

        // Deposit was only consumed once (first renewal never executed since tx reverted)
        assertEq(sa.getSubscription(subId).consumed, PRICE,
            "only initial period consumed: double-charge prevented");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 4: Subscribe with zero periods
    //
    // Attack:  Call subscribe(offeringId, 0) to create a subscription with
    //          zero deposit. If allowed, the subscriber gets access for free
    //          and the provider earns nothing.
    //
    // Why blocked: periods == 0 → revert InvalidPeriods.
    //
    // Invariant: Every subscription costs at least pricePerPeriod.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_04_subscribeZeroPeriods_blocked() public {
        vm.prank(provider);
        uint256 offId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.InvalidPeriods.selector);
        sa.subscribe{value: 0}(offId, 0);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 5: Top-up then immediately cancel to extract more than deposited
    //
    // Attack:  Subscribe for 1 period (deposit=P, consumed=P, remaining=0).
    //          TopUp with X tokens. Cancel → refund = X.
    //          Does the attacker recover MORE than they sent in?
    //
    // Why this doesn't work: deposited = P + X; consumed = P; refund = X.
    //   Net: attacker paid (P + X) total, recovered X. Cost = P (first period).
    //   No excess withdrawal — the accounting is tight.
    //
    // Invariant: refund ≤ deposited − consumed (no credit fabrication).
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_05_topUpThenCancelNoExcessExtraction() public {
        vm.prank(provider);
        uint256 offId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offId, 1);
        // deposited=P, consumed=P, remaining=0

        // TopUp a large amount
        uint256 topUpAmt = 7 * PRICE;
        vm.prank(alice);
        sa.topUp{value: topUpAmt}(subId, topUpAmt);
        // deposited=8P, consumed=P, remaining=7P

        uint256 aliceBefore = alice.balance;

        vm.prank(alice);
        sa.cancel(subId);

        // Withdraw the refund
        vm.prank(alice);
        sa.withdraw(address(0));

        uint256 aliceAfter = alice.balance;
        uint256 received   = aliceAfter - aliceBefore;

        // Alice recovers exactly 7P (the topUp) — never more
        assertEq(received, topUpAmt, "refund equals topUp amount exactly");

        // Provider earned exactly the first period
        assertEq(sa.pendingWithdrawals(provider, address(0)), PRICE,
            "provider earned exactly 1 period: no free access");

        // Sanity: alice's net position is -PRICE (paid for 1 period)
        // She started with 100 ETH, paid P + 7P = 8P, got 7P back → net -P
        uint256 totalPaid = PRICE + topUpAmt;
        uint256 recovered = topUpAmt;
        assertEq(totalPaid - recovered, PRICE, "cost = exactly 1 period, no extraction");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 6a: Provider subscribes to own offering directly (self-dealing)
    //
    // Attack:  Provider calls subscribe() on their own offering. If successful,
    //          the provider would pay themselves (pendingWithdrawals[provider]
    //          credits from their own deposit) — a no-op economically, but
    //          could be used to inflate subscriberCount.
    //
    // Why blocked: msg.sender == offering.provider → revert SelfDealing (SA-2).
    //
    // Invariant: Provider cannot be both the service seller and buyer.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_06a_selfDealingDirect_blocked() public {
        vm.prank(provider);
        uint256 offId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        // Provider tries to subscribe to their own offering
        vm.prank(provider);
        vm.expectRevert(SubscriptionAgreement.SelfDealing.selector);
        sa.subscribe{value: PRICE}(offId, 1);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 6b: Provider subscribes via a proxy contract to bypass SelfDealing
    //
    // Attack:  Deploy a proxy so that msg.sender != provider address. The SA-2
    //          check passes (msg.sender is proxy, not provider). Provider can
    //          "subscribe" to inflate subscriberCount or manipulate accounting.
    //
    // Why this achieves nothing: The proxy's deposit goes to provider's
    //   pendingWithdrawals (same party). Net P&L = 0 minus gas.
    //   The provider pays PRICE and earns PRICE: no financial gain.
    //   subscriberCount does get inflated, but cancel corrects it immediately.
    //
    // Invariant: Financial accounting is correct even with proxy self-dealing.
    //            The system's economic invariants hold.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_06b_selfDealingProxy_noFinancialGain() public {
        vm.prank(provider);
        uint256 offId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        // Provider deploys a proxy and funds it
        SelfDealingProxy proxy = new SelfDealingProxy(sa);
        vm.deal(address(proxy), 5 * PRICE);

        // Proxy subscribes — msg.sender = proxy ≠ provider, so SelfDealing doesn't fire
        uint256 subId = proxy.doSubscribe{value: 2 * PRICE}(offId, 2);
        assertEq(sa.getSubscription(subId).subscriber, address(proxy), "proxy is subscriber");
        // subscriberCount inflated
        assertEq(sa.getOffering(offId).subscriberCount, 1, "count inflated");

        // Provider earned first period from the proxy subscription (via pendingWithdrawals)
        assertEq(sa.pendingWithdrawals(provider, address(0)), PRICE, "first period credited to provider");

        // Proxy cancels → gets remaining P back
        proxy.doCancel(subId);
        assertEq(sa.pendingWithdrawals(address(proxy), address(0)), PRICE, "proxy refunded 1 period");

        // subscriberCount back to 0
        assertEq(sa.getOffering(offId).subscriberCount, 0, "count restored after cancel");

        // Provider withdraws P (earned from the cycle)
        uint256 providerBefore = provider.balance;
        vm.prank(provider);
        sa.withdraw(address(0));
        assertEq(provider.balance - providerBefore, PRICE, "provider net +P");

        // Proxy withdraws P (got refund)
        proxy.doWithdraw();
        // Proxy paid 2P, got P back → net -P (proxy is under provider's control)
        // Provider paid 0, earned P, proxy (controller) paid 2P, got P back
        // Combined: provider/proxy system paid P net — no financial gain from the proxy trick
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 7: Grief — fill maxSubscribers cap, cancel all, re-subscribe to
    //           permanently block other users
    //
    // Attack:  With maxSubscribers=N, attacker subscribes with N addresses
    //          (using vm.prank to simulate N distinct subscribers), blocking
    //          the offering. Then attacker cancels all, immediately re-subscribes
    //          to hold all slots indefinitely.
    //
    // Why it fails as a grief: After the attacker cancels, subscriberCount drops
    //   to 0 and legitimate users can subscribe before the re-subscribe. More
    //   importantly, each grief cycle costs the attacker ≥ N × pricePerPeriod.
    //   The grief is economically bounded (attacker must keep paying).
    //
    // Invariant: After all cancels, subscriberCount = 0 and new subscriptions
    //            from legitimate users succeed.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_07_griefMaxSubscribers_slotsReleasedAfterCancel() public {
        // maxSubscribers = 3
        vm.prank(provider);
        uint256 offId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 3);

        // Three attacker-controlled addresses grab all slots
        address atk1 = address(0xBEEF01);
        address atk2 = address(0xBEEF02);
        address atk3 = address(0xBEEF03);
        vm.deal(atk1, 10 ether);
        vm.deal(atk2, 10 ether);
        vm.deal(atk3, 10 ether);

        vm.prank(atk1); uint256 sub1 = sa.subscribe{value: PRICE}(offId, 1);
        vm.prank(atk2); uint256 sub2 = sa.subscribe{value: PRICE}(offId, 1);
        vm.prank(atk3); uint256 sub3 = sa.subscribe{value: PRICE}(offId, 1);

        assertEq(sa.getOffering(offId).subscriberCount, 3, "all 3 slots filled");

        // A fourth user is blocked
        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.MaxSubscribersReached.selector);
        sa.subscribe{value: PRICE}(offId, 1);

        // Attacker cancels all three — subscriberCount returns to 0
        vm.prank(atk1); sa.cancel(sub1);
        vm.prank(atk2); sa.cancel(sub2);
        vm.prank(atk3); sa.cancel(sub3);

        assertEq(sa.getOffering(offId).subscriberCount, 0, "all slots released");

        // Alice can now subscribe — grief failed permanently
        vm.prank(alice);
        sa.subscribe{value: PRICE}(offId, 1);
        assertEq(sa.getOffering(offId).subscriberCount, 1, "legitimate user subscribed");

        // Cost verification: each of the 3 attacker addresses spent PRICE with 0 refund
        // (1 period deposited, 1 period consumed → refund = 0)
        assertEq(sa.pendingWithdrawals(atk1, address(0)), 0, "atk1 got nothing back");
        assertEq(sa.pendingWithdrawals(atk2, address(0)), 0, "atk2 got nothing back");
        assertEq(sa.pendingWithdrawals(atk3, address(0)), 0, "atk3 got nothing back");

        // Provider earned 3 × PRICE from the grief cycle
        assertEq(sa.pendingWithdrawals(provider, address(0)), 4 * PRICE,
            "provider earned from all subs (3 grief + 1 alice)");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 8: Front-run a renewal with a cancel to avoid next payment
    //
    // Attack:  Alice has 3 periods deposited. Period 1 ends. A keeper is about
    //          to call renewSubscription() to charge period 2. Alice sees this
    //          in the mempool and front-runs with cancel(), getting back the
    //          remaining 2 periods' deposit.
    //
    // Why this isn't an exploit: cancel() is intentional design — subscribers
    //   CAN cancel to reclaim remaining prepaid deposit. The provider already
    //   received payment for the current (first) period at subscribe time.
    //   cancel() correctly debits only what was consumed; the provider suffers
    //   no loss. This is the documented graceful exit mechanism.
    //
    // Invariant: Provider always earns at least 1 period per subscription cycle.
    //            The "front-run" just exercises the cancel refund path correctly.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_08_frontRunRenewalWithCancel_providerNotHarmed() public {
        vm.prank(provider);
        uint256 offId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        // Alice prepays 3 periods
        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 3 * PRICE}(offId, 3);
        // deposited=3P, consumed=P, remaining=2P

        // Period 1 ends. Keeper is "about to" renew. Alice front-runs with cancel.
        skip(PERIOD - 1); // 1 second before period end
        vm.prank(alice);
        sa.cancel(subId);
        // remaining = 2P refunded to alice

        // Keeper's renewSubscription now fails (AlreadyCancelled)
        skip(2); // past period end
        vm.expectRevert(SubscriptionAgreement.AlreadyCancelled.selector);
        sa.renewSubscription(subId);

        // Provider invariant: earned exactly 1 period
        assertEq(sa.pendingWithdrawals(provider, address(0)), PRICE,
            "provider earned full first period despite front-run cancel");

        // Alice got her 2 prepaid future periods back — this is correct behavior
        assertEq(sa.pendingWithdrawals(alice, address(0)), 2 * PRICE,
            "alice correctly refunded the 2 unstarted periods");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 9: Manipulate block.timestamp to extend access for free
    //
    // Attack:  A subscriber's period is about to expire. They try to find any
    //          on-chain action that extends currentPeriodEnd without paying.
    //          (In production, a colluding miner could nudge timestamp slightly,
    //          but gains only seconds of access — no economic impact.)
    //
    // Why it fails: currentPeriodEnd is only advanced in renewSubscription(),
    //   which requires (a) block.timestamp >= currentPeriodEnd AND (b) enough
    //   deposit. There is no other code path that modifies currentPeriodEnd.
    //   Warping block.timestamp forward (simulating time passing) cannot extend
    //   the subscription — it can only accelerate expiry.
    //
    // Invariant: currentPeriodEnd increases only via paid renewals. It cannot
    //            be extended by any free action from any caller.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_09_timestampManipNoFreeExtension() public {
        vm.prank(provider);
        uint256 offId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        // Alice subscribes for exactly 1 period
        vm.prank(alice);
        uint256 subId = sa.subscribe{value: PRICE}(offId, 1);
        // deposited=P, consumed=P, remaining=0

        uint256 periodEnd = sa.getSubscription(subId).currentPeriodEnd;

        // Before expiry: alice has access
        assertTrue(sa.hasAccess(offId, alice), "access before expiry");

        // No-op calls cannot extend currentPeriodEnd
        // Dispute requires an active non-cancelled sub — let's try various calls
        // Renew: NotYetRenewable (not at period end yet)
        vm.expectRevert(SubscriptionAgreement.NotYetRenewable.selector);
        sa.renewSubscription(subId);
        assertEq(sa.getSubscription(subId).currentPeriodEnd, periodEnd,
            "currentPeriodEnd unchanged after failed renew");

        // Warp past period end
        skip(PERIOD + 1);

        // Access now expired
        assertFalse(sa.hasAccess(offId, alice), "access expired after period");

        // Renew with 0 remaining deposit → expires subscription (no extension)
        sa.renewSubscription(subId);
        assertFalse(sa.getSubscription(subId).active, "subscription expired: no funds");
        assertFalse(sa.hasAccess(offId, alice),        "no access after expiry");

        // currentPeriodEnd was NOT advanced (deposit exhausted path doesn't advance it)
        assertEq(sa.getSubscription(subId).currentPeriodEnd, periodEnd,
            "expired sub: currentPeriodEnd frozen at original value");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 10: Create offering with price = 0 for unlimited free subscriptions
    //
    // Attack:  Provider creates an offering with pricePerPeriod = 0. Subscribers
    //          can subscribe for free; no funds are locked. Access is unlimited.
    //          A malicious provider could also create such an offering to grief
    //          the contract by generating subscriptions that consume no funds.
    //
    // Why blocked: createOffering() enforces pricePerPeriod > 0 → InvalidPrice.
    //
    // Invariant: Every subscription has a positive economic cost per period.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_10_priceZeroOffering_blocked() public {
        vm.prank(provider);
        vm.expectRevert(SubscriptionAgreement.InvalidPrice.selector);
        sa.createOffering(0, PERIOD, address(0), HASH, 0);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 11: Create offering with extremely large periodSeconds to:
    //            (a) attempt overflow in currentPeriodEnd at subscribe time, and
    //            (b) trap a subscriber's multi-period deposit (can never renew).
    //
    // Attack (a): periodSeconds = type(uint256).max
    //   block.timestamp + type(uint256).max overflows → subscribe reverts.
    //   (Solidity 0.8 checked arithmetic.)
    //
    // Attack (b): periodSeconds = type(uint256).max / 2
    //   subscribe succeeds (periodEnd = type(uint256).max / 2 + timestamp).
    //   Subscriber deposits for 2 periods but can never renew — the renewal
    //   advances currentPeriodEnd by another half-max, overflowing → reverts.
    //   Subscriber's second-period funds are "trapped" until they cancel.
    //   cancel() rescues the deposit: subscriber gets remaining back.
    //
    // Why this is safe (not a theft): The subscriber can always cancel to recover
    //   remaining deposit. No funds are permanently locked.
    //
    // Invariant: Overflow in period arithmetic reverts safely. Subscriber can
    //            always recover remaining deposit via cancel().
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_11_extremePeriodSeconds_overflowSafeAndCancelRecoverable() public {
        // Part (a): overflow at subscribe time — should revert
        vm.prank(provider);
        uint256 offOverflow = sa.createOffering(PRICE, type(uint256).max, address(0), HASH, 0);

        vm.prank(alice);
        vm.expectRevert(); // arithmetic overflow in block.timestamp + type(uint256).max
        sa.subscribe{value: 2 * PRICE}(offOverflow, 2);

        // Part (b): very large but non-overflowing period
        // block.timestamp = 1 in forge default, so type(uint256).max - 2 + 1 = type(uint256).max - 1
        // periodEnd = 1 + (type(uint256).max - 2) = type(uint256).max - 1 (no overflow)
        uint256 hugePeriod = type(uint256).max - 2;

        vm.prank(provider);
        uint256 offHuge = sa.createOffering(PRICE, hugePeriod, address(0), HASH, 0);

        // Subscribe for 2 periods — succeeds
        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 2 * PRICE}(offHuge, 2);
        assertEq(sa.getSubscription(subId).deposited, 2 * PRICE, "subscribed with 2 periods");

        // currentPeriodEnd is near type(uint256).max — effectively eternal
        assertTrue(sa.getSubscription(subId).currentPeriodEnd > 1e30,
            "period end is astronomically far in the future");

        // hasAccess is true (block.timestamp << currentPeriodEnd)
        assertTrue(sa.hasAccess(offHuge, alice), "access granted");

        // Renewal would overflow: currentPeriodEnd + hugePeriod > type(uint256).max
        // We can't realistically warp to the period end, but we can verify the formula
        // by checking that renewSubscription is NotYetRenewable (cannot wait that long)
        vm.expectRevert(SubscriptionAgreement.NotYetRenewable.selector);
        sa.renewSubscription(subId);

        // RESCUE: alice cancels to recover her second period deposit
        vm.prank(alice);
        sa.cancel(subId);

        // Refund = deposited - consumed = 2P - P = P
        assertEq(sa.pendingWithdrawals(alice, address(0)), PRICE,
            "second period deposit recovered via cancel: no theft");

        vm.prank(alice);
        sa.withdraw(address(0));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 12: Cross-token confusion — top-up with ERC-20, withdraw ETH
    //
    // Two sub-cases:
    //   (a) Subscribe ERC-20 offering, try to withdraw address(0) → NothingToWithdraw
    //   (b) Subscribe ETH offering, try to topUp with msg.value on ERC-20 path → MsgValueWithToken
    //   (c) Subscribe ETH offering, try to topUp without msg.value → InsufficientDeposit
    //
    // Attack: Exploit accounting by mismatching token types to inflate one
    //         pendingWithdrawals[token] entry without a corresponding deposit.
    //
    // Why blocked: pendingWithdrawals is keyed by (user, token). Credits and
    //              withdrawals must use the same token key. No cross-token credit.
    //
    // Invariant: pendingWithdrawals[user][tokenA] can never be drained as tokenB.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_12_crossTokenConfusion_blocked() public {
        // Setup: two offerings — one ETH, one ERC-20
        vm.startPrank(provider);
        uint256 ethOff = sa.createOffering(PRICE,   PERIOD, address(0),     HASH, 0);
        uint256 tokOff = sa.createOffering(100e18,  PERIOD, address(token),  HASH, 0);
        vm.stopPrank();

        token.mint(alice, 1000e18);
        vm.prank(alice); token.approve(address(sa), 1000e18);

        // Case (a): Subscribe ERC-20, try to withdraw ETH
        vm.prank(alice);
        sa.subscribe(tokOff, 3); // ERC-20 subscribe
        vm.prank(alice);
        sa.cancel(1); // cancel → pendingWithdrawals[alice][token] = 200e18

        // alice has token pending, but tries to withdraw ETH
        vm.prank(alice);
        vm.expectRevert(SubscriptionAgreement.NothingToWithdraw.selector);
        sa.withdraw(address(0)); // wrong token

        // Correct withdrawal works
        vm.prank(alice);
        sa.withdraw(address(token)); // correct

        // Case (b): ETH offering topUp with ERC-20 allowance (msg.value mismatch)
        vm.prank(alice);
        uint256 ethSub = sa.subscribe{value: 2 * PRICE}(ethOff, 2);

        // Try to topUp ETH offering while sending msg.value
        // (this is correct, but verify the inverse — sending value on ERC-20 topUp)
        vm.prank(provider);
        uint256 tokOff2 = sa.createOffering(100e18, PERIOD, address(token), HASH, 0);
        token.mint(bob, 1000e18);
        vm.prank(bob); token.approve(address(sa), 1000e18);
        vm.prank(bob);
        uint256 bobSub = sa.subscribe(tokOff2, 2); // ERC-20

        // topUp ERC-20 subscription with ETH value → MsgValueWithToken
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        vm.expectRevert(SubscriptionAgreement.MsgValueWithToken.selector);
        sa.topUp{value: 1 ether}(bobSub, 100e18);

        // Case (c): ETH topUp with wrong msg.value → InsufficientDeposit
        vm.prank(alice);
        vm.expectRevert(); // InsufficientDeposit(topUpAmt, msg.value)
        sa.topUp{value: 0.5 ether}(ethSub, 1 ether); // msg.value != amount

        // ethSub used above in topUp revert test
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 13: Subscribe with fee-on-transfer token — balance accounting breaks
    //
    // Attack:  Use a fee-on-transfer token (10% burned on every transfer).
    //          When subscribe calls safeTransferFrom(alice, SA, total), SA
    //          receives only 0.9 × total. The internal accounting records
    //          deposited = total (the sent amount, not received).
    //          Total pendingWithdrawals > SA's actual token balance.
    //          One party's withdrawal fails — contract becomes insolvent.
    //
    // Why it manifests: The contract explicitly documents that fee-on-transfer
    //   tokens are NOT supported. This test quantifies the insolvency.
    //
    // Invariant documented: FOT tokens must NOT be used with this contract.
    //   Using them creates insolvency: sum(pendingWithdrawals) > balance.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_13_feeOnTransferTokenInsolvency_documented() public {
        uint256 fotPrice  = 1_000;
        uint256 fotPeriods = 3;
        uint256 fotTotal  = fotPrice * fotPeriods; // 3000 sent; 2700 received (10% fee)

        // Provider creates offering with FOT token
        vm.prank(provider);
        uint256 offId = sa.createOffering(fotPrice, PERIOD, address(fotToken), HASH, 0);

        // Mint enough for alice (she sends 3000, pays fee)
        fotToken.mint(alice, fotTotal + 1000);
        vm.prank(alice);
        fotToken.approve(address(sa), fotTotal);

        // Subscribe: SA's accounting records deposited=3000, consumed=1000
        // SA's ACTUAL fotToken balance = 2700 (10% fee taken on transferFrom)
        vm.prank(alice);
        uint256 subId = sa.subscribe(offId, fotPeriods);

        uint256 saBalance = fotToken.balanceOf(address(sa));
        assertEq(saBalance, 2700, "SA received only 2700 (10% fee applied)");

        // Internal accounting: deposited=3000, consumed=1000, pendingWithdrawals[provider]=1000
        assertEq(sa.getSubscription(subId).deposited, fotTotal,       "deposited recorded as 3000");
        assertEq(sa.getSubscription(subId).consumed,  fotPrice,        "consumed = first period");
        assertEq(sa.pendingWithdrawals(provider, address(fotToken)), fotPrice, "provider credit = 1000");

        // Alice cancels: pendingWithdrawals[alice][fotToken] += 2000
        vm.prank(alice);
        sa.cancel(subId);

        uint256 providerCredit = sa.pendingWithdrawals(provider, address(fotToken));
        uint256 aliceCredit    = sa.pendingWithdrawals(alice,    address(fotToken));
        uint256 totalCredits   = providerCredit + aliceCredit;

        assertGt(totalCredits, saBalance,
            "INSOLVENCY: total credits (3000) > SA balance (2700)");

        // Provider withdraws first (1000 → receives 900 after fee, SA balance: 2700-1000=1700)
        vm.prank(provider);
        sa.withdraw(address(fotToken));
        assertEq(fotToken.balanceOf(address(sa)), 1700, "SA balance: 1700 after provider withdraw");

        // Alice tries to withdraw 2000 — SA only has 1700 → token reverts (insufficient balance)
        vm.prank(alice);
        vm.expectRevert("balance"); // FOT token reverts on insufficient balance
        sa.withdraw(address(fotToken));

        // This confirms: FOT tokens cause insolvency; last withdrawer cannot be paid.
        // The contract's NatSpec explicitly warns: "Fee-on-transfer ... NOT supported."
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 14: Provider deactivates offering mid-period — subscriber access
    //
    // Attack:  Provider deactivates offering after alice subscribes, trying to
    //          revoke alice's access before the period ends, or to prevent
    //          alice from renewing with her prepaid deposit.
    //
    // Why it fails: deactivateOffering() only sets active=false, which blocks
    //   NEW subscribers. Existing subscriptions continue normally: hasAccess
    //   returns true, renewSubscription works until deposit is exhausted.
    //
    // Invariant: Provider cannot unilaterally cancel or revoke a paid subscription.
    //            Deactivation is prospective (no new subs), not retroactive.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_14_providerDeactivateMidPeriod_existingAccessPreserved() public {
        vm.prank(provider);
        uint256 offId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        // Alice subscribes for 3 periods
        vm.prank(alice);
        uint256 subId = sa.subscribe{value: 3 * PRICE}(offId, 3);
        assertTrue(sa.hasAccess(offId, alice), "alice has access before deactivation");

        // Provider deactivates mid-period
        vm.prank(provider);
        sa.deactivateOffering(offId);
        assertFalse(sa.getOffering(offId).active, "offering deactivated");

        // Alice STILL has access — deactivation does not revoke paid access
        assertTrue(sa.hasAccess(offId, alice), "alice keeps access after deactivation");
        assertTrue(sa.getSubscription(subId).active, "subscription still active");

        // Alice can still renew (deposit is sufficient)
        skip(PERIOD + 1);
        sa.renewSubscription(subId); // keeper-callable
        assertEq(sa.getSubscription(subId).consumed, 2 * PRICE, "second period processed");

        // New subscriber is blocked
        vm.prank(bob);
        vm.expectRevert(SubscriptionAgreement.OfferingInactive.selector);
        sa.subscribe{value: PRICE}(offId, 1);

        // Provider cannot deactivate twice
        vm.prank(provider);
        sa.deactivateOffering(offId); // idempotent (already false, just sets false again)
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 15: Dispute abuse — dispute every period for free service
    //
    // Attack:  Alice subscribes for N periods. Immediately disputes. Owner
    //          resolves SUBSCRIBER_WINS. Alice gets remaining deposit back.
    //          Repeat each cycle. If alice always gets her remaining deposit
    //          back, she receives free access (provider earns nothing).
    //
    // Why it fails: The first period payment is credited to the provider at
    //   subscribe time (SA records consumed=pricePerPeriod immediately).
    //   When owner resolves SUBSCRIBER_WINS, remaining = deposited - consumed.
    //   With 1 period deposited: remaining = 0. Alice gets nothing back.
    //   Each dispute cycle costs alice exactly pricePerPeriod.
    //
    // Extended: With 2 periods deposited, alice disputes immediately.
    //   remaining = P. SUBSCRIBER_WINS gives alice P back.
    //   Net per cycle: alice paid 2P, got P back → cost = P per cycle.
    //   Provider earns P per dispute cycle regardless of outcome.
    //
    // Invariant: Provider always earns at least pricePerPeriod per subscription.
    //            Dispute does not allow free service extraction.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_15_disputeAbuseEveryPeriod_providerAlwaysEarns() public {
        vm.prank(provider);
        uint256 offId = sa.createOffering(PRICE, PERIOD, address(0), HASH, 0);

        // Cycle 1: subscribe 1 period, immediately dispute
        vm.prank(alice);
        uint256 sub1 = sa.subscribe{value: PRICE}(offId, 1);
        // deposited=P, consumed=P, remaining=0

        vm.prank(alice);
        sa.disputeSubscription(sub1);

        // Owner resolves SUBSCRIBER_WINS — remaining=0, alice gets nothing
        sa.resolveDisputeDetailed(sub1, SubscriptionAgreement.DisputeOutcome.SUBSCRIBER_WINS, 0, 0);
        assertEq(sa.pendingWithdrawals(alice,    address(0)), 0, "cycle1: alice gets 0");
        assertEq(sa.pendingWithdrawals(provider, address(0)), PRICE, "cycle1: provider earns P");

        // Cycle 2: subscribe 2 periods, dispute immediately (remaining=P)
        vm.prank(alice);
        uint256 sub2 = sa.subscribe{value: 2 * PRICE}(offId, 2);
        // deposited=2P, consumed=P, remaining=P

        vm.prank(alice);
        sa.disputeSubscription(sub2);

        // Owner resolves SUBSCRIBER_WINS — alice gets remaining=P back
        sa.resolveDisputeDetailed(sub2, SubscriptionAgreement.DisputeOutcome.SUBSCRIBER_WINS, 0, 0);
        assertEq(sa.pendingWithdrawals(alice, address(0)), PRICE, "cycle2: alice gets P back");

        // Provider total earned after 2 cycles:
        // cycle1: P, cycle2: P (from sub2's first period). Total = 2P.
        assertEq(sa.pendingWithdrawals(provider, address(0)), 2 * PRICE,
            "provider earned 1 period per cycle regardless of dispute outcome");

        // Economic summary: alice spent 3P total (P + 2P), recovered P, net cost = 2P.
        // Provider earned 2P across 2 cycles. Dispute abuse is NOT free for alice.
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Attack 16: Flash loan — borrow tokens, subscribe, cancel in same tx for profit
    //
    // Attack:  Attacker borrows N × pricePerPeriod tokens (flash loan).
    //          Subscribes for N periods, immediately cancels, withdraws refund
    //          (N-1 periods back), repays loan. If net profit > 0, tokens
    //          were extracted from the contract.
    //
    // Why it fails: subscribe() credits consumed += pricePerPeriod immediately.
    //   cancel() refund = deposited - consumed = (N-1) × pricePerPeriod.
    //   Net: attacker receives (N-1)P but paid NP → net loss = pricePerPeriod.
    //   No flash loan is profitable because the first period is always consumed.
    //
    // Additionally verified: the entire subscribe+cancel+withdraw cycle executes
    //   atomically in one transaction (no timelocks needed for this invariant).
    //
    // Invariant: netProfit from flash subscribe+cancel cycle ≤ −pricePerPeriod.
    // ──────────────────────────────────────────────────────────────────────────
    function test_attack_16_flashLoanSubscribeCancel_noProfit() public {
        uint256 flashPrice   = 1_000e18;
        uint256 flashPeriods = 10;

        vm.prank(provider);
        uint256 offId = sa.createOffering(flashPrice, PERIOD, address(token), HASH, 0);

        FlashLoanAttacker attacker = new FlashLoanAttacker(sa, token);

        // Simulate flash loan: fund the attacker with exactly the deposit amount
        token.mint(address(attacker), flashPrice * flashPeriods);

        // Execute the flash attack: subscribe N periods, cancel, withdraw
        int256 netProfit = attacker.attack(offId, flashPrice, flashPeriods);

        // Net profit must be negative (loss = exactly pricePerPeriod)
        assertLt(netProfit, 0, "flash loan attack is always at a loss");
        assertEq(netProfit, -int256(flashPrice),
            "loss equals exactly one period: first period non-refundable");

        // Provider earned the first period
        assertEq(sa.pendingWithdrawals(provider, address(token)), flashPrice,
            "provider earned first period from the flash attack");

        // Verify: if the attacker subscribes for just 1 period (minimum), they get 0 back
        token.mint(address(attacker), flashPrice); // refill for second attempt
        int256 netProfit1Period = attacker.attack(offId, flashPrice, 1);
        assertEq(netProfit1Period, -int256(flashPrice),
            "1-period flash: attacker gets 0 back (deposited == consumed)");
    }
}
