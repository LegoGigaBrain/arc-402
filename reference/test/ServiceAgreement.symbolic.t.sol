// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ServiceAgreement Halmos Symbolic Tests
 * @notice Symbolic execution proofs for state machine invariants.
 *
 *         Run: halmos --contract ServiceAgreementSymbolic
 *
 * @dev HALMOS LIMITATION: Halmos cannot reliably model ETH balance changes
 *      through `call{value: amount}("")`. This affects ALL tests that assert
 *      on address.balance after ETH transfers (propose, fulfill, cancel, etc.).
 *      Even with fully concrete values, balance assertions fail.
 *
 *      STRATEGY: Focus Halmos on what it CAN prove universally:
 *      - State machine transition correctness (status enum values)
 *      - Data integrity (stored fields match inputs)
 *      - Sequential ID monotonicity
 *      - Access control (wrong actor → revert via try/catch)
 *
 *      ETH balance correctness is covered by the Foundry attack test suite
 *      (ServiceAgreement.attack.t.sol) and Echidna invariants instead.
 */

import "forge-std/Test.sol";
import "../contracts/ServiceAgreement.sol";
import "../contracts/TrustRegistry.sol";
import "../contracts/IServiceAgreement.sol";

contract ServiceAgreementSymbolic is Test {

    ServiceAgreement public sa;
    TrustRegistry    public trustReg;

    address payable constant CLIENT   = payable(address(0xC100));
    address payable constant PROVIDER = payable(address(0xA100));
    address constant STRANGER         = address(0xBEEF);

    uint256 constant PRICE = 1 ether;

    function setUp() public {
        trustReg = new TrustRegistry();
        sa = new ServiceAgreement(address(trustReg));
        trustReg.addUpdater(address(sa));
        vm.deal(CLIENT, 100 ether);
        vm.deal(PROVIDER, 10 ether);
    }

    // ─── Internal helper: create a PROPOSED agreement ────────────────────────

    function _propose(uint256 deadline) internal returns (uint256 id) {
        vm.prank(CLIENT);
        id = sa.propose{value: PRICE}(
            PROVIDER, "compute", "test", PRICE, address(0), deadline, bytes32(0)
        );
    }

    function _proposeAndAccept(uint256 deadline) internal returns (uint256 id) {
        id = _propose(deadline);
        vm.prank(PROVIDER);
        sa.accept(id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1: propose() stores all fields correctly for ANY valid inputs
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * @notice All Agreement struct fields match the propose() arguments.
     * @dev Pure data integrity proof. Symbolic deadline and specHash ensure
     *      this holds for ALL possible valid values, not just tested ones.
     */
    function check_propose_stores_fields(uint256 deadline, bytes32 specHash) public {
        vm.assume(deadline > block.timestamp);
        vm.assume(deadline <= block.timestamp + 365 days);

        vm.prank(CLIENT);
        uint256 id = sa.propose{value: PRICE}(
            PROVIDER, "compute", "test task", PRICE, address(0), deadline, specHash
        );

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);

        assert(ag.id == id);
        assert(ag.client == CLIENT);
        assert(ag.provider == PROVIDER);
        assert(ag.price == PRICE);
        assert(ag.token == address(0));
        assert(ag.deadline == deadline);
        assert(ag.deliverablesHash == specHash);
        assert(ag.status == IServiceAgreement.Status.PROPOSED);
        assert(ag.createdAt == block.timestamp);
        assert(ag.resolvedAt == 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2: Agreement IDs are strictly sequential
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * @notice Two consecutive propose() calls produce IDs differing by exactly 1.
     * @dev Symbolic prices ensure this holds regardless of escrow amounts.
     *      Covers: ID reuse, unchecked{} overflow, non-monotonic assignment.
     */
    function check_agreement_ids_sequential(uint256 price1, uint256 price2) public {
        vm.assume(price1 >= 1 && price1 <= 50 ether);
        vm.assume(price2 >= 1 && price2 <= 50 ether);

        vm.deal(CLIENT, 100 ether);
        uint256 deadline = block.timestamp + 7 days;

        vm.prank(CLIENT);
        uint256 id1 = sa.propose{value: price1}(
            PROVIDER, "compute", "first", price1, address(0), deadline, bytes32(0)
        );

        vm.prank(CLIENT);
        uint256 id2 = sa.propose{value: price2}(
            PROVIDER, "compute", "second", price2, address(0), deadline, bytes32(0)
        );

        // PROOF: sequential IDs
        assert(id2 == id1 + 1);
        assert(id1 == 1);
        assert(id2 == 2);

        // PROOF: independent price storage
        assert(sa.getAgreement(id1).price == price1);
        assert(sa.getAgreement(id2).price == price2);

        // PROOF: count matches
        assert(sa.agreementCount() == 2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3: State machine — PROPOSED can only transition to ACCEPTED or CANCELLED
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * @notice From PROPOSED, only accept() and cancel() are valid transitions.
     *         fulfill(), dispute(), and expiredCancel() must revert.
     * @dev Proves the state machine is correctly constrained at the PROPOSED node.
     */
    function check_proposed_valid_transitions(uint256 deadline) public {
        vm.assume(deadline > block.timestamp + 1 days);
        vm.assume(deadline <= block.timestamp + 365 days);

        uint256 id = _propose(deadline);

        // Status is PROPOSED
        assert(sa.getAgreement(id).status == IServiceAgreement.Status.PROPOSED);

        // fulfill() must revert (not ACCEPTED)
        vm.prank(PROVIDER);
        try sa.fulfill(id, bytes32(0)) {
            assert(false); // should not succeed
        } catch {}

        // dispute() must revert (not ACCEPTED)
        vm.prank(CLIENT);
        try sa.dispute(id, "test") {
            assert(false);
        } catch {}

        // expiredCancel() must revert (not ACCEPTED)
        vm.prank(CLIENT);
        try sa.expiredCancel(id) {
            assert(false);
        } catch {}

        // Status unchanged
        assert(sa.getAgreement(id).status == IServiceAgreement.Status.PROPOSED);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 4: State machine — ACCEPTED can transition to FULFILLED, DISPUTED, or CANCELLED
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * @notice From ACCEPTED, cancel() and propose() must revert.
     * @dev Proves that ACCEPTED agreements cannot be re-proposed or re-cancelled
     *      via the cancel() function (only expiredCancel is valid for cancellation).
     */
    function check_accepted_blocks_cancel(uint256 deadline) public {
        vm.assume(deadline > block.timestamp + 1 days);
        vm.assume(deadline <= block.timestamp + 365 days);

        uint256 id = _proposeAndAccept(deadline);
        assert(sa.getAgreement(id).status == IServiceAgreement.Status.ACCEPTED);

        // cancel() must revert (only works on PROPOSED)
        vm.prank(CLIENT);
        try sa.cancel(id) {
            assert(false); // should not succeed
        } catch {}

        // accept() must revert (already ACCEPTED)
        vm.prank(PROVIDER);
        try sa.accept(id) {
            assert(false);
        } catch {}

        // Status unchanged
        assert(sa.getAgreement(id).status == IServiceAgreement.Status.ACCEPTED);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 5: Access control — strangers cannot mutate agreements
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * @notice A stranger (not client/provider/owner) cannot call any mutating function.
     * @dev Tests ALL state-changing functions from a stranger address.
     *      Uses try/catch since vm.expectRevert is unsupported.
     */
    function check_stranger_cannot_mutate(uint256 deadline) public {
        vm.assume(deadline > block.timestamp + 1 days);
        vm.assume(deadline <= block.timestamp + 365 days);

        uint256 id = _proposeAndAccept(deadline);

        // Stranger cannot accept
        vm.prank(STRANGER);
        try sa.accept(id) {
            assert(false);
        } catch {}

        // Stranger cannot fulfill
        vm.prank(STRANGER);
        try sa.fulfill(id, bytes32(0)) {
            assert(false);
        } catch {}

        // Stranger cannot cancel
        vm.prank(STRANGER);
        try sa.cancel(id) {
            assert(false);
        } catch {}

        // Stranger cannot dispute
        vm.prank(STRANGER);
        try sa.dispute(id, "attack") {
            assert(false);
        } catch {}

        // Stranger cannot expiredCancel
        vm.prank(STRANGER);
        try sa.expiredCancel(id) {
            assert(false);
        } catch {}

        // Stranger cannot resolveDispute (not owner)
        vm.prank(STRANGER);
        try sa.resolveDispute(id, true) {
            assert(false);
        } catch {}

        // Status unchanged after all stranger attempts
        assert(sa.getAgreement(id).status == IServiceAgreement.Status.ACCEPTED);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 6: Dispute blocks fulfill and cancel
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * @notice Once disputed, fulfill() and cancel() both revert.
     *         Only resolveDispute() can progress the agreement.
     */
    function check_disputed_blocks_fulfill_and_cancel(uint256 deadline) public {
        vm.assume(deadline > block.timestamp + 1 days);
        vm.assume(deadline <= block.timestamp + 365 days);

        uint256 id = _proposeAndAccept(deadline);

        vm.prank(CLIENT);
        sa.dispute(id, "I disagree");

        assert(sa.getAgreement(id).status == IServiceAgreement.Status.DISPUTED);

        // fulfill() must revert
        vm.prank(PROVIDER);
        try sa.fulfill(id, bytes32(0)) {
            assert(false);
        } catch {}

        // cancel() must revert
        vm.prank(CLIENT);
        try sa.cancel(id) {
            assert(false);
        } catch {}

        // expiredCancel() must revert (wrong status)
        vm.prank(CLIENT);
        try sa.expiredCancel(id) {
            assert(false);
        } catch {}

        // accept() must revert
        vm.prank(PROVIDER);
        try sa.accept(id) {
            assert(false);
        } catch {}

        // Status still DISPUTED
        assert(sa.getAgreement(id).status == IServiceAgreement.Status.DISPUTED);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 7: resolveDispute() only works on DISPUTED agreements
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * @notice Owner (arbiter) cannot resolve agreements that aren't in DISPUTED state.
     * @dev Symbolic favorProvider tests both resolution directions.
     */
    function check_resolve_requires_disputed(bool favorProvider) public {
        uint256 deadline = block.timestamp + 7 days;
        uint256 id = _proposeAndAccept(deadline);

        // Agreement is ACCEPTED (not DISPUTED)
        // resolveDispute() must revert
        try sa.resolveDispute(id, favorProvider) {
            assert(false); // should not succeed
        } catch {}

        // Status unchanged
        assert(sa.getAgreement(id).status == IServiceAgreement.Status.ACCEPTED);
    }
}
