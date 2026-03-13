// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/PolicyEngine.sol";

contract PolicyEngineTest is Test {
    PolicyEngine engine;
    address wallet = address(0x1234);

    function setUp() public {
        engine = new PolicyEngine();
        // Fix 4: registerWallet requires msg.sender == wallet (the wallet self-registers)
        vm.prank(wallet);
        engine.registerWallet(wallet, address(this));
    }

    function test_setCategoryLimit() public {
        vm.prank(wallet);
        engine.setCategoryLimit("claims", 1 ether);
        assertEq(engine.categoryLimits(wallet, "claims"), 1 ether);
    }

    function test_validateSpend_pass() public {
        vm.prank(wallet);
        engine.setCategoryLimit("claims", 1 ether);
        (bool valid, string memory reason) = engine.validateSpend(wallet, "claims", 0.5 ether, bytes32(0));
        assertTrue(valid);
        assertEq(reason, "");
    }

    function test_validateSpend_exceedsLimit() public {
        vm.prank(wallet);
        engine.setCategoryLimit("claims", 0.1 ether);
        (bool valid, string memory reason) = engine.validateSpend(wallet, "claims", 0.5 ether, bytes32(0));
        assertFalse(valid);
        assertEq(reason, "PolicyEngine: amount exceeds per-tx limit");
    }

    function test_validateSpend_categoryNotConfigured() public {
        (bool valid, string memory reason) = engine.validateSpend(wallet, "unknown", 0.1 ether, bytes32(0));
        assertFalse(valid);
        assertEq(reason, "PolicyEngine: category not configured");
    }

    function test_setCategoryLimitFor() public {
        // address(this) is registered as the owner of 'wallet' in setUp()
        engine.setCategoryLimitFor(wallet, "claims", 2 ether);
        assertEq(engine.categoryLimits(wallet, "claims"), 2 ether);
    }

    // ─── Fix 4: PolicyEngine access control tests ─────────────────────────────

    /**
     * @notice registerWallet requires the caller to be the wallet itself.
     *         A third party cannot hijack the walletOwners mapping for a wallet
     *         they don't control.
     */
    function test_registerWallet_RevertsIfCallerNotWallet() public {
        address victimWallet = address(0xABCD);
        address attacker = address(0xDEAD);

        vm.prank(attacker);
        vm.expectRevert("PolicyEngine: caller must be wallet");
        engine.registerWallet(victimWallet, attacker);
    }

    /**
     * @notice A wallet can only register once — re-registration is blocked to
     *         prevent owner hijacking after initial registration.
     */
    function test_registerWallet_RevertsOnDoubleRegistration() public {
        // wallet is already registered in setUp()
        vm.prank(wallet);
        vm.expectRevert("PolicyEngine: already registered");
        engine.registerWallet(wallet, address(0xBEEF));
    }

    /**
     * @notice A non-owner cannot call setCategoryLimitFor on a wallet they don't own.
     *         Verifies the trust boundary on wallet policy assignment.
     */
    function test_setCategoryLimitFor_RevertsForNonOwner() public {
        address attacker = address(0xDEAD);

        vm.prank(attacker);
        vm.expectRevert("PolicyEngine: not authorized");
        engine.setCategoryLimitFor(wallet, "claims", 999 ether);
    }
}
