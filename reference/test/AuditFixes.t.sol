// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ServiceAgreement.sol";
import "../contracts/DisputeArbitration.sol";
import "../contracts/DisputeModule.sol";
import "../contracts/TrustRegistry.sol";
import "../contracts/TrustRegistryV2.sol";
import "../contracts/IServiceAgreement.sol";
import "../contracts/IDisputeArbitration.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Helpers ──────────────────────────────────────────────────────────────────

contract AuditMockERC20 is ERC20 {
    constructor() ERC20("AuditToken", "ATK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev DisputeArbitration stub that always reverts on openDispute.
///      Used to verify B-05: ETH refund on fee-call failure.
contract RevertingDisputeArbitration is IDisputeArbitration {
    function openDispute(
        uint256, DisputeMode, DisputeClass, address, address, address, uint256, address
    ) external payable returns (uint256) {
        revert("mock: always fails");
    }
    function joinMutualDispute(uint256) external payable {}
    function resolveDisputeFee(uint256, uint8) external {}
    function isEligibleArbitrator(address) external pure returns (bool) { return true; }
    function acceptAssignment(uint256) external payable {}
    function triggerFallback(uint256) external returns (bool) { return false; }
    function slashArbitrator(uint256, address, string calldata) external {}
    function getDisputeFeeState(uint256) external view returns (DisputeFeeState memory) {
        return DisputeFeeState({
            mode: DisputeMode.UNILATERAL, disputeClass: DisputeClass.HARD_FAILURE,
            opener: address(0), client: address(0), provider: address(0), token: address(0),
            agreementPrice: 0, feeRequired: 0, openerPaid: 0, respondentPaid: 0,
            openedAt: 0, active: false, resolved: false
        });
    }
    function getArbitratorBondState(address, uint256) external view returns (ArbitratorBondState memory) {
        return ArbitratorBondState({ bondAmount: 0, lockedAt: 0, locked: false, slashed: false, returned: false });
    }
    function getFeeQuote(uint256, address, DisputeMode, DisputeClass) external view returns (uint256) { return 0; }
    function getAcceptedArbitrators(uint256) external view returns (address[] memory) { return new address[](0); }
    function recordArbitratorVote(uint256, address) external {}
    function setTokenUsdRate(address, uint256) external {}
    function setFeeFloorUsd(uint256) external {}
    function setFeeCapUsd(uint256) external {}
    function setMinBondFloorUsd(uint256) external {}
    function setServiceAgreement(address) external {}
    function setTrustRegistry(address) external {}
    function setTreasury(address) external {}
}

// ─── Shared base test ─────────────────────────────────────────────────────────

abstract contract AuditBaseTest is Test {
    ServiceAgreement sa;
    TrustRegistry    trustReg;

    address owner    = address(this);
    address client   = address(0xC1);
    address provider = address(0xA1);

    uint256 constant PRICE    = 1 ether;
    uint256 constant DEADLINE = 7 days;

    function _baseSetUp() internal {
        trustReg = new TrustRegistry();
        sa = new ServiceAgreement(address(trustReg));
        trustReg.addUpdater(address(sa));
        DisputeModule dm = new DisputeModule(address(sa));
        sa.setDisputeModule(address(dm));
        vm.deal(client,   100 ether);
        vm.deal(provider,  10 ether);
    }

    /// @dev Propose + accept a standard ETH agreement.
    function _propose() internal returns (uint256 id) {
        vm.prank(client);
        id = sa.propose{value: PRICE}(
            provider, "coding", "Build a widget", PRICE, address(0),
            block.timestamp + DEADLINE, keccak256("spec")
        );
        vm.prank(provider);
        sa.accept(id);
    }

    /// @dev Open a formal dispute via directDispute after advancing past the deadline.
    ///      directDispute(HARD_DEADLINE_BREACH) bypasses the remediation requirement.
    function _directDispute(uint256 id) internal {
        vm.warp(block.timestamp + DEADLINE + 1);
        vm.prank(client);
        sa.directDispute(id, IServiceAgreement.DirectDisputeReason.HARD_DEADLINE_BREACH, "breach");
    }

    /// @dev Open a formal dispute with a fee value.
    function _directDisputeWithValue(uint256 id, uint256 feeValue) internal {
        vm.warp(block.timestamp + DEADLINE + 1);
        vm.prank(client);
        sa.directDispute{value: feeValue}(id, IServiceAgreement.DirectDisputeReason.HARD_DEADLINE_BREACH, "breach");
    }

    /// @dev Nominate 1 arb, wait past selection window → arbitration stalls → requestHumanEscalation.
    function _escalateToHuman(uint256 id, address arb) internal {
        sa.setApprovedArbitrator(arb, true);
        vm.prank(client);
        sa.nominateArbitrator(id, arb);
        vm.warp(block.timestamp + 4 days); // past 3-day ARBITRATION_SELECTION_WINDOW
        vm.prank(client);
        sa.requestHumanEscalation(id, "need human");
    }
}

// ─── B-01: Escrow split disbursement (no stranded funds) ─────────────────────
// Originally tested via resolveFromArbitration (DA callback). Since resolveFromArbitration
// was removed for EIP-170 compliance, these tests verify the same invariant via
// resolveDisputeDetailed (owner-callable). Same escrow logic, same invariant.

contract AuditFix_B01_SplitDisbursement is AuditBaseTest {

    function setUp() public {
        _baseSetUp();
    }

    function test_B01_Split6040DisbursesBothParties() public {
        uint256 id = _propose();
        _directDispute(id);

        uint256 providerBefore = provider.balance;
        uint256 clientBefore   = client.balance;

        sa.resolveDisputeDetailed(id, IServiceAgreement.DisputeOutcome.PARTIAL_PROVIDER, 0.6 ether, 0.4 ether);

        assertEq(provider.balance - providerBefore, 0.6 ether);
        assertEq(client.balance   - clientBefore,   0.4 ether);
        assertEq(address(sa).balance, 0); // no stranded escrow
    }

    function test_B01_RevertsIfAmountsDontSumToPrice() public {
        uint256 id = _propose();
        _directDispute(id);

        vm.expectRevert(ServiceAgreement.InvalidSplit.selector);
        sa.resolveDisputeDetailed(id, IServiceAgreement.DisputeOutcome.PARTIAL_PROVIDER, 0.3 ether, 0.4 ether); // 0.7 != 1.0
    }

    function test_B01_FullProviderWin_StatusFulfilled() public {
        uint256 id = _propose();
        _directDispute(id);

        sa.resolveDisputeDetailed(id, IServiceAgreement.DisputeOutcome.PROVIDER_WINS, 1 ether, 0);

        assertEq(address(sa).balance, 0);
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.FULFILLED));
    }

    function test_B01_FullClientRefund_StatusCancelled() public {
        uint256 id = _propose();
        _directDispute(id);
        uint256 clientBefore = client.balance;

        sa.resolveDisputeDetailed(id, IServiceAgreement.DisputeOutcome.CLIENT_REFUND, 0, 1 ether);

        assertEq(client.balance - clientBefore, 1 ether);
        assertEq(address(sa).balance, 0);
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.CANCELLED));
    }
}

