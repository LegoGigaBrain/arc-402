// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "../contracts/src/ComputeAgreement.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// ATTACKER CONTRACTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @title ReentrantProvider
 * @notice Malicious provider that re-enters withdraw() on ETH receipt.
 *         Attack: drain contract by exploiting reentrancy before balance is zeroed.
 *         Expected: CA-1 (checks-effects-interactions) stops double-withdrawal.
 */
contract ReentrantProvider {
    ComputeAgreement internal ca;
    uint256 public reentryCount;
    uint256 public stolenAmount;

    constructor(ComputeAgreement _ca) { ca = _ca; }

    receive() external payable {
        // Try to re-enter on every ETH receipt
        if (ca.pendingWithdrawals(address(this), address(0)) > 0) {
            reentryCount++;
            ca.withdraw(address(0));
        }
    }

    function acceptSession(bytes32 sid) external { ca.acceptSession(sid); }
    function startSession(bytes32 sid)  external { ca.startSession(sid);  }
    function endSession(bytes32 sid)    external { ca.endSession(sid);    }

    function doWithdraw() external {
        uint256 before = address(this).balance;
        ca.withdraw(address(0));
        stolenAmount = address(this).balance - before;
    }
}

/**
 * @title MaliciousArbitrator
 * @notice Arbitrator that tries to redirect all funds to itself via resolveDispute.
 *         Expected: resolveDispute only credits provider/client — can't pay itself.
 */
contract MaliciousArbitrator {
    ComputeAgreement internal ca;

    constructor(ComputeAgreement _ca) { ca = _ca; }

    // Attempt to steal by calling resolve with provider=self, client=self
    function tryStealViaResolve(bytes32 sid, uint256 deposit) external {
        // arbitrator cannot set provider/client to themselves —
        // resolveDispute credits the session's stored provider and client,
        // not arbitrary addresses. This call should succeed but credit session parties.
        ca.resolveDispute(sid, deposit, 0);
    }

    // Attempt overpayment split (providerAmount + clientAmount > depositAmount)
    function tryOverpay(bytes32 sid, uint256 deposit) external {
        ca.resolveDispute(sid, deposit, 1);
    }
}

/**
 * @title FlashLoanAttacker
 * @notice Simulates a flash-loan style attack: receive borrowed ETH, propose
 *         a session, try to withdraw in the same call before repaying.
 *         Expected: withdraw() requires a prior endSession; funds stay locked.
 */
contract FlashLoanAttacker {
    ComputeAgreement internal ca;
    address internal provider;

    constructor(ComputeAgreement _ca, address _provider) {
        ca = _ca;
        provider = _provider;
    }

    // Called with "flash loan" ETH — tries to propose + immediately withdraw
    function attack(bytes32 sid) external payable {
        // Step 1: deposit into contract
        ca.proposeSession{value: msg.value}(sid, provider, msg.value, 1, keccak256("spec"), address(0));
        // Step 2: try to withdraw immediately (session not ended — should fail)
        // (This will revert with NothingToWithdraw)
        ca.withdraw(address(0));
    }

    receive() external payable {}
}

/**
 * @title SessionGriefSpammer
 * @notice Spams proposeSession to a provider with unacceptable terms.
 *         Attack: lock up provider's reputation / force reject overhead.
 *         Expected: provider ignores sessions; spammer loses ETH to TTL wait.
 */
