// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ServiceAgreement v2 Feature Tests
 * @notice Tests for:
 *   Feature 1 — Minimum Trust Value (anti-farming)
 *   Feature 2 — Commit-Reveal Delivery (two-step verify flow)
 *
 * @dev Run with: forge test --match-path "test/ServiceAgreement.v2.t.sol" -vv
 */

import "forge-std/Test.sol";
import "../contracts/ServiceAgreement.sol";
import "../contracts/TrustRegistry.sol";
import "../contracts/IServiceAgreement.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Mock ERC-20 ──────────────────────────────────────────────────────────────

contract MockERC20v2 is ERC20 {
    constructor() ERC20("MockToken", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE 1: MINIMUM TRUST VALUE
// ═══════════════════════════════════════════════════════════════════════════════

contract MinimumTrustValueTest is Test {

    ServiceAgreement public sa;
    TrustRegistry    public trustReg;

    address public owner    = address(this);
    address public client   = address(0xC1);
    address public provider = address(0xA1);

    uint256 constant DEADLINE        = 7 days;
    uint256 constant MINIMUM         = 0.01 ether;   // 1e16 wei
    uint256 constant SMALL_PRICE     = 1;             // 1 wei — below minimum
    uint256 constant LARGE_PRICE     = 1 ether;       // above minimum
    bytes32 constant SPEC_HASH       = keccak256("spec-v1");
    bytes32 constant DELIVERY_HASH   = keccak256("delivery-v1");

    function setUp() public {
        trustReg = new TrustRegistry();
        sa       = new ServiceAgreement(address(trustReg));
        sa.setLegacyFulfillMode(true);
        sa.setLegacyFulfillProvider(provider, true);
        trustReg.addUpdater(address(sa));

        vm.deal(client,   100 ether);
        vm.deal(provider, 10 ether);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _propose(uint256 price) internal returns (uint256 id) {
        vm.prank(client);
        id = sa.propose{value: price}(
            provider,
            "text-generation",
            "Generate article",
            price,
            address(0),
            block.timestamp + DEADLINE,
            SPEC_HASH
        );
    }

    function _proposeAndAccept(uint256 price) internal returns (uint256 id) {
        id = _propose(price);
        vm.prank(provider);
        sa.accept(id);
    }

    // ─── Tests ───────────────────────────────────────────────────────────────

    /**
     * @notice Small agreement (1 wei) below minimumTrustValue=0.01 ETH.
     *         Agreement fulfills and releases escrow normally,
     *         but trust score must NOT be updated.
     */
    function test_MinimumTrustValue_SmallAgreement_NoTrustUpdate() public {
        sa.setMinimumTrustValue(MINIMUM);
        assertEq(sa.minimumTrustValue(), MINIMUM);

        uint256 id = _proposeAndAccept(SMALL_PRICE);

        uint256 scoreBefore = trustReg.getScore(provider);
        uint256 providerBefore = provider.balance;

        vm.prank(provider);
        sa.fulfill(id, DELIVERY_HASH);

        // Escrow released normally
        assertEq(provider.balance, providerBefore + SMALL_PRICE);

        // Agreement FULFILLED
        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.FULFILLED));

        // Trust score UNCHANGED — price < minimumTrustValue
        assertEq(trustReg.getScore(provider), scoreBefore,
            "Trust score must not update for sub-minimum agreements");
    }

    /**
     * @notice Large agreement (1 ETH) above minimumTrustValue=0.01 ETH.
     *         Agreement fulfills and trust score IS updated.
     */
    function test_MinimumTrustValue_LargeAgreement_TrustUpdates() public {
        sa.setMinimumTrustValue(MINIMUM);

        uint256 id = _proposeAndAccept(LARGE_PRICE);

        uint256 scoreBefore = trustReg.getScore(provider);

        vm.prank(provider);
        sa.fulfill(id, DELIVERY_HASH);

        // Trust score incremented — price >= minimumTrustValue
        assertEq(
            trustReg.getScore(provider),
            scoreBefore + trustReg.INITIAL_SCORE() + trustReg.INCREMENT(),
            "Trust score must increment for agreements at or above minimum"
        );
    }

    /**
     * @notice minimumTrustValue = 0 disables the threshold entirely.
     *         Even a 1-wei agreement updates trust.
     */
    function test_MinimumTrustValue_Disabled() public {
        // minimumTrustValue defaults to 0 (disabled)
        assertEq(sa.minimumTrustValue(), 0);

        uint256 id = _proposeAndAccept(SMALL_PRICE);

        uint256 scoreBefore = trustReg.getScore(provider);

        vm.prank(provider);
        sa.fulfill(id, DELIVERY_HASH);

        // Trust score incremented — threshold disabled
        assertGt(
            trustReg.getScore(provider),
            scoreBefore,
            "Trust score must update when minimumTrustValue=0"
        );
    }

    /**
     * @notice setMinimumTrustValue emits MinimumTrustValueUpdated event.
     */
    function test_MinimumTrustValue_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit ServiceAgreement.MinimumTrustValueUpdated(MINIMUM);
        sa.setMinimumTrustValue(MINIMUM);
    }

    /**
     * @notice Only owner may call setMinimumTrustValue.
     */
    function test_MinimumTrustValue_OnlyOwner() public {
        vm.prank(client);
        vm.expectRevert("ServiceAgreement: not owner");
        sa.setMinimumTrustValue(MINIMUM);
    }

    /**
     * @notice Exactly at the minimum threshold: trust is updated.
     */
    function test_MinimumTrustValue_ExactlyAtMinimum_TrustUpdates() public {
        sa.setMinimumTrustValue(MINIMUM);

        uint256 id = _proposeAndAccept(MINIMUM); // price == minimumTrustValue

        uint256 scoreBefore = trustReg.getScore(provider);

        vm.prank(provider);
        sa.fulfill(id, DELIVERY_HASH);

        assertGt(
            trustReg.getScore(provider),
            scoreBefore,
            "Trust score must update when price == minimumTrustValue"
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE 2: COMMIT-REVEAL DELIVERY
// ═══════════════════════════════════════════════════════════════════════════════

contract CommitRevealTest is Test {

    ServiceAgreement public sa;
    TrustRegistry    public trustReg;

    address public owner    = address(this);
    address public client   = address(0xC1);
    address public provider = address(0xA1);
    address public stranger = address(0xBEEF);

    uint256 constant PRICE         = 1 ether;
    uint256 constant DEADLINE      = 14 days;
    bytes32 constant SPEC_HASH     = keccak256("spec-v1");
    bytes32 constant DELIVERY_HASH = keccak256("delivery-v1");

    function setUp() public {
        trustReg = new TrustRegistry();
        sa       = new ServiceAgreement(address(trustReg));
        sa.setLegacyFulfillMode(true);
        sa.setLegacyFulfillProvider(provider, true);
        trustReg.addUpdater(address(sa));

        vm.deal(client,   100 ether);
        vm.deal(provider, 10 ether);
        vm.deal(stranger, 1 ether);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _propose() internal returns (uint256 id) {
        vm.prank(client);
        id = sa.propose{value: PRICE}(
            provider,
            "text-generation",
            "Generate article",
            PRICE,
            address(0),
            block.timestamp + DEADLINE,
            SPEC_HASH
        );
    }

    function _proposeAndAccept() internal returns (uint256 id) {
        id = _propose();
        vm.prank(provider);
        sa.accept(id);
    }

    function _commit(uint256 id) internal {
        vm.prank(provider);
        sa.commitDeliverable(id, DELIVERY_HASH);
    }

    // ─── Tests ───────────────────────────────────────────────────────────────

    /**
     * @notice Full two-step flow: commit → verify → payment released.
     */
    function test_CommitReveal_FullFlow() public {
        uint256 id = _proposeAndAccept();
        uint256 providerBefore = provider.balance;

        // Step 1: Provider commits deliverable hash
        _commit(id);

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.PENDING_VERIFICATION));
        assertEq(ag.committedHash, DELIVERY_HASH);
        assertEq(ag.deliverablesHash, DELIVERY_HASH, "deliverablesHash also updated for compat");
        assertGt(ag.verifyWindowEnd, block.timestamp);
        assertEq(ag.verifyWindowEnd, block.timestamp + sa.VERIFY_WINDOW());

        // Step 2: Client verifies delivery
        vm.prank(client);
        sa.verifyDeliverable(id);

        ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.FULFILLED));
        assertGt(ag.resolvedAt, 0);

        // Payment released to provider
        assertEq(provider.balance, providerBefore + PRICE);
        assertEq(address(sa).balance, 0);

        // Trust score updated
        assertGt(trustReg.getScore(provider), 0);
    }

    /**
     * @notice Auto-release: commit, warp 4 days past verify window, anyone triggers release.
     */
    function test_CommitReveal_AutoRelease() public {
        uint256 id = _proposeAndAccept();
        _commit(id);

        uint256 verifyWindowEnd = sa.getAgreement(id).verifyWindowEnd;
        uint256 providerBefore  = provider.balance;

        // Warp past the verify window (3 days + 1 second)
        vm.warp(verifyWindowEnd + 1);

        // Stranger triggers auto-release (anyone can call)
        vm.prank(stranger);
        sa.autoRelease(id);

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.FULFILLED));
        assertGt(ag.resolvedAt, 0);

        // Payment released to provider
        assertEq(provider.balance, providerBefore + PRICE);
        assertEq(address(sa).balance, 0);

        // Trust score updated
        assertGt(trustReg.getScore(provider), 0);
    }

    /**
     * @notice Normal quality disputes must go through remediation first.
     */
    function test_CommitReveal_DisputeRequiresRemediationInNormalCase() public {
        uint256 id = _proposeAndAccept();
        _commit(id);

        vm.prank(client);
        vm.expectRevert("ServiceAgreement: remediation first");
        sa.dispute(id, "Deliverable does not meet spec");
    }

    /**
     * @notice After remediation is opened, explicit escalation can enter dispute.
     */
    function test_CommitReveal_EscalateToDisputeAfterRemediation() public {
        uint256 id = _proposeAndAccept();
        _commit(id);

        vm.prank(client);
        sa.requestRevision(id, keccak256("needs-fix"), "ipfs://feedback", bytes32(0));

        vm.prank(provider);
        sa.escalateToDispute(id, "deadlocked after remediation started");

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.DISPUTED));
        assertEq(address(sa).balance, PRICE);
    }


    /**
     * @notice Hard non-delivery can bypass remediation once the deadline is actually breached.
     */
    function test_DirectDispute_AllowsNoDeliveryAfterDeadline() public {
        uint256 id = _proposeAndAccept();

        vm.warp(block.timestamp + DEADLINE + 1);

        vm.prank(client);
        sa.directDispute(id, IServiceAgreement.DirectDisputeReason.NO_DELIVERY, "provider never delivered");

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.DISPUTED));
    }

    /**
     * @notice Hard deadline breach can bypass remediation.
     */
    function test_DirectDispute_AllowsHardDeadlineBreach() public {
        uint256 id = _proposeAndAccept();

        vm.warp(block.timestamp + DEADLINE + 1);

        vm.prank(provider);
        sa.directDispute(id, IServiceAgreement.DirectDisputeReason.HARD_DEADLINE_BREACH, "deadline was breached");

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.DISPUTED));
    }

    /**
     * @notice Clearly invalid or fraudulent deliverables can be disputed directly during verification.
     */
    function test_DirectDispute_AllowsInvalidDeliverable() public {
        uint256 id = _proposeAndAccept();
        _commit(id);

        vm.prank(client);
        sa.directDispute(id, IServiceAgreement.DirectDisputeReason.INVALID_OR_FRAUDULENT_DELIVERABLE, "deliverable is fraudulent");

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.DISPUTED));
    }

    /**
     * @notice Safety-critical violations can bypass remediation immediately.
     */
    function test_DirectDispute_AllowsSafetyCriticalViolation() public {
        uint256 id = _proposeAndAccept();

        vm.prank(client);
        sa.directDispute(id, IServiceAgreement.DirectDisputeReason.SAFETY_CRITICAL_VIOLATION, "unsafe output");

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.DISPUTED));
    }

    /**
     * @notice Direct-dispute exceptions are narrow and cannot be abused before the condition exists.
     */
    function test_DirectDispute_RevertsWhenConditionNotMet() public {
        uint256 id = _proposeAndAccept();
        _commit(id);

        vm.prank(client);
        vm.expectRevert("ServiceAgreement: direct dispute not allowed");
        sa.directDispute(id, IServiceAgreement.DirectDisputeReason.NO_DELIVERY, "not yet overdue");
    }

    /**
     * @notice Non-client cannot call verifyDeliverable.
     */
    function test_CommitReveal_CannotVerify_NotClient() public {
        uint256 id = _proposeAndAccept();
        _commit(id);

        vm.prank(stranger);
        vm.expectRevert("ServiceAgreement: not client");
        sa.verifyDeliverable(id);

        // Provider also cannot verify
        vm.prank(provider);
        vm.expectRevert("ServiceAgreement: not client");
        sa.verifyDeliverable(id);
    }

    /**
     * @notice autoRelease reverts if verify window has not expired yet.
     */
    function test_CommitReveal_CannotAutoRelease_WindowOpen() public {
        uint256 id = _proposeAndAccept();
        _commit(id);

        // Still inside the verify window
        vm.expectRevert("ServiceAgreement: verify window open");
        sa.autoRelease(id);

        // Even 1 second before expiry
        uint256 verifyWindowEnd = sa.getAgreement(id).verifyWindowEnd;
        vm.warp(verifyWindowEnd - 1);

        vm.expectRevert("ServiceAgreement: verify window open");
        sa.autoRelease(id);
    }

    /**
     * @notice autoRelease reverts on non-PENDING_VERIFICATION status.
     */
    function test_CommitReveal_CannotAutoRelease_WrongStatus() public {
        uint256 id = _proposeAndAccept();
        // Did not commit — still ACCEPTED

        vm.expectRevert("ServiceAgreement: not PENDING_VERIFICATION");
        sa.autoRelease(id);
    }

    /**
     * @notice verifyDeliverable reverts on non-PENDING_VERIFICATION status.
     */
    function test_CommitReveal_CannotVerify_WrongStatus() public {
        uint256 id = _proposeAndAccept();
        // Still ACCEPTED — not committed yet

        vm.prank(client);
        vm.expectRevert("ServiceAgreement: not PENDING_VERIFICATION");
        sa.verifyDeliverable(id);
    }

    /**
     * @notice commitDeliverable reverts if status is not ACCEPTED.
     */
    function test_CommitReveal_CannotCommit_WrongStatus() public {
        uint256 id = _propose();
        // Still PROPOSED — not accepted

        vm.prank(provider);
        vm.expectRevert("ServiceAgreement: not ACCEPTED");
        sa.commitDeliverable(id, DELIVERY_HASH);
    }

    /**
     * @notice commitDeliverable reverts if past the deadline.
     */
    function test_CommitReveal_CannotCommit_PastDeadline() public {
        uint256 id = _proposeAndAccept();

        // Warp past deadline
        vm.warp(block.timestamp + DEADLINE + 1);

        vm.prank(provider);
        vm.expectRevert("ServiceAgreement: past deadline");
        sa.commitDeliverable(id, DELIVERY_HASH);
    }

    /**
     * @notice Only provider can commitDeliverable.
     */
    function test_CommitReveal_CannotCommit_NotProvider() public {
        uint256 id = _proposeAndAccept();

        vm.prank(client);
        vm.expectRevert("ServiceAgreement: not provider");
        sa.commitDeliverable(id, DELIVERY_HASH);
    }

    /**
     * @notice DeliverableCommitted event is emitted with correct parameters.
     */
    function test_CommitReveal_EmitsDeliverableCommitted() public {
        uint256 id = _proposeAndAccept();
        uint256 expectedWindowEnd = block.timestamp + sa.VERIFY_WINDOW();

        vm.expectEmit(true, true, false, true);
        emit ServiceAgreement.DeliverableCommitted(id, provider, DELIVERY_HASH, expectedWindowEnd);

        _commit(id);
    }

    /**
     * @notice AutoReleased event is emitted on auto-release.
     */
    function test_CommitReveal_EmitsAutoReleased() public {
        uint256 id = _proposeAndAccept();
        _commit(id);

        uint256 verifyWindowEnd = sa.getAgreement(id).verifyWindowEnd;
        vm.warp(verifyWindowEnd + 1);

        vm.expectEmit(true, true, false, false);
        emit ServiceAgreement.AutoReleased(id, provider);

        sa.autoRelease(id);
    }

    /**
     * @notice Commit-reveal path respects minimumTrustValue.
     *         1-wei agreement via commitDeliverable + verifyDeliverable
     *         should NOT update trust when minimumTrustValue = 0.01 ETH.
     */
    function test_CommitReveal_MinimumTrustValue_Interaction() public {
        sa.setMinimumTrustValue(0.01 ether);

        // Propose a 1-wei agreement
        vm.prank(client);
        uint256 id = sa.propose{value: 1}(
            provider,
            "micro-task",
            "tiny task",
            1,
            address(0),
            block.timestamp + DEADLINE,
            SPEC_HASH
        );
        vm.prank(provider);
        sa.accept(id);

        uint256 scoreBefore = trustReg.getScore(provider);

        // Commit and verify
        vm.prank(provider);
        sa.commitDeliverable(id, DELIVERY_HASH);

        vm.prank(client);
        sa.verifyDeliverable(id);

        // Trust NOT updated — price (1 wei) < minimumTrustValue (0.01 ETH)
        assertEq(trustReg.getScore(provider), scoreBefore,
            "Trust score must not update for sub-minimum commit-reveal agreement");
    }

    /**
     * @notice autoRelease path also respects minimumTrustValue.
     */
    function test_CommitReveal_AutoRelease_MinimumTrustValue_Interaction() public {
        sa.setMinimumTrustValue(0.01 ether);

        vm.prank(client);
        uint256 id = sa.propose{value: 1}(
            provider, "micro", "tiny", 1, address(0),
            block.timestamp + DEADLINE, SPEC_HASH
        );
        vm.prank(provider);
        sa.accept(id);
        vm.prank(provider);
        sa.commitDeliverable(id, DELIVERY_HASH);

        uint256 scoreBefore = trustReg.getScore(provider);
        uint256 verifyWindowEnd = sa.getAgreement(id).verifyWindowEnd;
        vm.warp(verifyWindowEnd + 1);

        sa.autoRelease(id);

        assertEq(trustReg.getScore(provider), scoreBefore,
            "Trust score must not update on auto-release for sub-minimum agreement");
    }

    /**
     * @notice Public launch posture: fulfill() is not a normal settlement path.
     *         A fresh deployment disables it until the owner explicitly opts into legacy mode.
     */
    function test_CommitReveal_FulfillDisabledByDefaultOnFreshDeployment() public {
        ServiceAgreement fresh = new ServiceAgreement(address(trustReg));
        trustReg.addUpdater(address(fresh));

        vm.prank(client);
        uint256 id = fresh.propose{value: PRICE}(
            provider,
            "text-generation",
            "Generate article",
            PRICE,
            address(0),
            block.timestamp + DEADLINE,
            SPEC_HASH
        );
        vm.prank(provider);
        fresh.accept(id);

        vm.prank(provider);
        vm.expectRevert("ServiceAgreement: legacy fulfill disabled");
        fresh.fulfill(id, DELIVERY_HASH);
    }

    /**
     * @notice Backward compatibility remains available only for explicitly trusted legacy providers.
     */
    function test_CommitReveal_BackwardCompat_FulfillRequiresLegacyTrust() public {
        uint256 id = _proposeAndAccept();
        uint256 providerBefore = provider.balance;

        vm.prank(provider);
        sa.fulfill(id, DELIVERY_HASH);

        assertEq(provider.balance, providerBefore + PRICE);
        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.FULFILLED));
        assertEq(ag.deliverablesHash, DELIVERY_HASH);
    }

    /**
     * @notice After verifyDeliverable, status is FULFILLED and trust is updated.
     */
    function test_CommitReveal_FullFlow_TrustUpdated() public {
        uint256 id = _proposeAndAccept();
        _commit(id);

        uint256 expectedScore = trustReg.INITIAL_SCORE() + trustReg.INCREMENT();

        vm.prank(client);
        sa.verifyDeliverable(id);

        assertEq(trustReg.getScore(provider), expectedScore,
            "Trust score must increment on successful verifyDeliverable");
    }

    /**
     * @notice VERIFY_WINDOW is exactly 3 days.
     */
    function test_CommitReveal_VerifyWindowIs3Days() public {
        assertEq(sa.VERIFY_WINDOW(), 3 days);
    }
}
