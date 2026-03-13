// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/ARC402Wallet.sol";
import "../contracts/ARC402Registry.sol";
import "../contracts/PolicyEngine.sol";
import "../contracts/TrustRegistry.sol";
import "../contracts/IntentAttestation.sol";
import "../contracts/SettlementCoordinator.sol";

contract ARC402WalletGuardianTest is Test {
    // Allow this test contract to receive ETH (needed for freezeAndDrain tests where owner=address(this))
    receive() external payable {}
    PolicyEngine policyEngine;
    TrustRegistry trustRegistry;
    IntentAttestation intentAttestation;
    SettlementCoordinator settlementCoordinator;
    ARC402Registry reg;
    ARC402Wallet wallet;

    address owner = address(this);
    address guardian = address(0xC0A8D1A0);
    address attacker = address(0xDEAD);
    address recipient = address(0xBEEF);

    bytes32 constant CONTEXT_ID = keccak256("guardian-context");
    bytes32 constant ATTEST_ID  = keccak256("guardian-intent");

    function setUp() public {
        policyEngine = new PolicyEngine();
        trustRegistry = new TrustRegistry();
        intentAttestation = new IntentAttestation();
        settlementCoordinator = new SettlementCoordinator();

        reg = new ARC402Registry(
            address(policyEngine),
            address(trustRegistry),
            address(intentAttestation),
            address(settlementCoordinator),
            "v1.0.0"
        );

        wallet = new ARC402Wallet(address(reg), owner);
        trustRegistry.addUpdater(address(wallet));
        vm.deal(address(wallet), 10 ether);

        vm.prank(address(wallet));
        policyEngine.setCategoryLimit("claims", 1 ether);

        // Set guardian on the wallet
        wallet.setGuardian(guardian);
    }

    // ─── test_Guardian_CanFreeze ──────────────────────────────────────────────

    function test_Guardian_CanFreeze() public {
        assertFalse(wallet.frozen());
        vm.prank(guardian);
        wallet.freeze();
        assertTrue(wallet.frozen());
    }

    // ─── test_NonGuardian_CannotFreeze ────────────────────────────────────────

    function test_NonGuardian_CannotFreeze() public {
        vm.prank(attacker);
        vm.expectRevert("ARC402: not guardian");
        wallet.freeze();
    }

    function test_Owner_CannotCallGuardianFreeze() public {
        // The no-arg freeze() is guardian-only; owner should use freeze(string)
        vm.prank(owner);
        vm.expectRevert("ARC402: not guardian");
        wallet.freeze();
    }

    // ─── test_Frozen_BlocksExecute ────────────────────────────────────────────

    function test_Frozen_BlocksExecute() public {
        wallet.openContext(CONTEXT_ID, "claims_processing");
        wallet.attest(ATTEST_ID, "pay", "test", recipient, 0.1 ether, address(0), 0);

        vm.prank(guardian);
        wallet.freeze();

        vm.expectRevert("ARC402: wallet frozen");
        wallet.executeSpend(payable(recipient), 0.1 ether, "claims", ATTEST_ID);
    }

    // ─── test_Owner_CanUnfreeze ───────────────────────────────────────────────

    function test_Owner_CanUnfreeze() public {
        vm.prank(guardian);
        wallet.freeze();
        assertTrue(wallet.frozen());

        wallet.unfreeze();
        assertFalse(wallet.frozen());
    }

    // ─── test_Guardian_CannotUnfreeze (critical) ──────────────────────────────

    function test_Guardian_CannotUnfreeze() public {
        vm.prank(guardian);
        wallet.freeze();
        assertTrue(wallet.frozen());

        // Guardian cannot unfreeze — only owner can
        vm.prank(guardian);
        vm.expectRevert("ARC402: not owner");
        wallet.unfreeze();

        // Wallet remains frozen
        assertTrue(wallet.frozen());
    }

    // ─── test_Owner_CanSetGuardian ────────────────────────────────────────────

    function test_Owner_CanSetGuardian() public {
        address newGuardian = address(0x1EEF);
        wallet.setGuardian(newGuardian);
        assertEq(wallet.guardian(), newGuardian);

        // New guardian can freeze
        vm.prank(newGuardian);
        wallet.freeze();
        assertTrue(wallet.frozen());

        // Old guardian can no longer freeze (after unfreeze)
        wallet.unfreeze();
        vm.prank(guardian);
        vm.expectRevert("ARC402: not guardian");
        wallet.freeze();
    }

    function test_NonOwner_CannotSetGuardian() public {
        vm.prank(attacker);
        vm.expectRevert("ARC402: not owner");
        wallet.setGuardian(attacker);
    }

    // ─── test_FreezeAndDrain_MovesBalance ─────────────────────────────────────

    function test_FreezeAndDrain_MovesBalance() public {
        uint256 walletBalance = address(wallet).balance;
        assertTrue(walletBalance > 0, "wallet must have ETH for drain test");

        uint256 ownerBefore = owner.balance;

        vm.prank(guardian);
        wallet.freezeAndDrain();

        // All ETH moved to owner
        assertEq(address(wallet).balance, 0);
        assertEq(owner.balance, ownerBefore + walletBalance);
    }

    // ─── test_FreezeAndDrain_ThenFrozen ───────────────────────────────────────

    function test_FreezeAndDrain_ThenFrozen() public {
        vm.prank(guardian);
        wallet.freezeAndDrain();

        assertTrue(wallet.frozen());
        assertEq(wallet.frozenBy(), guardian);
    }

    // ─── test_FreezeAndDrain_NonGuardian_Reverts ──────────────────────────────

    function test_FreezeAndDrain_NonGuardian_Reverts() public {
        vm.prank(attacker);
        vm.expectRevert("ARC402: not guardian");
        wallet.freezeAndDrain();
    }

    // ─── test_GuardianNotSet_FreezeReverts ────────────────────────────────────

    function test_GuardianNotSet_FreezeReverts() public {
        // Deploy wallet without setting guardian
        ARC402Wallet w2 = new ARC402Wallet(address(reg), owner);
        vm.deal(address(w2), 1 ether);

        // Guardian is address(0) — check fires before the identity check
        vm.expectRevert("ARC402: guardian not set");
        w2.freeze();
    }
}
