// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/IntentAttestation.sol";

contract IntentAttestationTest is Test {
    IntentAttestation attestor;
    bytes32 constant ID = keccak256("test-intent-1");

    function setUp() public {
        attestor = new IntentAttestation();
    }

    function test_attest_and_verify() public {
        attestor.attest(ID, "pay_provider", "Test payment", address(0x999), 0.1 ether, address(0), 0);
        assertTrue(attestor.verify(ID, address(this), address(0x999), 0.1 ether, address(0)));
    }

    function test_verify_wrongWallet() public {
        attestor.attest(ID, "pay_provider", "Test payment", address(0x999), 0.1 ether, address(0), 0);
        assertFalse(attestor.verify(ID, address(0x1234), address(0x999), 0.1 ether, address(0)));
    }

    function test_verify_nonexistentAttestation() public {
        assertFalse(attestor.verify(bytes32(0), address(this), address(0), 0, address(0)));
    }

    function test_immutability_cannotReattest() public {
        attestor.attest(ID, "pay_provider", "Test payment", address(0x999), 0.1 ether, address(0), 0);
        vm.expectRevert("IntentAttestation: already exists");
        attestor.attest(ID, "pay_provider_2", "Different", address(0x999), 0.2 ether, address(0), 0);
    }

    function test_getAttestation() public {
        attestor.attest(ID, "acquire_records", "Medical records for claim", address(0x999), 0.05 ether, address(0), 0);
        (bytes32 id, address wallet, string memory action, string memory reason, address recipient, uint256 amount, address token,) = attestor.getAttestation(ID);
        assertEq(id, ID);
        assertEq(wallet, address(this));
        assertEq(action, "acquire_records");
        assertEq(reason, "Medical records for claim");
        assertEq(recipient, address(0x999));
        assertEq(amount, 0.05 ether);
        assertEq(token, address(0));
    }

    function test_attest_withToken() public {
        address usdc = address(0x036CbD53842c5426634e7929541eC2318f3dCF7e);
        attestor.attest(ID, "api_call", "x402 payment for API access", address(0x999), 1_000_000, usdc, 0);
        (,,,,,, address token,) = attestor.getAttestation(ID);
        assertEq(token, usdc);
    }

    // ─── Expiry Tests ─────────────────────────────────────────────────────────

    function test_Attest_WithExpiry() public {
        uint256 expiry = block.timestamp + 1 hours;
        attestor.attest(ID, "pay_provider", "Expiring payment", address(0x999), 0.1 ether, address(0), expiry);
        // Should still be valid before expiry
        assertTrue(attestor.verify(ID, address(this), address(0x999), 0.1 ether, address(0)));
    }

    function test_Attest_Expired_FailsVerify() public {
        uint256 expiry = block.timestamp + 1 hours;
        attestor.attest(ID, "pay_provider", "Expiring payment", address(0x999), 0.1 ether, address(0), expiry);
        // Warp past expiry
        vm.warp(block.timestamp + 2 hours);
        assertFalse(attestor.verify(ID, address(this), address(0x999), 0.1 ether, address(0)));
    }

    function test_Attest_NoExpiry_AlwaysValid() public {
        attestor.attest(ID, "pay_provider", "No expiry payment", address(0x999), 0.1 ether, address(0), 0);
        // Warp forward 1 year — should still be valid
        vm.warp(block.timestamp + 365 days);
        assertTrue(attestor.verify(ID, address(this), address(0x999), 0.1 ether, address(0)));
    }

    function test_Attest_ExpiryInPast_Reverts() public {
        vm.warp(1000); // ensure block.timestamp > 1 so past expiry is non-zero
        uint256 pastExpiry = block.timestamp - 1;
        vm.expectRevert("IA: expiry in past");
        attestor.attest(ID, "pay_provider", "Already expired", address(0x999), 0.1 ether, address(0), pastExpiry);
    }

    function test_IsExpired_ReturnsCorrectly() public {
        uint256 expiry = block.timestamp + 1 hours;
        attestor.attest(ID, "pay_provider", "Expiry check", address(0x999), 0.1 ether, address(0), expiry);

        // Before expiry: not expired
        assertFalse(attestor.isExpired(ID));

        // Warp past expiry
        vm.warp(expiry + 1);
        assertTrue(attestor.isExpired(ID));
    }
}
