// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/SettlementCoordinator.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock ERC-20 for settlement tests
contract MockToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {
        _mint(msg.sender, 1_000_000 * 10**18);
    }
}

/**
 * @dev Helper: simulates an ARC-402 wallet that calls propose() and execute() on its
 *      own behalf (msg.sender == address(this) in both calls).
 *
 *      After Fix 3 (SC-AUTH), SettlementCoordinator.propose() requires
 *      msg.sender == fromWallet, so the wallet must be the direct caller.
 */
contract MockWallet {
    SettlementCoordinator coordinator;

    constructor(address _coord) {
        coordinator = SettlementCoordinator(_coord);
    }

    /// @notice Wallet calls propose on its own behalf (msg.sender == address(this))
    function callPropose(
        address toWallet,
        uint256 amount,
        address token,
        bytes32 intentId,
        uint256 expiresAt
    ) external returns (bytes32) {
        return coordinator.propose(address(this), toWallet, amount, token, intentId, expiresAt);
    }

    function callExecute(bytes32 proposalId, uint256 amount) external payable {
        coordinator.execute{value: amount}(proposalId);
    }

    receive() external payable {}
}

contract SettlementCoordinatorTest is Test {
    SettlementCoordinator coordinator;
    MockWallet fromWallet;
    MockToken token;
    address toWallet = address(0xBEEF);
    bytes32 constant INTENT_ID = keccak256("intent-1");

    function setUp() public {
        coordinator = new SettlementCoordinator();
        fromWallet = new MockWallet(address(coordinator));
        token = new MockToken();
        vm.deal(address(fromWallet), 10 ether);
        vm.deal(toWallet, 0);
    }

    // ─── Helper ──────────────────────────────────────────────────────────────

    function _propose() internal returns (bytes32) {
        return fromWallet.callPropose(toWallet, 1 ether, address(0), INTENT_ID, block.timestamp + 1 hours);
    }

    // ─── Existing Tests (updated to use callPropose) ──────────────────────────

    function test_propose() public {
        bytes32 proposalId = _propose();
        (address from, address to, uint256 amount,,,,, SettlementCoordinator.ProposalStatus status,) = coordinator.getProposal(proposalId);
        assertEq(from, address(fromWallet));
        assertEq(to, toWallet);
        assertEq(amount, 1 ether);
        assertEq(uint(status), uint(SettlementCoordinator.ProposalStatus.PENDING));
    }

    function test_accept() public {
        bytes32 proposalId = _propose();
        vm.prank(toWallet);
        coordinator.accept(proposalId);
        (,,,,,,, SettlementCoordinator.ProposalStatus status,) = coordinator.getProposal(proposalId);
        assertEq(uint(status), uint(SettlementCoordinator.ProposalStatus.ACCEPTED));
    }

    function test_execute_fullFlow() public {
        bytes32 proposalId = _propose();
        vm.prank(toWallet);
        coordinator.accept(proposalId);

        uint256 balanceBefore = toWallet.balance;
        fromWallet.callExecute{value: 1 ether}(proposalId, 1 ether);
        assertEq(toWallet.balance - balanceBefore, 1 ether);

        (,,,,,,, SettlementCoordinator.ProposalStatus status,) = coordinator.getProposal(proposalId);
        assertEq(uint(status), uint(SettlementCoordinator.ProposalStatus.EXECUTED));
    }

    function test_accept_notRecipient() public {
        bytes32 proposalId = _propose();
        vm.expectRevert("SettlementCoordinator: not recipient");
        coordinator.accept(proposalId);
    }

    function test_execute_wrongAmount() public {
        bytes32 proposalId = _propose();
        vm.prank(toWallet);
        coordinator.accept(proposalId);
        vm.expectRevert("SettlementCoordinator: wrong amount");
        fromWallet.callExecute{value: 0.5 ether}(proposalId, 0.5 ether);
    }

    function test_reject() public {
        bytes32 proposalId = _propose();
        vm.prank(toWallet);
        coordinator.reject(proposalId, "not authorized");
        (,,,,,,, SettlementCoordinator.ProposalStatus status, string memory reason) = coordinator.getProposal(proposalId);
        assertEq(uint(status), uint(SettlementCoordinator.ProposalStatus.REJECTED));
        assertEq(reason, "not authorized");
    }

    function test_execute_token_settlement() public {
        uint256 amount = 100 * 10**18;

        // address(this) is the fromWallet for direct execution — msg.sender == address(this) so auth passes
        token.approve(address(coordinator), amount);

        bytes32 proposalId = coordinator.propose(
            address(this), toWallet, amount, address(token), INTENT_ID, block.timestamp + 1 hours
        );

        vm.prank(toWallet);
        coordinator.accept(proposalId);

        uint256 balanceBefore = token.balanceOf(toWallet);
        coordinator.execute(proposalId); // no ETH value — ERC-20 path
        assertEq(token.balanceOf(toWallet) - balanceBefore, amount);

        (,,,,,,, SettlementCoordinator.ProposalStatus status,) = coordinator.getProposal(proposalId);
        assertEq(uint(status), uint(SettlementCoordinator.ProposalStatus.EXECUTED));
    }

    // ─── Fix 3: SC-AUTH — fromWallet auth on propose() ───────────────────────

    /**
     * @notice Fix 3 hardening: a third party cannot call propose() pretending to be
     *         a different fromWallet address. msg.sender must equal fromWallet.
     */
    function test_SettlementCoordinator_RejectsWrongCaller() public {
        address attacker = address(0xDEAD);
        address victimWallet = address(0xABCD);

        // Attacker tries to propose a settlement on behalf of victimWallet
        vm.prank(attacker);
        vm.expectRevert("SC: caller must be fromWallet");
        coordinator.propose(
            victimWallet,    // fromWallet  ≠ msg.sender (attacker)
            toWallet,
            1 ether,
            address(0),
            INTENT_ID,
            block.timestamp + 1 hours
        );
    }

    // ─── F-19: ACCEPTED execution deadline ───────────────────────────────────

    function test_ExpireAccepted_AfterWindow() public {
        bytes32 proposalId = _propose();
        vm.prank(toWallet);
        coordinator.accept(proposalId);

        // Cannot expire while window is open
        vm.expectRevert("SettlementCoordinator: execution window open");
        coordinator.expireAccepted(proposalId);

        // Warp past execution window
        vm.warp(block.timestamp + 7 days + 1);

        // Anyone can expire it
        vm.prank(address(0xCAFE));
        coordinator.expireAccepted(proposalId);

        (,,,,,,, SettlementCoordinator.ProposalStatus status,) = coordinator.getProposal(proposalId);
        assertEq(uint(status), uint(SettlementCoordinator.ProposalStatus.EXPIRED));
    }

    function test_ExpireAccepted_CannotExpireEarly() public {
        bytes32 proposalId = _propose();
        vm.prank(toWallet);
        coordinator.accept(proposalId);

        vm.warp(block.timestamp + 6 days); // 6 days < 7 day window
        vm.expectRevert("SettlementCoordinator: execution window open");
        coordinator.expireAccepted(proposalId);
    }

    function test_Execute_CannotExecuteAfterWindow() public {
        // Use a long-lived proposal so expiresAt doesn't fire before the execution window check
        bytes32 proposalId = fromWallet.callPropose(toWallet, 1 ether, address(0), INTENT_ID, block.timestamp + 30 days);
        vm.prank(toWallet);
        coordinator.accept(proposalId);

        // Warp past 7-day execution window (but still within 30-day expiresAt)
        vm.warp(block.timestamp + 7 days + 1);

        vm.expectRevert("SettlementCoordinator: execution window expired");
        fromWallet.callExecute{value: 1 ether}(proposalId, 1 ether);
    }

    function test_ExpireAccepted_OnlyOnAccepted() public {
        bytes32 proposalId = _propose();
        // Still PENDING — not accepted
        vm.expectRevert("SettlementCoordinator: not accepted");
        coordinator.expireAccepted(proposalId);
    }
}
