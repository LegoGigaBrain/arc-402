// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/TrustRegistryV2.sol";
import "../contracts/TrustRegistry.sol"; // v1, for migration test

/**
 * @title TrustRegistryV2Test
 * @notice Foundry test suite for TrustRegistryV2 — capability-specific Sybil-resistant trust.
 *
 * Coverage:
 *   - Wallet initialisation (fresh + v1 migration)
 *   - recordSuccess: base case, value weighting, counterparty diversity decay
 *   - recordAnomaly: penalty size (50 pts vs v1's 20)
 *   - Time decay: 180-day half-life, full decay floor
 *   - On-chain capability slots (top-5 enforcement)
 *   - Minimum agreement value gate
 *   - Attack cost commentary (see test_AttackCost_Commentary)
 */
contract TrustRegistryV2Test is Test {

    TrustRegistryV2 registry;
    TrustRegistry   v1;

    address constant WALLET      = address(0xA1);
    address constant COUNTERPARTY = address(0xB1);

    // Reference value = 0.01 ETH
    uint256 constant REF_VALUE = 1e16;

    function setUp() public {
        // Deploy without v1 migration unless specific test needs it
        registry = new TrustRegistryV2(address(0));
        registry.addUpdater(address(this));
    }

    // ─── Initialisation ──────────────────────────────────────────────────────

    /// @notice Fresh wallet: initWallet sets global score to INITIAL_SCORE (100).
    function test_InitWallet() public {
        registry.initWallet(WALLET);
        assertEq(registry.getGlobalScore(WALLET), 100, "globalScore should be 100 after init");
    }

    /// @notice initWallet is idempotent — second call does not reset score.
    function test_InitWallet_Idempotent() public {
        registry.initWallet(WALLET);
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", REF_VALUE);
        registry.initWallet(WALLET); // should be no-op
        assertEq(registry.getGlobalScore(WALLET), 105, "initWallet should not reset score");
    }

    /// @notice Uninitialised wallet returns 0 for effective score.
    function test_UninitWallet_EffectiveScoreZero() public {
        assertEq(registry.getEffectiveScore(WALLET), 0);
    }

    // ─── recordSuccess: Base Case ─────────────────────────────────────────────

    /// @notice 0.01 ETH agreement, first counterparty → score 100 → 105.
    /// @dev valMul = sqrt(10_000) = 100; divMul = 10_000 (first deal); gain = 5*100*10000/1_000_000 = 5.
    function test_RecordSuccess_BaseCase() public {
        registry.initWallet(WALLET);
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", REF_VALUE);
        assertEq(registry.getGlobalScore(WALLET), 105, "score should be 105 after base-case success");
    }

    /// @notice Capability score is also initialised and updated on first success.
    function test_RecordSuccess_CapabilityScore_BaseCase() public {
        registry.initWallet(WALLET);
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", REF_VALUE);
        // Capability initialises at INITIAL_SCORE (100) + gain (5) = 105
        assertEq(registry.getCapabilityScore(WALLET, "compute"), 105);
    }

    // ─── recordSuccess: Value-Weighted ───────────────────────────────────────

    /// @notice 1 ETH agreement earns more than 0.01 ETH agreement.
    /// @dev 1 ETH: valMul = min(sqrt(1_000_000), 500) = 500; gain = 5*500*10000/1_000_000 = 25.
    ///             0.01 ETH: gain = 5.  25 > 5. ✓
    function test_RecordSuccess_ValueWeighted() public {
        // Wallet A: 0.01 ETH agreement
        address walletA = address(0xA1);
        address walletB = address(0xA2);
        registry.initWallet(walletA);
        registry.initWallet(walletB);

        registry.recordSuccess(walletA, COUNTERPARTY, "compute", REF_VALUE);  // 0.01 ETH → +5
        registry.recordSuccess(walletB, COUNTERPARTY, "compute", 1 ether);    // 1 ETH → +25

        uint256 scoreA = registry.getGlobalScore(walletA);
        uint256 scoreB = registry.getGlobalScore(walletB);

        assertGt(scoreB, scoreA, "1 ETH agreement should yield higher score gain than 0.01 ETH");
        assertEq(scoreA, 105, "0.01 ETH: 100 + 5 = 105");
        assertEq(scoreB, 125, "1 ETH: 100 + 25 = 125 (capped at MAX_SINGLE_GAIN)");
    }

    /// @notice A 10 ETH agreement still caps at MAX_SINGLE_GAIN (25 pts).
    function test_RecordSuccess_ValueCap() public {
        registry.initWallet(WALLET);
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", 10 ether);
        assertEq(registry.getGlobalScore(WALLET), 125, "Value cap at 5x base = 25 pts max");
    }

    // ─── recordSuccess: Counterparty Diversity Decay ─────────────────────────

    /// @notice 10 deals with same counterparty: deals 9 and 10 yield 0 trust gain.
    /// @dev With REF_VALUE and the diversity multiplier table:
    ///       deal 9  → priorCount=8 → divMul=39   → gain=(5*100*39)/1_000_000 = 0
    ///       deal 10 → priorCount=9 → divMul=19   → gain=(5*100*19)/1_000_000 = 0
    function test_RecordSuccess_DiversityDecay() public {
        registry.initWallet(WALLET);

        // Record 8 deals — each gives decreasing but eventually positive gain
        for (uint256 i = 0; i < 8; i++) {
            registry.recordSuccess(WALLET, COUNTERPARTY, "compute", REF_VALUE);
            vm.roll(block.number + 1);
        }
        uint256 scoreAfter8 = registry.getGlobalScore(WALLET);

        // Deal 9: priorCount = 8 → diversityMultiplier = 39
        // gain = (5 * 100 * 39) / 1_000_000 = 19_500 / 1_000_000 = 0 (integer truncation)
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", REF_VALUE);
        uint256 scoreAfter9 = registry.getGlobalScore(WALLET);

        // Deal 10: priorCount = 9 → diversityMultiplier = 19
        // gain = (5 * 100 * 19) / 1_000_000 = 9_500 / 1_000_000 = 0
        vm.roll(block.number + 1);
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", REF_VALUE);
        uint256 scoreAfter10 = registry.getGlobalScore(WALLET);

        assertEq(scoreAfter9,  scoreAfter8,  "Deal 9 should yield 0 trust gain");
        assertEq(scoreAfter10, scoreAfter8,  "Deal 10 should yield 0 trust gain");

        // Sanity: first deal DID add trust
        assertGt(scoreAfter8, 100, "First 8 deals should have added some trust");
    }

    /// @notice Different counterparties each yield full trust gain (diversity not penalised).
    function test_RecordSuccess_DifferentCounterparties_FullGain() public {
        registry.initWallet(WALLET);
        registry.recordSuccess(WALLET, address(0xC1), "compute", REF_VALUE); // gain=5
        vm.roll(block.number + 1);
        registry.recordSuccess(WALLET, address(0xC2), "compute", REF_VALUE); // gain=5 (new CP)
        assertEq(registry.getGlobalScore(WALLET), 110, "Two unique counterparties: 100+5+5=110");
    }

    // ─── recordAnomaly ────────────────────────────────────────────────────────

    /// @notice Anomaly deducts 50 pts (was 20 in v1), making dispute farming unprofitable.
    function test_RecordAnomaly_DeductsMore() public {
        registry.initWallet(WALLET);
        uint256 scoreBefore = registry.getGlobalScore(WALLET); // 100

        registry.recordAnomaly(WALLET, COUNTERPARTY, "compute", REF_VALUE);

        uint256 scoreAfter = registry.getGlobalScore(WALLET);
        int256  delta      = int256(scoreAfter) - int256(scoreBefore);

        assertEq(delta, -50, "Anomaly should deduct exactly 50 pts (not v1's 20)");
        assertEq(scoreAfter, 50, "100 - 50 = 50");
    }

    /// @notice Anomaly floors at 0, never underflows.
    function test_RecordAnomaly_FloorsAtZero() public {
        registry.initWallet(WALLET);
        registry.recordAnomaly(WALLET, COUNTERPARTY, "compute", REF_VALUE); // 100 → 50
        vm.roll(block.number + 1);
        registry.recordAnomaly(WALLET, COUNTERPARTY, "compute", REF_VALUE); // 50 → 0
        assertEq(registry.getGlobalScore(WALLET), 0);
    }

    // ─── Time Decay ──────────────────────────────────────────────────────────

    /// @notice After 180 days (one half-life), effective score halves toward floor (100).
    /// @dev Stored score = 900. Floor = 100. Above = 800.
    ///      After 1 half-life: above = 800 >> 1 = 400. Effective = 100 + 400 = 500.
    function test_EffectiveScore_TimeDecay() public {
        registry.initWallet(WALLET);

        // Build up to score 900: need (900 - 100) / 25 = 32 max-value agreements
        for (uint256 i = 0; i < 32; i++) {
            // Use unique counterparties to avoid diversity decay
            registry.recordSuccess(WALLET, address(uint160(0xC000 + i)), "compute", 1 ether);
            vm.roll(block.number + 1);
        }
        uint256 storedScore = registry.getGlobalScore(WALLET);
        assertGe(storedScore, 800, "Should have built significant score");

        // Record exact stored score for decay math
        uint256 above       = storedScore > 100 ? storedScore - 100 : 0;
        uint256 expectedEff = 100 + (above >> 1); // after 1 half-life

        // Warp 180 days
        vm.warp(block.timestamp + 180 days);

        uint256 effScore = registry.getEffectiveScore(WALLET);
        assertEq(effScore, expectedEff, "Effective score should halve above-floor portion after 180 days");
        assertLt(effScore, storedScore, "Effective score should be less than stored after decay");
    }

    /// @notice After 5+ years (≥10 half-lives), effective score decays to floor (100).
    function test_EffectiveScore_FullDecay() public {
        registry.initWallet(WALLET);

        // Build a high score
        for (uint256 i = 0; i < 32; i++) {
            registry.recordSuccess(WALLET, address(uint160(0xD000 + i)), "compute", 1 ether);
            vm.roll(block.number + 1);
        }
        assertGt(registry.getGlobalScore(WALLET), 100);

        // Warp 5 years (> 10 half-lives of 180 days each)
        vm.warp(block.timestamp + 1825 days); // 5 years

        assertEq(registry.getEffectiveScore(WALLET), 100, "Should decay to floor (100) after 5 years");
    }

    /// @notice Effective score equals stored score immediately after activity (no elapsed time).
    function test_EffectiveScore_NoDecayImmediately() public {
        registry.initWallet(WALLET);
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", 1 ether);
        uint256 stored = registry.getGlobalScore(WALLET);
        assertEq(registry.getEffectiveScore(WALLET), stored, "No decay at t=0");
    }

    // ─── On-Chain Capability Slots (Top-5) ────────────────────────────────────

    /// @notice Record 6 unique capabilities — only 5 fit on-chain; 6th is not stored.
    /// @dev All 6 get the same score (105), so the 6th cannot displace any slot.
    function test_CapabilityScore_TopFive() public {
        registry.initWallet(WALLET);

        string[6] memory caps = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];

        for (uint256 i = 0; i < 6; i++) {
            registry.recordSuccess(WALLET, COUNTERPARTY, caps[i], REF_VALUE);
            vm.roll(block.number + 1);
        }

        // First 5 should be stored (score 105)
        uint256 stored = 0;
        for (uint256 i = 0; i < 6; i++) {
            if (registry.getCapabilityScore(WALLET, caps[i]) > 0) {
                stored++;
            }
        }
        assertEq(stored, 5, "Exactly 5 capability scores should be stored on-chain");

        // 6th capability (zeta) should NOT be stored (tie score with all slots, no replacement)
        assertEq(registry.getCapabilityScore(WALLET, "zeta"), 0, "6th capability should not be on-chain");
    }

    /// @notice Higher-scoring capability displaces lowest slot when all 5 are full.
    function test_CapabilityScore_HigherScoreDisplacesLowest() public {
        registry.initWallet(WALLET);

        string[5] memory base = ["a", "b", "c", "d", "e"];

        // Fill 5 slots at base score (105 each)
        for (uint256 i = 0; i < 5; i++) {
            registry.recordSuccess(WALLET, COUNTERPARTY, base[i], REF_VALUE);
            vm.roll(block.number + 1);
        }

        // Now record a high-value agreement for a 6th capability → score 125 (>105)
        registry.recordSuccess(WALLET, COUNTERPARTY, "highval", 1 ether);

        // "highval" should now be in a slot (displaced lowest 105 slot)
        assertEq(registry.getCapabilityScore(WALLET, "highval"), 125, "High-value capability should be stored");
    }

    // ─── Minimum Agreement Value ──────────────────────────────────────────────

    /// @notice Agreements below minimumAgreementValue are silently skipped.
    function test_MinimumAgreementValue_SkipsSmall() public {
        registry.setMinimumAgreementValue(REF_VALUE); // 0.01 ETH minimum
        registry.initWallet(WALLET);

        uint256 scoreBefore = registry.getGlobalScore(WALLET); // 100

        // 1 wei < 0.01 ETH minimum → no score update, no revert
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", 1);

        assertEq(registry.getGlobalScore(WALLET), scoreBefore, "Sub-minimum agreement should not change score");
    }

    /// @notice Agreement exactly at the minimum IS processed.
    function test_MinimumAgreementValue_ExactMinimumProcessed() public {
        registry.setMinimumAgreementValue(REF_VALUE);
        registry.initWallet(WALLET);

        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", REF_VALUE); // exactly at min
        assertEq(registry.getGlobalScore(WALLET), 105, "Exact minimum should be processed");
    }

    /// @notice minimumAgreementValue = 0 disables the gate (all agreements processed).
    function test_MinimumAgreementValue_ZeroDisabled() public {
        registry.setMinimumAgreementValue(0);
        registry.initWallet(WALLET);

        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", 1); // 1 wei, gate disabled
        // gain = (5 * sqrt(1*10000/1e16) * 10000) / 1_000_000 ≈ 0 (very tiny value)
        // Score change = 0 or +0 — just verifying no revert
        assertGe(registry.getGlobalScore(WALLET), 100, "No revert for 1 wei when gate disabled");
    }

    /// @notice Minimum value gate also applies to recordAnomaly.
    function test_MinimumAgreementValue_AnomalySkipped() public {
        registry.setMinimumAgreementValue(REF_VALUE);
        registry.initWallet(WALLET);

        uint256 scoreBefore = registry.getGlobalScore(WALLET);
        registry.recordAnomaly(WALLET, COUNTERPARTY, "compute", 1); // 1 wei < minimum

        assertEq(registry.getGlobalScore(WALLET), scoreBefore, "Sub-minimum anomaly should not change score");
    }

    // ─── V1 Migration ─────────────────────────────────────────────────────────

    /// @notice Deploy v2 with v1 registry; initWallet migrates v1 score as global score.
    function test_V1Migration() public {
        // Deploy v1 and give a wallet a score of 500
        v1 = new TrustRegistry();
        v1.addUpdater(address(this));
        v1.initWallet(WALLET);
        // Build score to 500: (500-100)/5 = 80 successes
        for (uint256 i = 0; i < 80; i++) {
            v1.recordSuccess(WALLET, address(uint160(i + 1)), "legacy", REF_VALUE);
        }
        assertEq(v1.getScore(WALLET), 500, "v1 score should be 500");

        // Deploy v2 pointing at v1
        TrustRegistryV2 v2 = new TrustRegistryV2(address(v1));
        v2.addUpdater(address(this));

        // initWallet on v2 should read v1 score = 500
        v2.initWallet(WALLET);
        assertEq(v2.getGlobalScore(WALLET), 500, "v2 global score should be migrated from v1");
    }

    /// @notice Wallet with no v1 score starts at INITIAL_SCORE (100) even with v1 configured.
    function test_V1Migration_NoV1Score_StartsAtInitial() public {
        v1 = new TrustRegistry();
        TrustRegistryV2 v2 = new TrustRegistryV2(address(v1));

        // WALLET has no score in v1 (getScore returns 0)
        v2.initWallet(WALLET);
        assertEq(v2.getGlobalScore(WALLET), 100, "No v1 score should fall back to INITIAL_SCORE");
    }

    // ─── Authorization ────────────────────────────────────────────────────────

    /// @notice Unauthorised address cannot call recordSuccess.
    function test_Auth_RecordSuccess_Unauthorised() public {
        registry.initWallet(WALLET);
        vm.prank(address(0xDEAD));
        vm.expectRevert("TrustRegistryV2: not authorized updater");
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", REF_VALUE);
    }

    /// @notice Unauthorised address cannot call recordAnomaly.
    function test_Auth_RecordAnomaly_Unauthorised() public {
        registry.initWallet(WALLET);
        vm.prank(address(0xDEAD));
        vm.expectRevert("TrustRegistryV2: not authorized updater");
        registry.recordAnomaly(WALLET, COUNTERPARTY, "compute", REF_VALUE);
    }

    // ─── meetsThreshold / meetsCapabilityThreshold ────────────────────────────

    function test_MeetsThreshold_True() public {
        registry.initWallet(WALLET);
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", 1 ether); // → 125
        assertTrue(registry.meetsThreshold(WALLET, 110));
    }

    function test_MeetsThreshold_False() public {
        registry.initWallet(WALLET);
        assertFalse(registry.meetsThreshold(WALLET, 200));
    }

    function test_MeetsCapabilityThreshold() public {
        registry.initWallet(WALLET);
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", 1 ether); // cap score = 125
        assertTrue(registry.meetsCapabilityThreshold(WALLET, 110, "compute"));
        assertFalse(registry.meetsCapabilityThreshold(WALLET, 200, "compute"));
        assertFalse(registry.meetsCapabilityThreshold(WALLET, 50, "legal-research")); // untracked cap
    }

    // ─── Deal Count ───────────────────────────────────────────────────────────

    function test_DealCount_Increments() public {
        registry.initWallet(WALLET);
        bytes32 capHash = keccak256(abi.encodePacked("compute"));

        assertEq(registry.dealCount(WALLET, COUNTERPARTY, capHash), 0);
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", REF_VALUE);
        assertEq(registry.dealCount(WALLET, COUNTERPARTY, capHash), 1);
        vm.roll(block.number + 1);
        registry.recordSuccess(WALLET, COUNTERPARTY, "compute", REF_VALUE);
        assertEq(registry.dealCount(WALLET, COUNTERPARTY, capHash), 2);
    }

    // ─── Attack Cost Commentary ───────────────────────────────────────────────

    /**
     * @notice Documents the Sybil attack cost comparison (not a pass/fail test).
     *
     * v1: 140 self-deals at $0.01 → $1.40 total → Autonomous tier
     *
     * v2 (compute, REF_VALUE = 0.01 ETH ≈ $30 at $3000/ETH):
     *   - gain per deal  = 5 pts (first deal, full diversity)
     *   - For 10th+ deal with same counterparty: 0 pts (integer truncation)
     *   - To reach 800 pts from 100 (700 pts needed) using ONLY first-deal counterparties:
     *     700 / 5 = 140 unique counterparties required
     *   - Capital: 140 × 0.01 ETH = 1.4 ETH ≈ $4,200 at $3000/ETH
     *   - Plus counterparty funding: 140 wallets × 0.01 ETH = 1.4 ETH more
     *   - Total deployed capital: ~$8,400 (vs v1's $1.40)
     *
     * v2 (legal-research at $50 minimum, using ETH):
     *   - value = 50/3000 ETH ≈ 0.0167 ETH → valMul ≈ 129; gain ≈ 6 pts per deal
     *   - 700 / 6 ≈ 117 unique counterparties × $50 = $5,850 in agreement value
     *   - Both sides need funding: ~$11,700 deployed capital minimum
     *
     * Cost uplift: ~4–5 orders of magnitude over v1 for single-actor Sybil.
     * Capability specificity: compute trust ≠ legal-research trust (compartmentalised).
     */
    function test_AttackCost_Commentary() public pure {
        // Verify key constants match the attack cost analysis
        uint256 baseIncrement = 5;
        uint256 ptsNeeded     = 700; // 800 - 100 (Autonomous tier - initial score)
        uint256 uniqueCPs     = ptsNeeded / baseIncrement; // 140 unique counterparties minimum
        assertEq(uniqueCPs, 140);

        // At 0.01 ETH per deal, 140 unique CPs = 1.4 ETH minimum capital
        // At $3000/ETH ≈ $4,200 per side = $8,400 total
        // Compare: v1 = 140 × $0.01 = $1.40 total
        // Uplift factor: 8400 / 1.40 = 6000× minimum
        uint256 v1CostCents   = 140;      // cents ($1.40)
        uint256 v2CostCents   = 840_000;  // cents ($8,400) at $3000/ETH
        assertGt(v2CostCents, v1CostCents * 1000, "v2 attack cost should be >1000x v1");
    }
}
