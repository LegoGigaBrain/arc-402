// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ArenaPool.sol";
import "../contracts/interfaces/IArenaPool.sol";

// ─── Mock contracts ───────────────────────────────────────────────────────────

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "MockUSDC: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "MockUSDC: insufficient allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MockUSDC: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockAgentRegistry {
    mapping(address => bool) private _registered;

    function setRegistered(address agent, bool val) external {
        _registered[agent] = val;
    }

    function isRegistered(address wallet) external view returns (bool) {
        return _registered[wallet];
    }
}

contract MockPolicyEngine {
    bool public shouldReject;

    function setShouldReject(bool val) external {
        shouldReject = val;
    }

    function validateSpend(address, string calldata, uint256, address) external view {
        require(!shouldReject, "PolicyEngine: spend rejected");
    }

    function recordSpend(address, string calldata, uint256, address) external {
        // no-op in tests unless overridden
    }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

contract ArenaPoolTest is Test {
    ArenaPool         public pool;
    MockUSDC          public usdc;
    MockAgentRegistry public agentReg;
    MockPolicyEngine  public policyEngine;

    address public resolver  = address(0x1234567890000000000000000000000000000001);
    address public treasury  = address(0x1234567890000000000000000000000000000002);
    address public agentA    = address(0xA1);
    address public agentB    = address(0xB2);
    address public agentC    = address(0xC3);
    address public unregistered = address(0xDEAD);

    uint256 constant ONE_USDC  = 1_000_000;   // 1 USDC (6 decimals)
    uint256 constant TEN_USDC  = 10_000_000;
    uint256 constant FEE_BPS   = 300;          // 3%
    uint256 constant ONE_HOUR  = 3600;
    uint256 constant TWO_HOURS = 7200;

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _fundAndApprove(address agent, uint256 amount) internal {
        usdc.mint(agent, amount);
        vm.prank(agent);
        usdc.approve(address(pool), amount);
    }

    /// @dev createRound now requires a registered agent. Use agentA as creator.
    function _createStandardRound() internal returns (uint256 roundId) {
        vm.prank(agentA);
        roundId = pool.createRound("BTC above $70k?", "market.crypto", TWO_HOURS, ONE_USDC);
    }

    function _enterRound(address agent, uint256 roundId, uint8 side, uint256 amount) internal {
        _fundAndApprove(agent, amount);
        vm.prank(agent);
        pool.enterRound(roundId, side, amount, "conviction note");
    }

    /// @dev Warp to resolvesAt and resolve. Required after CRIT-1 fix.
    function _resolveRound(uint256 roundId, bool outcome) internal {
        IArenaPool.Round memory r = pool.getRound(roundId);
        vm.warp(r.resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(roundId, outcome, bytes32(0));
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        usdc         = new MockUSDC();
        agentReg     = new MockAgentRegistry();
        policyEngine = new MockPolicyEngine();

        pool = new ArenaPool(
            address(usdc),
            address(policyEngine),
            address(agentReg),
            resolver,
            treasury,
            FEE_BPS
        );

        agentReg.setRegistered(agentA, true);
        agentReg.setRegistered(agentB, true);
        agentReg.setRegistered(agentC, true);
        // unregistered stays false
    }

    // ─── Test 01: Constructor stores addresses correctly ─────────────────────

    function test_01_ConstructorParams() public view {
        assertEq(address(pool.usdc()),          address(usdc));
        assertEq(address(pool.policyEngine()),  address(policyEngine));
        assertEq(address(pool.agentRegistry()), address(agentReg));
        assertEq(pool.resolver(),               resolver);
        assertEq(pool.treasury(),               treasury);
        assertEq(pool.feeBps(),                 FEE_BPS);
    }

    // ─── Test 02: Constructor rejects zero addresses ──────────────────────────

    function test_02_ConstructorRejectsZeroAddress() public {
        vm.expectRevert(ArenaPool.ZeroAddress.selector);
        new ArenaPool(address(0), address(policyEngine), address(agentReg), resolver, treasury, FEE_BPS);

        vm.expectRevert(ArenaPool.ZeroAddress.selector);
        new ArenaPool(address(usdc), address(0), address(agentReg), resolver, treasury, FEE_BPS);
    }

    // ─── Test 03: Constructor rejects fee over max ────────────────────────────

    function test_03_ConstructorRejectsHighFee() public {
        vm.expectRevert(ArenaPool.FeeTooHigh.selector);
        new ArenaPool(address(usdc), address(policyEngine), address(agentReg), resolver, treasury, 1_001);
    }

    // ─── Test 04: createRound emits event and stores round ───────────────────

    function test_04_CreateRound() public {
        vm.expectEmit(true, true, false, true);
        emit IArenaPool.RoundCreated(
            0,
            agentA,
            "BTC above $70k?",
            "market.crypto",
            block.timestamp + TWO_HOURS - 30 minutes,
            block.timestamp + TWO_HOURS
        );
        uint256 roundId = _createStandardRound();

        assertEq(roundId, 0);
        assertEq(pool.roundCount(), 1);

        IArenaPool.Round memory r = pool.getRound(roundId);
        assertEq(r.question,   "BTC above $70k?");
        assertEq(r.category,   "market.crypto");
        assertEq(r.creator,    agentA);
        assertEq(r.yesPot,     0);
        assertEq(r.noPot,      0);
        assertFalse(r.resolved);
    }

    // ─── Test 05: createRound rejects duration <= 30 min ─────────────────────

    function test_05_CreateRoundInvalidDuration() public {
        vm.prank(agentA);
        vm.expectRevert(ArenaPool.InvalidDuration.selector);
        pool.createRound("Q?", "cat", 30 minutes, ONE_USDC);

        vm.prank(agentA);
        vm.expectRevert(ArenaPool.InvalidDuration.selector);
        pool.createRound("Q?", "cat", 1 minutes, ONE_USDC);
    }

    // ─── Test 06: Full happy path — create, enter both sides, resolve YES, claim ──

    function test_06_HappyPathYESWins() public {
        uint256 roundId = _createStandardRound();

        // agentA bets YES: 10 USDC
        _enterRound(agentA, roundId, 0, TEN_USDC);
        // agentB bets NO:  5 USDC
        _enterRound(agentB, roundId, 1, 5_000_000);

        // Fast-forward to resolvesAt
        IArenaPool.Round memory rInfo = pool.getRound(roundId);
        vm.warp(rInfo.resolvesAt);

        // Resolve YES
        vm.prank(resolver);
        pool.resolveRound(roundId, true, keccak256("evidence-btc"));

        IArenaPool.Round memory r = pool.getRound(roundId);
        assertTrue(r.resolved);
        assertTrue(r.outcome);
        assertEq(r.yesPot, TEN_USDC);
        assertEq(r.noPot, 5_000_000);

        // agentA claims
        // yesPot = 10 USDC (winner)
        // noPot  = 5 USDC  (loser)
        // fee    = 3% of 5 USDC = 150_000
        // net    = 5_000_000 - 150_000 = 4_850_000
        // agentA payout = 10_000_000 + (10_000_000 * 4_850_000) / 10_000_000 = 14_850_000
        uint256 expectedPayout = TEN_USDC + 4_850_000;
        uint256 expectedFee    = (5_000_000 * FEE_BPS) / 10_000; // 150_000

        vm.expectEmit(true, true, false, true);
        emit IArenaPool.Claimed(roundId, agentA, expectedPayout);

        vm.prank(agentA);
        pool.claim(roundId);

        assertEq(usdc.balanceOf(agentA), expectedPayout);
        // Treasury received fee (per-winner portion = all of it since single winner)
        assertEq(usdc.balanceOf(treasury), expectedFee);
    }

    // ─── Test 07: Losing side cannot claim ───────────────────────────────────

    function test_07_LoserCannotClaim() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC); // YES
        _enterRound(agentB, roundId, 1, 5_000_000); // NO

        vm.warp(pool.getRound(roundId).resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(roundId, true, bytes32(0)); // YES wins

        // agentB (NO) tries to claim — should revert
        vm.prank(agentB);
        vm.expectRevert(ArenaPool.NothingToClaim.selector);
        pool.claim(roundId);
    }

    // ─── Test 08: Non-entrant cannot claim ───────────────────────────────────

    function test_08_NonEntrantCannotClaim() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);

        vm.warp(pool.getRound(roundId).resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(roundId, true, bytes32(0));

        vm.prank(agentC);
        vm.expectRevert(ArenaPool.NothingToClaim.selector);
        pool.claim(roundId);
    }

    // ─── Test 09: Cannot enter after staking cutoff ───────────────────────────

    function test_09_EnterAfterStakingCutoff() public {
        uint256 roundId = _createStandardRound();

        // Warp to staking cutoff
        IArenaPool.Round memory r = pool.getRound(roundId);
        vm.warp(r.stakingClosesAt);

        _fundAndApprove(agentA, TEN_USDC);
        vm.prank(agentA);
        vm.expectRevert(ArenaPool.StakingClosed.selector);
        pool.enterRound(roundId, 0, TEN_USDC, "late entry");
    }

    // ─── Test 10: Double entry same round reverts ─────────────────────────────

    function test_10_DoubleEntryReverts() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);

        // Second entry
        _fundAndApprove(agentA, TEN_USDC);
        vm.prank(agentA);
        vm.expectRevert(ArenaPool.AlreadyEntered.selector);
        pool.enterRound(roundId, 1, TEN_USDC, "second try");
    }

    // ─── Test 11: Unregistered agent cannot enter ────────────────────────────

    function test_11_UnregisteredAgentReverts() public {
        uint256 roundId = _createStandardRound();
        _fundAndApprove(unregistered, TEN_USDC);

        vm.prank(unregistered);
        vm.expectRevert(ArenaPool.NotRegistered.selector);
        pool.enterRound(roundId, 0, TEN_USDC, "note");
    }

    // ─── Test 12: PolicyEngine rejection reverts enterRound ──────────────────

    function test_12_PolicyEngineRejectionReverts() public {
        policyEngine.setShouldReject(true);

        uint256 roundId = _createStandardRound();
        _fundAndApprove(agentA, TEN_USDC);

        vm.prank(agentA);
        vm.expectRevert("PolicyEngine: spend rejected");
        pool.enterRound(roundId, 0, TEN_USDC, "note");
    }

    // ─── Test 13: Frozen round blocks entry ──────────────────────────────────

    function test_13_FrozenRoundBlocksEntry() public {
        uint256 roundId = _createStandardRound();

        vm.prank(resolver);
        pool.freezeRound(roundId);

        _fundAndApprove(agentA, TEN_USDC);
        vm.prank(agentA);
        vm.expectRevert(ArenaPool.RoundIsFrozen.selector);
        pool.enterRound(roundId, 0, TEN_USDC, "note");
    }

    // ─── Test 14: Frozen round blocks resolution ─────────────────────────────

    function test_14_FrozenRoundBlocksResolution() public {
        uint256 roundId = _createStandardRound();
        vm.prank(resolver);
        pool.freezeRound(roundId);

        vm.warp(pool.getRound(roundId).resolvesAt);
        vm.prank(resolver);
        vm.expectRevert(ArenaPool.RoundIsFrozen.selector);
        pool.resolveRound(roundId, true, bytes32(0));
    }

    // ─── Test 15: Unfreeze re-enables entry ──────────────────────────────────

    function test_15_UnfreezeReenablesEntry() public {
        uint256 roundId = _createStandardRound();

        vm.prank(resolver);
        pool.freezeRound(roundId);

        vm.prank(resolver);
        pool.unfreezeRound(roundId);

        // Now should succeed
        _enterRound(agentA, roundId, 0, TEN_USDC);
        IArenaPool.Entry memory e = pool.getUserEntry(roundId, agentA);
        assertEq(e.amount, TEN_USDC);
    }

    // ─── Test 16: Fee calculation accuracy ───────────────────────────────────

    function test_16_FeeCalculationAccuracy() public {
        // agentA: YES 20 USDC, agentB: NO 10 USDC
        // fee = 3% of losing pot (NO = 10 USDC) = 300_000
        // net losing = 9_700_000
        // agentA payout = 20_000_000 + 9_700_000 = 29_700_000 (sole winner)
        // treasury should get 300_000 (per-winner portion = 300_000 * 20M/20M = 300_000)

        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, 20_000_000); // YES 20 USDC
        _enterRound(agentB, roundId, 1, 10_000_000); // NO  10 USDC

        vm.warp(pool.getRound(roundId).resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(roundId, true, bytes32(0));

        vm.prank(agentA);
        pool.claim(roundId);

        assertEq(usdc.balanceOf(agentA), 29_700_000);
        assertEq(usdc.balanceOf(treasury), 300_000);
    }

    // ─── Test 17: Payout proportional to stake (two YES winners) ─────────────

    function test_17_PayoutProportionalToStake() public {
        // agentA YES: 10 USDC, agentC YES: 30 USDC, agentB NO: 20 USDC
        // YES pot = 40 USDC (winner side)
        // NO pot  = 20 USDC (losing side)
        // fee = 3% of 20 USDC = 600_000
        // netLosing = 19_400_000
        //
        // agentA share = 10/40 of 19_400_000 = 4_850_000
        // agentA payout = 10_000_000 + 4_850_000 = 14_850_000
        //
        // agentC share = 30/40 of 19_400_000 = 14_550_000
        // agentC payout = 30_000_000 + 14_550_000 = 44_550_000
        //
        // fee from agentA: 600_000 * 10/40 = 150_000
        // fee from agentC: 600_000 * 30/40 = 450_000
        // total treasury:  600_000

        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, 10_000_000);
        _enterRound(agentB, roundId, 1, 20_000_000);
        _enterRound(agentC, roundId, 0, 30_000_000);

        vm.warp(pool.getRound(roundId).resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(roundId, true, bytes32(0));

        vm.prank(agentA);
        pool.claim(roundId);

        vm.prank(agentC);
        pool.claim(roundId);

        assertEq(usdc.balanceOf(agentA), 14_850_000);
        assertEq(usdc.balanceOf(agentC), 44_550_000);
        assertEq(usdc.balanceOf(treasury), 600_000);
    }

    // ─── Test 18: Cannot claim twice ─────────────────────────────────────────

    function test_18_CannotClaimTwice() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);

        vm.warp(pool.getRound(roundId).resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(roundId, true, bytes32(0));

        vm.prank(agentA);
        pool.claim(roundId);

        vm.prank(agentA);
        vm.expectRevert(ArenaPool.AlreadyClaimed.selector);
        pool.claim(roundId);
    }

    // ─── Test 19: Cannot resolve already resolved round ──────────────────────

    function test_19_CannotResolveAlreadyResolved() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);

        vm.warp(pool.getRound(roundId).resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(roundId, true, bytes32(0));

        vm.prank(resolver);
        vm.expectRevert(ArenaPool.AlreadyResolved.selector);
        pool.resolveRound(roundId, false, bytes32(0));
    }

    // ─── Test 20: Non-resolver cannot resolve ────────────────────────────────

    function test_20_NonResolverCannotResolve() public {
        uint256 roundId = _createStandardRound();

        vm.warp(pool.getRound(roundId).resolvesAt);
        vm.prank(agentA);
        vm.expectRevert("ArenaPool: not resolver");
        pool.resolveRound(roundId, true, bytes32(0));
    }

    // ─── Test 21: Cannot claim before resolution ─────────────────────────────

    function test_21_CannotClaimBeforeResolution() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);

        vm.prank(agentA);
        vm.expectRevert(ArenaPool.NotResolved.selector);
        pool.claim(roundId);
    }

    // ─── Test 22: Below minimum entry reverts ────────────────────────────────

    function test_22_BelowMinEntryReverts() public {
        vm.prank(agentA);
        uint256 roundId = pool.createRound("Q?", "cat", TWO_HOURS, 5_000_000); // min 5 USDC

        _fundAndApprove(agentA, 4_000_000);
        vm.prank(agentA);
        vm.expectRevert(ArenaPool.BelowMinEntry.selector);
        pool.enterRound(roundId, 0, 4_000_000, "note");
    }

    // ─── Test 23: Invalid side reverts ───────────────────────────────────────

    function test_23_InvalidSideReverts() public {
        uint256 roundId = _createStandardRound();
        _fundAndApprove(agentA, TEN_USDC);

        vm.prank(agentA);
        vm.expectRevert(ArenaPool.InvalidSide.selector);
        pool.enterRound(roundId, 2, TEN_USDC, "note");
    }

    // ─── Test 24: Note too long reverts ──────────────────────────────────────

    function test_24_NoteTooLongReverts() public {
        uint256 roundId = _createStandardRound();
        _fundAndApprove(agentA, TEN_USDC);

        // Build 281-byte string
        bytes memory longNote = new bytes(281);
        for (uint i = 0; i < 281; i++) longNote[i] = 0x41; // 'A'

        vm.prank(agentA);
        vm.expectRevert(ArenaPool.NoteTooLong.selector);
        pool.enterRound(roundId, 0, TEN_USDC, string(longNote));
    }

    // ─── Test 25: Standings track correctly across multiple rounds ────────────

    function test_25_StandingsTracking() public {
        // Round 0: agentA wins
        uint256 r0 = _createStandardRound();
        _enterRound(agentA, r0, 0, TEN_USDC);
        _enterRound(agentB, r0, 1, TEN_USDC);
        vm.warp(pool.getRound(r0).resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(r0, true, bytes32(0));
        vm.prank(agentA);
        pool.claim(r0);

        // Round 1: agentB wins
        vm.warp(block.timestamp + 1);
        vm.prank(agentA);
        uint256 r1 = pool.createRound("ETH above $4k?", "market.crypto", TWO_HOURS, ONE_USDC);
        _enterRound(agentA, r1, 0, TEN_USDC);
        _enterRound(agentB, r1, 1, TEN_USDC);
        vm.warp(pool.getRound(r1).resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(r1, false, bytes32(0)); // NO wins
        vm.prank(agentB);
        pool.claim(r1);

        (IArenaPool.AgentStanding[] memory standings, ) = pool.getStandings(0, 0);
        assertEq(standings.length, 2);

        // Find agentA
        IArenaPool.AgentStanding memory standA = standings[0].agent == agentA ? standings[0] : standings[1];
        assertEq(standA.roundsEntered, 2);
        assertEq(standA.roundsWon, 1);
        assertEq(standA.winRate, 5_000); // 50% = 5000 bps

        // Find agentB
        IArenaPool.AgentStanding memory standB = standings[0].agent == agentB ? standings[0] : standings[1];
        assertEq(standB.roundsEntered, 2);
        assertEq(standB.roundsWon, 1);
        assertEq(standB.winRate, 5_000);
    }

    // ─── Test 26: setFeeBps can update fee (only resolver) ───────────────────

    function test_26_SetFeeBps() public {
        vm.prank(resolver);
        pool.setFeeBps(500); // 5%
        assertEq(pool.feeBps(), 500);

        vm.prank(resolver);
        vm.expectRevert(ArenaPool.FeeTooHigh.selector);
        pool.setFeeBps(1_001);

        vm.prank(agentA);
        vm.expectRevert("ArenaPool: not resolver");
        pool.setFeeBps(100);
    }

    // ─── Test 27: NO side wins scenario ──────────────────────────────────────

    function test_27_NOWinsScenario() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC); // YES
        _enterRound(agentB, roundId, 1, 5_000_000); // NO

        vm.warp(pool.getRound(roundId).resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(roundId, false, bytes32(0)); // NO wins

        // agentA (YES) cannot claim
        vm.prank(agentA);
        vm.expectRevert(ArenaPool.NothingToClaim.selector);
        pool.claim(roundId);

        // agentB (NO) can claim
        // noPot = 5_000_000 (winner), yesPot = 10_000_000 (loser)
        // fee = 3% of 10_000_000 = 300_000
        // net = 9_700_000
        // payout = 5_000_000 + 9_700_000 = 14_700_000
        vm.prank(agentB);
        pool.claim(roundId);
        assertEq(usdc.balanceOf(agentB), 14_700_000);
        assertEq(usdc.balanceOf(treasury), 300_000);
    }

    // ─── Test 28: Zero fee configuration (no fee taken) ──────────────────────

    function test_28_ZeroFeeNoPayout() public {
        // Deploy a pool with 0% fee
        ArenaPool zeroPool = new ArenaPool(
            address(usdc),
            address(policyEngine),
            address(agentReg),
            resolver,
            treasury,
            0 // 0% fee
        );

        vm.prank(agentA);
        uint256 roundId = zeroPool.createRound("Q?", "cat", TWO_HOURS, ONE_USDC);

        usdc.mint(agentA, TEN_USDC);
        vm.prank(agentA);
        usdc.approve(address(zeroPool), TEN_USDC);
        vm.prank(agentA);
        zeroPool.enterRound(roundId, 0, TEN_USDC, "");

        usdc.mint(agentB, 5_000_000);
        vm.prank(agentB);
        usdc.approve(address(zeroPool), 5_000_000);
        vm.prank(agentB);
        zeroPool.enterRound(roundId, 1, 5_000_000, "");

        vm.warp(zeroPool.getRound(roundId).resolvesAt);
        vm.prank(resolver);
        zeroPool.resolveRound(roundId, true, bytes32(0));

        vm.prank(agentA);
        zeroPool.claim(roundId);

        // With 0% fee: payout = 10_000_000 + 5_000_000 = 15_000_000
        assertEq(usdc.balanceOf(agentA), 15_000_000);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    // ─── Test 29: Multiple rounds, correct pot isolation ─────────────────────

    function test_29_MultipleRoundIsolation() public {
        uint256 r0 = _createStandardRound();
        vm.warp(block.timestamp + 1); // ensure different timestamps
        vm.prank(agentA);
        uint256 r1 = pool.createRound("ETH Q?", "market.crypto", TWO_HOURS, ONE_USDC);

        _enterRound(agentA, r0, 0, TEN_USDC);
        _enterRound(agentB, r1, 1, 5_000_000);

        IArenaPool.Round memory round0 = pool.getRound(r0);
        IArenaPool.Round memory round1 = pool.getRound(r1);

        assertEq(round0.yesPot, TEN_USDC);
        assertEq(round0.noPot, 0);
        assertEq(round1.yesPot, 0);
        assertEq(round1.noPot, 5_000_000);
    }

    // ─── Test 30: getRoundEntrants returns correct list ───────────────────────

    function test_30_GetRoundEntrants() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);
        _enterRound(agentB, roundId, 1, 5_000_000);

        address[] memory entrants = pool.getRoundEntrants(roundId);
        assertEq(entrants.length, 2);
        assertEq(entrants[0], agentA);
        assertEq(entrants[1], agentB);
    }

    // ─── Test 31: [FIX CRIT-1] Resolve before resolvesAt reverts ─────────────

    function test_31_ResolveBeforeResolvesAt_Reverts() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);

        // Try to resolve before resolvesAt — must revert
        IArenaPool.Round memory r = pool.getRound(roundId);
        vm.warp(r.resolvesAt - 1);
        vm.prank(resolver);
        vm.expectRevert(ArenaPool.TooEarlyToResolve.selector);
        pool.resolveRound(roundId, true, bytes32(0));

        // Exactly at resolvesAt — should succeed
        vm.warp(r.resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(roundId, true, bytes32(0));
        assertTrue(pool.getRound(roundId).resolved);
    }

    // ─── Test 32: [FIX CRIT-2] Zero winner side refunds losers ──────────────

    function test_32_ZeroWinnerSide_RefundsLosers() public {
        uint256 roundId = _createStandardRound();
        // Only YES bets — nobody bets NO
        _enterRound(agentA, roundId, 0, TEN_USDC);
        _enterRound(agentB, roundId, 0, 5_000_000);

        // Resolve NO wins (zero-winner side — noPot = 0, yesPot = 15M)
        vm.warp(pool.getRound(roundId).resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(roundId, false, bytes32(0)); // NO wins, but noPot=0

        // Both YES bettors should get full refund of their stakes
        vm.prank(agentA);
        pool.claim(roundId);
        assertEq(usdc.balanceOf(agentA), TEN_USDC); // full stake refunded

        vm.prank(agentB);
        pool.claim(roundId);
        assertEq(usdc.balanceOf(agentB), 5_000_000); // full stake refunded

        // Treasury receives nothing (no fee on refund)
        assertEq(usdc.balanceOf(treasury), 0);
    }

    // ─── Test 33: [FIX HIGH-1] Emergency refund after MAX_FREEZE_DURATION ────

    function test_33_EmergencyRefund_AfterMaxFreezeDuration() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);
        _enterRound(agentB, roundId, 1, 5_000_000);

        // Freeze the round
        vm.prank(resolver);
        pool.freezeRound(roundId);

        // Try too soon — should revert
        vm.prank(agentA);
        vm.expectRevert(ArenaPool.FreezePeriodActive.selector);
        pool.emergencyRefund(roundId);

        // Warp past MAX_FREEZE_DURATION (30 days)
        vm.warp(block.timestamp + 30 days + 1);

        // Now should succeed
        vm.prank(agentA);
        pool.emergencyRefund(roundId);
        assertEq(usdc.balanceOf(agentA), TEN_USDC); // stake returned

        vm.prank(agentB);
        pool.emergencyRefund(roundId);
        assertEq(usdc.balanceOf(agentB), 5_000_000); // stake returned
    }

    // ─── Test 34: [FIX MED-1] refundUnresolved after grace period ───────────

    function test_34_RefundUnresolved_AfterGracePeriod() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);

        // Too soon — grace period not over
        vm.warp(pool.getRound(roundId).resolvesAt + 72 hours); // exactly at boundary
        vm.prank(agentA);
        vm.expectRevert(ArenaPool.GracePeriodActive.selector);
        pool.refundUnresolved(roundId);

        // Past grace period
        vm.warp(pool.getRound(roundId).resolvesAt + 72 hours + 1);
        vm.prank(agentA);
        pool.refundUnresolved(roundId);
        assertEq(usdc.balanceOf(agentA), TEN_USDC);
    }

    // ─── Test 35: [FIX HIGH-2] Fee snapshot immutable after resolution ────────

    function test_35_FeeSnapshotImmutable_AfterResolution() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);  // YES 10 USDC
        _enterRound(agentB, roundId, 1, 10_000_000); // NO  10 USDC

        // Resolve with 3% fee
        vm.warp(pool.getRound(roundId).resolvesAt);
        vm.prank(resolver);
        pool.resolveRound(roundId, true, bytes32(0)); // YES wins, feeBps=300 snapshotted

        // Resolver bumps fee AFTER resolution
        vm.prank(resolver);
        pool.setFeeBps(1_000); // 10%

        // Winner should still pay 3% (snapshotted at resolution time)
        // noPot=10M, fee@3%=300k, net=9.7M, payout=10M+9.7M=19.7M
        vm.prank(agentA);
        pool.claim(roundId);

        assertEq(usdc.balanceOf(agentA), 19_700_000); // 3% fee, not 10%
        assertEq(usdc.balanceOf(treasury), 300_000);   // 3% of 10M
    }

    // ─── Test 36: [FIX HIGH-3] recordSpend only after USDC transfer ──────────

    function test_36_RecordSpendOrder_TransferFailsBeforeRecordSpend() public {
        uint256 roundId = _createStandardRound();

        // Approve less than the entry amount — transfer will fail
        usdc.mint(agentA, TEN_USDC);
        vm.prank(agentA);
        usdc.approve(address(pool), ONE_USDC); // only 1 USDC approved, entering 10

        vm.prank(agentA);
        vm.expectRevert("MockUSDC: insufficient allowance");
        pool.enterRound(roundId, 0, TEN_USDC, "note");

        // Verify no entry was recorded (effects should have reverted)
        IArenaPool.Entry memory entry = pool.getUserEntry(roundId, agentA);
        assertEq(entry.agent, address(0));
    }

    // ─── Test 37: createRound by unregistered address reverts ────────────────

    function test_37_CreateRound_UnregisteredReverts() public {
        vm.prank(unregistered);
        vm.expectRevert(ArenaPool.NotRegistered.selector);
        pool.createRound("Q?", "cat", TWO_HOURS, ONE_USDC);
    }
}
