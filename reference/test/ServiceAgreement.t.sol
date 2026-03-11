// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/ServiceAgreement.sol";
import "../contracts/TrustRegistry.sol";
import "../contracts/IServiceAgreement.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Mock ERC-20 ─────────────────────────────────────────────────────────────

contract MockERC20 is ERC20 {
    constructor() ERC20("MockToken", "MTK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

contract ServiceAgreementTest is Test {

    ServiceAgreement public sa;
    TrustRegistry    public trustReg;
    MockERC20 public token;

    address public owner   = address(this);
    address public client  = address(0xC1);
    address public provider = address(0xA1);
    address public stranger = address(0xBEEF);

    uint256 constant PRICE    = 1 ether;
    uint256 constant DEADLINE = 7 days; // added to block.timestamp in helpers
    bytes32 constant SPEC_HASH = keccak256("spec-v1");
    bytes32 constant DELIVERY_HASH = keccak256("delivery-v1");

    // ─── Setup ───────────────────────────────────────────────────────────────

    function setUp() public {
        trustReg = new TrustRegistry();
        token    = new MockERC20();
        sa       = new ServiceAgreement(address(trustReg));
        // T-02: ServiceAgreement is the authorized trust updater
        trustReg.addUpdater(address(sa));
        // T-03: allowlist the mock ERC-20 token for ERC-20 agreement tests
        sa.allowToken(address(token));

        vm.deal(client, 100 ether);
        vm.deal(provider, 10 ether);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _propose() internal returns (uint256 id) {
        vm.prank(client);
        id = sa.propose{value: PRICE}(
            provider,
            "text-generation",
            "Generate a 1000-word article",
            PRICE,
            address(0),
            block.timestamp + DEADLINE,
            SPEC_HASH
        );
    }

    function _proposeERC20() internal returns (uint256 id) {
        token.mint(client, PRICE);
        vm.prank(client);
        token.approve(address(sa), PRICE);
        vm.prank(client);
        id = sa.propose(
            provider,
            "data-analysis",
            "Analyse on-chain data set",
            PRICE,
            address(token),
            block.timestamp + DEADLINE,
            SPEC_HASH
        );
    }

    // ─── Tests ───────────────────────────────────────────────────────────────

    function test_ProposeAndAccept() public {
        uint256 id = _propose();

        // Verify PROPOSED state
        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(ag.id, 1);
        assertEq(ag.client, client);
        assertEq(ag.provider, provider);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.PROPOSED));
        assertEq(address(sa).balance, PRICE);

        // Provider accepts
        vm.prank(provider);
        sa.accept(id);

        ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.ACCEPTED));
    }

    function test_ProposeAndFulfill() public {
        uint256 id = _propose();

        vm.prank(provider);
        sa.accept(id);

        uint256 providerBefore = provider.balance;

        vm.prank(provider);
        sa.fulfill(id, DELIVERY_HASH);

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.FULFILLED));
        assertEq(ag.deliverablesHash, DELIVERY_HASH);
        assertGt(ag.resolvedAt, 0);

        // Provider received escrow
        assertEq(provider.balance, providerBefore + PRICE);
        assertEq(address(sa).balance, 0);

        // T-02: trust score updated automatically on fulfill
        assertEq(trustReg.getScore(provider), TrustRegistry(address(trustReg)).INITIAL_SCORE() + TrustRegistry(address(trustReg)).INCREMENT());
    }

    function test_Cancel() public {
        uint256 id = _propose();
        assertEq(address(sa).balance, PRICE);

        uint256 clientBefore = client.balance;

        vm.prank(client);
        sa.cancel(id);

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.CANCELLED));

        // Client refunded
        assertEq(client.balance, clientBefore + PRICE);
        assertEq(address(sa).balance, 0);
    }

    function test_Dispute() public {
        uint256 id = _propose();

        vm.prank(provider);
        sa.accept(id);

        vm.prank(client);
        sa.dispute(id, "Deliverables not as agreed");

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.DISPUTED));
        // Escrow still locked
        assertEq(address(sa).balance, PRICE);
    }

    function test_ResolveDisputeFavorProvider() public {
        uint256 id = _propose();

        vm.prank(provider);
        sa.accept(id);

        vm.prank(provider);
        sa.dispute(id, "I delivered everything");

        uint256 providerBefore = provider.balance;

        // Owner resolves in provider's favour
        sa.resolveDispute(id, true);

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.FULFILLED));
        assertEq(provider.balance, providerBefore + PRICE);
        assertEq(address(sa).balance, 0);

        // T-02: provider vindicated — trust score recorded (provider auto-initialized at 100, then +5 = 105)
        assertEq(trustReg.getScore(provider), trustReg.INITIAL_SCORE() + trustReg.INCREMENT());
    }

    function test_ResolveDisputeFavorClient() public {
        uint256 id = _propose();

        vm.prank(provider);
        sa.accept(id);

        vm.prank(client);
        sa.dispute(id, "Nothing was delivered");

        uint256 clientBefore = client.balance;
        uint256 scoreBefore = trustReg.getScore(provider);

        // Owner resolves in client's favour
        sa.resolveDispute(id, false);

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.CANCELLED));
        assertEq(client.balance, clientBefore + PRICE);
        assertEq(address(sa).balance, 0);

        // T-02: provider failed — trust score decremented
        // Provider was uninitialized (score 0), after anomaly recorded: initializes at 100 then subtracts 20 → 80
        assertLt(trustReg.getScore(provider), scoreBefore + trustReg.INITIAL_SCORE());
    }

    function test_ExpiredCancel() public {
        uint256 id = _propose();

        vm.prank(provider);
        sa.accept(id);

        // Warp past deadline
        vm.warp(block.timestamp + DEADLINE + 1);

        uint256 clientBefore = client.balance;

        vm.prank(client);
        sa.expiredCancel(id);

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.CANCELLED));
        assertEq(client.balance, clientBefore + PRICE);
        assertEq(address(sa).balance, 0);
    }

    function test_ERC20Agreement() public {
        uint256 id = _proposeERC20();

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(ag.token, address(token));
        assertEq(ag.price, PRICE);
        assertEq(token.balanceOf(address(sa)), PRICE);

        vm.prank(provider);
        sa.accept(id);

        uint256 providerBefore = token.balanceOf(provider);

        vm.prank(provider);
        sa.fulfill(id, DELIVERY_HASH);

        assertEq(token.balanceOf(provider), providerBefore + PRICE);
        assertEq(token.balanceOf(address(sa)), 0);

        ag = sa.getAgreement(id);
        assertEq(uint256(ag.status), uint256(IServiceAgreement.Status.FULFILLED));
    }

    function test_RevertPropose_TokenNotAllowed() public {
        // T-03: tokens not on the allowlist must be rejected
        address unlisted = address(0xBAD);
        vm.prank(client);
        vm.expectRevert("ServiceAgreement: token not allowed");
        sa.propose(
            provider, "compute", "task", PRICE, unlisted,
            block.timestamp + DEADLINE, SPEC_HASH
        );
    }

    function test_AllowAndDisallowToken() public {
        address newToken = address(0x1234);
        // Initially not allowed
        assertFalse(sa.allowedTokens(newToken));

        sa.allowToken(newToken);
        assertTrue(sa.allowedTokens(newToken));

        sa.disallowToken(newToken);
        assertFalse(sa.allowedTokens(newToken));
    }

    function test_RevertAccept_NotProvider() public {
        uint256 id = _propose();

        vm.prank(stranger);
        vm.expectRevert("ServiceAgreement: not provider");
        sa.accept(id);
    }

    function test_RevertFulfill_PastDeadline() public {
        uint256 id = _propose();

        vm.prank(provider);
        sa.accept(id);

        // Warp past deadline
        vm.warp(block.timestamp + DEADLINE + 1);

        vm.prank(provider);
        vm.expectRevert("ServiceAgreement: past deadline");
        sa.fulfill(id, DELIVERY_HASH);
    }

    function test_RevertCancel_AlreadyAccepted() public {
        uint256 id = _propose();

        vm.prank(provider);
        sa.accept(id);

        vm.prank(client);
        vm.expectRevert("ServiceAgreement: not PROPOSED");
        sa.cancel(id);
    }

    function test_GetAgreementsByClient() public {
        uint256 id1 = _propose();
        uint256 id2 = _propose();

        uint256[] memory ids = sa.getAgreementsByClient(client);
        assertEq(ids.length, 2);
        assertEq(ids[0], id1);
        assertEq(ids[1], id2);
    }

    function test_GetAgreementsByProvider() public {
        uint256 id1 = _propose();
        uint256 id2 = _propose();

        uint256[] memory ids = sa.getAgreementsByProvider(provider);
        assertEq(ids.length, 2);
        assertEq(ids[0], id1);
        assertEq(ids[1], id2);
    }

    function test_AgreementCount() public {
        assertEq(sa.agreementCount(), 0);
        _propose();
        assertEq(sa.agreementCount(), 1);
        _propose();
        assertEq(sa.agreementCount(), 2);
    }

    function test_RevertGetAgreement_NotFound() public {
        vm.expectRevert("ServiceAgreement: not found");
        sa.getAgreement(999);
    }
}