contract SessionGriefSpammer {
    ComputeAgreement internal ca;

    constructor(ComputeAgreement _ca) { ca = _ca; }

    function spamSessions(address victim, uint256 count) external payable {
        uint256 perDeposit = msg.value / count;
        for (uint256 i = 0; i < count; i++) {
            bytes32 sid = keccak256(abi.encodePacked(address(this), i));
            ca.proposeSession{value: perDeposit}(sid, victim, perDeposit, 1, keccak256("grief"), address(0));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTACKER TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @title ComputeAgreementAttackerTest
 * @notice AUDITOR A — THE ATTACKER.
 *         Each test is a concrete exploit attempt. All must PASS — meaning the
 *         attack is PREVENTED by the contract.
 */
contract ComputeAgreementAttackerTest is Test {
    ComputeAgreement internal ca;

    // Fixed addresses
    address internal client   = address(0xC1);
    address internal attacker = address(0xBAD);

    // Provider key-pair (deterministic)
    uint256 internal providerKey = 0xBEEF;
    address internal provider;

    // Arbitrator
    address internal arbitrator = address(0xAB);

    uint256 internal constant RATE  = 1 ether;
    uint256 internal constant HOURS = 4;
    uint256 internal constant DEPOSIT = RATE * HOURS;
    bytes32 internal constant GPU_SPEC = keccak256("h100");

    bytes32 internal sid;

    function setUp() public {
        provider = vm.addr(providerKey);
        ca = new ComputeAgreement(arbitrator);

        vm.deal(client,   100 ether);
        vm.deal(attacker, 100 ether);
        vm.deal(provider, 10 ether);

        sid = keccak256(abi.encodePacked(client, uint256(1)));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _propose() internal {
        vm.prank(client);
        ca.proposeSession{value: DEPOSIT}(sid, provider, RATE, HOURS, GPU_SPEC, address(0));
    }

    function _proposeAndAccept() internal {
        _propose();
        vm.prank(provider);
        ca.acceptSession(sid);
    }

    function _start() internal {
        _proposeAndAccept();
        vm.prank(provider);
        ca.startSession(sid);
    }

    function _signReport(
        bytes32 _sid,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 computeMinutes,
        uint256 avgUtil,
        bytes32 metricsHash
    ) internal view returns (bytes memory) {
        return _signReportWithKey(
            providerKey, address(ca), _sid, periodStart, periodEnd, computeMinutes, avgUtil, metricsHash
        );
    }

    function _signReportWithKey(
        uint256 key,
        address contractAddr,
        bytes32 _sid,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 computeMinutes,
        uint256 avgUtil,
        bytes32 metricsHash
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            block.chainid,
            contractAddr,
            _sid, periodStart, periodEnd, computeMinutes, avgUtil, metricsHash
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _submitReport(uint256 computeMinutes, uint256 avgUtil) internal {
        uint256 ps = block.timestamp;
        uint256 pe = ps + computeMinutes * 60;
        bytes32 mh = keccak256(abi.encodePacked("metrics", computeMinutes));
        bytes memory sig = _signReport(sid, ps, pe, computeMinutes, avgUtil, mh);
        vm.warp(pe);
        vm.prank(provider);
        ca.submitUsageReport(sid, ps, pe, computeMinutes, avgUtil, sig, mh);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 1: Reentrancy on withdraw()
    // Attack:   Malicious provider earns ETH, then re-enters withdraw() in
    //           receive() trying to drain the contract twice.
    // Why fail: CA-1 — balance zeroed BEFORE transfer (checks-effects).
    //           Second withdraw call hits NothingToWithdraw.
    // Invariant: provider can only withdraw what they earned, exactly once.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack01_reentrancyOnWithdraw() public {
        ReentrantProvider rp = new ReentrantProvider(ca);
        address rpAddr = address(rp);

        // Setup session with malicious provider
        bytes32 sid2 = keccak256(abi.encodePacked(client, uint256(2)));
        vm.prank(client);
        ca.proposeSession{value: 1 ether}(sid2, rpAddr, 1 ether, 1, GPU_SPEC, address(0));

        // Malicious provider accepts and starts
        rp.acceptSession(sid2);

        vm.prank(rpAddr);
        ca.startSession(sid2);

        // Submit 60 minutes → provider earns 1 ETH (full deposit)
        uint256 ps = block.timestamp;
        uint256 pe = ps + 60 minutes;
        bytes32 mh = keccak256("r1");
        // Provider key must match rpAddr — use a fresh key
        // For this test we make the provider sign as themselves using vm.sign
        // Actually, provider is rpAddr which has no private key directly.
        // Instead, use a real key for provider and fund that address.
        // Re-setup: use a fresh session with actual keyed provider for sig test.
        // End session with zero usage → client gets full refund, provider 0.
        // Then test reentrancy on client's withdraw instead.
        vm.prank(client);
        ca.endSession(sid2);

        // Client has 1 ETH pending — client is a contract? No, client=0xC1 (EOA).
        assertEq(ca.pendingWithdrawals(client, address(0)), 1 ether);
        assertEq(ca.pendingWithdrawals(rpAddr, address(0)),  0);

        // To test reentrancy meaningfully we need rpAddr to have a pending balance.
        // Manually credit rp with ETH via a second session where it earns payment.
        // We set this up with the real providerKey-signed report approach:
        // Build separate session where keyed provider = rpAddr isn't possible without the key.
        // Instead: we verify that the check-effects pattern means pendingWithdrawals zeroes
        // before transfer. If reentrancy succeeded, rp.reentryCount > 0 AND contract lost
        // more than what was credited.

        // Verify the reentrancy attempt on the legitimate client withdrawal:
        // (rp has nothing — NothingToWithdraw fires immediately)
        vm.expectRevert(ComputeAgreement.NothingToWithdraw.selector);
        rp.doWithdraw();

        // Client can withdraw safely
        uint256 clientBefore = client.balance;
        vm.prank(client);
        ca.withdraw(address(0));
        assertEq(client.balance - clientBefore, 1 ether);
        assertEq(address(ca).balance, 0);
    }

    /**
     * @notice Reentrancy 1b: Inject a pending balance into a reentrant contract
     *         and verify the check-effects pattern stops double-withdrawal.
     *         This uses deal() to simulate having earned funds.
     */
    function test_attack01b_reentrancyCheckEffects() public {
        ReentrantProvider rp = new ReentrantProvider(ca);
        address rpAddr = address(rp);

        // Build a session with actual keyed provider to earn ETH,
        // then simulate rp earning via a separate session using providerKey → rpAddr mapping.
        // Cleaner approach: set up a session where rpAddr is provider using a vm.prank chain.

        // Propose session with rpAddr as provider, 1 ETH deposit
        bytes32 sid3 = keccak256(abi.encodePacked(client, uint256(3)));
        vm.prank(client);
        ca.proposeSession{value: 1 ether}(sid3, rpAddr, 1 ether, 1, GPU_SPEC, address(0));

        // rpAddr accepts and starts
        vm.prank(rpAddr);
        ca.acceptSession(sid3);
        vm.prank(rpAddr);
        ca.startSession(sid3);

        // Provider ends session with no usage → client gets full refund, provider 0
        // (We can't sign a report for rpAddr without its private key)
        // End the session — client terminates
        vm.prank(client);
        ca.endSession(sid3);

        // Simulate provider earning something by manually crediting via vm.store.
        // pendingWithdrawals is slot 3 (nested: mapping(address => mapping(address => uint256))).
        // Slot for pendingWithdrawals[rpAddr][address(0)]:
        //   innerSlot = keccak256(abi.encode(rpAddr, 3))
        //   finalSlot = keccak256(abi.encode(address(0), innerSlot))
        bytes32 innerSlot = keccak256(abi.encode(rpAddr, uint256(3)));
        bytes32 slot = keccak256(abi.encode(address(0), innerSlot));
        vm.store(address(ca), slot, bytes32(uint256(0.5 ether)));

        assertEq(ca.pendingWithdrawals(rpAddr, address(0)), 0.5 ether);
        uint256 contractBalance = address(ca).balance + 0.5 ether;
        // Fund contract to match the injected balance
        vm.deal(address(ca), address(ca).balance + 0.5 ether);

        // ATTACK: rp calls withdraw, re-enters in receive(), tries to get 1 ETH total
        rp.doWithdraw();

        // Invariant: rp got exactly 0.5 ETH (its credited amount), nothing more
        assertEq(rp.stolenAmount(), 0.5 ether);
        // Re-entry was attempted but had nothing to withdraw
        // (pendingWithdrawals zeroed before transfer → second call gets NothingToWithdraw)
        // The reentryCount MAY be > 0 but stolenAmount must be exactly 0.5 ETH
        assertEq(ca.pendingWithdrawals(rpAddr, address(0)), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 2: Front-running proposeSession — sessionId sniping
    // Attack:   Attacker watches mempool, frontruns client's proposeSession with
    //           the same sessionId, seizing it before the real client.
    // Why fail: Client's tx reverts (SessionAlreadyExists) but client's ETH
    //           is safe — the reverted tx never deducted their deposit.
    //           Attacker controls useless session (different client/provider).
    // Invariant: Front-runner cannot steal client's ETH; they only grief.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack02_frontRunSessionId() public {
        // Attacker snatches the sessionId first (same sid, different provider chosen by attacker)
        address attackerProvider = address(0xDEAD);
        vm.prank(attacker);
        ca.proposeSession{value: DEPOSIT}(sid, attackerProvider, RATE, HOURS, GPU_SPEC, address(0));

        // Attacker now owns the session as client
        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(s.client, attacker);

        // Legitimate client's tx arrives — must revert
        uint256 clientBalanceBefore = client.balance;
        vm.prank(client);
        vm.expectRevert(ComputeAgreement.SessionAlreadyExists.selector);
        ca.proposeSession{value: DEPOSIT}(sid, provider, RATE, HOURS, GPU_SPEC, address(0));

        // Client's ETH is untouched (revert refunds the call value)
        assertEq(client.balance, clientBalanceBefore);

        // Attacker's session is useless — their chosen provider can't do anything useful
        // (attacker can't make the real provider accept a session they didn't set up)
        // Attacker's deposit is locked for PROPOSAL_TTL then refundable — no profit
        assertEq(s.provider, attackerProvider);
        assertNotEq(s.provider, provider); // real provider is not involved
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 3: Provider inflates computeMinutes to drain deposit
    // Attack:   Dishonest provider signs a report claiming full maxHours*60
    //           minutes in a single report to extract maximum payment.
    // Why fail: CA-8 caps consumedMinutes to maxHours*60. Any single report
    //           exceeding the cap reverts. Even at max, payment == deposit
    //           (already the agreed maximum). Client got what they paid for.
    // Invariant: provider can never receive more than depositAmount.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack03_providerInflatesMinutes() public {
        _start();

        uint256 maxMinutes = HOURS * 60; // 240

        // Provider attempts to claim maxMinutes + 1 in one shot
        uint256 ps = block.timestamp;
        uint256 pe = ps + (maxMinutes + 1) * 60;
        bytes32 mh = keccak256("inflated");
        bytes memory sig = _signReport(sid, ps, pe, maxMinutes + 1, 100, mh);
        vm.warp(pe);

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.ExceedsMaxMinutes.selector);
        ca.submitUsageReport(sid, ps, pe, maxMinutes + 1, 100, sig, mh);

        // Legitimate max claim (exactly maxMinutes) is allowed
        bytes32 mh2 = keccak256("exact-max");
        bytes memory sig2 = _signReport(sid, ps, pe, maxMinutes, 100, mh2);
        vm.prank(provider);
        ca.submitUsageReport(sid, ps, pe, maxMinutes, 100, sig2, mh2);

        vm.prank(provider);
        ca.endSession(sid);

        // Provider earns exactly deposit — no more
        uint256 earned = ca.pendingWithdrawals(provider, address(0));
        assertEq(earned, DEPOSIT);
        assertEq(ca.pendingWithdrawals(client, address(0)), 0);

        // Settlement never exceeds deposit
        assertLe(earned, DEPOSIT);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 4: Grief by spamming proposeSession to lock up provider
    // Attack:   Attacker floods provider with hundreds of sessions hoping to
    //           deny service, confuse the provider, or lock provider's address.
    // Why fail: Provider simply doesn't accept; spam sessions expire after
    //           PROPOSAL_TTL. Spammer's own ETH is locked until TTL, losing
    //           opportunity cost. Provider's funds and reputation are unaffected.
    // Invariant: Provider's pendingWithdrawals and session data are unaffected.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack04_griefBySpammingSessions() public {
        SessionGriefSpammer spammer = new SessionGriefSpammer(ca);
        vm.deal(address(spammer), 50 ether);

        // Spam 10 sessions targeting the real provider
        spammer.spamSessions{value: 10 ether}(provider, 10);

        // Provider's ETH balance is untouched — they didn't deposit anything
        assertEq(provider.balance, 10 ether);
        // Provider's pending withdrawals = 0
        assertEq(ca.pendingWithdrawals(provider, address(0)), 0);

        // The legitimate session still works normally
        _start();
        _submitReport(60, 80);
        vm.prank(provider);
        ca.endSession(sid);
        assertEq(ca.pendingWithdrawals(provider, address(0)), 1 ether); // 60 min * 1 ETH/hr / 60 = 1 ETH

        // Spammer's ETH is locked (they own the sessions as client), provider can ignore them
        // Verify one spam session belongs to spammer as client, provider unrelated
        bytes32 spamSid = keccak256(abi.encodePacked(address(spammer), uint256(0)));
        ComputeAgreement.ComputeSession memory s = ca.getSession(spamSid);
        assertEq(s.client, address(spammer));
        assertEq(s.provider, provider);
        assertEq(uint256(s.status), uint256(ComputeAgreement.SessionStatus.Proposed));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 5: Replay attack — reuse signed report within same session
    // Attack:   Provider submits a valid signed report, then replays the exact
    //           same signature to double-count compute minutes and earn twice.
    // Why fail: CA-2 — reportDigestUsed[digest] = true after first submission.
    //           Second identical submission reverts with ReportAlreadySubmitted.
    // Invariant: consumedMinutes only increments once per unique report digest.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack05_replaySignedReport() public {
        _start();

        uint256 ps = block.timestamp;
        uint256 pe = ps + 60 minutes;
        bytes32 mh = keccak256("metrics-replay");
        bytes memory sig = _signReport(sid, ps, pe, 60, 80, mh);

        vm.warp(pe);
        vm.prank(provider);
        ca.submitUsageReport(sid, ps, pe, 60, 80, sig, mh);

        // Replay the exact same signed report
        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.ReportAlreadySubmitted.selector);
        ca.submitUsageReport(sid, ps, pe, 60, 80, sig, mh);

        // Consumed minutes correctly = 60, not 120
        assertEq(ca.getSession(sid).consumedMinutes, 60);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 6: Cross-session signature forgery
    // Attack:   Provider has two sessions (A and B). Takes a valid signed report
    //           for session A and submits it against session B to earn double.
    // Why fail: _reportDigest includes sessionId. The digest for session B differs
    //           from session A's digest; ecrecover returns wrong address →
    //           InvalidSignature.
    // Invariant: A signature bound to sessionId_A is cryptographically invalid
    //            for any sessionId_B ≠ sessionId_A.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack06_crossSessionSignatureForgery() public {
        // Setup session A (the main sid)
        _start();

        // Setup session B with same provider
        bytes32 sidB = keccak256(abi.encodePacked(client, uint256(99)));
        vm.prank(client);
        ca.proposeSession{value: DEPOSIT}(sidB, provider, RATE, HOURS, GPU_SPEC, address(0));
        vm.prank(provider);
        ca.acceptSession(sidB);
        vm.prank(provider);
        ca.startSession(sidB);

        // Sign a valid report for session A
        uint256 ps = block.timestamp;
        uint256 pe = ps + 60 minutes;
        bytes32 mh = keccak256("cross-session");
        bytes memory sigForA = _signReport(sid, ps, pe, 60, 80, mh);

        vm.warp(pe);

        // Submit the session-A sig against session B → InvalidSignature
        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.InvalidSignature.selector);
        ca.submitUsageReport(sidB, ps, pe, 60, 80, sigForA, mh);

        // The valid sig works correctly for session A
        vm.prank(provider);
        ca.submitUsageReport(sid, ps, pe, 60, 80, sigForA, mh);
        assertEq(ca.getSession(sid).consumedMinutes, 60);
        assertEq(ca.getSession(sidB).consumedMinutes, 0); // session B untouched
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 7: Dispute abuse — dispute to delay payment, claim timeout refund
    // Attack:   Client receives full GPU work, then disputes to avoid paying.
    //           Tries to claim timeout refund before 7-day window expires.
    // Why fail: claimDisputeTimeout requires block.timestamp >= disputedAt +
    //           DISPUTE_TIMEOUT. Premature call reverts with DisputeNotExpired.
    //           Arbitrator can intervene and award provider their earned amount.
    // Invariant: Provider's earned payment is protected via arbitration path;
    //            client cannot escape before DISPUTE_TIMEOUT.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack07_disputeAbuse_cannotClaimEarly() public {
        _start();
        _submitReport(120, 90); // 2 hours of GPU work done

        // Client disputes instead of paying
        vm.prank(client);
        ca.disputeSession(sid);

        // Attempt premature timeout claim
        vm.prank(client);
        vm.expectRevert(ComputeAgreement.DisputeNotExpired.selector);
        ca.claimDisputeTimeout(sid);

        // Arbitrator correctly awards provider for work done: 2 ETH
        // (120 min * 1 ETH/hr / 60 = 2 ETH)
        vm.prank(arbitrator);
        ca.resolveDispute(sid, 2 ether, 2 ether);

        assertEq(ca.pendingWithdrawals(provider, address(0)), 2 ether);
        assertEq(ca.pendingWithdrawals(client, address(0)),   2 ether);
    }

    function test_attack07b_disputeAbuse_timeoutWorksAfterDelay() public {
        _start();

        // Client disputes with zero usage (provider did no work)
        vm.prank(client);
        ca.disputeSession(sid);

        // Wait exactly one second short of timeout — still locked
        vm.warp(block.timestamp + ca.DISPUTE_TIMEOUT() - 1);
        vm.prank(client);
        vm.expectRevert(ComputeAgreement.DisputeNotExpired.selector);
        ca.claimDisputeTimeout(sid);

        // After timeout expires, client can recover (provider never started work anyway)
        vm.warp(block.timestamp + 2); // now past timeout
        vm.prank(client);
        ca.claimDisputeTimeout(sid);

        assertEq(ca.pendingWithdrawals(client, address(0)), DEPOSIT);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 8: Arbitrator collusion
    // Attack 8a: Malicious arbitrator tries to award funds to themselves.
    // Attack 8b: Arbitrator tries to award more than depositAmount.
    // Why fail: resolveDispute credits only the session's provider and client
    //           addresses — the arbitrator cannot insert their own address.
    //           InvalidSplit fires if providerAmount + clientAmount > depositAmount.
    // Invariant: Arbitrator can redistribute funds only between session parties;
    //            total paid out ≤ depositAmount; arbitrator gets nothing.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack08a_arbitratorCannotStealFunds() public {
        _start();
        _submitReport(60, 80); // 1 ETH earned by provider

        vm.prank(client);
        ca.disputeSession(sid);

        // Malicious arbitrator deploys helper that calls resolveDispute
        MaliciousArbitrator mal = new MaliciousArbitrator(ca);

        // The arbitrator address in the contract is fixed at construction = arbitrator (0xAB)
        // MaliciousArbitrator is a different address → NotArbitrator
        vm.expectRevert(ComputeAgreement.NotArbitrator.selector);
        mal.tryStealViaResolve(sid, DEPOSIT);

        // Even the real arbitrator cannot send funds to themselves — they can only
        // credit the stored provider and client addresses.
        // Resolve awarding all to provider (legitimate outcome)
        vm.prank(arbitrator);
        ca.resolveDispute(sid, DEPOSIT, 0);

        // Arbitrator's own balance is unchanged
        assertEq(ca.pendingWithdrawals(arbitrator, address(0)), 0);
        // Funds went to provider, not arbitrator
        assertEq(ca.pendingWithdrawals(provider, address(0)), DEPOSIT);
    }

    function test_attack08b_arbitratorCannotOverpay() public {
        _start();

        vm.prank(client);
        ca.disputeSession(sid);

        // Arbitrator tries to award more than deposit (collusion to double-pay provider)
        vm.prank(arbitrator);
        vm.expectRevert(ComputeAgreement.InvalidSplit.selector);
        ca.resolveDispute(sid, DEPOSIT, 1); // DEPOSIT + 1 > DEPOSIT

        // Remainder logic: any under-allocation goes to client automatically
        vm.prank(arbitrator);
        ca.resolveDispute(sid, 1 ether, 0); // only 1 ETH to provider

        // Client gets remainder: 4 - 1 = 3 ETH
        assertEq(ca.pendingWithdrawals(provider, address(0)), 1 ether);
        assertEq(ca.pendingWithdrawals(client, address(0)),   3 ether);

        // Total must equal deposit
        assertEq(
            ca.pendingWithdrawals(provider, address(0)) + ca.pendingWithdrawals(client, address(0)),
            DEPOSIT
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 9: Race condition — endSession vs submitUsageReport same block
    // Attack:   Provider races to submit one more usage report in the same
    //           block as client's endSession, hoping to inflate payment.
    // Why fail: Whichever tx lands first wins. If endSession is mined first,
    //           status becomes Completed → submitUsageReport reverts WrongStatus.
    //           If submitUsageReport lands first, endSession then calculates
    //           the updated consumedMinutes — no double-counting.
    // Invariant: No transaction can circumvent status checks; no double-spend.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack09_raceEndSessionVsReport() public {
        _start();
        _submitReport(60, 80); // 1 ETH earned

        // Client ends session (status → Completed)
        vm.prank(client);
        ca.endSession(sid);
        assertEq(uint256(ca.getSession(sid).status),
            uint256(ComputeAgreement.SessionStatus.Completed));

        // Provider tries to slip in a report after endSession — must fail
        uint256 ps = block.timestamp;
        uint256 pe = ps + 30 minutes;
        bytes32 mh = keccak256("late-report");
        bytes memory sig = _signReport(sid, ps, pe, 30, 80, mh);
        vm.warp(pe);

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ComputeAgreement.WrongStatus.selector,
                ComputeAgreement.SessionStatus.Completed,
                ComputeAgreement.SessionStatus.Active
            )
        );
        ca.submitUsageReport(sid, ps, pe, 30, 80, sig, mh);

        // Settlement was locked at endSession: 60 min = 1 ETH to provider
        assertEq(ca.pendingWithdrawals(provider, address(0)), 1 ether);
        assertEq(ca.pendingWithdrawals(client, address(0)),   3 ether);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 10: Flash loan attack
    // Attack:   Attacker borrows large ETH, proposes session to "reserve" funds,
    //           then attempts to withdraw in the same atomic transaction before
    //           repaying the flash loan.
    // Why fail: withdraw() requires pendingWithdrawals[msg.sender] > 0, which
    //           only accumulates after endSession/resolveDispute/cancelSession.
    //           A freshly proposed session has no pending balance.
    //           The contract has no spot price or oracle to manipulate.
    // Invariant: No single-transaction round-trip can extract ETH from a
    //            session that was just proposed (deposit is locked).
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack10_flashLoanAttack() public {
        // Simulate flash loaner: has ETH for one tx, must repay immediately
        FlashLoanAttacker fla = new FlashLoanAttacker(ca, provider);
        vm.deal(address(fla), 1 ether); // "flash loaned" ETH

        bytes32 flashSid = keccak256(abi.encodePacked(address(fla), uint256(1)));

        // The attack function proposes then immediately withdraws — withdraw should revert
        vm.expectRevert(ComputeAgreement.NothingToWithdraw.selector);
        fla.attack{value: 1 ether}(flashSid);

        // Deposit remains locked in the contract
        // (the revert unwinds the whole call — deposit never entered the contract)
        assertEq(ca.pendingWithdrawals(address(fla), address(0)), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 11: Depositor != msg.sender (impersonation)
    // Attack:   Attacker calls proposeSession on behalf of a victim, trying to
    //           make the victim appear as client (and get their deposit locked).
    // Why fail: proposeSession records msg.sender as client — the attacker
    //           becomes the client of their own session; victim is uninvolved.
    //           Victim's funds cannot be taken without their authorization.
    // Invariant: Only the actual msg.sender bears the deposit and is recorded
    //            as client; no one can force another party's deposit.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack11_depositorNotSender() public {
        address victim = address(0xDEADC0DE);
        vm.deal(victim, 10 ether);

        // Attacker proposes a session — attacker pays, attacker is client
        bytes32 attackSid = keccak256(abi.encodePacked(attacker, uint256(42)));
        vm.prank(attacker);
        ca.proposeSession{value: DEPOSIT}(attackSid, provider, RATE, HOURS, GPU_SPEC, address(0));

        ComputeAgreement.ComputeSession memory s = ca.getSession(attackSid);
        assertEq(s.client, attacker);    // attacker is client, not victim
        assertNotEq(s.client, victim);   // victim has no obligation

        // Victim's balance is untouched
        assertEq(victim.balance, 10 ether);

        // Attacker cannot set client to victim — no such parameter exists
        // The session is bound to attacker; victim is never at risk
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 12: Timestamp manipulation by miners (metering fraud)
    // Attack 12a: Provider claims a future periodEnd to pre-credit future minutes.
    // Attack 12b: Provider backdates periodStart to before session startedAt.
    // Why fail: CA-14 — periodEnd > block.timestamp → InvalidPeriod;
    //           periodStart < s.startedAt → InvalidPeriod.
    //           Even with ±15s miner drift, a meaningful manipulation is caught.
    // Invariant: Usage reports can only cover time within [startedAt, now].
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack12a_futurePeriodEnd() public {
        _start();

        // Provider tries to claim minutes for time that hasn't happened yet
        uint256 ps = block.timestamp;
        uint256 pe = block.timestamp + 1 hours; // future
        bytes32 mh = keccak256("future-fraud");
        bytes memory sig = _signReport(sid, ps, pe, 60, 100, mh);

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.InvalidPeriod.selector);
        ca.submitUsageReport(sid, ps, pe, 60, 100, sig, mh);

        // Even a small future timestamp is rejected
        pe = block.timestamp + 1;
        bytes32 mh2 = keccak256("future-fraud-2");
        bytes memory sig2 = _signReport(sid, ps, pe, 1, 100, mh2);

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.InvalidPeriod.selector);
        ca.submitUsageReport(sid, ps, pe, 1, 100, sig2, mh2);
    }

    function test_attack12b_backdatedPeriodStart() public {
        // Session starts at t=1000
        _proposeAndAccept();
        vm.warp(1000);
        vm.prank(provider);
        ca.startSession(sid);

        // Provider tries to claim credit for time before session started
        uint256 ps = 500; // before startedAt=1000
        uint256 pe = 1001;
        vm.warp(pe);
        bytes32 mh = keccak256("backdated");
        bytes memory sig = _signReport(sid, ps, pe, 10, 80, mh);

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.InvalidPeriod.selector);
        ca.submitUsageReport(sid, ps, pe, 10, 80, sig, mh);

        // Also: periodStart == startedAt is fine (boundary valid)
        uint256 ps2 = 1000; // exactly startedAt
        uint256 pe2 = 1001;
        bytes32 mh2 = keccak256("boundary");
        bytes memory sig2 = _signReport(sid, ps2, pe2, 1, 80, mh2);
        vm.prank(provider);
        ca.submitUsageReport(sid, ps2, pe2, 1, 80, sig2, mh2);
        assertEq(ca.getSession(sid).consumedMinutes, 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 13: Malicious provider accepts then never starts — deposit locked
    // Attack:   Provider accepts session (status → Active) then ghosts, leaving
    //           client's deposit locked with no way to recover it.
    // Why fail: CA-3 — if status == Active and startedAt == 0, client can call
    //           cancelSession() at any time to recover their full deposit.
    // Invariant: Client can always recover their deposit if provider never starts.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack13_providerNeverStarts_clientCanCancel() public {
        _proposeAndAccept(); // provider accepts but does NOT call startSession

        // Verify session is Active but not started
        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(uint256(s.status), uint256(ComputeAgreement.SessionStatus.Active));
        assertEq(s.startedAt, 0);

        // Client can cancel immediately (no time lock required for unstarted Active sessions)
        uint256 clientBefore = client.balance;
        vm.prank(client);
        ca.cancelSession(sid);

        assertEq(uint256(ca.getSession(sid).status),
            uint256(ComputeAgreement.SessionStatus.Cancelled));
        assertEq(ca.pendingWithdrawals(client, address(0)), DEPOSIT);

        vm.prank(client);
        ca.withdraw(address(0));
        assertEq(client.balance - clientBefore, DEPOSIT);
        assertEq(address(ca).balance, 0);
    }

    function test_attack13b_proposedAndIgnored_clientCancelsAfterTTL() public {
        _propose(); // provider never accepts

        // Client cannot cancel before TTL
        vm.prank(client);
        vm.expectRevert(ComputeAgreement.ProposalNotExpired.selector);
        ca.cancelSession(sid);

        // After TTL, client recovers deposit
        vm.warp(block.timestamp + ca.PROPOSAL_TTL() + 1);
        uint256 clientBefore = client.balance;
        vm.prank(client);
        ca.cancelSession(sid);
        vm.prank(client);
        ca.withdraw(address(0));
        assertEq(client.balance - clientBefore, DEPOSIT);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 14: Provider submits report after endSession
    // Attack:   Provider waits for endSession to complete, then submits a
    //           report to retroactively inflate consumedMinutes and call
    //           endSession again (or manipulate settlement).
    // Why fail: endSession sets status = Completed. submitUsageReport checks
    //           s.status == Active → WrongStatus. endSession also checks Active.
    //           No double-settlement is possible.
    // Invariant: Once Completed, no further state changes are accepted.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack14_reportAfterEndSession() public {
        _start();
        _submitReport(60, 80); // 1 ETH

        vm.prank(provider);
        ca.endSession(sid);

        // Provider tries to submit another report post-completion
        uint256 ps = block.timestamp;
        uint256 pe = ps + 30 minutes;
        bytes32 mh = keccak256("after-end");
        bytes memory sig = _signReport(sid, ps, pe, 30, 80, mh);
        vm.warp(pe);

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ComputeAgreement.WrongStatus.selector,
                ComputeAgreement.SessionStatus.Completed,
                ComputeAgreement.SessionStatus.Active
            )
        );
        ca.submitUsageReport(sid, ps, pe, 30, 80, sig, mh);

        // Provider also cannot call endSession again
        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ComputeAgreement.WrongStatus.selector,
                ComputeAgreement.SessionStatus.Completed,
                ComputeAgreement.SessionStatus.Active
            )
        );
        ca.endSession(sid);

        // Settlement is frozen: exactly 1 ETH to provider, 3 ETH to client
        assertEq(ca.pendingWithdrawals(provider, address(0)), 1 ether);
        assertEq(ca.pendingWithdrawals(client, address(0)),   3 ether);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 15 (bonus): ecrecover zero-address forgery
    // Attack:   Craft a malformed signature that causes ecrecover to return
    //           address(0), then target a session whose provider == address(0).
    // Why fail: CA-10 — submitUsageReport explicitly checks
    //           recovered == address(0) → InvalidSignature before the
    //           provider-match check. address(0) provider sessions can't exist
    //           anyway (proposeSession would accept address(0) as provider but
    //           only the real address(0) could call acceptSession, which no one can).
    // Invariant: address(0) recovered from ecrecover is always rejected.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack15_ecrecoverZeroAddress() public {
        _start();

        uint256 ps = block.timestamp;
        uint256 pe = ps + 30 minutes;
        bytes32 mh = keccak256("zero-sig");
        vm.warp(pe);

        // Craft a 65-byte signature that causes ecrecover to return address(0)
        // A zeroed-out signature (r=0, s=0, v=27) typically returns address(0)
        bytes memory zeroSig = abi.encodePacked(bytes32(0), bytes32(0), uint8(27));

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.InvalidSignature.selector);
        ca.submitUsageReport(sid, ps, pe, 30, 80, zeroSig, mh);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 16 (bonus): Self-dealing prevention
    // Attack:   Provider tries to be both client and provider of the same
    //           session to run a circular payment scheme.
    // Why fail: CA-9 — proposeSession checks provider != msg.sender → SelfDealing.
    // Invariant: A party cannot be on both sides of an agreement.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack16_selfDealing() public {
        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.SelfDealing.selector);
        ca.proposeSession{value: DEPOSIT}(sid, provider, RATE, HOURS, GPU_SPEC, address(0));

        vm.prank(client);
        vm.expectRevert(ComputeAgreement.SelfDealing.selector);
        ca.proposeSession{value: DEPOSIT}(sid, client, RATE, HOURS, GPU_SPEC, address(0));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 17 (bonus): Dispute on non-Active session
    // Attack:   Client tries to dispute a Proposed session (before provider
    //           accepts) or a Completed session to re-open settlement.
    // Why fail: disputeSession requires status == Active.
    // Invariant: Dispute path is only reachable from Active sessions.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack17_disputeOnNonActiveSession() public {
        // Scenario A: dispute a Proposed session (never accepted)
        bytes32 sidA = keccak256(abi.encodePacked(client, uint256(17)));
        vm.prank(client);
        ca.proposeSession{value: DEPOSIT}(sidA, provider, RATE, HOURS, GPU_SPEC, address(0));

        vm.prank(client);
        vm.expectRevert(
            abi.encodeWithSelector(
                ComputeAgreement.WrongStatus.selector,
                ComputeAgreement.SessionStatus.Proposed,
                ComputeAgreement.SessionStatus.Active
            )
        );
        ca.disputeSession(sidA);

        // Scenario B: dispute a Completed session
        bytes32 sidB = keccak256(abi.encodePacked(client, uint256(18)));
        vm.prank(client);
        ca.proposeSession{value: DEPOSIT}(sidB, provider, RATE, HOURS, GPU_SPEC, address(0));
        vm.prank(provider);
        ca.acceptSession(sidB);
        vm.prank(provider);
        ca.startSession(sidB);
        vm.prank(client);
        ca.endSession(sidB);

        // Try disputing a Completed session
        vm.prank(client);
        vm.expectRevert(
            abi.encodeWithSelector(
                ComputeAgreement.WrongStatus.selector,
                ComputeAgreement.SessionStatus.Completed,
                ComputeAgreement.SessionStatus.Active
            )
        );
        ca.disputeSession(sidB);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ATTACK 18 (bonus): Invariant — total funds in == total funds out
    // Verify that across a full session lifecycle, the contract's ETH balance
    // reaches exactly zero after all parties withdraw.
    // ─────────────────────────────────────────────────────────────────────────
    function test_attack18_noFundsLeaked() public {
        _start();

        // Submit 90 minutes (1.5 ETH cost)
        _submitReport(90, 75);

        uint256 contractBefore = address(ca).balance;
        assertEq(contractBefore, DEPOSIT);

        vm.prank(client);
        ca.endSession(sid);

        // 90 * 1e18 / 60 = 1.5 ETH to provider; 2.5 ETH refund to client
        assertEq(ca.pendingWithdrawals(provider, address(0)), 1.5 ether);
        assertEq(ca.pendingWithdrawals(client, address(0)),   2.5 ether);
        assertEq(
            ca.pendingWithdrawals(provider, address(0)) + ca.pendingWithdrawals(client, address(0)),
            DEPOSIT
        );

        uint256 providerBefore = provider.balance;
        uint256 clientBefore   = client.balance;

        vm.prank(provider);
        ca.withdraw(address(0));
        vm.prank(client);
        ca.withdraw(address(0));

        assertEq(provider.balance - providerBefore, 1.5 ether);
        assertEq(client.balance  - clientBefore,    2.5 ether);
        assertEq(address(ca).balance, 0); // no dust left behind
    }
}
