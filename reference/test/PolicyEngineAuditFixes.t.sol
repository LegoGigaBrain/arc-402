// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/PolicyEngine.sol";

/**
 * @title PolicyEngineAuditFixesTest
 * @notice Tests for all five Opus-recommended audit fixes:
 *   Fix 1 - Two-bucket spend window (boundary cliff fix)
 *   Fix 2 - Emergency freeze (PolicyEngine-level kill switch)
 *   Fix 3 - Velocity detection (hourly tx/spend rate limits)
 *   Fix 4 - Per-agreement cap reduction with 24-hour timelock
 *   Fix 5 - Limit changes must NOT reset spend window state
 */
contract PolicyEngineAuditFixesTest is Test {
    PolicyEngine engine;

    address wallet = address(0x1111);
    address owner  = address(0x2222);
    address watchtower = address(0x3333);
    address attacker   = address(0x4444);

    string constant CAT = "claims";

    function setUp() public {
        engine = new PolicyEngine();
        vm.prank(wallet);
        engine.registerWallet(wallet, owner);

        // Set a per-tx limit so category is configured
        vm.prank(wallet);
        engine.setCategoryLimit(CAT, 10 ether);

        // Set a daily limit of 20 ether
        vm.prank(wallet);
        engine.setDailyLimit(CAT, 20 ether);
    }

    // ─── Fix 1: Two-bucket window ─────────────────────────────────────────────

    function test_TwoBucket_FirstSpendRecorded() public {
        // Record 5 ETH in first bucket
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 5 ether, bytes32(0));

        (bool v,) = engine.validateSpend(wallet, CAT, 5 ether, bytes32(0));
        assertTrue(v, "should have 5 ETH headroom");

        // Another 10.1 ETH would exceed the 20 ETH daily
        (bool over,) = engine.validateSpend(wallet, CAT, 10.1 ether, bytes32(0));
        // 5 + 10.1 = 15.1 which is <= 20, so this is valid (per-tx limit is 10 ETH)
        // Actually 10.1 > per-tx limit of 10, so it fails per-tx. Use 10 ether.
        (bool atLimit,) = engine.validateSpend(wallet, CAT, 10 ether, bytes32(0));
        assertTrue(atLimit, "5+10=15 <= 20 daily limit");

        (bool overflow,) = engine.validateSpend(wallet, CAT, 6 ether, bytes32(0));
        // 5+6=11 <= 20: valid. But 6 > per-tx limit of 10? No, 6 < 10. OK.
        assertTrue(overflow, "5+6=11 <= 20");

        // Now push accumulated to near limit: record 14 more
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 14 ether, bytes32(0));

        // Now 5+14=19 accumulated; next spend of 1.1 ETH should fail
        (bool atEdge,) = engine.validateSpend(wallet, CAT, 1 ether, bytes32(0));
        assertTrue(atEdge, "19+1=20 exactly at daily limit");

        (bool exceeded,) = engine.validateSpend(wallet, CAT, 2 ether, bytes32(0));
        assertFalse(exceeded, "19+2=21 > 20 daily limit");
    }

    function test_TwoBucket_BucketRotation() public {
        // Spend 8 ETH in bucket 0
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 8 ether, bytes32(0));

        // Advance past one BUCKET_DURATION (12 hours) - triggers bucket rotation
        vm.warp(block.timestamp + 12 hours + 1);

        // Spend 6 ETH in bucket 1 (new current)
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 6 ether, bytes32(0));

        // Effective = current(6) + previous(8) = 14 ETH
        // Daily limit = 20; headroom = 6 ETH
        (bool v,) = engine.validateSpend(wallet, CAT, 6 ether, bytes32(0));
        assertTrue(v, "6+8=14 <= 20, 6 more is fine");

        (bool over,) = engine.validateSpend(wallet, CAT, 7 ether, bytes32(0));
        assertFalse(over, "6+8+7=21 > 20 daily limit");
    }

    function test_TwoBucket_FullExpiry_ResetsToZero() public {
        // Spend 18 ETH
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 8 ether, bytes32(0));
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 10 ether, bytes32(0));

        // Advance past TWO bucket durations (24 hours) - both buckets expired
        vm.warp(block.timestamp + 24 hours + 1);

        // Effective spend should now be 0
        (bool v,) = engine.validateSpend(wallet, CAT, 10 ether, bytes32(0));
        assertTrue(v, "window fully expired - accumulated should be 0");
    }

    function test_TwoBucket_PreviousBucketOnlyVisible_AfterOneRotation() public {
        // Spend 12 ETH in bucket 0
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 5 ether, bytes32(0));
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 7 ether, bytes32(0));

        // Advance exactly one bucket (12h) - bucket 0 becomes previous, new current = 0
        vm.warp(block.timestamp + 12 hours + 1);

        // No spend in new bucket yet; effective = 0(current) + 12(previous) = 12 ETH
        // Headroom = 20 - 12 = 8 ETH
        (bool v8,) = engine.validateSpend(wallet, CAT, 8 ether, bytes32(0));
        assertTrue(v8, "12+8=20 exactly at limit");

        (bool v9,) = engine.validateSpend(wallet, CAT, 9 ether, bytes32(0));
        assertFalse(v9, "12+9=21 > 20 limit");
    }

    // ─── Fix 2: Emergency freeze ──────────────────────────────────────────────

    function test_Freeze_OwnerCanFreeze() public {
        vm.prank(owner);
        engine.freezeSpend(wallet);
        assertTrue(engine.spendFrozen(wallet));
    }

    function test_Freeze_WalletCanFreeze() public {
        vm.prank(wallet);
        engine.freezeSpend(wallet);
        assertTrue(engine.spendFrozen(wallet));
    }

    function test_Freeze_WatchtowerCanFreeze() public {
        vm.prank(wallet);
        engine.authorizeFreezeAgent(watchtower);

        vm.prank(watchtower);
        engine.freezeSpend(wallet);
        assertTrue(engine.spendFrozen(wallet));
    }

    function test_Freeze_UnauthorizedCannotFreeze() public {
        vm.prank(attacker);
        vm.expectRevert("PolicyEngine: not authorized");
        engine.freezeSpend(wallet);
    }

    function test_Freeze_BlocksValidateSpend() public {
        vm.prank(owner);
        engine.freezeSpend(wallet);

        vm.expectRevert("PolicyEngine: spend frozen");
        engine.validateSpend(wallet, CAT, 1 ether, bytes32(0));
    }

    function test_Unfreeze_OwnerCanUnfreeze() public {
        vm.prank(owner);
        engine.freezeSpend(wallet);

        vm.prank(owner);
        engine.unfreeze(wallet);
        assertFalse(engine.spendFrozen(wallet));

        (bool v,) = engine.validateSpend(wallet, CAT, 1 ether, bytes32(0));
        assertTrue(v, "spending allowed after unfreeze");
    }

    function test_Unfreeze_WatchtowerCannotUnfreeze() public {
        vm.prank(wallet);
        engine.authorizeFreezeAgent(watchtower);

        vm.prank(watchtower);
        engine.freezeSpend(wallet);

        vm.prank(watchtower);
        vm.expectRevert("PolicyEngine: only owner can unfreeze");
        engine.unfreeze(wallet);
    }

    function test_RevokedWatchtowerCannotFreeze() public {
        vm.prank(wallet);
        engine.authorizeFreezeAgent(watchtower);
        assertTrue(engine.isFreezeAgent(wallet, watchtower));

        vm.prank(wallet);
        engine.revokeFreezeAgent(watchtower);
        assertFalse(engine.isFreezeAgent(wallet, watchtower));

        vm.prank(watchtower);
        vm.expectRevert("PolicyEngine: not authorized");
        engine.freezeSpend(wallet);
    }

    // ─── Fix 3: Velocity detection ────────────────────────────────────────────

    function test_Velocity_TxRateLimit_BlocksExcess() public {
        vm.prank(owner);
        engine.setMaxTxPerHour(wallet, 3);

        // 3 spends - all OK
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(wallet);
            engine.recordSpend(wallet, CAT, 1 ether, bytes32(0));
        }

        (bool v,) = engine.validateSpend(wallet, CAT, 1 ether, bytes32(0));
        assertFalse(v, "4th tx in same hour should be blocked");
    }

    function test_Velocity_TxRateLimit_ResetsAfterWindow() public {
        vm.prank(owner);
        engine.setMaxTxPerHour(wallet, 2);

        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 1 ether, bytes32(0));
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 1 ether, bytes32(0));

        // Advance 1 hour + 1 second - both velocity buckets fully expired
        vm.warp(block.timestamp + 1 hours + 1);

        (bool v,) = engine.validateSpend(wallet, CAT, 1 ether, bytes32(0));
        assertTrue(v, "velocity window reset after 1 hour");
    }

    function test_Velocity_SpendRateLimit_BlocksExcess() public {
        vm.prank(owner);
        engine.setMaxSpendPerHour(wallet, 8 ether);

        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 5 ether, bytes32(0));

        (bool ok,) = engine.validateSpend(wallet, CAT, 3 ether, bytes32(0));
        assertTrue(ok, "5+3=8 exactly at hourly limit");

        (bool over,) = engine.validateSpend(wallet, CAT, 4 ether, bytes32(0));
        assertFalse(over, "5+4=9 > 8 hourly limit");
    }

    function test_Velocity_Disabled_WhenZero() public {
        // Default is 0 - velocity limits disabled; many small spends should pass velocity checks
        // Record 5 spends of 0.1 ETH each (total 0.5 ETH, well under 20 ETH daily)
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(wallet);
            engine.recordSpend(wallet, CAT, 0.1 ether, bytes32(0));
        }
        // Velocity not blocking (disabled); daily limit has plenty of headroom
        (bool v,) = engine.validateSpend(wallet, CAT, 1 ether, bytes32(0));
        assertTrue(v, "velocity limits disabled - spend should pass");
    }

    function test_Velocity_ExistingWallets_Unaffected() public {
        // maxTxPerHour=0, maxSpendPerHour=0 → velocity checks skipped entirely
        address wallet2 = address(0x5555);
        vm.prank(wallet2);
        engine.registerWallet(wallet2, address(this));
        vm.prank(wallet2);
        engine.setCategoryLimit(CAT, 10 ether);

        // 100 spends with no velocity limits set - all pass validation
        for (uint256 i = 0; i < 100; i++) {
            (bool v,) = engine.validateSpend(wallet2, CAT, 0.01 ether, bytes32(0));
            assertTrue(v);
            vm.prank(wallet2);
            engine.recordSpend(wallet2, CAT, 0.01 ether, bytes32(0));
        }
    }

    function test_Velocity_TxBucketRotation() public {
        vm.prank(owner);
        engine.setMaxTxPerHour(wallet, 5);

        // 4 spends in first 30-min bucket
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(wallet);
            engine.recordSpend(wallet, CAT, 0.1 ether, bytes32(0));
        }

        // Advance past one VELOCITY_BUCKET (30 min) - first bucket becomes previous
        vm.warp(block.timestamp + 30 minutes + 1);

        // 1 spend in new bucket: effective = 1(current) + 4(previous) = 5 → at limit
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 0.1 ether, bytes32(0));

        // 6th tx would be 2+4=6 > 5 → blocked
        (bool v,) = engine.validateSpend(wallet, CAT, 0.1 ether, bytes32(0));
        assertFalse(v, "1+4=5 at limit; 6th blocked");
    }

    // ─── Fix 4: Per-agreement cap reduction with timelock ─────────────────────

    function test_CapReduction_QueueAndApply() public {
        // Current daily limit = 20 ether; reduce to 10 ether
        vm.prank(owner);
        engine.queueCapReduction(wallet, CAT, 10 ether);

        // Verify pending state
        (uint256 newCap, uint256 effectiveAt) = engine.pendingCapReductions(wallet, CAT);
        assertEq(newCap, 10 ether);
        assertEq(effectiveAt, block.timestamp + 86400);

        // Cannot apply before timelock
        vm.expectRevert("PolicyEngine: timelock active");
        engine.applyCapReduction(wallet, CAT);

        // Warp past timelock
        vm.warp(block.timestamp + 86400 + 1);
        engine.applyCapReduction(wallet, CAT);

        assertEq(engine.dailyCategoryLimit(wallet, CAT), 10 ether);

        // Pending reduction should be cleared
        (uint256 cleared,) = engine.pendingCapReductions(wallet, CAT);
        assertEq(cleared, 0);
    }

    function test_CapReduction_CannotIncrease() public {
        vm.prank(owner);
        vm.expectRevert("PolicyEngine: can only reduce cap");
        engine.queueCapReduction(wallet, CAT, 25 ether); // > 20 current
    }

    function test_CapReduction_CannotQueueEqualCap() public {
        vm.prank(owner);
        vm.expectRevert("PolicyEngine: can only reduce cap");
        engine.queueCapReduction(wallet, CAT, 20 ether); // equal, not less
    }

    function test_CapReduction_UnauthorizedCannotQueue() public {
        vm.prank(attacker);
        vm.expectRevert("PolicyEngine: not authorized");
        engine.queueCapReduction(wallet, CAT, 5 ether);
    }

    function test_CapReduction_NoPending_RevertsOnApply() public {
        vm.expectRevert("PolicyEngine: no pending reduction");
        engine.applyCapReduction(wallet, CAT);
    }

    function test_CapReduction_DoesNotResetSpendWindow() public {
        // Queue cap reduction first (effectiveAt = now + 86400)
        vm.prank(owner);
        engine.queueCapReduction(wallet, CAT, 18 ether);

        // Warp to just before the timelock expires, then record spend so the
        // bucket window starts fresh (well within the 2*BUCKET_DURATION = 86400s window)
        vm.warp(block.timestamp + 86399);
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 5 ether, bytes32(0));
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 10 ether, bytes32(0));

        // Warp 2 more seconds to pass the timelock (window expires 86400s after the spend above)
        vm.warp(block.timestamp + 2);
        engine.applyCapReduction(wallet, CAT);

        // New limit = 18. Accumulated = 15 (window NOT reset by applyCapReduction).
        // 15+4=19 > 18 should be blocked
        (bool over,) = engine.validateSpend(wallet, CAT, 4 ether, bytes32(0));
        assertFalse(over, "15+4=19 > 18 new cap, window preserved");

        // 15+3=18 exactly at new limit should pass
        (bool atLimit,) = engine.validateSpend(wallet, CAT, 3 ether, bytes32(0));
        assertTrue(atLimit, "15+3=18 exactly at new cap");
    }

    function test_CapReduction_WalletSelfCanQueue() public {
        vm.prank(wallet);
        engine.queueCapReduction(wallet, CAT, 5 ether);
        (uint256 newCap,) = engine.pendingCapReductions(wallet, CAT);
        assertEq(newCap, 5 ether);
    }

    // ─── Fix 5: Limit changes must NOT reset spend window state ───────────────

    function test_SetCategoryLimit_DoesNotResetWindow() public {
        // Record 15 ETH spend (recordSpend has no per-tx check)
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 15 ether, bytes32(0));

        // Change per-tx limit - must NOT reset accumulated window
        vm.prank(wallet);
        engine.setCategoryLimit(CAT, 5 ether);

        // accumulated=15, daily=20, per-tx=5; amount=5: 5<=5 ✓, 15+5=20<=20 ✓ → valid
        (bool v,) = engine.validateSpend(wallet, CAT, 5 ether, bytes32(0));
        assertTrue(v, "15+5=20 exactly at daily limit, window not reset");

        // 6 > per-tx limit of 5 → blocked by per-tx check
        (bool over,) = engine.validateSpend(wallet, CAT, 6 ether, bytes32(0));
        assertFalse(over, "6 > per-tx limit of 5");
    }

    function test_SetDailyLimit_DoesNotResetWindow() public {
        // Record 12 ETH
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 12 ether, bytes32(0));

        // Tighten daily limit to 15 ETH (must not reset accumulated window)
        vm.prank(wallet);
        engine.setDailyLimit(CAT, 15 ether);

        // Accumulated=12, new limit=15; headroom=3
        (bool ok3,) = engine.validateSpend(wallet, CAT, 3 ether, bytes32(0));
        assertTrue(ok3, "12+3=15 at new limit, window not reset");

        (bool over4,) = engine.validateSpend(wallet, CAT, 4 ether, bytes32(0));
        assertFalse(over4, "12+4=16 > 15 new limit");
    }

    function test_SetMaxTxPerHour_DoesNotResetWindow() public {
        // Record 2 spends
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 1 ether, bytes32(0));
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 1 ether, bytes32(0));

        // Set velocity limit to 3/hour (window already has 2)
        vm.prank(owner);
        engine.setMaxTxPerHour(wallet, 3);

        // 3rd tx should be fine (2+1=3)
        (bool ok,) = engine.validateSpend(wallet, CAT, 1 ether, bytes32(0));
        assertTrue(ok, "2 existing + 1 new = 3 at limit");

        // 4th would exceed
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 1 ether, bytes32(0));
        (bool over,) = engine.validateSpend(wallet, CAT, 1 ether, bytes32(0));
        assertFalse(over, "3 existing + 1 = 4 > limit of 3");
    }

    function test_SetMaxSpendPerHour_DoesNotResetWindow() public {
        // Record 5 ETH
        vm.prank(wallet);
        engine.recordSpend(wallet, CAT, 5 ether, bytes32(0));

        // Set hourly limit to 8 ETH (window already has 5)
        vm.prank(owner);
        engine.setMaxSpendPerHour(wallet, 8 ether);

        (bool ok,) = engine.validateSpend(wallet, CAT, 3 ether, bytes32(0));
        assertTrue(ok, "5+3=8 at hourly limit");

        (bool over,) = engine.validateSpend(wallet, CAT, 4 ether, bytes32(0));
        assertFalse(over, "5+4=9 > 8 hourly limit");
    }
}
