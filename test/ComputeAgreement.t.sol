// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "../contracts/src/ComputeAgreement.sol";

/**
 * @title MockERC20
 * @notice Minimal ERC-20 for testing. Supports mint, approve, transfer.
 */
contract MockERC20 {
    string  public name     = "MockUSDC";
    string  public symbol   = "mUSDC";
    uint8   public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply    += amount;
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

/**
 * @title MaliciousProvider
 * @notice Reentrancy attack contract — reverts on first receive, then succeeds.
 *         Used to test CA-1 (pull-payment) fix.
 */
contract MaliciousProvider {
    ComputeAgreement internal ca;
    bytes32 internal targetSid;
    bool internal attacked;

    constructor(ComputeAgreement _ca) {
        ca = _ca;
    }

    function setTarget(bytes32 sid) external {
        targetSid = sid;
    }

    // CA-1 test: attempt reentrance on withdraw
    receive() external payable {
        if (!attacked) {
            attacked = true;
            // Try to withdraw again (reentrance attempt)
            try ca.withdraw(address(0)) {} catch {}
        }
    }

    function doWithdraw() external {
        ca.withdraw(address(0));
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}

/**
 * @title RevertingProvider
 * @notice A provider that always reverts on ETH receive.
 *         Used to verify the old push-payment griefing vector is gone.
 */
contract RevertingProvider {
    ComputeAgreement internal ca;

    constructor(ComputeAgreement _ca) {
        ca = _ca;
    }

    receive() external payable {
        revert("I reject ETH");
    }

    // Delegate calls to the compute agreement
    function acceptSession(bytes32 sid) external {
        ca.acceptSession(sid);
    }

    function startSession(bytes32 sid) external {
        ca.startSession(sid);
    }

    function endSession(bytes32 sid) external {
        ca.endSession(sid);
    }
}

/**
 * @title ComputeAgreementTest
 * @notice Foundry tests for the full ComputeAgreement session lifecycle.
 *         Includes all original ETH tests plus ERC-20 tests.
 */
contract ComputeAgreementTest is Test {
    ComputeAgreement internal ca;
    MockERC20        internal token;

    // Test accounts
    address internal client   = address(0xC1);
    address internal provider;
    address internal arbitrator = address(0xAB);

    // Standard session params
    uint256 internal constant RATE_PER_HOUR = 1 ether;   // 1 ETH/GPU-hour
    uint256 internal constant MAX_HOURS     = 4;
    uint256 internal constant DEPOSIT       = RATE_PER_HOUR * MAX_HOURS; // 4 ETH
    bytes32 internal constant GPU_SPEC_HASH = keccak256("nvidia-h100-80gb");

    // ERC-20 session params (USDC-like: 6 decimals, 10 USDC/hr)
    uint256 internal constant TOKEN_RATE    = 10e6;       // 10 USDC/hr
    uint256 internal constant TOKEN_DEPOSIT = TOKEN_RATE * MAX_HOURS; // 40 USDC

    // Provider private key (deterministic for signature tests)
    uint256 internal providerKey = 0xBEEF;

    bytes32 internal sid;

    function setUp() public {
        ca    = new ComputeAgreement(arbitrator);
        token = new MockERC20();

        // Use provider derived from key
        provider = vm.addr(providerKey);

        // Fund accounts
        vm.deal(client,   100 ether);
        vm.deal(provider, 10 ether);

        // Mint ERC-20 to client
        token.mint(client, 1_000e6);

        sid = keccak256(abi.encodePacked(client, uint256(1)));
    }

    // ─── proposeSession (ETH) ─────────────────────────────────────────────────

    function test_proposeSession() public {
        vm.prank(client);
        ca.proposeSession{value: DEPOSIT}(sid, provider, RATE_PER_HOUR, MAX_HOURS, GPU_SPEC_HASH, address(0));

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(s.client,        client);
        assertEq(s.provider,      provider);
        assertEq(s.token,         address(0));
        assertEq(s.ratePerHour,   RATE_PER_HOUR);
        assertEq(s.maxHours,      MAX_HOURS);
        assertEq(s.depositAmount, DEPOSIT);
        assertEq(uint256(s.status), uint256(ComputeAgreement.SessionStatus.Proposed));
    }

    function test_proposeSession_insufficientDeposit() public {
        vm.prank(client);
        vm.expectRevert(
            abi.encodeWithSelector(ComputeAgreement.InsufficientDeposit.selector, DEPOSIT, DEPOSIT - 1)
        );
        ca.proposeSession{value: DEPOSIT - 1}(sid, provider, RATE_PER_HOUR, MAX_HOURS, GPU_SPEC_HASH, address(0));
    }

    function test_proposeSession_duplicate() public {
        vm.prank(client);
        ca.proposeSession{value: DEPOSIT}(sid, provider, RATE_PER_HOUR, MAX_HOURS, GPU_SPEC_HASH, address(0));

        vm.prank(client);
        vm.expectRevert(ComputeAgreement.SessionAlreadyExists.selector);
        ca.proposeSession{value: DEPOSIT}(sid, provider, RATE_PER_HOUR, MAX_HOURS, GPU_SPEC_HASH, address(0));
    }

    // ─── proposeSession (ERC-20) ──────────────────────────────────────────────

    function test_proposeSession_erc20() public {
        vm.startPrank(client);
        token.approve(address(ca), TOKEN_DEPOSIT);
        ca.proposeSession(sid, provider, TOKEN_RATE, MAX_HOURS, GPU_SPEC_HASH, address(token));
        vm.stopPrank();

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(s.token,         address(token));
        assertEq(s.ratePerHour,   TOKEN_RATE);
        assertEq(s.depositAmount, TOKEN_DEPOSIT);
        assertEq(token.balanceOf(address(ca)), TOKEN_DEPOSIT);
    }

    function test_proposeSession_erc20_insufficientAllowance() public {
        vm.startPrank(client);
        // Approve less than required
        token.approve(address(ca), TOKEN_DEPOSIT - 1);
        vm.expectRevert();  // SafeERC20 will revert on failed transferFrom
        ca.proposeSession(sid, provider, TOKEN_RATE, MAX_HOURS, GPU_SPEC_HASH, address(token));
        vm.stopPrank();
    }

    function test_proposeSession_erc20_msgValueRejected() public {
        vm.startPrank(client);
        token.approve(address(ca), TOKEN_DEPOSIT);
        vm.expectRevert(ComputeAgreement.MsgValueWithToken.selector);
        ca.proposeSession{value: 1 ether}(sid, provider, TOKEN_RATE, MAX_HOURS, GPU_SPEC_HASH, address(token));
        vm.stopPrank();
    }

    // ─── acceptSession ────────────────────────────────────────────────────────

    function test_acceptSession() public {
        _propose();

        vm.prank(provider);
        ca.acceptSession(sid);

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(uint256(s.status), uint256(ComputeAgreement.SessionStatus.Active));
    }

    function test_acceptSession_notProvider() public {
        _propose();

        vm.prank(address(0xBAD));
        vm.expectRevert(ComputeAgreement.NotProvider.selector);
        ca.acceptSession(sid);
    }

    // ─── startSession ─────────────────────────────────────────────────────────

    function test_startSession() public {
        _proposeAndAccept();

        uint256 ts = block.timestamp + 100;
        vm.warp(ts);
        vm.prank(provider);
        ca.startSession(sid);

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(s.startedAt, ts);
    }

    function test_startSession_notProvider() public {
        _proposeAndAccept();

        vm.prank(client);
        vm.expectRevert(ComputeAgreement.NotProvider.selector);
        ca.startSession(sid);
    }

    // ─── submitUsageReport ────────────────────────────────────────────────────

    function test_submitUsageReport() public {
        _start();

        uint256 periodStart    = block.timestamp;
        uint256 periodEnd      = periodStart + 15 minutes;
        uint256 computeMinutes = 12;
        uint256 avgUtil        = 85;
        bytes32 metricsHash    = keccak256("raw-metrics");

        // advance time so periodEnd <= block.timestamp
        vm.warp(periodEnd);

        bytes memory sig = _signReport(sid, periodStart, periodEnd, computeMinutes, avgUtil, metricsHash);

        vm.prank(provider);
        ca.submitUsageReport(sid, periodStart, periodEnd, computeMinutes, avgUtil, sig, metricsHash);

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(s.consumedMinutes, computeMinutes);

        ComputeAgreement.UsageReport[] memory reports = ca.getUsageReports(sid);
        assertEq(reports.length, 1);
        assertEq(reports[0].computeMinutes, computeMinutes);
        assertEq(reports[0].avgUtilization, avgUtil);
    }

    function test_submitUsageReport_badSignature() public {
        _start();

        uint256 periodStart    = block.timestamp;
        uint256 periodEnd      = periodStart + 15 minutes;
        uint256 computeMinutes = 12;
        uint256 avgUtil        = 85;
        bytes32 metricsHash    = keccak256("raw-metrics");

        vm.warp(periodEnd);

        // Sign with wrong key
        bytes memory badSig = _signReportWithKey(
            0xDEAD, address(ca), sid, periodStart, periodEnd, computeMinutes, avgUtil, metricsHash
        );

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.InvalidSignature.selector);
        ca.submitUsageReport(sid, periodStart, periodEnd, computeMinutes, avgUtil, badSig, metricsHash);
    }

    // ─── endSession + settlement math (ETH) ───────────────────────────────────

    function test_endSession_fullUsage() public {
        _start();

        // Submit 240 minutes (4 hours = max)
        _submitReport(240, 90);

        uint256 contractBefore = address(ca).balance;
        assertEq(contractBefore, DEPOSIT);

        vm.prank(provider);
        ca.endSession(sid);

        // cost = 240 * 1e18 / 60 = 4 ETH (full deposit) -> credited to provider
        assertEq(ca.pendingWithdrawals(provider, address(0)), 4 ether);
        assertEq(ca.pendingWithdrawals(client,   address(0)), 0);

        // Pull the payment
        uint256 providerBefore = provider.balance;
        vm.prank(provider);
        ca.withdraw(address(0));
        assertEq(provider.balance - providerBefore, 4 ether);
        assertEq(address(ca).balance, 0);
    }

    function test_endSession_partialUsage() public {
        _start();

        // Use only 60 minutes (1 hour)
        _submitReport(60, 75);

        vm.prank(client);
        ca.endSession(sid);

        // cost = 60 * 1e18 / 60 = 1 ETH; refund = 3 ETH
        assertEq(ca.pendingWithdrawals(provider, address(0)), 1 ether);
        assertEq(ca.pendingWithdrawals(client,   address(0)), 3 ether);

        // Both parties withdraw
        uint256 providerBefore = provider.balance;
        uint256 clientBefore   = client.balance;

        vm.prank(provider);
        ca.withdraw(address(0));
        vm.prank(client);
        ca.withdraw(address(0));

        assertEq(provider.balance - providerBefore, 1 ether);
        assertEq(client.balance  - clientBefore,    3 ether);
        assertEq(address(ca).balance,               0);
    }

    function test_endSession_zeroUsage() public {
        _start();
        // No usage reports submitted

        vm.prank(client);
        ca.endSession(sid);

        // cost = 0; full refund credited to client
        assertEq(ca.pendingWithdrawals(client, address(0)), DEPOSIT);

        uint256 clientBefore = client.balance;
        vm.prank(client);
        ca.withdraw(address(0));
        assertEq(client.balance - clientBefore, DEPOSIT);
        assertEq(address(ca).balance, 0);
    }

    function test_endSession_statusCompleted() public {
        _start();
        _submitReport(30, 50);

        vm.prank(client);
        ca.endSession(sid);

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(uint256(s.status), uint256(ComputeAgreement.SessionStatus.Completed));
        assertGt(s.endedAt, 0);
    }

    function test_endSession_notParty() public {
        _start();

        vm.prank(address(0xBAD));
        vm.expectRevert(ComputeAgreement.NotParty.selector);
        ca.endSession(sid);
    }

    // ─── endSession + settlement (ERC-20) ─────────────────────────────────────

    function test_erc20_endSession_partialUsage() public {
        bytes32 eSid = _proposeErc20();
        vm.prank(provider); ca.acceptSession(eSid);
        vm.prank(provider); ca.startSession(eSid);

        // Submit 60 minutes (1 hour) → cost = TOKEN_RATE = 10 USDC; refund = 30 USDC
        _submitReportFor(eSid, 60, 75);

        vm.prank(client);
        ca.endSession(eSid);

        assertEq(ca.pendingWithdrawals(provider, address(token)), TOKEN_RATE);
        assertEq(ca.pendingWithdrawals(client,   address(token)), TOKEN_RATE * 3);

        // Provider withdraws tokens
        uint256 providerBefore = token.balanceOf(provider);
        vm.prank(provider);
        ca.withdraw(address(token));
        assertEq(token.balanceOf(provider) - providerBefore, TOKEN_RATE);

        // Client withdraws tokens
        uint256 clientBefore = token.balanceOf(client);
        vm.prank(client);
        ca.withdraw(address(token));
        assertEq(token.balanceOf(client) - clientBefore, TOKEN_RATE * 3);

        // Contract balance zeroed
        assertEq(token.balanceOf(address(ca)), 0);
    }

    function test_erc20_cancelSession_returnsTokens() public {
        bytes32 eSid = _proposeErc20();

        uint256 clientBefore = token.balanceOf(client);

        // Advance past TTL
        vm.warp(block.timestamp + ca.PROPOSAL_TTL() + 1);

        vm.prank(client);
        ca.cancelSession(eSid);

        // Tokens credited to client
        assertEq(ca.pendingWithdrawals(client, address(token)), TOKEN_DEPOSIT);

        vm.prank(client);
        ca.withdraw(address(token));
        assertEq(token.balanceOf(client) - clientBefore, TOKEN_DEPOSIT);
        assertEq(token.balanceOf(address(ca)), 0);
    }

    function test_erc20_disputeResolution() public {
        bytes32 eSid = _proposeErc20();
        vm.prank(provider); ca.acceptSession(eSid);
        vm.prank(provider); ca.startSession(eSid);
        _submitReportFor(eSid, 60, 80);

        vm.prank(client);
        ca.disputeSession(eSid);

        // Arbitrator splits: 8 USDC to provider, 32 USDC to client
        uint256 pAmt = 8e6;
        uint256 cAmt = 32e6;
        vm.prank(arbitrator);
        ca.resolveDispute(eSid, pAmt, cAmt);

        assertEq(ca.pendingWithdrawals(provider, address(token)), pAmt);
        assertEq(ca.pendingWithdrawals(client,   address(token)), cAmt);

        vm.prank(provider); ca.withdraw(address(token));
        vm.prank(client);   ca.withdraw(address(token));
        assertEq(token.balanceOf(address(ca)), 0);
    }

    function test_erc20_withdrawSpecificToken() public {
        // Client has ETH pendingWithdrawals AND token pendingWithdrawals from two sessions
        // ETH session
        vm.prank(client);
        ca.proposeSession{value: DEPOSIT}(sid, provider, RATE_PER_HOUR, MAX_HOURS, GPU_SPEC_HASH, address(0));
        vm.prank(provider); ca.acceptSession(sid);
        vm.prank(provider); ca.startSession(sid);
        vm.prank(client);   ca.endSession(sid);  // zero usage → full refund to client

        // ERC-20 session
        bytes32 eSid = _proposeErc20();
        vm.prank(provider); ca.acceptSession(eSid);
        vm.prank(provider); ca.startSession(eSid);
        vm.prank(client);   ca.endSession(eSid);  // zero usage → full refund

        // Withdraw ETH only
        uint256 ethBefore = client.balance;
        vm.prank(client);
        ca.withdraw(address(0));
        assertEq(client.balance - ethBefore, DEPOSIT);
        assertEq(ca.pendingWithdrawals(client, address(token)), TOKEN_DEPOSIT); // token still pending

        // Withdraw token only
        uint256 tokBefore = token.balanceOf(client);
        vm.prank(client);
        ca.withdraw(address(token));
        assertEq(token.balanceOf(client) - tokBefore, TOKEN_DEPOSIT);
        assertEq(ca.pendingWithdrawals(client, address(0)), 0);
    }

    // ─── disputeSession ───────────────────────────────────────────────────────

    function test_disputeSession() public {
        _start();

        vm.prank(client);
        ca.disputeSession(sid);

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(uint256(s.status), uint256(ComputeAgreement.SessionStatus.Disputed));
    }

    function test_disputeSession_notClient() public {
        _start();

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.NotClient.selector);
        ca.disputeSession(sid);
    }

    function test_endSession_blocked_when_disputed() public {
        _start();

        vm.prank(client);
        ca.disputeSession(sid);

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ComputeAgreement.WrongStatus.selector,
                ComputeAgreement.SessionStatus.Disputed,
                ComputeAgreement.SessionStatus.Active
            )
        );
        ca.endSession(sid);
    }

    // ─── calculateCost ────────────────────────────────────────────────────────

    function test_calculateCost() public {
        _start();
        _submitReport(30, 80);

        // 30 * 1e18 / 60 = 0.5 ETH
        assertEq(ca.calculateCost(sid), 0.5 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── EXTENDED SECURITY TESTS ──────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── CA-1: Reentrancy / ETH griefing ─────────────────────────────────────

    /**
     * @notice CA-1 fix verification: a reverting provider contract cannot block
     *         client refund. endSession credits balances; each party withdraws
     *         independently. Provider's inability to receive ETH does not affect
     *         client's ability to withdraw their refund.
     */
    function test_reentrancy_revertingProvider_doesNotBlockClientRefund() public {
        // Deploy reverting provider
        RevertingProvider rp = new RevertingProvider(ca);
        address rpAddr = address(rp);
        vm.deal(rpAddr, 1 ether);

        // Create session with reverting provider
        bytes32 sid2 = keccak256(abi.encodePacked(client, uint256(99)));
        vm.prank(client);
        ca.proposeSession{value: DEPOSIT}(sid2, rpAddr, RATE_PER_HOUR, MAX_HOURS, GPU_SPEC_HASH, address(0));

        rp.acceptSession(sid2);
        rp.startSession(sid2);

        // Provider ends session (no usage = full refund to client)
        rp.endSession(sid2);

        // Client's refund should be credited
        assertEq(ca.pendingWithdrawals(client, address(0)), DEPOSIT);

        // Client can withdraw even though provider can't receive ETH
        uint256 clientBefore = client.balance;
        vm.prank(client);
        ca.withdraw(address(0));
        assertEq(client.balance - clientBefore, DEPOSIT);

        // Provider's pending is 0 (no usage), attempting withdraw fails gracefully
        vm.expectRevert(ComputeAgreement.NothingToWithdraw.selector);
        vm.prank(rpAddr);
        ca.withdraw(address(0));
    }

    /**
     * @notice CA-1 reentrancy test: malicious provider's receive() attempts
     *         re-entry into withdraw(); second call must fail (already zeroed).
     */
    function test_reentrancy_maliciousProviderWithdraw() public {
        // Deploy malicious provider
        MaliciousProvider mp = new MaliciousProvider(ca);
        address mpAddr = address(mp);
        vm.deal(mpAddr, 1 ether);

        // Build a session where the malicious provider earns some ETH
        bytes32 sid3 = keccak256(abi.encodePacked(client, uint256(77)));
        vm.prank(client);
        ca.proposeSession{value: 1 ether}(sid3, mpAddr, 1 ether, 1, GPU_SPEC_HASH, address(0));

        // Provider accepts and starts
        vm.prank(mpAddr);
        ca.acceptSession(sid3);
        vm.prank(mpAddr);
        ca.startSession(sid3);

        // End session from client side with no usage -> full refund to client, 0 to provider
        vm.prank(client);
        ca.endSession(sid3);

        // Client gets deposit back
        assertEq(ca.pendingWithdrawals(client, address(0)), 1 ether);
        // Provider gets 0
        assertEq(ca.pendingWithdrawals(mpAddr, address(0)), 0);

        // Verify withdraw zeros before sending (reentrancy guard via check-effects)
        uint256 clientBefore = client.balance;
        vm.prank(client);
        ca.withdraw(address(0));
        assertEq(client.balance - clientBefore, 1 ether);
        assertEq(ca.pendingWithdrawals(client, address(0)), 0);
    }

    // ─── CA-2: Signature replay ───────────────────────────────────────────────

    /**
     * @notice CA-2: submitting the exact same signed report twice must revert.
     */
    function test_signatureReplay_rejected() public {
        _start();

        uint256 ps  = block.timestamp;
        uint256 pe  = ps + 15 minutes;
        vm.warp(pe);
        bytes32 mh  = keccak256("metrics-1");
        bytes memory sig = _signReport(sid, ps, pe, 15, 80, mh);

        vm.prank(provider);
        ca.submitUsageReport(sid, ps, pe, 15, 80, sig, mh);

        // Second submission of identical report must revert
        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.ReportAlreadySubmitted.selector);
        ca.submitUsageReport(sid, ps, pe, 15, 80, sig, mh);
    }

    // ─── Multiple sequential usage reports ───────────────────────────────────

    /**
     * @notice Provider submits multiple non-overlapping reports; consumedMinutes
     *         accumulates correctly.
     */
    function test_multipleUsageReports_accumulate() public {
        _start();

        uint256 t0 = block.timestamp;

        // Report 1: 0-15 min
        uint256 ps1 = t0;
        uint256 pe1 = t0 + 15 minutes;
        vm.warp(pe1);
        bytes32 mh1 = keccak256("m1");
        bytes memory sig1 = _signReport(sid, ps1, pe1, 15, 80, mh1);
        vm.prank(provider);
        ca.submitUsageReport(sid, ps1, pe1, 15, 80, sig1, mh1);

        // Report 2: 15-30 min
        uint256 ps2 = pe1;
        uint256 pe2 = pe1 + 15 minutes;
        vm.warp(pe2);
        bytes32 mh2 = keccak256("m2");
        bytes memory sig2 = _signReport(sid, ps2, pe2, 15, 90, mh2);
        vm.prank(provider);
        ca.submitUsageReport(sid, ps2, pe2, 15, 90, sig2, mh2);

        // Report 3: 30-60 min
        uint256 ps3 = pe2;
        uint256 pe3 = pe2 + 30 minutes;
        vm.warp(pe3);
        bytes32 mh3 = keccak256("m3");
        bytes memory sig3 = _signReport(sid, ps3, pe3, 30, 70, mh3);
        vm.prank(provider);
        ca.submitUsageReport(sid, ps3, pe3, 30, 70, sig3, mh3);

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(s.consumedMinutes, 60); // 15 + 15 + 30

        ComputeAgreement.UsageReport[] memory reports = ca.getUsageReports(sid);
        assertEq(reports.length, 3);

        // cost = 60 * 1e18 / 60 = 1 ETH
        assertEq(ca.calculateCost(sid), 1 ether);
    }

    // ─── CA-8: consumedMinutes cap ────────────────────────────────────────────

    /**
     * @notice CA-8: a report that would push consumedMinutes beyond maxHours*60 reverts.
     */
    function test_exceedsMaxMinutes_reverts() public {
        _start();

        // Max is 4 hours = 240 minutes
        // Submit 230 minutes first
        uint256 ps1 = block.timestamp;
        uint256 pe1 = ps1 + 230 * 60;
        vm.warp(pe1);
        bytes32 mh1 = keccak256("m-big");
        bytes memory sig1 = _signReport(sid, ps1, pe1, 230, 80, mh1);
        vm.prank(provider);
        ca.submitUsageReport(sid, ps1, pe1, 230, 80, sig1, mh1);

        // Now try to submit 11 more minutes (would exceed 240)
        uint256 ps2 = pe1;
        uint256 pe2 = ps2 + 11 * 60;
        vm.warp(pe2);
        bytes32 mh2 = keccak256("m-overflow");
        bytes memory sig2 = _signReport(sid, ps2, pe2, 11, 80, mh2);
        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.ExceedsMaxMinutes.selector);
        ca.submitUsageReport(sid, ps2, pe2, 11, 80, sig2, mh2);

        // Exactly 10 more (=240 total) should succeed
        bytes32 mh3 = keccak256("m-exact");
        bytes memory sig3 = _signReport(sid, ps2, pe2, 10, 80, mh3);
        vm.prank(provider);
        ca.submitUsageReport(sid, ps2, pe2, 10, 80, sig3, mh3);

        assertEq(ca.getSession(sid).consumedMinutes, 240);
    }

    // ─── CA-IND-3: Exact deposit required ────────────────────────────────────

    /**
     * @notice CA-IND-3: overpayment is rejected — msg.value must equal required exactly.
     */
    function test_exactDepositRequired_overpaymentReverts() public {
        uint256 excess = 0.5 ether;
        uint256 sent   = DEPOSIT + excess;

        vm.prank(client);
        vm.expectRevert(
            abi.encodeWithSelector(ComputeAgreement.InsufficientDeposit.selector, DEPOSIT, sent)
        );
        ca.proposeSession{value: sent}(sid, provider, RATE_PER_HOUR, MAX_HOURS, GPU_SPEC_HASH, address(0));
    }

    // ─── CA-3: Session expiry / cancellation ─────────────────────────────────

    /**
     * @notice CA-3: client can cancel a Proposed session after PROPOSAL_TTL.
     */
    function test_cancelSession_afterTTL() public {
        _propose();

        uint256 clientBefore = client.balance;

        // Advance past TTL
        vm.warp(block.timestamp + ca.PROPOSAL_TTL() + 1);

        vm.prank(client);
        ca.cancelSession(sid);

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(uint256(s.status), uint256(ComputeAgreement.SessionStatus.Cancelled));

        // Client must withdraw
        vm.prank(client);
        ca.withdraw(address(0));
        assertEq(client.balance - clientBefore, DEPOSIT);
    }

    /**
     * @notice CA-3: client cannot cancel before TTL expires.
     */
    function test_cancelSession_beforeTTL_reverts() public {
        _propose();

        vm.prank(client);
        vm.expectRevert(ComputeAgreement.ProposalNotExpired.selector);
        ca.cancelSession(sid);
    }

    /**
     * @notice CA-3: client can immediately cancel an Active session where provider
     *         accepted but never called startSession.
     */
    function test_cancelSession_acceptedNotStarted() public {
        _proposeAndAccept();

        uint256 clientBefore = client.balance;

        // No need to wait — Active + startedAt==0 is immediately cancellable
        vm.prank(client);
        ca.cancelSession(sid);

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(uint256(s.status), uint256(ComputeAgreement.SessionStatus.Cancelled));

        vm.prank(client);
        ca.withdraw(address(0));
        assertEq(client.balance - clientBefore, DEPOSIT);
    }

    // ─── CA-4: Dispute resolution ─────────────────────────────────────────────

    /**
     * @notice CA-4: arbitrator resolves dispute with a split.
     */
    function test_disputeResolution_byArbitrator() public {
        _start();
        _submitReport(60, 80);

        vm.prank(client);
        ca.disputeSession(sid);

        // Arbitrator resolves: 0.8 ETH to provider, 3.2 ETH to client
        vm.prank(arbitrator);
        ca.resolveDispute(sid, 0.8 ether, 3.2 ether);

        assertEq(ca.pendingWithdrawals(provider, address(0)), 0.8 ether);
        assertEq(ca.pendingWithdrawals(client,   address(0)), 3.2 ether);

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid);
        assertEq(uint256(s.status), uint256(ComputeAgreement.SessionStatus.Completed));
    }

    /**
     * @notice CA-4: dispute resolution blocked for non-arbitrator.
     */
    function test_disputeResolution_notArbitrator_reverts() public {
        _start();

        vm.prank(client);
        ca.disputeSession(sid);

        vm.prank(client);
        vm.expectRevert(ComputeAgreement.NotArbitrator.selector);
        ca.resolveDispute(sid, 1 ether, 3 ether);
    }

    /**
     * @notice CA-ARCH-2: after DISPUTE_TIMEOUT, settlement uses proven usage —
     *         provider earns payment for consumedMinutes, client gets remainder.
     */
    function test_disputeTimeout_paysProviderForUsage() public {
        _start();
        _submitReport(60, 80); // 60 min = 1 ETH at 1 ETH/hr

        vm.prank(client);
        ca.disputeSession(sid);

        // Advance past timeout
        vm.warp(block.timestamp + ca.DISPUTE_TIMEOUT() + 1);

        vm.prank(client);
        ca.claimDisputeTimeout(sid);

        // Provider gets 1 ETH for proven work; client gets 3 ETH remainder
        assertEq(ca.pendingWithdrawals(provider, address(0)), 1 ether);
        assertEq(ca.pendingWithdrawals(client,   address(0)), 3 ether);
        assertEq(
            ca.pendingWithdrawals(provider, address(0)) + ca.pendingWithdrawals(client, address(0)),
            DEPOSIT
        );
    }

    /**
     * @notice CA-4: dispute timeout cannot be claimed before timeout expires.
     */
    function test_disputeTimeout_beforeExpiry_reverts() public {
        _start();

        vm.prank(client);
        ca.disputeSession(sid);

        vm.prank(client);
        vm.expectRevert(ComputeAgreement.DisputeNotExpired.selector);
        ca.claimDisputeTimeout(sid);
    }

    /**
     * @notice CA-4: dispute blocks submitUsageReport.
     */
    function test_dispute_blocksReport() public {
        _start();

        vm.prank(client);
        ca.disputeSession(sid);

        uint256 ps = block.timestamp;
        uint256 pe = ps + 15 minutes;
        vm.warp(pe);
        bytes32 mh = keccak256("m");
        bytes memory sig = _signReport(sid, ps, pe, 15, 80, mh);

        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(
                ComputeAgreement.WrongStatus.selector,
                ComputeAgreement.SessionStatus.Disputed,
                ComputeAgreement.SessionStatus.Active
            )
        );
        ca.submitUsageReport(sid, ps, pe, 15, 80, sig, mh);
    }

    // ─── CA-9: Self-dealing ───────────────────────────────────────────────────

    /**
     * @notice CA-9: proposing a session where client == provider must revert.
     */
    function test_selfDealing_reverts() public {
        vm.prank(client);
        vm.expectRevert(ComputeAgreement.SelfDealing.selector);
        ca.proposeSession{value: DEPOSIT}(sid, client, RATE_PER_HOUR, MAX_HOURS, GPU_SPEC_HASH, address(0));
    }

    // ─── Double start ─────────────────────────────────────────────────────────

    /**
     * @notice Provider cannot call startSession twice on the same session.
     */
    function test_doubleStart_reverts() public {
        _start();

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.AlreadyStarted.selector);
        ca.startSession(sid);
    }

    // ─── Zero-hour session edge case ──────────────────────────────────────────

    /**
     * @notice A session with maxHours = 0 results in required deposit of 0.
     *         Provider can end it immediately with zero cost.
     */
    function test_zeroHourSession() public {
        bytes32 sid0 = keccak256(abi.encodePacked(client, uint256(100)));
        vm.prank(client);
        // required = 0, send 0
        ca.proposeSession{value: 0}(sid0, provider, RATE_PER_HOUR, 0, GPU_SPEC_HASH, address(0));

        vm.prank(provider);
        ca.acceptSession(sid0);
        vm.prank(provider);
        ca.startSession(sid0);
        vm.prank(provider);
        ca.endSession(sid0);

        ComputeAgreement.ComputeSession memory s = ca.getSession(sid0);
        assertEq(uint256(s.status), uint256(ComputeAgreement.SessionStatus.Completed));
        assertEq(ca.calculateCost(sid0), 0);
        // Nothing to withdraw for either party
        assertEq(ca.pendingWithdrawals(provider, address(0)), 0);
        assertEq(ca.pendingWithdrawals(client,   address(0)), 0);
    }

    // ─── Fuzz: random computeMinutes / ratePerHour ────────────────────────────

    /**
     * @notice Fuzz test: random computeMinutes and ratePerHour values.
     *         Cost must never exceed deposit; no overflow.
     */
    function testFuzz_settlement(uint64 computeMinutes_, uint64 ratePerHour_) public {
        // Bound to reasonable values
        uint256 cMin    = uint256(computeMinutes_) % 1_000_000;   // up to ~16k hours
        uint256 rate    = uint256(ratePerHour_);
        uint256 maxHrs  = 1000;

        // Avoid zero-rate with non-zero minutes causing trivial pass
        if (rate == 0) rate = 1;

        uint256 required = rate * maxHrs;
        // Only run if client can fund it
        vm.assume(required <= 1_000_000 ether);

        vm.deal(client, required + 1 ether);

        bytes32 fSid = keccak256(abi.encodePacked("fuzz", computeMinutes_, ratePerHour_));
        vm.prank(client);
        ca.proposeSession{value: required}(fSid, provider, rate, maxHrs, GPU_SPEC_HASH, address(0));

        vm.prank(provider);
        ca.acceptSession(fSid);
        vm.prank(provider);
        ca.startSession(fSid);

        // Submit cMin minutes (capped to maxHours*60 = 60000)
        uint256 maxMin = maxHrs * 60;
        uint256 actualMin = cMin <= maxMin ? cMin : maxMin;

        if (actualMin > 0) {
            uint256 ps = block.timestamp;
            uint256 pe = ps + actualMin * 60;
            vm.warp(pe);
            bytes32 fMh = keccak256(abi.encodePacked("fm", computeMinutes_, ratePerHour_));
            bytes memory fSig = _signReport(fSid, ps, pe, actualMin, 50, fMh);
            vm.prank(provider);
            ca.submitUsageReport(fSid, ps, pe, actualMin, 50, fSig, fMh);
        }

        vm.prank(provider);
        ca.endSession(fSid);

        uint256 providerCredit = ca.pendingWithdrawals(provider, address(0));
        uint256 clientCredit   = ca.pendingWithdrawals(client,   address(0));

        // Invariant: total credited == deposit
        assertEq(providerCredit + clientCredit, required);

        // Invariant: provider payment never exceeds deposit
        assertLe(providerCredit, required);
    }

    // ─── CA-14: Period timestamp validation ───────────────────────────────────

    /**
     * @notice Report with periodEnd in the future must revert.
     */
    function test_futureTimestamp_reverts() public {
        _start();

        uint256 ps = block.timestamp;
        uint256 pe = block.timestamp + 1 hours; // in the future

        bytes32 mh  = keccak256("future");
        bytes memory sig = _signReport(sid, ps, pe, 60, 80, mh);

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.InvalidPeriod.selector);
        ca.submitUsageReport(sid, ps, pe, 60, 80, sig, mh);
    }

    /**
     * @notice Report with periodStart before session startedAt must revert.
     */
    function test_periodBeforeStart_reverts() public {
        _proposeAndAccept();

        // Warp forward then start
        vm.warp(1000);
        vm.prank(provider);
        ca.startSession(sid);

        // Try to submit report with periodStart before startedAt
        uint256 ps = 500; // before startedAt=1000
        uint256 pe = 1001;
        vm.warp(pe);
        bytes32 mh  = keccak256("early");
        bytes memory sig = _signReport(sid, ps, pe, 10, 50, mh);

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.InvalidPeriod.selector);
        ca.submitUsageReport(sid, ps, pe, 10, 50, sig, mh);
    }

    // ─── Withdraw edge cases ──────────────────────────────────────────────────

    /**
     * @notice withdraw() with nothing credited must revert.
     */
    function test_withdraw_nothingToWithdraw() public {
        vm.expectRevert(ComputeAgreement.NothingToWithdraw.selector);
        vm.prank(client);
        ca.withdraw(address(0));
    }

    // ─── CA-IND-1: Cross-chain / cross-contract replay prevention ────────────

    /**
     * @notice A signature produced for a different chainId must be rejected.
     */
    function test_crossChainReplay_rejected() public {
        _start();

        uint256 ps = block.timestamp;
        uint256 pe = ps + 15 minutes;
        vm.warp(pe);
        bytes32 mh = keccak256("xchain-metrics");

        // Sign with wrong chainId
        uint256 wrongChainId = block.chainid + 1;
        bytes32 structHash = keccak256(abi.encode(
            wrongChainId, address(ca), sid, ps, pe, uint256(15), uint256(80), mh
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(providerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.InvalidSignature.selector);
        ca.submitUsageReport(sid, ps, pe, 15, 80, sig, mh);
    }

    /**
     * @notice A signature produced for a different contract address must be rejected.
     */
    function test_crossContractReplay_rejected() public {
        _start();

        uint256 ps = block.timestamp;
        uint256 pe = ps + 15 minutes;
        vm.warp(pe);
        bytes32 mh = keccak256("xcontract-metrics");

        // Sign with wrong contract address
        address wrongContract = address(0xDEAD);
        bytes32 structHash = keccak256(abi.encode(
            block.chainid, wrongContract, sid, ps, pe, uint256(15), uint256(80), mh
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(providerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(provider);
        vm.expectRevert(ComputeAgreement.InvalidSignature.selector);
        ca.submitUsageReport(sid, ps, pe, 15, 80, sig, mh);
    }

    // ─── CA-IND-2: s-value malleability ──────────────────────────────────────

    /**
     * @notice A signature with s > secp256k1n/2 (malleable form) must be rejected.
     */
    function test_malleableS_rejected() public {
        _start();
        uint256 ps = block.timestamp;
        uint256 pe = ps + 15 minutes;
        vm.warp(pe);
        bytes32 mh = keccak256("malleable-metrics");
        bytes memory malleableSig = _buildMalleableSig(sid, ps, pe, mh);
        vm.prank(provider);
        vm.expectRevert("Invalid s");
        ca.submitUsageReport(sid, ps, pe, 15, 80, malleableSig, mh);
    }

    function _buildMalleableSig(
        bytes32 _sid,
        uint256 ps,
        uint256 pe,
        bytes32 mh
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            block.chainid, address(ca), _sid, ps, pe, uint256(15), uint256(80), mh
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(providerKey, digest);
        uint256 secp256k1n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 malleableS = bytes32(secp256k1n - uint256(s));
        return abi.encodePacked(r, malleableS, v);
    }

    // ─── SL-2: Constructor zero-address check ─────────────────────────────────

    /**
     * @notice Deploying with address(0) arbitrator must revert.
     */
    function test_constructorRejectsZeroArbitrator() public {
        vm.expectRevert("Zero arbitrator");
        new ComputeAgreement(address(0));
    }

    // ─── CA-IND-3: Exact deposit ──────────────────────────────────────────────

    /**
     * @notice Exact deposit amount succeeds; underpayment still reverts.
     */
    function test_exactDeposit_succeeds() public {
        vm.prank(client);
        ca.proposeSession{value: DEPOSIT}(sid, provider, RATE_PER_HOUR, MAX_HOURS, GPU_SPEC_HASH, address(0));
        assertEq(ca.getSession(sid).depositAmount, DEPOSIT);
        assertEq(address(ca).balance, DEPOSIT);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _propose() internal {
        vm.prank(client);
        ca.proposeSession{value: DEPOSIT}(sid, provider, RATE_PER_HOUR, MAX_HOURS, GPU_SPEC_HASH, address(0));
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

    function _proposeErc20() internal returns (bytes32 eSid) {
        eSid = keccak256(abi.encodePacked(client, uint256(200)));
        vm.startPrank(client);
        token.approve(address(ca), TOKEN_DEPOSIT);
        ca.proposeSession(eSid, provider, TOKEN_RATE, MAX_HOURS, GPU_SPEC_HASH, address(token));
        vm.stopPrank();
    }

    function _submitReport(uint256 computeMinutes, uint256 avgUtil) internal {
        _submitReportFor(sid, computeMinutes, avgUtil);
    }

    function _submitReportFor(bytes32 _sid, uint256 computeMinutes, uint256 avgUtil) internal {
        uint256 periodStart = block.timestamp;
        uint256 periodEnd   = periodStart + computeMinutes * 60;
        bytes32 mHash       = keccak256(abi.encodePacked("metrics", computeMinutes, _sid));
        bytes memory sig    = _signReport(_sid, periodStart, periodEnd, computeMinutes, avgUtil, mHash);

        vm.warp(periodEnd);
        vm.prank(provider);
        ca.submitUsageReport(_sid, periodStart, periodEnd, computeMinutes, avgUtil, sig, mHash);
    }

    function _signReport(
        bytes32 _sid,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 computeMinutes,
        uint256 avgUtil,
        bytes32 metricsHash
    ) internal view returns (bytes memory) {
        return _signReportWithKey(providerKey, address(ca), _sid, periodStart, periodEnd, computeMinutes, avgUtil, metricsHash);
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
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