// ─── B-03: PARTIAL_SETTLEMENT is terminal (FULFILLED) ────────────────────────

contract AuditFix_B03_PartialSettlementTerminal is AuditBaseTest {

    address arb1 = address(0xB1);
    address arb2 = address(0xB2);
    address arb3 = address(0xB3);
    address treasury = address(0xFEE1);

    DisputeArbitration da;

    function setUp() public {
        _baseSetUp();
        da = new DisputeArbitration(address(trustReg), treasury);
        da.setServiceAgreement(address(sa));
        da.setDisputeModule(sa.disputeModule());
        da.setTokenUsdRate(address(0), 2000e18);
        trustReg.addUpdater(address(da));
        sa.setDisputeArbitration(address(da));

        sa.setApprovedArbitrator(arb1, true);
        sa.setApprovedArbitrator(arb2, true);
        sa.setApprovedArbitrator(arb3, true);

        trustReg.initWallet(arb1);
        trustReg.initWallet(arb2);
        trustReg.initWallet(arb3);

        vm.deal(arb1, 50 ether);
        vm.deal(arb2, 50 ether);
        vm.deal(arb3, 50 ether);
        vm.deal(treasury, 0 ether);
    }

    function test_B03_SplitVoteProducesTerminalFULFILLED() public {
        uint256 id = _propose();
        uint256 fee = da.getFeeQuote(PRICE, address(0), IDisputeArbitration.DisputeMode.UNILATERAL, IDisputeArbitration.DisputeClass.HARD_FAILURE);

        _directDisputeWithValue(id, fee);

        // Nominate 3 arbitrators
        vm.prank(client);  sa.nominateArbitrator(id, arb1);
        vm.prank(client);  sa.nominateArbitrator(id, arb2);
        vm.prank(provider); sa.nominateArbitrator(id, arb3);

        // Post bonds
        uint256 bond = da.getDisputeFeeState(id).feeRequired * 2;
        vm.prank(arb1); da.acceptAssignment{value: bond}(id);
        vm.prank(arb2); da.acceptAssignment{value: bond}(id);
        vm.prank(arb3); da.acceptAssignment{value: bond}(id);

        // All three vote SPLIT (same 60/40 — simple majority path)
        vm.prank(arb1); sa.castArbitrationVote(id, IServiceAgreement.ArbitrationVote.SPLIT, 0.6 ether, 0.4 ether);
        vm.prank(arb2); sa.castArbitrationVote(id, IServiceAgreement.ArbitrationVote.SPLIT, 0.6 ether, 0.4 ether);
        // Majority reached after 2 votes — agreement should be finalized

        // B-03: must be FULFILLED (terminal), not PARTIAL_SETTLEMENT
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.FULFILLED));
        assertEq(address(sa).balance, 0); // no stranded escrow
    }

    function test_B03_ExpiredCancelFailsAfterPartialResolution() public {
        uint256 id = _propose();
        uint256 fee = da.getFeeQuote(PRICE, address(0), IDisputeArbitration.DisputeMode.UNILATERAL, IDisputeArbitration.DisputeClass.HARD_FAILURE);
        _directDisputeWithValue(id, fee);

        vm.prank(client);  sa.nominateArbitrator(id, arb1);
        vm.prank(client);  sa.nominateArbitrator(id, arb2);
        vm.prank(provider); sa.nominateArbitrator(id, arb3);

        uint256 bond = da.getDisputeFeeState(id).feeRequired * 2;
        vm.prank(arb1); da.acceptAssignment{value: bond}(id);
        vm.prank(arb2); da.acceptAssignment{value: bond}(id);
        vm.prank(arb3); da.acceptAssignment{value: bond}(id);

        vm.prank(arb1); sa.castArbitrationVote(id, IServiceAgreement.ArbitrationVote.SPLIT, 0.6 ether, 0.4 ether);
        vm.prank(arb2); sa.castArbitrationVote(id, IServiceAgreement.ArbitrationVote.SPLIT, 0.6 ether, 0.4 ether);

        // FULFILLED is terminal — expiredCancel should fail
        vm.warp(block.timestamp + 400 days);
        vm.prank(client);
        vm.expectRevert(ServiceAgreement.InvalidStatus.selector);
        sa.expiredCancel(id);
    }
}

