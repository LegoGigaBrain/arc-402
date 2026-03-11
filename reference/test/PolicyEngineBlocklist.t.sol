// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/PolicyEngine.sol";

contract PolicyEngineBlocklistTest is Test {
    PolicyEngine pe;
    address wallet = address(0xAAAA);
    address owner  = address(0xBBBB);
    address provider1 = address(0xC001);
    address provider2 = address(0xC002);

    function setUp() public {
        pe = new PolicyEngine();
        // Register wallet with owner
        vm.prank(wallet);
        pe.registerWallet(wallet, owner);
    }

    // ─── Blocklist ────────────────────────────────────────────────────────────

    function test_Blocklist_OwnerCanBlock() public {
        vm.prank(owner);
        pe.addToBlocklist(wallet, provider1);
        assertTrue(pe.isBlocked(wallet, provider1));
    }

    function test_Blocklist_WalletCanBlock() public {
        vm.prank(wallet);
        pe.addToBlocklist(wallet, provider1);
        assertTrue(pe.isBlocked(wallet, provider1));
    }

    function test_Blocklist_UnauthorizedReverts() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert("PolicyEngine: not authorized");
        pe.addToBlocklist(wallet, provider1);
    }

    function test_Blocklist_Unblock() public {
        vm.prank(owner);
        pe.addToBlocklist(wallet, provider1);
        assertTrue(pe.isBlocked(wallet, provider1));

        vm.prank(owner);
        pe.removeFromBlocklist(wallet, provider1);
        assertFalse(pe.isBlocked(wallet, provider1));
    }

    function test_Blocklist_NotBlockedByDefault() public view {
        assertFalse(pe.isBlocked(wallet, provider1));
        assertFalse(pe.isBlocked(wallet, provider2));
    }

    // ─── Shortlist ────────────────────────────────────────────────────────────

    function test_Shortlist_OwnerCanAddPreferred() public {
        vm.prank(owner);
        pe.addPreferred(wallet, "legal-research", provider1);
        assertTrue(pe.isPreferred(wallet, "legal-research", provider1));
    }

    function test_Shortlist_GetPreferredList() public {
        vm.prank(owner);
        pe.addPreferred(wallet, "legal-research", provider1);
        vm.prank(owner);
        pe.addPreferred(wallet, "legal-research", provider2);

        address[] memory list = pe.getPreferred(wallet, "legal-research");
        assertEq(list.length, 2);
    }

    function test_Shortlist_RemovePreferred() public {
        vm.prank(owner);
        pe.addPreferred(wallet, "legal-research", provider1);
        vm.prank(owner);
        pe.addPreferred(wallet, "legal-research", provider2);

        vm.prank(owner);
        pe.removePreferred(wallet, "legal-research", provider1);

        assertFalse(pe.isPreferred(wallet, "legal-research", provider1));
        assertTrue(pe.isPreferred(wallet, "legal-research", provider2));
        assertEq(pe.getPreferred(wallet, "legal-research").length, 1);
    }

    function test_Shortlist_CapabilityIsolation() public {
        vm.prank(owner);
        pe.addPreferred(wallet, "legal-research", provider1);

        // provider1 preferred for legal-research but not for coding
        assertTrue(pe.isPreferred(wallet, "legal-research", provider1));
        assertFalse(pe.isPreferred(wallet, "coding", provider1));
    }

    function test_Shortlist_CannotAddTwice() public {
        vm.prank(owner);
        pe.addPreferred(wallet, "legal-research", provider1);
        vm.prank(owner);
        vm.expectRevert("PolicyEngine: already preferred");
        pe.addPreferred(wallet, "legal-research", provider1);
    }

    function test_Shortlist_UnauthorizedReverts() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert("PolicyEngine: not authorized");
        pe.addPreferred(wallet, "legal-research", provider1);
    }
}
