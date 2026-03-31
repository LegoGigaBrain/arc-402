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

contract MockWatchtowerRegistry {
    mapping(address => bool) private _watchtowers;

    function setWatchtower(address wt, bool val) external {
        _watchtowers[wt] = val;
    }

    function isWatchtower(address agent) external view returns (bool) {
        return _watchtowers[agent];
    }
}

contract MockGovernance {
    // Minimal mock — the only thing ArenaPool checks is msg.sender == governance
    // So we expose a helper to call setFeeBps as governance
    function callSetFeeBps(address pool, uint256 newFeeBps) external {
        ArenaPool(pool).setFeeBps(newFeeBps);
    }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

contract ArenaPoolTest is Test {
    ArenaPool                public pool;
    MockUSDC                 public usdc;
    MockAgentRegistry        public agentReg;
    MockPolicyEngine         public policyEngine;
    MockWatchtowerRegistry   public watchtowerReg;
    MockGovernance           public govContract;

    // Three watchtowers (RESOLUTION_QUORUM = 3)
    address public watchtower1 = address(0x1111111111111111111111111111111111111111);
    address public watchtower2 = address(0x2222222222222222222222222222222222222222);
    address public watchtower3 = address(0x3333333333333333333333333333333333333333);
    address public watchtower4 = address(0x4444444444444444444444444444444444444444);

    address public treasury    = address(0x1234567890000000000000000000000000000002);
    address public agentA      = address(0xA1);
    address public agentB      = address(0xB2);
    address public agentC      = address(0xC3);
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

    /// @dev createRound requires a registered agent. Use agentA as creator.
    function _createStandardRound() internal returns (uint256 roundId) {
        vm.prank(agentA);
        roundId = pool.createRound("BTC above $70k?", "market.crypto", TWO_HOURS, ONE_USDC);
    }

    function _enterRound(address agent, uint256 roundId, uint8 side, uint256 amount) internal {
        _fundAndApprove(agent, amount);
        vm.prank(agent);
        pool.enterRound(roundId, side, amount, "conviction note");
    }

    /// @dev Warp to resolvesAt and submit quorum (3 watchtowers) to resolve.
    function _resolveRound(uint256 roundId, bool outcome) internal {
        IArenaPool.Round memory r = pool.getRound(roundId);
        vm.warp(r.resolvesAt);
        vm.prank(watchtower1);
        pool.submitResolution(roundId, outcome, bytes32(0));
        vm.prank(watchtower2);
        pool.submitResolution(roundId, outcome, bytes32(0));
        vm.prank(watchtower3);
        pool.submitResolution(roundId, outcome, bytes32(0));
    }

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        usdc         = new MockUSDC();
        agentReg     = new MockAgentRegistry();
        policyEngine = new MockPolicyEngine();
        watchtowerReg = new MockWatchtowerRegistry();
        govContract  = new MockGovernance();

        pool = new ArenaPool(
            address(usdc),
            address(policyEngine),
            address(agentReg),
            address(watchtowerReg),
            address(govContract),
            treasury,
            FEE_BPS
        );

        agentReg.setRegistered(agentA, true);
        agentReg.setRegistered(agentB, true);
        agentReg.setRegistered(agentC, true);
        // unregistered stays false

        // Register 4 watchtowers
        watchtowerReg.setWatchtower(watchtower1, true);
        watchtowerReg.setWatchtower(watchtower2, true);
        watchtowerReg.setWatchtower(watchtower3, true);
        watchtowerReg.setWatchtower(watchtower4, true);
    }

    // ─── Test 01: Constructor stores addresses correctly ─────────────────────

    function test_01_ConstructorParams() public view {
        assertEq(address(pool.usdc()),               address(usdc));
        assertEq(address(pool.policyEngine()),        address(policyEngine));
        assertEq(address(pool.agentRegistry()),       address(agentReg));
        assertEq(address(pool.watchtowerRegistry()),  address(watchtowerReg));
        assertEq(pool.governance(),                   address(govContract));
        assertEq(pool.treasury(),                     treasury);
        assertEq(pool.feeBps(),                       FEE_BPS);
        assertEq(pool.RESOLUTION_QUORUM(),            3);
    }

    // ─── Test 02: Constructor rejects zero addresses ──────────────────────────

    function test_02_ConstructorRejectsZeroAddress() public {
        vm.expectRevert(ArenaPool.ZeroAddress.selector);
        new ArenaPool(address(0), address(policyEngine), address(agentReg), address(watchtowerReg), address(govContract), treasury, FEE_BPS);

        vm.expectRevert(ArenaPool.ZeroAddress.selector);
        new ArenaPool(address(usdc), address(0), address(agentReg), address(watchtowerReg), address(govContract), treasury, FEE_BPS);

        vm.expectRevert(ArenaPool.ZeroAddress.selector);
        new ArenaPool(address(usdc), address(policyEngine), address(0), address(watchtowerReg), address(govContract), treasury, FEE_BPS);

        vm.expectRevert(ArenaPool.ZeroAddress.selector);
        new ArenaPool(address(usdc), address(policyEngine), address(agentReg), address(0), address(govContract), treasury, FEE_BPS);

        vm.expectRevert(ArenaPool.ZeroAddress.selector);
        new ArenaPool(address(usdc), address(policyEngine), address(agentReg), address(watchtowerReg), address(0), treasury, FEE_BPS);

        vm.expectRevert(ArenaPool.ZeroAddress.selector);
        new ArenaPool(address(usdc), address(policyEngine), address(agentReg), address(watchtowerReg), address(govContract), address(0), FEE_BPS);
    }

    // ─── Test 03: Constructor rejects fee over max ────────────────────────────

    function test_03_ConstructorRejectsHighFee() public {
        vm.expectRevert(ArenaPool.FeeTooHigh.selector);
        new ArenaPool(address(usdc), address(policyEngine), address(agentReg), address(watchtowerReg), address(govContract), treasury, 1_001);
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

        // Fast-forward to resolvesAt and get quorum
        IArenaPool.Round memory rInfo = pool.getRound(roundId);
        vm.warp(rInfo.resolvesAt);

        // Submit 3 watchtower attestations for YES=true
        vm.prank(watchtower1);
        pool.submitResolution(roundId, true, keccak256("evidence-btc"));
        vm.prank(watchtower2);
        pool.submitResolution(roundId, true, keccak256("evidence-btc"));
        vm.prank(watchtower3);
        pool.submitResolution(roundId, true, keccak256("evidence-btc"));

        IArenaPool.Round memory r = pool.getRound(roundId);
        assertTrue(r.resolved);
        assertTrue(r.outcome);
        assertEq(r.yesPot, TEN_USDC);
        assertEq(r.noPot, 5_000_000);

        // agentA claims
        // yesPot = 10 USDC (winner), noPot = 5 USDC (loser)
        // fee    = 3% of 5 USDC = 150_000
        // net    = 5_000_000 - 150_000 = 4_850_000
        // agentA payout = 10_000_000 + 4_850_000 = 14_850_000
        uint256 expectedPayout = TEN_USDC + 4_850_000;
        uint256 expectedFee    = (5_000_000 * FEE_BPS) / 10_000; // 150_000

        vm.expectEmit(true, true, false, true);
        emit IArenaPool.Claimed(roundId, agentA, expectedPayout);

        vm.prank(agentA);
        pool.claim(roundId);

        assertEq(usdc.balanceOf(agentA), expectedPayout);
        assertEq(usdc.balanceOf(treasury), expectedFee);
    }

    // ─── Test 07: Losing side cannot claim ───────────────────────────────────

    function test_07_LoserCannotClaim() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC); // YES
        _enterRound(agentB, roundId, 1, 5_000_000); // NO

        _resolveRound(roundId, true); // YES wins

        // agentB (NO) tries to claim — should revert
        vm.prank(agentB);
        vm.expectRevert(ArenaPool.NothingToClaim.selector);
        pool.claim(roundId);
    }

    // ─── Test 08: Non-entrant cannot claim ───────────────────────────────────

    function test_08_NonEntrantCannotClaim() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);
        _resolveRound(roundId, true);

        vm.prank(agentC);
        vm.expectRevert(ArenaPool.NothingToClaim.selector);
        pool.claim(roundId);
    }

    // ─── Test 09: Cannot enter after staking cutoff ───────────────────────────

    function test_09_EnterAfterStakingCutoff() public {
        uint256 roundId = _createStandardRound();

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

    // ─── Test 13: submitResolution rejects non-watchtower ────────────────────

    function test_13_NonWatchtowerCannotSubmitResolution() public {
        uint256 roundId = _createStandardRound();

        vm.warp(pool.getRound(roundId).resolvesAt);

        // agentA is not a watchtower
        vm.prank(agentA);
        vm.expectRevert(ArenaPool.NotWatchtower.selector);
        pool.submitResolution(roundId, true, bytes32(0));
    }

    // ─── Test 14: submitResolution rejects before resolvesAt ─────────────────

    function test_14_CannotSubmitResolutionBeforeResolvesAt() public {
        uint256 roundId = _createStandardRound();

        IArenaPool.Round memory r = pool.getRound(roundId);
        vm.warp(r.resolvesAt - 1);

        vm.prank(watchtower1);
        vm.expectRevert(ArenaPool.TooEarlyToResolve.selector);
        pool.submitResolution(roundId, true, bytes32(0));
    }

    // ─── Test 15: submitResolution: watchtower cannot attest twice ────────────

    function test_15_WatchtowerCannotAttestTwice() public {
        uint256 roundId = _createStandardRound();
        vm.warp(pool.getRound(roundId).resolvesAt);

        vm.prank(watchtower1);
        pool.submitResolution(roundId, true, bytes32(0));

        vm.prank(watchtower1);
        vm.expectRevert(ArenaPool.AlreadyAttested.selector);
        pool.submitResolution(roundId, true, bytes32(0));
    }

    // ─── Test 16: Fee calculation accuracy ───────────────────────────────────

    function test_16_FeeCalculationAccuracy() public {
        // agentA: YES 20 USDC, agentB: NO 10 USDC
        // fee = 3% of losing pot (NO = 10 USDC) = 300_000
        // net losing = 9_700_000
        // agentA payout = 20_000_000 + 9_700_000 = 29_700_000 (sole winner)
        // treasury should get 300_000

        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, 20_000_000); // YES 20 USDC
        _enterRound(agentB, roundId, 1, 10_000_000); // NO  10 USDC

        _resolveRound(roundId, true);

        vm.prank(agentA);
        pool.claim(roundId);

        assertEq(usdc.balanceOf(agentA), 29_700_000);
        assertEq(usdc.balanceOf(treasury), 300_000);
    }

    // ─── Test 17: Payout proportional to stake (two YES winners) ─────────────

    function test_17_PayoutProportionalToStake() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, 10_000_000);
        _enterRound(agentB, roundId, 1, 20_000_000);
        _enterRound(agentC, roundId, 0, 30_000_000);

        _resolveRound(roundId, true);

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
        _resolveRound(roundId, true);

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
        _resolveRound(roundId, true);

        // Watchtower tries again — round already resolved
        vm.prank(watchtower1);
        vm.expectRevert(ArenaPool.AlreadyResolved.selector);
        pool.submitResolution(roundId, false, bytes32(0));
    }

    // ─── Test 20: Non-governance cannot set fee ───────────────────────────────

    function test_20_NonGovernanceCannotSetFee() public {
        vm.prank(agentA);
        vm.expectRevert(ArenaPool.NotGovernance.selector);
        pool.setFeeBps(100);

        // A random address also cannot set fee
        vm.prank(watchtower1);
        vm.expectRevert(ArenaPool.NotGovernance.selector);
        pool.setFeeBps(200);
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
        _resolveRound(r0, true);
        vm.prank(agentA);
        pool.claim(r0);

        // Round 1: agentB wins
        vm.warp(block.timestamp + 1);
        vm.prank(agentA);
        uint256 r1 = pool.createRound("ETH above $4k?", "market.crypto", TWO_HOURS, ONE_USDC);
        _enterRound(agentA, r1, 0, TEN_USDC);
        _enterRound(agentB, r1, 1, TEN_USDC);
        _resolveRound(r1, false); // NO wins
        vm.prank(agentB);
        pool.claim(r1);

        (IArenaPool.AgentStanding[] memory standings, ) = pool.getStandings(0, 0);
        assertEq(standings.length, 2);

        // Find agentA
        IArenaPool.AgentStanding memory standA = standings[0].agent == agentA ? standings[0] : standings[1];
        assertEq(standA.roundsEntered, 2);
        assertEq(standA.roundsWon, 1);
        assertEq(standA.winRate, 5_000); // 50%

        // Find agentB
        IArenaPool.AgentStanding memory standB = standings[0].agent == agentB ? standings[0] : standings[1];
        assertEq(standB.roundsEntered, 2);
        assertEq(standB.roundsWon, 1);
        assertEq(standB.winRate, 5_000);
    }

    // ─── Test 26: setFeeBps via governance ───────────────────────────────────

    function test_26_SetFeeBpsViaGovernance() public {
        // Only governance can call setFeeBps
        govContract.callSetFeeBps(address(pool), 500); // 5%
        assertEq(pool.feeBps(), 500);

        // Governance can also set to 0
        govContract.callSetFeeBps(address(pool), 0);
        assertEq(pool.feeBps(), 0);

        // Governance cannot exceed MAX_FEE_BPS
        vm.expectRevert(ArenaPool.FeeTooHigh.selector);
        govContract.callSetFeeBps(address(pool), 1_001);
    }

    // ─── Test 27: NO side wins scenario ──────────────────────────────────────

    function test_27_NOWinsScenario() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC); // YES
        _enterRound(agentB, roundId, 1, 5_000_000); // NO

        _resolveRound(roundId, false); // NO wins

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
            address(watchtowerReg),
            address(govContract),
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
        vm.prank(watchtower1);
        zeroPool.submitResolution(roundId, true, bytes32(0));
        vm.prank(watchtower2);
        zeroPool.submitResolution(roundId, true, bytes32(0));
        vm.prank(watchtower3);
        zeroPool.submitResolution(roundId, true, bytes32(0));

        vm.prank(agentA);
        zeroPool.claim(roundId);

        // With 0% fee: payout = 10_000_000 + 5_000_000 = 15_000_000
        assertEq(usdc.balanceOf(agentA), 15_000_000);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    // ─── Test 29: Multiple rounds, correct pot isolation ─────────────────────

    function test_29_MultipleRoundIsolation() public {
        uint256 r0 = _createStandardRound();
        vm.warp(block.timestamp + 1);
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

    // ─── Test 31: Quorum requires RESOLUTION_QUORUM attestations ─────────────

    function test_31_QuorumRequires3Attestations() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);

        vm.warp(pool.getRound(roundId).resolvesAt);

        // 1st attestation — not resolved
        vm.prank(watchtower1);
        pool.submitResolution(roundId, true, bytes32(0));
        assertFalse(pool.getRound(roundId).resolved);
        assertEq(pool.getAttestationCount(roundId, true), 1);

        // 2nd attestation — still not resolved
        vm.prank(watchtower2);
        pool.submitResolution(roundId, true, bytes32(0));
        assertFalse(pool.getRound(roundId).resolved);
        assertEq(pool.getAttestationCount(roundId, true), 2);

        // 3rd attestation — auto-resolves
        vm.prank(watchtower3);
        pool.submitResolution(roundId, true, bytes32(0));
        assertTrue(pool.getRound(roundId).resolved);
        assertTrue(pool.getRound(roundId).outcome);
    }

    // ─── Test 32: [FIX CRIT-2] Zero winner side refunds all stakers ──────────

    function test_32_ZeroWinnerSide_RefundsLosers() public {
        uint256 roundId = _createStandardRound();
        // Only YES bets — nobody bets NO
        _enterRound(agentA, roundId, 0, TEN_USDC);
        _enterRound(agentB, roundId, 0, 5_000_000);

        // Resolve NO wins (zero-winner side — noPot = 0, yesPot = 15M)
        _resolveRound(roundId, false); // NO wins, but noPot=0

        // Both YES bettors should get full refund
        vm.prank(agentA);
        pool.claim(roundId);
        assertEq(usdc.balanceOf(agentA), TEN_USDC);

        vm.prank(agentB);
        pool.claim(roundId);
        assertEq(usdc.balanceOf(agentB), 5_000_000);

        // Treasury receives nothing (no fee on refund)
        assertEq(usdc.balanceOf(treasury), 0);
    }

    // ─── Test 33: emergencyRefund after MAX_FREEZE_DURATION past resolvesAt ───

    function test_33_EmergencyRefund_AfterMaxFreezeDuration() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);
        _enterRound(agentB, roundId, 1, 5_000_000);

        IArenaPool.Round memory r = pool.getRound(roundId);

        // Too soon — must be at least MAX_FREEZE_DURATION past resolvesAt
        vm.warp(r.resolvesAt + 1);
        vm.prank(agentA);
        vm.expectRevert("ArenaPool: too early for emergency refund");
        pool.emergencyRefund(roundId);

        // Warp past resolvesAt + 30 days
        vm.warp(r.resolvesAt + 30 days);
        vm.prank(agentA);
        vm.expectRevert("ArenaPool: too early for emergency refund");
        pool.emergencyRefund(roundId);

        vm.warp(r.resolvesAt + 30 days + 1);
        vm.prank(agentA);
        pool.emergencyRefund(roundId);
        assertEq(usdc.balanceOf(agentA), TEN_USDC);

        vm.prank(agentB);
        pool.emergencyRefund(roundId);
        assertEq(usdc.balanceOf(agentB), 5_000_000);
    }

    // ─── Test 34: [FIX MED-1] refundUnresolved after grace period ───────────

    function test_34_RefundUnresolved_AfterGracePeriod() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);

        // Too soon — grace period not over
        vm.warp(pool.getRound(roundId).resolvesAt + 72 hours);
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
        _enterRound(agentA, roundId, 0, TEN_USDC);
        _enterRound(agentB, roundId, 1, 10_000_000);

        // Resolve with 3% fee
        _resolveRound(roundId, true); // YES wins, feeBps=300 snapshotted

        // Governance bumps fee AFTER resolution
        govContract.callSetFeeBps(address(pool), 1_000); // 10%

        // Winner should still pay 3% (snapshotted at resolution time)
        // noPot=10M, fee@3%=300k, net=9.7M, payout=10M+9.7M=19.7M
        vm.prank(agentA);
        pool.claim(roundId);

        assertEq(usdc.balanceOf(agentA), 19_700_000); // 3% fee, not 10%
        assertEq(usdc.balanceOf(treasury), 300_000);
    }

    // ─── Test 36: recordSpend order — transfer fails before recordSpend ───────

    function test_36_RecordSpendOrder_TransferFailsBeforeRecordSpend() public {
        uint256 roundId = _createStandardRound();

        usdc.mint(agentA, TEN_USDC);
        vm.prank(agentA);
        usdc.approve(address(pool), ONE_USDC); // only 1 USDC approved, entering 10

        vm.prank(agentA);
        vm.expectRevert("MockUSDC: insufficient allowance");
        pool.enterRound(roundId, 0, TEN_USDC, "note");

        IArenaPool.Entry memory entry = pool.getUserEntry(roundId, agentA);
        assertEq(entry.agent, address(0));
    }

    // ─── Test 37: createRound by unregistered address reverts ────────────────

    function test_37_CreateRound_UnregisteredReverts() public {
        vm.prank(unregistered);
        vm.expectRevert(ArenaPool.NotRegistered.selector);
        pool.createRound("Q?", "cat", TWO_HOURS, ONE_USDC);
    }

    // ─── Test 38: Split attestations don't auto-resolve ──────────────────────

    function test_38_SplitAttestationsNoAutoResolve() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);

        vm.warp(pool.getRound(roundId).resolvesAt);

        // 2 YES, 2 NO — neither reaches quorum of 3
        vm.prank(watchtower1);
        pool.submitResolution(roundId, true, bytes32(0));
        vm.prank(watchtower2);
        pool.submitResolution(roundId, true, bytes32(0));
        vm.prank(watchtower3);
        pool.submitResolution(roundId, false, bytes32(0));
        vm.prank(watchtower4);
        pool.submitResolution(roundId, false, bytes32(0));

        // Should NOT be resolved — no side reached quorum
        assertFalse(pool.getRound(roundId).resolved);
        assertEq(pool.getAttestationCount(roundId, true), 2);
        assertEq(pool.getAttestationCount(roundId, false), 2);
    }

    // ─── Test 39: hasAttested and getAttestationCount views ──────────────────

    function test_39_AttestationViews() public {
        uint256 roundId = _createStandardRound();
        vm.warp(pool.getRound(roundId).resolvesAt);

        assertFalse(pool.hasAttested(roundId, watchtower1));
        assertEq(pool.getAttestationCount(roundId, true), 0);

        vm.prank(watchtower1);
        pool.submitResolution(roundId, true, bytes32(0));

        assertTrue(pool.hasAttested(roundId, watchtower1));
        assertFalse(pool.hasAttested(roundId, watchtower2));
        assertEq(pool.getAttestationCount(roundId, true), 1);
        assertEq(pool.getAttestationCount(roundId, false), 0);
    }

    // ─── Test 40: emergencyRefund fails if already resolved ──────────────────

    function test_40_EmergencyRefund_FailsIfResolved() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);
        _resolveRound(roundId, true);

        IArenaPool.Round memory r = pool.getRound(roundId);
        vm.warp(r.resolvesAt + 30 days + 1);

        vm.prank(agentA);
        vm.expectRevert("ArenaPool: already resolved");
        pool.emergencyRefund(roundId);
    }

    // ─── Test 41: refundUnresolved fails if already resolved ─────────────────

    function test_41_RefundUnresolved_FailsIfResolved() public {
        uint256 roundId = _createStandardRound();
        _enterRound(agentA, roundId, 0, TEN_USDC);
        _resolveRound(roundId, true);

        vm.warp(pool.getRound(roundId).resolvesAt + 72 hours + 1);

        vm.prank(agentA);
        vm.expectRevert("ArenaPool: already resolved");
        pool.refundUnresolved(roundId);
    }

    // ─── Test 42: ResolutionAttested and RoundAutoResolved events emitted ─────

    function test_42_Events_AttestationAndAutoResolve() public {
        uint256 roundId = _createStandardRound();
        vm.warp(pool.getRound(roundId).resolvesAt);

        vm.prank(watchtower1);
        vm.expectEmit(true, true, false, true);
        emit IArenaPool.ResolutionAttested(roundId, watchtower1, true, 1);
        pool.submitResolution(roundId, true, bytes32(0));

        vm.prank(watchtower2);
        pool.submitResolution(roundId, true, bytes32(0));

        // 3rd attestation triggers both RoundResolved and RoundAutoResolved
        vm.prank(watchtower3);
        vm.expectEmit(true, false, false, true);
        emit IArenaPool.RoundResolved(roundId, true, bytes32(0));
        vm.expectEmit(true, false, false, true);
        emit IArenaPool.RoundAutoResolved(roundId, true, 3);
        pool.submitResolution(roundId, true, bytes32(0));
    }
}