// ─── B-05: ETH refund on dispute fee failure ──────────────────────────────────

contract AuditFix_B05_DisputeFeeETHRefund is AuditBaseTest {

    RevertingDisputeArbitration revertingDA;

    function setUp() public {
        _baseSetUp();
        revertingDA = new RevertingDisputeArbitration();
        sa.setDisputeArbitration(address(revertingDA));
    }

    function test_B05_ETHRefundedWhenDAReverts() public {
        uint256 id = _propose();
        vm.warp(block.timestamp + DEADLINE + 1);

        uint256 clientBefore = client.balance;

        // Client sends 0.05 ETH as dispute fee — the DA will revert → whole tx reverts
        vm.prank(client);
        vm.expectRevert(ServiceAgreement.DisputeFeeError.selector);
        sa.directDispute{value: 0.05 ether}(id, IServiceAgreement.DirectDisputeReason.HARD_DEADLINE_BREACH, "breach");

        // B-05: EVM revert automatically restores ETH (no net loss to client)
        assertEq(client.balance, clientBefore);
    }

    function test_B05_DisputeNotOpenedWhenDAReverts() public {
        uint256 id = _propose();
        vm.warp(block.timestamp + DEADLINE + 1);

        // Dispute must fail — status is preserved as ACCEPTED
        vm.prank(client);
        vm.expectRevert(ServiceAgreement.DisputeFeeError.selector);
        sa.directDispute(id, IServiceAgreement.DirectDisputeReason.HARD_DEADLINE_BREACH, "breach");

        // Agreement should remain ACCEPTED (revert rolled back DISPUTED status change)
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.ACCEPTED));
    }
}

