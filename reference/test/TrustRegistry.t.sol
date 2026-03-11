// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/TrustRegistry.sol";

contract TrustRegistryTest is Test {
    TrustRegistry registry;
    address wallet = address(0xABCD);

    function setUp() public {
        registry = new TrustRegistry();
        registry.addUpdater(address(this));
    }

    function test_initWallet() public {
        registry.initWallet(wallet);
        assertEq(registry.getScore(wallet), 100);
    }

    function test_initWallet_idempotent() public {
        registry.initWallet(wallet);
        registry.initWallet(wallet);
        assertEq(registry.getScore(wallet), 100);
    }

    function test_recordSuccess_increments() public {
        registry.initWallet(wallet);
        registry.recordSuccess(wallet, address(0xBEEF), "legacy", 1 ether);
        assertEq(registry.getScore(wallet), 105);
    }

    function test_recordSuccess_capsAt1000() public {
        registry.initWallet(wallet);
        // Need to get to near 1000
        for (uint i = 0; i < 180; i++) {
            registry.recordSuccess(wallet, address(0xBEEF), "legacy", 1 ether);
        }
        assertEq(registry.getScore(wallet), 1000);
    }

    function test_recordAnomaly_decrements() public {
        registry.initWallet(wallet);
        registry.recordAnomaly(wallet, address(0xBEEF), "legacy", 1 ether);
        assertEq(registry.getScore(wallet), 80);
    }

    function test_recordAnomaly_floorsAt0() public {
        registry.initWallet(wallet);
        // Score starts at 100, decrement is 20, so 5 anomalies = 0
        for (uint i = 0; i < 10; i++) {
            registry.recordAnomaly(wallet, address(0xBEEF), "legacy", 1 ether);
        }
        assertEq(registry.getScore(wallet), 0);
    }

    function test_getTrustLevel_restricted() public {
        registry.initWallet(wallet);
        // Score 100 = restricted
        assertEq(registry.getTrustLevel(wallet), "restricted");
    }

    function test_getTrustLevel_standard() public {
        registry.initWallet(wallet);
        for (uint i = 0; i < 40; i++) {
            registry.recordSuccess(wallet, address(0xBEEF), "legacy", 1 ether);
        }
        // 100 + 40*5 = 300 = standard
        assertEq(registry.getTrustLevel(wallet), "standard");
    }

    function test_getTrustLevel_elevated() public {
        registry.initWallet(wallet);
        for (uint i = 0; i < 120; i++) {
            registry.recordSuccess(wallet, address(0xBEEF), "legacy", 1 ether);
        }
        // 100 + 120*5 = 700 = elevated
        assertEq(registry.getTrustLevel(wallet), "elevated");
    }

    function test_getTrustLevel_autonomous() public {
        registry.initWallet(wallet);
        for (uint i = 0; i < 180; i++) {
            registry.recordSuccess(wallet, address(0xBEEF), "legacy", 1 ether);
        }
        assertEq(registry.getTrustLevel(wallet), "autonomous");
    }

    function test_uninitializedScore() public {
        assertEq(registry.getScore(wallet), 0);
    }
}
