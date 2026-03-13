// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/DisputeArbitration.sol";
import "../contracts/IDisputeArbitration.sol";
import "../contracts/TrustRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Mock ERC-20 ─────────────────────────────────────────────────────────────

contract DAMockERC20 is ERC20 {
    constructor() ERC20("MockToken", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

contract DisputeArbitrationTest is Test {

    DisputeArbitration da;
    TrustRegistry     trustReg;
    DAMockERC20       token;

    address saAddr   = address(0xAA01);   // stand-in for ServiceAgreement
    address treasury = address(0xAA02);
    address client   = address(0xC1);
    address provider = address(0xA1);
    address arb1     = address(0xB1);
    address arb2     = address(0xB2);
    address arb3     = address(0xB3);
    address arb4     = address(0xB4);
    address stranger = address(0xBEEF);

    uint256 constant AGREEMENT_ID    = 1;
    uint256 constant AGREEMENT_PRICE = 100 ether;

    // ETH at $2000/ETH: 1 token (1e18 wei) = $2000
    uint256 constant ETH_USD_RATE = 2000e18;
    // Stable token at $1/token
    uint256 constant TOKEN_USD_RATE = 1e18;

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        trustReg = new TrustRegistry();
        token    = new DAMockERC20();

        da = new DisputeArbitration(address(trustReg), treasury);
        da.setServiceAgreement(saAddr);
        da.setTokenUsdRate(address(0),          ETH_USD_RATE);
        da.setTokenUsdRate(address(token),      TOKEN_USD_RATE);

        // Allow DA to write trust scores
        trustReg.addUpdater(address(da));

        vm.deal(saAddr,    1_000 ether);
        vm.deal(client,      100 ether);
        vm.deal(provider,    100 ether);
        vm.deal(arb1,        100 ether);
        vm.deal(arb2,        100 ether);
        vm.deal(arb3,        100 ether);
        vm.deal(arb4,        100 ether);
        vm.deal(stranger,     10 ether);
        vm.deal(treasury,      0 ether);

        token.mint(client,   1_000 ether);
        token.mint(arb1,     1_000 ether);
        token.mint(arb2,     1_000 ether);
        token.mint(arb3,     1_000 ether);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /// @dev Compute the bond amount from DisputeArbitration's public logic.
    ///      bond = max(2 * feeRequired, minBondFloor)
    ///      minBondFloor in ETH = (20e18 [USD] * 1e18) / ETH_USD_RATE = 0.01 ETH
    function _calcExpectedBond(uint256 feeRequired) internal view returns (uint256) {
        uint256 twiceFee = feeRequired * 2;
        uint256 bondFloor = (da.minBondFloorUsd18() * 1e18) / ETH_USD_RATE;
        return twiceFee > bondFloor ? twiceFee : bondFloor;
    }

    function _feeETH(IDisputeArbitration.DisputeClass cls) internal view returns (uint256) {
        return da.getFeeQuote(
            AGREEMENT_PRICE, address(0),
            IDisputeArbitration.DisputeMode.UNILATERAL,
            cls
        );
    }

    function _openETHDispute(uint256 agrId) internal returns (uint256 fee) {
        fee = _feeETH(IDisputeArbitration.DisputeClass.HARD_FAILURE);
        vm.prank(saAddr);
        da.openDispute{value: fee}(
            agrId,
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE,
            client, client, provider,
            AGREEMENT_PRICE, address(0)
        );
    }

    function _openMutualETHDispute(uint256 agrId) internal returns (uint256 fee) {
        fee = da.getFeeQuote(
            AGREEMENT_PRICE, address(0),
            IDisputeArbitration.DisputeMode.MUTUAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE
        );
        // MUTUAL opener pays half
        vm.prank(saAddr);
        da.openDispute{value: fee / 2}(
            agrId,
            IDisputeArbitration.DisputeMode.MUTUAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE,
            client, client, provider,
            AGREEMENT_PRICE, address(0)
        );
    }

    function _acceptFull3Panel(uint256 agrId) internal {
        uint256 fee = da.getDisputeFeeState(agrId).feeRequired;
        uint256 bond = _calcExpectedBond(fee);
        vm.prank(arb1); da.acceptAssignment{value: bond}(agrId);
        vm.prank(arb2); da.acceptAssignment{value: bond}(agrId);
        vm.prank(arb3); da.acceptAssignment{value: bond}(agrId);
    }

    // ─── Panel selection ─────────────────────────────────────────────────────

    function test_AcceptAssignment_correct_bond_posted() public {
        uint256 fee = _openETHDispute(AGREEMENT_ID);
        uint256 expectedBond = _calcExpectedBond(fee);

        uint256 balBefore = arb1.balance;
        vm.prank(arb1);
        da.acceptAssignment{value: expectedBond}(AGREEMENT_ID);

        IDisputeArbitration.ArbitratorBondState memory bond =
            da.getArbitratorBondState(arb1, AGREEMENT_ID);
        assertTrue(bond.locked,                         "bond not locked");
        assertEq(bond.bondAmount, expectedBond,         "bond amount mismatch");
        assertFalse(bond.slashed,                       "should not be slashed");
        assertFalse(bond.returned,                      "should not be returned yet");
        assertEq(arb1.balance, balBefore - expectedBond, "ETH not deducted");
    }

    function test_AcceptAssignment_panel_size_enforced() public {
        _openETHDispute(AGREEMENT_ID);
        uint256 fee  = da.getDisputeFeeState(AGREEMENT_ID).feeRequired;
        uint256 bond = _calcExpectedBond(fee);
        vm.prank(arb1); da.acceptAssignment{value: bond}(AGREEMENT_ID);
        vm.prank(arb2); da.acceptAssignment{value: bond}(AGREEMENT_ID);
        vm.prank(arb3); da.acceptAssignment{value: bond}(AGREEMENT_ID);

        vm.prank(arb4);
        vm.expectRevert("DisputeArbitration: panel full");
        da.acceptAssignment{value: bond}(AGREEMENT_ID);
    }

    function test_AcceptAssignment_correct_panel_members_returned() public {
        _openETHDispute(AGREEMENT_ID);
        uint256 fee  = da.getDisputeFeeState(AGREEMENT_ID).feeRequired;
        uint256 bond = _calcExpectedBond(fee);
        vm.prank(arb1); da.acceptAssignment{value: bond}(AGREEMENT_ID);
        vm.prank(arb2); da.acceptAssignment{value: bond}(AGREEMENT_ID);

        address[] memory accepted = da.getAcceptedArbitrators(AGREEMENT_ID);
        assertEq(accepted.length, 2);
        assertEq(accepted[0], arb1);
        assertEq(accepted[1], arb2);
    }

    function test_AcceptAssignment_revert_double_accept() public {
        _openETHDispute(AGREEMENT_ID);
        uint256 fee  = da.getDisputeFeeState(AGREEMENT_ID).feeRequired;
        uint256 bond = _calcExpectedBond(fee);
        vm.prank(arb1); da.acceptAssignment{value: bond}(AGREEMENT_ID);

        vm.prank(arb1);
        vm.expectRevert("DisputeArbitration: already accepted");
        da.acceptAssignment{value: bond}(AGREEMENT_ID);
    }

    function test_AcceptAssignment_revert_dispute_not_active() public {
        // No open dispute yet
        vm.prank(arb1);
        vm.expectRevert("DisputeArbitration: dispute not active");
        da.acceptAssignment{value: 1 ether}(AGREEMENT_ID);
    }

    // ─── Bond posting — ETH path ─────────────────────────────────────────────

    function test_OpenDispute_ETH_fee_collected() public {
        uint256 fee = _feeETH(IDisputeArbitration.DisputeClass.HARD_FAILURE);
        uint256 balBefore = address(da).balance;

        vm.prank(saAddr);
        da.openDispute{value: fee}(
            AGREEMENT_ID,
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE,
            client, client, provider,
            AGREEMENT_PRICE, address(0)
        );

        assertEq(address(da).balance, balBefore + fee, "ETH not collected");

        IDisputeArbitration.DisputeFeeState memory fs = da.getDisputeFeeState(AGREEMENT_ID);
        assertTrue(fs.active,          "should be active");
        assertFalse(fs.resolved,       "should not be resolved");
        assertEq(fs.openerPaid, fee,   "UNILATERAL: opener pays full fee");
        assertEq(fs.feeRequired, fee);
        assertEq(fs.token, address(0));
    }

    function test_OpenDispute_ETH_mutual_opener_pays_half() public {
        uint256 fee = da.getFeeQuote(
            AGREEMENT_PRICE, address(0),
            IDisputeArbitration.DisputeMode.MUTUAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE
        );

        vm.prank(saAddr);
        da.openDispute{value: fee / 2}(
            AGREEMENT_ID,
            IDisputeArbitration.DisputeMode.MUTUAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE,
            client, client, provider,
            AGREEMENT_PRICE, address(0)
        );

        IDisputeArbitration.DisputeFeeState memory fs = da.getDisputeFeeState(AGREEMENT_ID);
        assertEq(fs.openerPaid, fee / 2, "MUTUAL: opener pays half");
    }

    // ─── Bond posting — ERC-20 path ──────────────────────────────────────────

    function test_OpenDispute_ERC20_fee_collected() public {
        uint256 fee = da.getFeeQuote(
            AGREEMENT_PRICE, address(token),
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE
        );
        // Opener approves DA
        vm.prank(client);
        token.approve(address(da), fee);

        uint256 balBefore = token.balanceOf(address(da));
        vm.prank(saAddr);
        da.openDispute(
            AGREEMENT_ID,
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE,
            client, client, provider,
            AGREEMENT_PRICE, address(token)
        );

        assertEq(token.balanceOf(address(da)), balBefore + fee, "ERC-20 not collected");
    }

    // ─── openDispute adversarial ─────────────────────────────────────────────

    function test_OpenDispute_revert_not_serviceAgreement() public {
        uint256 fee = _feeETH(IDisputeArbitration.DisputeClass.HARD_FAILURE);
        vm.prank(stranger);
        vm.expectRevert("DisputeArbitration: not ServiceAgreement");
        da.openDispute{value: fee}(
            AGREEMENT_ID,
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE,
            client, client, provider,
            AGREEMENT_PRICE, address(0)
        );
    }

    function test_OpenDispute_revert_duplicate() public {
        _openETHDispute(AGREEMENT_ID);
        uint256 fee = _feeETH(IDisputeArbitration.DisputeClass.HARD_FAILURE);

        vm.prank(saAddr);
        vm.expectRevert("DisputeArbitration: dispute already open");
        da.openDispute{value: fee}(
            AGREEMENT_ID,
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE,
            client, client, provider,
            AGREEMENT_PRICE, address(0)
        );
    }

    function test_OpenDispute_revert_no_token_rate() public {
        address badToken = address(0xDEAD);
        vm.prank(saAddr);
        vm.expectRevert("DisputeArbitration: no rate for token");
        da.openDispute(
            2,
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE,
            client, client, provider,
            AGREEMENT_PRICE, badToken
        );
    }

    // ─── Vote recording ───────────────────────────────────────────────────────

    function test_RecordArbitratorVote_succeeds_for_SA() public {
        _openETHDispute(AGREEMENT_ID);
        // Vote recording should not revert
        vm.prank(saAddr);
        da.recordArbitratorVote(AGREEMENT_ID, arb1);
    }

    function test_RecordArbitratorVote_revert_non_SA() public {
        _openETHDispute(AGREEMENT_ID);

        vm.prank(arb1);
        vm.expectRevert("DisputeArbitration: not ServiceAgreement");
        da.recordArbitratorVote(AGREEMENT_ID, arb1);
    }

    function test_RecordArbitratorVote_revert_stranger() public {
        _openETHDispute(AGREEMENT_ID);

        vm.prank(stranger);
        vm.expectRevert("DisputeArbitration: not ServiceAgreement");
        da.recordArbitratorVote(AGREEMENT_ID, arb1);
    }

    // ─── Resolution outcomes ─────────────────────────────────────────────────

    function test_ResolveDisputeFee_PROVIDER_WINS_writes_trust_success() public {
        _openETHDispute(AGREEMENT_ID);
        trustReg.initWallet(provider);
        uint256 scoreBefore = trustReg.getScore(provider);

        vm.prank(saAddr);
        da.resolveDisputeFee(AGREEMENT_ID, 2); // OUTCOME_PROVIDER_WINS

        // Provider score should increase
        uint256 scoreAfter = trustReg.getScore(provider);
        assertTrue(scoreAfter > scoreBefore, "provider score should increase on win");
    }

    function test_ResolveDisputeFee_CLIENT_REFUND_writes_trust_anomaly() public {
        _openETHDispute(AGREEMENT_ID);
        trustReg.initWallet(provider);
        uint256 scoreBefore = trustReg.getScore(provider);

        vm.prank(saAddr);
        da.resolveDisputeFee(AGREEMENT_ID, 3); // OUTCOME_CLIENT_REFUND

        uint256 scoreAfter = trustReg.getScore(provider);
        assertTrue(scoreAfter < scoreBefore, "provider score should decrease on loss");
    }

    function test_ResolveDisputeFee_SPLIT_no_trust_write() public {
        _openETHDispute(AGREEMENT_ID);
        trustReg.initWallet(provider);
        uint256 scoreBefore = trustReg.getScore(provider);

        vm.prank(saAddr);
        da.resolveDisputeFee(AGREEMENT_ID, 4); // OUTCOME_PARTIAL_PROVIDER — no trust write

        assertEq(trustReg.getScore(provider), scoreBefore, "split: no trust change");
    }

    function test_ResolveDisputeFee_MUTUAL_CANCEL_no_trust_write() public {
        _openETHDispute(AGREEMENT_ID);
        trustReg.initWallet(provider);
        uint256 scoreBefore = trustReg.getScore(provider);

        vm.prank(saAddr);
        da.resolveDisputeFee(AGREEMENT_ID, 6); // OUTCOME_MUTUAL_CANCEL

        assertEq(trustReg.getScore(provider), scoreBefore, "mutual cancel: no trust change");
    }

    function test_ResolveDisputeFee_voted_arbitrators_get_bond_plus_fee() public {
        _openETHDispute(AGREEMENT_ID);
        _acceptFull3Panel(AGREEMENT_ID);

        vm.prank(saAddr); da.recordArbitratorVote(AGREEMENT_ID, arb1);
        vm.prank(saAddr); da.recordArbitratorVote(AGREEMENT_ID, arb2);
        vm.prank(saAddr); da.recordArbitratorVote(AGREEMENT_ID, arb3);

        uint256 arb1Before = arb1.balance;

        vm.prank(saAddr);
        da.resolveDisputeFee(AGREEMENT_ID, 2);

        assertTrue(arb1.balance > arb1Before, "arb1 should receive bond + fee share");

        IDisputeArbitration.ArbitratorBondState memory bond =
            da.getArbitratorBondState(arb1, AGREEMENT_ID);
        assertTrue(bond.returned, "bond should be marked returned");
        assertFalse(bond.slashed, "voted arb should not be slashed");
    }

    function test_ResolveDisputeFee_non_voting_arbitrators_slashed_to_treasury() public {
        _openETHDispute(AGREEMENT_ID);
        uint256 fee  = da.getDisputeFeeState(AGREEMENT_ID).feeRequired;
        uint256 bond = _calcExpectedBond(fee);
        vm.prank(arb1); da.acceptAssignment{value: bond}(AGREEMENT_ID);
        vm.prank(arb2); da.acceptAssignment{value: bond}(AGREEMENT_ID);

        // Only arb1 votes; arb2 misses deadline
        vm.prank(saAddr); da.recordArbitratorVote(AGREEMENT_ID, arb1);

        uint256 treasuryBefore = treasury.balance;

        vm.prank(saAddr);
        da.resolveDisputeFee(AGREEMENT_ID, 2);

        IDisputeArbitration.ArbitratorBondState memory arb2Bond =
            da.getArbitratorBondState(arb2, AGREEMENT_ID);
        assertTrue(arb2Bond.slashed, "non-voting arb2 bond should be slashed");
        assertTrue(treasury.balance > treasuryBefore, "treasury should receive slashed bond");
    }

    function test_ResolveDisputeFee_no_panel_fee_goes_to_treasury() public {
        _openETHDispute(AGREEMENT_ID);
        // No arbitrators accepted

        uint256 treasuryBefore = treasury.balance;

        vm.prank(saAddr);
        da.resolveDisputeFee(AGREEMENT_ID, 2);

        assertTrue(treasury.balance > treasuryBefore, "all fee should go to treasury when no panel");
    }

    function test_ResolveDisputeFee_unilateral_winner_gets_partial_refund() public {
        uint256 fee = _openETHDispute(AGREEMENT_ID);
        // Client is opener; PROVIDER_WINS means client (opener) loses → no refund

        uint256 clientBefore = client.balance;

        vm.prank(saAddr);
        da.resolveDisputeFee(AGREEMENT_ID, 2); // PROVIDER_WINS → opener (client) loses

        // No refund to client since client opened and lost
        assertEq(client.balance, clientBefore, "losing opener should not receive refund");
    }

    // ─── resolveDisputeFee adversarial ───────────────────────────────────────

    function test_ResolveDisputeFee_revert_not_serviceAgreement() public {
        _openETHDispute(AGREEMENT_ID);

        vm.prank(stranger);
        vm.expectRevert("DisputeArbitration: not ServiceAgreement");
        da.resolveDisputeFee(AGREEMENT_ID, 2);
    }

    function test_ResolveDisputeFee_revert_double_resolve() public {
        _openETHDispute(AGREEMENT_ID);
        vm.prank(saAddr); da.resolveDisputeFee(AGREEMENT_ID, 2);

        vm.prank(saAddr);
        vm.expectRevert("DisputeArbitration: not active or already resolved");
        da.resolveDisputeFee(AGREEMENT_ID, 2);
    }

    function test_ResolveDisputeFee_revert_non_existent_dispute() public {
        vm.prank(saAddr);
        vm.expectRevert("DisputeArbitration: not active or already resolved");
        da.resolveDisputeFee(999, 2);
    }

    // ─── Fallback ────────────────────────────────────────────────────────────

    function test_TriggerFallback_mutual_unfunded_after_window() public {
        _openMutualETHDispute(AGREEMENT_ID);

        // Advance past MUTUAL_FUNDING_WINDOW (48 hours)
        vm.warp(block.timestamp + 49 hours);

        bool triggered = da.triggerFallback(AGREEMENT_ID);
        assertTrue(triggered, "fallback should return true");
    }

    function test_TriggerFallback_revert_conditions_not_met_unilateral() public {
        _openETHDispute(AGREEMENT_ID); // UNILATERAL mode

        vm.expectRevert("DisputeArbitration: fallback conditions not met");
        da.triggerFallback(AGREEMENT_ID);
    }

    function test_TriggerFallback_revert_mutual_still_within_window() public {
        _openMutualETHDispute(AGREEMENT_ID);
        // Don't advance time

        vm.expectRevert("DisputeArbitration: fallback conditions not met");
        da.triggerFallback(AGREEMENT_ID);
    }

    // ─── Admin slash ─────────────────────────────────────────────────────────

    function test_SlashArbitrator_sends_bond_to_treasury() public {
        _openETHDispute(AGREEMENT_ID);
        uint256 fee  = da.getDisputeFeeState(AGREEMENT_ID).feeRequired;
        uint256 bond = _calcExpectedBond(fee);
        vm.prank(arb1); da.acceptAssignment{value: bond}(AGREEMENT_ID);

        uint256 treasuryBefore = treasury.balance;
        da.slashArbitrator(AGREEMENT_ID, arb1, "rules-violation");

        IDisputeArbitration.ArbitratorBondState memory bs =
            da.getArbitratorBondState(arb1, AGREEMENT_ID);
        assertTrue(bs.slashed, "bond should be slashed");
        assertEq(treasury.balance, treasuryBefore + bond, "full bond to treasury");
    }

    function test_SlashArbitrator_revert_not_owner() public {
        _openETHDispute(AGREEMENT_ID);
        uint256 fee  = da.getDisputeFeeState(AGREEMENT_ID).feeRequired;
        uint256 bond = _calcExpectedBond(fee);
        vm.prank(arb1); da.acceptAssignment{value: bond}(AGREEMENT_ID);

        vm.prank(stranger);
        vm.expectRevert("DisputeArbitration: not owner");
        da.slashArbitrator(AGREEMENT_ID, arb1, "rules-violation");
    }

    function test_SlashArbitrator_revert_already_slashed() public {
        _openETHDispute(AGREEMENT_ID);
        uint256 fee  = da.getDisputeFeeState(AGREEMENT_ID).feeRequired;
        uint256 bond = _calcExpectedBond(fee);
        vm.prank(arb1); da.acceptAssignment{value: bond}(AGREEMENT_ID);

        da.slashArbitrator(AGREEMENT_ID, arb1, "first-violation");

        vm.expectRevert("DisputeArbitration: bond not slashable");
        da.slashArbitrator(AGREEMENT_ID, arb1, "second-slash-attempt");
    }

    // ─── Fee quote ────────────────────────────────────────────────────────────

    function test_FeeQuote_respects_floor() public view {
        // Small price → raw fee below floor → clamped to floor
        uint256 quote = da.getFeeQuote(
            0.001 ether, address(0),
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE
        );
        // floor = $5; ETH at $2000 → floor in ETH = 5/2000 ETH = 0.0025 ETH
        uint256 floorInETH = (da.feeFloorUsd18() * 1e18) / ETH_USD_RATE;
        assertEq(quote, floorInETH, "fee should equal floor for small price");
    }

    function test_FeeQuote_respects_cap() public view {
        // Very large price → raw fee exceeds cap → clamped to cap
        uint256 quote = da.getFeeQuote(
            1_000_000 ether, address(0),
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE
        );
        uint256 capInETH = (da.feeCapUsd18() * 1e18) / ETH_USD_RATE;
        assertEq(quote, capInETH, "fee should equal cap for huge price");
    }

    function test_FeeQuote_HIGH_SENSITIVITY_higher_than_HARD_FAILURE() public view {
        // Use moderate price where raw fee is between floor and cap/1.5
        // 1 ETH @ $2000 → $2000 * 3% = $60. HIGH_SENSITIVITY: $60 * 1.5 = $90 < $250 cap
        uint256 hardFee = da.getFeeQuote(
            1 ether, address(0),
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE
        );
        uint256 hiSensFee = da.getFeeQuote(
            1 ether, address(0),
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HIGH_SENSITIVITY
        );
        assertTrue(hiSensFee > hardFee, "HIGH_SENSITIVITY should have higher fee");
    }

    function test_FeeQuote_AMBIGUITY_between_hard_and_high() public view {
        uint256 hardFee = da.getFeeQuote(
            1 ether, address(0),
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE
        );
        uint256 ambiguityFee = da.getFeeQuote(
            1 ether, address(0),
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.AMBIGUITY_QUALITY
        );
        uint256 hiSensFee = da.getFeeQuote(
            1 ether, address(0),
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HIGH_SENSITIVITY
        );
        assertTrue(ambiguityFee >= hardFee);
        assertTrue(hiSensFee >= ambiguityFee);
    }

    function test_FeeQuote_revert_no_rate() public {
        vm.expectRevert("DisputeArbitration: no rate for token");
        da.getFeeQuote(
            AGREEMENT_PRICE, address(0xDEAD),
            IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE
        );
    }

    // ─── Arbitrator eligibility ──────────────────────────────────────────────

    function test_IsEligibleArbitrator_uninitialized_score_ineligible() public view {
        // score == 0 (not initialized) → ineligible
        assertFalse(da.isEligibleArbitrator(arb1));
    }

    function test_IsEligibleArbitrator_initialized_eligible() public {
        trustReg.initWallet(arb1); // score set to 100
        assertTrue(da.isEligibleArbitrator(arb1));
    }

    function test_IsEligibleArbitrator_zero_address_ineligible() public view {
        assertFalse(da.isEligibleArbitrator(address(0)));
    }

    // ─── Admin setters ────────────────────────────────────────────────────────

    function test_SetFeeFloorUsd_updates() public {
        da.setFeeFloorUsd(10e18);
        assertEq(da.feeFloorUsd18(), 10e18);
    }

    function test_SetFeeFloorUsd_revert_exceeds_cap() public {
        // Pre-compute before arming expectRevert (external call ordering)
        uint256 aboveCap = da.feeCapUsd18() + 1;
        vm.expectRevert("DisputeArbitration: floor exceeds cap");
        da.setFeeFloorUsd(aboveCap);
    }

    function test_SetFeeCapUsd_revert_below_floor() public {
        // Pre-compute before arming expectRevert (external call ordering)
        uint256 belowFloor = da.feeFloorUsd18() - 1;
        vm.expectRevert("DisputeArbitration: cap below floor");
        da.setFeeCapUsd(belowFloor);
    }

    function test_SetTreasury_revert_zero_address() public {
        vm.expectRevert("DisputeArbitration: zero treasury");
        da.setTreasury(address(0));
    }
}