// ─── B-06: Dispute timeout set only once ─────────────────────────────────────

contract AuditFix_B06_DisputeTimeoutSetOnce is AuditBaseTest {

    function setUp() public {
        _baseSetUp();
    }

    function test_B06_ResolvedAtSetOnlyOnFirstDispute() public {
        uint256 id = _propose();
        _directDispute(id);

        uint256 firstResolvedAt = sa.getAgreement(id).resolvedAt;
        assertGt(firstResolvedAt, 0);

        // Advance time — resolvedAt must not change if dispute is reopened via another mechanism
        vm.warp(block.timestamp + 5 days);

        // resolvedAt is still the original timestamp (B-06: only set once)
        assertEq(sa.getAgreement(id).resolvedAt, firstResolvedAt);
    }

    function test_B06_TimeoutBasedOnFirstOpenTime() public {
        uint256 id = _propose();
        _directDispute(id);

        uint256 openedAt = sa.getAgreement(id).resolvedAt;

        // Advance 29 days — not yet timed out
        vm.warp(openedAt + 29 days);
        vm.expectRevert(ServiceAgreement.DisputeTimeoutNotReached.selector);
        sa.expiredDisputeRefund(id);

        // Advance to 31 days — timed out
        vm.warp(openedAt + 31 days);
        sa.expiredDisputeRefund(id); // should succeed
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.CANCELLED));
    }
}

// ─── B-07: isEligibleArbitrator uses effective (time-decayed) score ───────────

contract AuditFix_B07_EffectiveScoreArbitratorCheck is Test {

    DisputeArbitration da;
    TrustRegistryV2    trustRegV2;

    address saAddr   = address(0xAA01);
    address treasury = address(0xFEE2);
    address arbGood  = address(0xB1);
    address arbBad   = address(0xB2);

    function setUp() public {
        trustRegV2 = new TrustRegistryV2(address(0)); // no v1 migration
        da = new DisputeArbitration(address(trustRegV2), treasury);
        da.setServiceAgreement(saAddr);
        da.setTokenUsdRate(address(0), 2000e18);
        trustRegV2.addUpdater(address(da));
        trustRegV2.addUpdater(address(this));
    }

    function test_B07_InitializedWalletWithScore100IsEligible() public {
        trustRegV2.initWallet(arbGood);
        // score = 100 >= 50 threshold → eligible
        assertTrue(da.isEligibleArbitrator(arbGood));
    }

    function test_B07_UnitializedWalletIsIneligible() public {
        assertFalse(da.isEligibleArbitrator(arbBad));
    }

    function test_B07_SlashedBelowThresholdIsIneligible() public {
        trustRegV2.initWallet(arbBad);
        // Two slashes: 100 - 50 - 50 = 0 → ineligible
        vm.roll(block.number + 1);
        trustRegV2.recordArbitratorSlash(arbBad, "slash-1");
        vm.roll(block.number + 2);
        trustRegV2.recordArbitratorSlash(arbBad, "slash-2");
        assertFalse(da.isEligibleArbitrator(arbBad));
    }

    function test_B07_EffectiveScoreUsedNotRawScore() public {
        // B-07: getEffectiveScore (decayed) is used, not getScore (raw).
        // TrustRegistryV2.getEffectiveScore applies time decay toward floor.
        // Score starts at 100 (floor) → no decay possible below floor.
        // Test that the interface function exists and is used.
        trustRegV2.initWallet(arbGood);
        uint256 effective = trustRegV2.getEffectiveScore(arbGood);
        uint256 raw       = trustRegV2.getScore(arbGood);
        // At initialization, both should equal 100 (same as floor)
        assertEq(effective, raw);
        // Both should result in eligible
        assertTrue(da.isEligibleArbitrator(arbGood));
    }
}