// ─── Broken TrustRegistry for liveness isolation tests ───────────────────────

/**
 * @notice A TrustRegistry that always reverts on recordSuccess and recordAnomaly.
 *         Used to verify that ServiceAgreement.fulfill() never holds escrow hostage
 *         due to a broken or malicious trust registry.
 */
contract BrokenTrustRegistry is ITrustRegistry {
    function initWallet(address) external pure override {}
    function recordSuccess(address) external pure override {
        revert("TrustRegistry: permanent failure");
    }
    function recordAnomaly(address) external pure override {
        revert("TrustRegistry: permanent failure");
    }
    function getScore(address) external pure override returns (uint256) {
        return 0;
    }
}

// ─── Liveness isolation tests ─────────────────────────────────────────────────

/**
 * @notice Verifies Fix 2: a broken TrustRegistry must never block escrow release.
 *         fulfill(), resolveDispute(true), and resolveDispute(false) must all
 *         succeed and release escrow even when the TrustRegistry always reverts.
 */
contract ServiceAgreementTrustLivenessTest is Test {

    ServiceAgreement public sa;
    BrokenTrustRegistry public brokenRegistry;

    address public owner    = address(this);
    address public client   = address(0xC1);
    address public provider = address(0xA1);

    uint256 constant PRICE    = 1 ether;
    uint256 constant DEADLINE = 7 days;
    bytes32 constant SPEC_HASH     = keccak256("spec");
    bytes32 constant DELIVERY_HASH = keccak256("delivery");

    function setUp() public {
        brokenRegistry = new BrokenTrustRegistry();
        sa = new ServiceAgreement(address(brokenRegistry));
        // Note: do NOT add ServiceAgreement as updater — the registry always reverts anyway.
        vm.deal(client, 100 ether);
        vm.deal(provider, 10 ether);
    }

    function _propose() internal returns (uint256 id) {
        vm.prank(client);
        id = sa.propose{value: PRICE}(
            provider,
            "text-generation",
            "Generate a report",
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

    /**
     * @notice CRITICAL LIVENESS TEST: fulfill() releases escrow even when
     *         TrustRegistry.recordSuccess() always reverts.
     *
     *         This is the core guarantee of Fix 2: a broken TrustRegistry can never
     *         hold the provider's payment hostage.
     */
    function test_Fulfill_SucceedsEvenIfTrustRegistryReverts() public {
        uint256 id = _proposeAndAccept();

        uint256 providerBefore = provider.balance;

        // fulfill() must succeed despite the broken registry
        vm.prank(provider);
        sa.fulfill(id, DELIVERY_HASH);

        // Escrow released to provider
        assertEq(provider.balance, providerBefore + PRICE);

        // Agreement is FULFILLED
        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint8(ag.status), uint8(IServiceAgreement.Status.FULFILLED));
    }

    /**
     * @notice TrustUpdateFailed event is emitted when the registry reverts.
     */
    function test_Fulfill_EmitsTrustUpdateFailed_WhenRegistryReverts() public {
        uint256 id = _proposeAndAccept();

        vm.expectEmit(true, true, false, true);
        emit ServiceAgreement.TrustUpdateFailed(id, provider, "fulfill");

        vm.prank(provider);
        sa.fulfill(id, DELIVERY_HASH);
    }

    /**
     * @notice resolveDispute(favorProvider=true) releases escrow even when
     *         TrustRegistry.recordSuccess() always reverts.
     */
    function test_ResolveDispute_FavorProvider_SucceedsEvenIfTrustRegistryReverts() public {
        uint256 id = _proposeAndAccept();
        vm.prank(client);
        sa.dispute(id, "disputed");

        uint256 providerBefore = provider.balance;

        // Owner resolves in favor of provider — must not revert
        sa.resolveDispute(id, true);

        assertEq(provider.balance, providerBefore + PRICE);
    }

    /**
     * @notice resolveDispute(favorProvider=false) releases escrow to client even when
     *         TrustRegistry.recordAnomaly() always reverts.
     */
    function test_ResolveDispute_FavorClient_SucceedsEvenIfTrustRegistryReverts() public {
        uint256 id = _proposeAndAccept();
        vm.prank(client);
        sa.dispute(id, "disputed");

        uint256 clientBefore = client.balance;

        // Owner resolves in favor of client — must not revert
        sa.resolveDispute(id, false);

        assertEq(client.balance, clientBefore + PRICE);
    }

    // ─── Fix 1: Dispute Timeout ───────────────────────────────────────────────

    /**
     * @notice Fix 1 hardening: after DISPUTE_TIMEOUT (30 days) from when the dispute
     *         was opened, either party (or anyone) can call expiredDisputeRefund()
     *         to release escrow back to the client — even if the owner is offline.
     */
    function test_DisputeTimeout_RefundsClient() public {
        uint256 id = _proposeAndAccept();

        // Client raises a dispute
        vm.prank(client);
        sa.dispute(id, "provider is unresponsive");

        IServiceAgreement.Agreement memory ag = sa.getAgreement(id);
        assertEq(uint8(ag.status), uint8(IServiceAgreement.Status.DISPUTED));
        uint256 disputedAt = ag.resolvedAt; // dispute() now sets resolvedAt = block.timestamp

        // Still within the 30-day window — must revert
        vm.warp(disputedAt + 30 days);
        vm.expectRevert("ServiceAgreement: dispute timeout not reached");
        sa.expiredDisputeRefund(id);

        // Advance past the 30-day timeout
        vm.warp(disputedAt + 31 days);

        uint256 clientBefore = client.balance;

        // Anyone can trigger the refund (caller is a third party here)
        address caller = address(0xCAFE);
        vm.prank(caller);
        sa.expiredDisputeRefund(id);

        // Client receives the escrowed funds
        assertEq(client.balance, clientBefore + PRICE);

        // Agreement is now CANCELLED
        ag = sa.getAgreement(id);
        assertEq(uint8(ag.status), uint8(IServiceAgreement.Status.CANCELLED));
    }

    // ─── F-24: Ownable2Step ──────────────────────────────────────────────────

    function test_Ownable2Step_PendingOwnerMustAccept() public {
        address newOwner = address(0xAA01);

        // Current owner initiates transfer
        sa.transferOwnership(newOwner);
        assertEq(sa.pendingOwner(), newOwner);
        // Owner unchanged until accepted
        assertEq(sa.owner(), address(this));

        // New owner accepts
        vm.prank(newOwner);
        sa.acceptOwnership();

        assertEq(sa.owner(), newOwner);
        assertEq(sa.pendingOwner(), address(0));
    }

    function test_Ownable2Step_WrongCallerCannotAccept() public {
        address newOwner = address(0xAA01);
        sa.transferOwnership(newOwner);

        vm.prank(address(0xBB02));
        vm.expectRevert("ServiceAgreement: not pending owner");
        sa.acceptOwnership();

        // Owner unchanged
        assertEq(sa.owner(), address(this));
    }

    function test_Ownable2Step_OverwritePending() public {
        address ownerA = address(0xAA03);
        address ownerB = address(0xBB04);

        sa.transferOwnership(ownerA);
        assertEq(sa.pendingOwner(), ownerA);

        // Overwrite with ownerB — ownerA can no longer accept
        sa.transferOwnership(ownerB);
        assertEq(sa.pendingOwner(), ownerB);

        vm.prank(ownerA);
        vm.expectRevert("ServiceAgreement: not pending owner");
        sa.acceptOwnership();

        vm.prank(ownerB);
        sa.acceptOwnership();
        assertEq(sa.owner(), ownerB);
    }

    function test_Ownable2Step_OldOwnerFunctionsWhilePending() public {
        address newOwner = address(0xAA01);
        sa.transferOwnership(newOwner);

        // Old owner still controls the contract until acceptance
        sa.allowToken(address(0xCC05));
        assertTrue(sa.allowedTokens(address(0xCC05)));
    }
}