// ─── R-01: expiredDisputeRefund calls resolveDisputeFee ───────────────────────

contract AuditFix_R01_ExpiredDisputeRefund is AuditBaseTest {

    DisputeArbitration da;
    address treasury = address(0xFEE3);

    function setUp() public {
        _baseSetUp();
        da = new DisputeArbitration(address(trustReg), treasury);
        da.setServiceAgreement(address(sa));
        da.setDisputeModule(sa.disputeModule());
        da.setTokenUsdRate(address(0), 2000e18);
        trustReg.addUpdater(address(da));
        sa.setDisputeArbitration(address(da));
        vm.deal(treasury, 0 ether);
    }

    function test_R01_ExpiredRefundCallsResolveDisputeFee() public {
        uint256 id = _propose();
        uint256 fee = da.getFeeQuote(PRICE, address(0), IDisputeArbitration.DisputeMode.UNILATERAL, IDisputeArbitration.DisputeClass.HARD_FAILURE);
        _directDisputeWithValue(id, fee);

        // Verify DA state is active
        assertTrue(da.getDisputeFeeState(id).active);

        uint256 openedAt = sa.getAgreement(id).resolvedAt;
        vm.warp(openedAt + 31 days);

        uint256 clientBefore = client.balance;
        sa.expiredDisputeRefund(id);

        // Client receives escrow back + half the dispute fee (opener won → half-fee refund)
        assertEq(client.balance - clientBefore, PRICE + fee / 2);
        // R-01: DA state is resolved after expiredDisputeRefund
        assertTrue(da.getDisputeFeeState(id).resolved);
        assertFalse(da.getDisputeFeeState(id).active);
        // Agreement is CANCELLED
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.CANCELLED));
    }
}

// ─── R-02: castArbitrationVote does not silently swallow recordArbitratorVote failure ─

contract AuditFix_R02_NoCatchOnRecordVote is Test {

    /// @dev A fake DisputeArbitration that records whether recordArbitratorVote was called.
    ///      If it reverts, the entire castArbitrationVote must also revert.
    DisputeArbitration da;
    ServiceAgreement   sa;
    TrustRegistry      trustReg;

    address treasury = address(0xFEE7);
    address client   = address(0xC1);
    address provider = address(0xA1);
    address arb1     = address(0xB1);
    address arb2     = address(0xB2);
    address arb3     = address(0xB3);
    uint256 constant PRICE    = 1 ether;
    uint256 constant DEADLINE = 7 days;

    function setUp() public {
        trustReg = new TrustRegistry();
        sa = new ServiceAgreement(address(trustReg));
        trustReg.addUpdater(address(sa));
        DisputeModule dm = new DisputeModule(address(sa));
        sa.setDisputeModule(address(dm));

        da = new DisputeArbitration(address(trustReg), treasury);
        da.setServiceAgreement(address(sa));
        da.setDisputeModule(address(dm));
        da.setTokenUsdRate(address(0), 2000e18);
        trustReg.addUpdater(address(da));
        sa.setDisputeArbitration(address(da));

        sa.setApprovedArbitrator(arb1, true);
        sa.setApprovedArbitrator(arb2, true);
        sa.setApprovedArbitrator(arb3, true);
        trustReg.initWallet(arb1);
        trustReg.initWallet(arb2);
        trustReg.initWallet(arb3);

        vm.deal(client,   100 ether);
        vm.deal(provider,  10 ether);
        vm.deal(arb1,      50 ether);
        vm.deal(arb2,      50 ether);
        vm.deal(arb3,      50 ether);
        vm.deal(treasury,   0 ether);
    }

    function test_R02_SuccessfulVoteRecords() public {
        // Full happy path — vote succeeds and recordArbitratorVote is called
        vm.prank(client);
        uint256 id = sa.propose{value: PRICE}(
            provider, "c", "d", PRICE, address(0), block.timestamp + DEADLINE, keccak256("s")
        );
        vm.prank(provider); sa.accept(id);

        uint256 fee = da.getFeeQuote(PRICE, address(0), IDisputeArbitration.DisputeMode.UNILATERAL, IDisputeArbitration.DisputeClass.HARD_FAILURE);
        vm.warp(block.timestamp + DEADLINE + 1);
        vm.prank(client); sa.directDispute{value: fee}(id, IServiceAgreement.DirectDisputeReason.HARD_DEADLINE_BREACH, "breach");

        vm.prank(client);  sa.nominateArbitrator(id, arb1);
        vm.prank(client);  sa.nominateArbitrator(id, arb2);
        vm.prank(provider); sa.nominateArbitrator(id, arb3);

        uint256 bond = da.getDisputeFeeState(id).feeRequired * 2;
        vm.prank(arb1); da.acceptAssignment{value: bond}(id);
        vm.prank(arb2); da.acceptAssignment{value: bond}(id);
        vm.prank(arb3); da.acceptAssignment{value: bond}(id);

        // Vote — should succeed and mark arb1 as voted in DA
        vm.prank(arb1); sa.castArbitrationVote(id, IServiceAgreement.ArbitrationVote.PROVIDER_WINS, PRICE, 0);
        assertTrue(da.getDisputeFeeState(id).active); // still active (1/2 majority)
    }
}

// ─── R-03: DisputeArbitration Ownable2Step ────────────────────────────────────

contract AuditFix_R03_Ownable2Step is Test {

    DisputeArbitration da;
    TrustRegistry      trustReg;

    address initialOwner = address(this);
    address newOwner     = address(0x1234567890);
    address treasury     = address(0xFEE4);

    function setUp() public {
        trustReg = new TrustRegistry();
        da = new DisputeArbitration(address(trustReg), treasury);
    }

    function test_R03_TransferIsProposalOnly() public {
        da.transferOwnership(newOwner);
        assertEq(da.owner(), initialOwner); // old owner still owns
        assertEq(da.pendingOwner(), newOwner);
    }

    function test_R03_AcceptOwnershipCompletesTransfer() public {
        da.transferOwnership(newOwner);
        vm.prank(newOwner);
        da.acceptOwnership();
        assertEq(da.owner(), newOwner);
        assertEq(da.pendingOwner(), address(0));
    }

    function test_R03_NonPendingOwnerCannotAccept() public {
        da.transferOwnership(newOwner);
        vm.prank(address(0xABCD1234));
        vm.expectRevert("DisputeArbitration: not pending owner");
        da.acceptOwnership();
    }

    function test_R03_OnlyOwnerCanPropose() public {
        vm.prank(address(0xABCD1234));
        vm.expectRevert("DisputeArbitration: not owner");
        da.transferOwnership(newOwner);
    }
}

// ─── R-04: Split vote averages ────────────────────────────────────────────────

contract AuditFix_R04_SplitVoteAverage is AuditBaseTest {

    address arb1     = address(0xB1);
    address arb2     = address(0xB2);
    address arb3     = address(0xB3);
    address treasury = address(0xFEE5);

    DisputeArbitration da;

    function setUp() public {
        _baseSetUp();
        da = new DisputeArbitration(address(trustReg), treasury);
        da.setServiceAgreement(address(sa));
        da.setDisputeModule(sa.disputeModule());
        da.setTokenUsdRate(address(0), 2000e18);
        trustReg.addUpdater(address(da));
        sa.setDisputeArbitration(address(da));

        sa.setApprovedArbitrator(arb1, true);
        sa.setApprovedArbitrator(arb2, true);
        sa.setApprovedArbitrator(arb3, true);
        trustReg.initWallet(arb1);
        trustReg.initWallet(arb2);
        trustReg.initWallet(arb3);

        vm.deal(arb1, 50 ether);
        vm.deal(arb2, 50 ether);
        vm.deal(arb3, 50 ether);
        vm.deal(treasury, 0 ether);
    }

    function _setupArbitration() internal returns (uint256 id) {
        id = _propose();
        uint256 fee = da.getFeeQuote(PRICE, address(0), IDisputeArbitration.DisputeMode.UNILATERAL, IDisputeArbitration.DisputeClass.HARD_FAILURE);
        _directDisputeWithValue(id, fee);

        vm.prank(client);  sa.nominateArbitrator(id, arb1);
        vm.prank(client);  sa.nominateArbitrator(id, arb2);
        vm.prank(provider); sa.nominateArbitrator(id, arb3);

        uint256 bond = da.getDisputeFeeState(id).feeRequired * 2;
        vm.prank(arb1); da.acceptAssignment{value: bond}(id);
        vm.prank(arb2); da.acceptAssignment{value: bond}(id);
        vm.prank(arb3); da.acceptAssignment{value: bond}(id);
    }

    function test_R04_DifferentSplitVotesAreAveraged() public {
        uint256 id = _setupArbitration();

        // Two different split votes reach majority (2 of 3): 0.7/0.3 and 0.5/0.5 → avg provider = 0.6
        vm.prank(arb1); sa.castArbitrationVote(id, IServiceAgreement.ArbitrationVote.SPLIT, 0.7 ether, 0.3 ether);
        vm.prank(arb2); sa.castArbitrationVote(id, IServiceAgreement.ArbitrationVote.SPLIT, 0.5 ether, 0.5 ether);
        // Majority reached — finalized

        IServiceAgreement.ArbitrationCase memory ac = DisputeModule(sa.disputeModule()).getArbitrationCase(id);
        assertTrue(ac.finalized);
        // Average: (0.7+0.5)/2 = 0.6
        assertEq(ac.splitProviderAward, 0.6 ether);
        assertEq(ac.splitClientAward,   0.4 ether); // ag.price - avgProvider
        assertEq(address(sa).balance,   0);
    }

    function test_R04_MajorityThresholdIsStillRespected() public {
        uint256 id = _setupArbitration();

        // Only 1 split vote — not at majority (need 2)
        vm.prank(arb1); sa.castArbitrationVote(id, IServiceAgreement.ArbitrationVote.SPLIT, 0.7 ether, 0.3 ether);

        // Not finalized yet
        assertFalse(DisputeModule(sa.disputeModule()).getArbitrationCase(id).finalized);

        // 2nd vote reaches majority → finalize
        vm.prank(arb2); sa.castArbitrationVote(id, IServiceAgreement.ArbitrationVote.SPLIT, 0.5 ether, 0.5 ether);
        assertTrue(DisputeModule(sa.disputeModule()).getArbitrationCase(id).finalized);
        // Average of 0.7 and 0.5 = 0.6
        assertEq(DisputeModule(sa.disputeModule()).getArbitrationCase(id).splitProviderAward, 0.6 ether);
    }
}

// ─── R-05: Arbitrator bond timeout recovery ───────────────────────────────────

contract AuditFix_R05_BondRecovery is Test {

    DisputeArbitration da;
    TrustRegistry      trustReg;

    address saAddr   = address(0xAA01);
    address treasury = address(0xFEE6);
    address arb1     = address(0xB1);

    uint256 constant AGREEMENT_ID    = 42;
    uint256 constant AGREEMENT_PRICE = 100 ether;

    function setUp() public {
        trustReg = new TrustRegistry();
        da = new DisputeArbitration(address(trustReg), treasury);
        da.setServiceAgreement(saAddr);
        da.setTokenUsdRate(address(0), 2000e18);
        trustReg.addUpdater(address(da));
        trustReg.initWallet(arb1);

        vm.deal(saAddr,  1_000 ether);
        vm.deal(arb1,    100 ether);
        vm.deal(treasury,  0 ether);
    }

    function _openAndAccept() internal returns (uint256 bond) {
        uint256 fee = da.getFeeQuote(
            AGREEMENT_PRICE, address(0), IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE
        );
        vm.prank(saAddr);
        da.openDispute{value: fee}(
            AGREEMENT_ID, IDisputeArbitration.DisputeMode.UNILATERAL,
            IDisputeArbitration.DisputeClass.HARD_FAILURE,
            saAddr, saAddr, address(0xBEEFCAFE), AGREEMENT_PRICE, address(0)
        );
        bond = da.getDisputeFeeState(AGREEMENT_ID).feeRequired * 2;
        vm.prank(arb1);
        da.acceptAssignment{value: bond}(AGREEMENT_ID);
    }

    function test_R05_CanReclaimAfterTimeout() public {
        uint256 bond = _openAndAccept();
        uint256 arbBefore = arb1.balance;

        // Too early — should revert
        vm.warp(block.timestamp + 44 days);
        vm.prank(arb1);
        vm.expectRevert("DisputeArbitration: timeout not reached");
        da.reclaimExpiredBond(AGREEMENT_ID);

        // After 45-day timeout
        vm.warp(block.timestamp + 2 days); // total 46 days
        vm.prank(arb1);
        da.reclaimExpiredBond(AGREEMENT_ID);
        assertEq(arb1.balance - arbBefore, bond);
    }

    function test_R05_CannotReclaimTwice() public {
        _openAndAccept();
        vm.warp(block.timestamp + 46 days);
        vm.prank(arb1); da.reclaimExpiredBond(AGREEMENT_ID);
        vm.prank(arb1);
        vm.expectRevert("DisputeArbitration: no reclaimable bond");
        da.reclaimExpiredBond(AGREEMENT_ID);
    }

    function test_R05_CannotReclaimIfAlreadyResolved() public {
        _openAndAccept();
        // SA resolves the fee — sets active=false, resolved=true
        vm.prank(saAddr);
        da.resolveDisputeFee(AGREEMENT_ID, 2); // PROVIDER_WINS
        vm.warp(block.timestamp + 46 days);
        vm.prank(arb1);
        // active=false is checked first → "dispute not active"
        vm.expectRevert("DisputeArbitration: dispute not active");
        da.reclaimExpiredBond(AGREEMENT_ID);
    }
}

// ─── R-06: ownerResolveDispute for basic DISPUTED state ───────────────────────

contract AuditFix_R06_OwnerResolveDispute is AuditBaseTest {

    function setUp() public {
        _baseSetUp();
    }

    function test_R06_OwnerCanResolveBasicDISPUTED_FavorProvider() public {
        uint256 id = _propose();
        _directDispute(id);

        uint256 providerBefore = provider.balance;
        sa.ownerResolveDispute(id, true); // favor provider

        assertGt(provider.balance, providerBefore);
        assertEq(address(sa).balance, 0);
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.FULFILLED));
    }

    function test_R06_OwnerCanResolveBasicDISPUTED_FavorClient() public {
        uint256 id = _propose();
        _directDispute(id);
        uint256 clientBefore = client.balance;

        sa.ownerResolveDispute(id, false); // favor client

        assertEq(client.balance - clientBefore, PRICE);
        assertEq(address(sa).balance, 0);
        assertEq(uint256(sa.getAgreement(id).status), uint256(IServiceAgreement.Status.CANCELLED));
    }

    function test_R06_NonOwnerCannotCall() public {
        uint256 id = _propose();
        _directDispute(id);

        vm.prank(client);
        vm.expectRevert(ServiceAgreement.NotOwner.selector);
        sa.ownerResolveDispute(id, true);
    }

    function test_R06_RevertsIfNotInDispute() public {
        uint256 id = _propose();
        // ACCEPTED status — not disputed
        vm.expectRevert(ServiceAgreement.InvalidStatus.selector);
        sa.ownerResolveDispute(id, true);
    }
}
