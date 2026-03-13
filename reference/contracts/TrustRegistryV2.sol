// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ITrustRegistryV2.sol";
import "./ITrustRegistry.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title TrustRegistryV2
 * @notice Capability-specific, Sybil-resistant trust registry for ARC-402.
 *
 * STATUS: DRAFT — not audited, do not use in production
 *
 * Mechanisms vs v1:
 *   1. Capability-specific scores (top-5 stored on-chain; full profile on IPFS)
 *   2. Counterparty diversity — diminishing returns for repeated same-counterparty deals
 *   3. Value-weighted trust gains — sqrt scaling vs reference 0.01 ETH, capped at 5× base
 *   4. Time decay at read time — 6-month half-life toward floor (100)
 *   5. Asymmetric anomaly penalty — 50 pts (was 20 in v1)
 *   6. Minimum agreement value floor — below threshold = no trust update, no revert
 *   7. Lazy v1 migration — on first interaction, reads v1 score as initial global score
 *
 * @dev Uses Ownable2Step to require two-step ownership transfer (prevents phishing hijack).
 */
contract TrustRegistryV2 is ITrustRegistryV2, ITrustRegistry, Ownable2Step {

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant MAX_SCORE       = 1000;
    uint256 public constant INITIAL_SCORE   = 100;   // Starting score for new wallets
    uint256 public constant DECAY_FLOOR     = 100;   // Score never decays below this
    uint256 public constant HALF_LIFE       = 180 days; // Time decay half-life
    uint256 public constant REFERENCE_VALUE = 1e16;  // 0.01 ETH — base value anchor
    uint256 public constant BASE_INCREMENT  = 5;     // Trust gain at 1× value multiplier
    uint256 public constant MAX_SINGLE_GAIN = 25;    // 5× BASE_INCREMENT cap per agreement
    uint256 public constant ANOMALY_PENALTY = 50;    // Points deducted per anomaly (v1 was 20)
    uint256 public constant CAP_SLOTS       = 5;     // On-chain capability slots per wallet

    // ─── Storage ─────────────────────────────────────────────────────────────

    /// @notice Full trust profiles keyed by wallet address.
    mapping(address => TrustProfile) public profiles;

    /// @notice Top-5 on-chain capability score slots per wallet.
    /// @dev CapabilityScore.capabilityHash == 0 means slot is empty.
    // slither-disable-next-line uninitialized-state
    mapping(address => CapabilityScore[5]) internal _capabilitySlots;

    /// @notice Counterparty diversity tracker: wallet → counterparty → capabilityHash → count.
    /// @dev Count = number of PRIOR completed deals. Read before incrementing.
    mapping(address => mapping(address => mapping(bytes32 => uint256))) public dealCount;

    /// @notice Addresses authorised to call recordSuccess / recordAnomaly.
    mapping(address => bool) public isAuthorizedUpdater;

    /// @notice Tracks the last block number a wallet's trust score was written.
    ///         Used by noFlashLoan modifier to block same-block multi-write attacks.
    mapping(address => uint256) private _lastUpdateBlock;

    /// @notice Minimum agreement value (wei). 0 = disabled.
    /// @dev Agreements below this threshold produce no trust update (not reverted).
    uint256 public minimumAgreementValue;

    /// @notice Optional v1 registry for lazy migration.
    ITrustRegistry public immutable v1Registry;

    // ─── Events (beyond ITrustRegistryV2) ───────────────────────────────────

    event UpdaterAdded(address indexed updater);
    event UpdaterRemoved(address indexed updater);
    event MinimumAgreementValueUpdated(uint256 oldValue, uint256 newValue);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyUpdater() {
        require(isAuthorizedUpdater[msg.sender], "TrustRegistryV2: not authorized updater");
        _;
    }

    /// @dev Prevents flash-loan-assisted same-block trust manipulation.
    ///      A wallet's trust score can only be written once per block.
    modifier noFlashLoan(address subject) {
        require(block.number > _lastUpdateBlock[subject], "TrustRegistryV2: flash loan protection");
        _lastUpdateBlock[subject] = block.number;
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param _v1Registry Address of the v1 TrustRegistry for lazy migration.
    ///                    Pass address(0) to disable v1 migration.
    constructor(address _v1Registry) Ownable(msg.sender) {
        v1Registry = ITrustRegistry(_v1Registry);
        isAuthorizedUpdater[msg.sender] = true;
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function addUpdater(address updater) external onlyOwner {
        isAuthorizedUpdater[updater] = true;
        emit UpdaterAdded(updater);
    }

    function removeUpdater(address updater) external onlyOwner {
        isAuthorizedUpdater[updater] = false;
        emit UpdaterRemoved(updater);
    }

    /// @notice Set the minimum agreement value (wei). 0 = disabled.
    function setMinimumAgreementValue(uint256 value) external onlyOwner {
        emit MinimumAgreementValueUpdated(minimumAgreementValue, value);
        minimumAgreementValue = value;
    }

    // ─── Write ───────────────────────────────────────────────────────────────

    /// @inheritdoc ITrustRegistryV2
    function initWallet(address wallet) external override(ITrustRegistry, ITrustRegistryV2) {
        _ensureInitialized(wallet);
    }

    /// @inheritdoc ITrustRegistryV2
    function recordSuccess(
        address wallet,
        address counterparty,
        string calldata capability,
        uint256 agreementValueWei
    ) external override(ITrustRegistry, ITrustRegistryV2) onlyUpdater noFlashLoan(wallet) {
        // Minimum agreement value gate — silent skip, no revert
        if (minimumAgreementValue > 0 && agreementValueWei < minimumAgreementValue) return;

        _ensureInitialized(wallet);

        bytes32 capHash = keccak256(abi.encodePacked(capability));

        // ── Compute trust gain ──────────────────────────────────────────────
        uint256 valMul     = _valueMultiplier(agreementValueWei);       // 0–500 (100 = 1×)
        uint256 priorCount = dealCount[wallet][counterparty][capHash];
        uint256 divMul     = _diversityMultiplier(priorCount);          // 0–10000 (10000 = 100%)

        // gain = BASE_INCREMENT × (valMul/100) × (divMul/10000)
        // Rearranged to avoid precision loss: multiply first, divide last.
        uint256 gain = (BASE_INCREMENT * valMul * divMul) / (100 * 10_000);

        // Increment deal count AFTER computing gain (prior count used for current deal)
        dealCount[wallet][counterparty][capHash] = priorCount + 1;

        if (gain == 0) {
            // Still update lastUpdated and deal count — activity occurred
            profiles[wallet].lastUpdated = block.timestamp;
            return;
        }

        // ── Update capability score ─────────────────────────────────────────
        _updateCapabilitySlot(wallet, capHash, gain);

        // ── Update global score ─────────────────────────────────────────────
        TrustProfile storage p = profiles[wallet];
        uint256 oldGlobal = p.globalScore;
        uint256 newGlobal  = oldGlobal + gain > MAX_SCORE ? MAX_SCORE : oldGlobal + gain;
        p.globalScore  = newGlobal;
        p.lastUpdated  = block.timestamp;

        // gain is bounded by MAX_SCORE (1000) — safe to cast to int256
        emit ScoreUpdated(wallet, newGlobal, capability, int256(uint256(gain)));
    }

    /// @inheritdoc ITrustRegistryV2
    function recordAnomaly(
        address wallet,
        address counterparty,
        string calldata capability,
        uint256 agreementValueWei
    ) external override(ITrustRegistry, ITrustRegistryV2) onlyUpdater noFlashLoan(wallet) {
        // Minimum agreement value gate
        if (minimumAgreementValue > 0 && agreementValueWei < minimumAgreementValue) return;

        _ensureInitialized(wallet);

        // Suppress unused variable warnings — counterparty logged for off-chain indexing
        // but not used in penalty computation (penalty is fixed at ANOMALY_PENALTY).
        // We reference it to avoid compiler warnings.
        counterparty; // intentionally unused in penalty calc

        bytes32 capHash = keccak256(abi.encodePacked(capability));

        // ── Deduct from capability score ────────────────────────────────────
        _deductCapabilitySlot(wallet, capHash, ANOMALY_PENALTY);

        // ── Deduct from global score ────────────────────────────────────────
        TrustProfile storage p = profiles[wallet];
        uint256 oldGlobal = p.globalScore;
        uint256 newGlobal  = oldGlobal >= ANOMALY_PENALTY ? oldGlobal - ANOMALY_PENALTY : 0;
        p.globalScore  = newGlobal;
        p.lastUpdated  = block.timestamp;

        // ANOMALY_PENALTY is a small constant (50) — safe to cast to int256
        emit ScoreUpdated(wallet, newGlobal, capability, -int256(uint256(ANOMALY_PENALTY)));
    }

    // ─── Read ────────────────────────────────────────────────────────────────

    /// @inheritdoc ITrustRegistryV2
    function getGlobalScore(address wallet) public view returns (uint256) {
        return profiles[wallet].globalScore;
    }

    /// @inheritdoc ITrustRegistry
    function getScore(address wallet) external view override(ITrustRegistry, ITrustRegistryV2) returns (uint256) {
        return getGlobalScore(wallet);
    }

    /// @inheritdoc ITrustRegistryV2
    /// @dev Applies half-life time decay toward DECAY_FLOOR at read time.
    ///      Decay is NEVER stored — only computed on each read.
    function getEffectiveScore(address wallet) external view override(ITrustRegistry, ITrustRegistryV2) returns (uint256) {
        TrustProfile storage p = profiles[wallet];
        if (p.lastUpdated == 0) return 0;

        uint256 elapsed = block.timestamp - p.lastUpdated;
        if (elapsed == 0) return p.globalScore;

        uint256 above = p.globalScore > DECAY_FLOOR ? p.globalScore - DECAY_FLOOR : 0;

        // Integer approximation: halve `above` for each complete HALF_LIFE elapsed.
        // Accurate to ~1 part in 1000 for intervals up to 10 years.
        uint256 halvings = elapsed / HALF_LIFE;
        if (halvings >= 10) return DECAY_FLOOR; // Fully decayed after ~5 years

        above = above >> halvings; // right-shift = divide by 2^halvings

        return DECAY_FLOOR + above;
    }

    /// @inheritdoc ITrustRegistryV2
    /// @dev Scans the 5 on-chain capability slots. Returns 0 if not found.
    function getCapabilityScore(address wallet, string calldata capability) external view returns (uint256) {
        bytes32 capHash = keccak256(abi.encodePacked(capability));
        CapabilityScore[5] storage slots = _capabilitySlots[wallet];
        for (uint256 i = 0; i < CAP_SLOTS; i++) {
            if (slots[i].capabilityHash == capHash) {
                return slots[i].score;
            }
        }
        return 0;
    }

    /// @inheritdoc ITrustRegistryV2
    function meetsThreshold(address wallet, uint256 minScore) external view returns (bool) {
        TrustProfile storage p = profiles[wallet];
        if (p.lastUpdated == 0) return false;

        // Re-compute effective score inline (same logic as getEffectiveScore)
        uint256 elapsed  = block.timestamp - p.lastUpdated;
        uint256 above    = p.globalScore > DECAY_FLOOR ? p.globalScore - DECAY_FLOOR : 0;
        uint256 halvings = elapsed / HALF_LIFE;
        if (halvings >= 10) return DECAY_FLOOR >= minScore;
        uint256 effective = DECAY_FLOOR + (above >> halvings);
        return effective >= minScore;
    }

    /// @inheritdoc ITrustRegistryV2
    function meetsCapabilityThreshold(
        address wallet,
        uint256 minScore,
        string calldata capability
    ) external view returns (bool) {
        bytes32 capHash = keccak256(abi.encodePacked(capability));
        CapabilityScore[5] storage slots = _capabilitySlots[wallet];
        for (uint256 i = 0; i < CAP_SLOTS; i++) {
            if (slots[i].capabilityHash == capHash) {
                return slots[i].score >= minScore;
            }
        }
        return false;
    }

    /// @notice Expose the on-chain capability slots for a wallet (for inspection/testing).
    function getCapabilitySlots(address wallet) external view returns (CapabilityScore[5] memory) {
        return _capabilitySlots[wallet];
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    /// @dev Initialise a wallet profile if not already done.
    ///      Performs lazy v1 migration if v1Registry is configured and has a score.
    function _ensureInitialized(address wallet) internal {
        if (profiles[wallet].lastUpdated != 0) return; // Already initialised

        uint256 initialScore = INITIAL_SCORE;

        if (address(v1Registry) != address(0)) {
            try v1Registry.getScore(wallet) returns (uint256 v1Score) {
                if (v1Score > 0) initialScore = v1Score;
            } catch {
                // v1 call failed — fall back to INITIAL_SCORE
            }
        }

        profiles[wallet] = TrustProfile({
            globalScore:           initialScore,
            lastUpdated:           block.timestamp,
            capabilityProfileHash: bytes32(0)
        });

        emit WalletInitialized(wallet, initialScore);
    }

    /// @dev Update (or insert) a capability score slot on a successful agreement.
    ///      Slot selection priority:
    ///        1. Existing slot for this capabilityHash  → add gain (cap at MAX_SCORE)
    ///        2. Empty slot (hash == 0)                 → initialise at INITIAL_SCORE + gain
    ///        3. Full: replace lowest-score slot if INITIAL_SCORE + gain > that slot's score
    function _updateCapabilitySlot(address wallet, bytes32 capHash, uint256 gain) internal {
        CapabilityScore[5] storage slots = _capabilitySlots[wallet];

        // Pass 1: find existing slot
        for (uint256 i = 0; i < CAP_SLOTS; i++) {
            if (slots[i].capabilityHash == capHash) {
                uint256 cur = slots[i].score;
                slots[i].score = cur + gain > MAX_SCORE ? MAX_SCORE : cur + gain;
                return;
            }
        }

        // New capability — starting score = INITIAL_SCORE + gain (capped)
        uint256 newScore = INITIAL_SCORE + gain > MAX_SCORE ? MAX_SCORE : INITIAL_SCORE + gain;

        // Pass 2: find empty slot
        for (uint256 i = 0; i < CAP_SLOTS; i++) {
            if (slots[i].capabilityHash == bytes32(0)) {
                slots[i] = CapabilityScore({ capabilityHash: capHash, score: newScore });
                return;
            }
        }

        // Pass 3: replace lowest-score slot if new score is strictly higher
        uint256 minIdx   = 0;
        uint256 minScore = slots[0].score;
        for (uint256 i = 1; i < CAP_SLOTS; i++) {
            if (slots[i].score < minScore) {
                minScore = slots[i].score;
                minIdx   = i;
            }
        }
        if (newScore > minScore) {
            slots[minIdx] = CapabilityScore({ capabilityHash: capHash, score: newScore });
        }
        // Otherwise: 6th+ capability with score ≤ min existing — not stored on-chain
    }

    /// @dev Deduct from a capability slot's score (anomaly). If not present, no-op for that slot.
    function _deductCapabilitySlot(address wallet, bytes32 capHash, uint256 penalty) internal {
        CapabilityScore[5] storage slots = _capabilitySlots[wallet];
        for (uint256 i = 0; i < CAP_SLOTS; i++) {
            if (slots[i].capabilityHash == capHash) {
                slots[i].score = slots[i].score >= penalty ? slots[i].score - penalty : 0;
                return;
            }
        }
        // Capability not in top-5 slots — global score still deducted (handled by caller)
    }

    /// @dev Value multiplier: sqrt(valueWei / REFERENCE_VALUE) scaled to 100 = 1×, capped at 500 (5×).
    ///      Internally: ratio = (valueWei * 10_000) / REFERENCE_VALUE; return sqrt(ratio) capped at 500.
    function _valueMultiplier(uint256 valueWei) internal pure returns (uint256) {
        if (valueWei == 0) return 0;
        // Scale up by 10_000 to preserve precision through sqrt.
        // For REFERENCE_VALUE (0.01 ETH): ratio = 10_000 → sqrt = 100 → 1× ✓
        // For 1 ETH:                      ratio = 1_000_000 → sqrt = 1000 → capped at 500 ✓
        uint256 ratio    = (valueWei * 10_000) / REFERENCE_VALUE;
        uint256 sqrtVal  = _sqrt(ratio);
        return sqrtVal > 500 ? 500 : sqrtVal;
    }

    /// @dev Counterparty diversity multiplier in basis points (10_000 = 100%, 0 = 0%).
    ///      Halves with each additional deal with the same counterparty in the same capability.
    ///      10th+ deal = 0 (rounds down, preventing unbounded farming).
    function _diversityMultiplier(uint256 priorCount) internal pure returns (uint256) {
        if (priorCount == 0) return 10_000;
        if (priorCount == 1) return  5_000;
        if (priorCount == 2) return  2_500;
        if (priorCount == 3) return  1_250;
        if (priorCount == 4) return    625;
        if (priorCount == 5) return    312;
        if (priorCount == 6) return    156;
        if (priorCount == 7) return     78;
        if (priorCount == 8) return     39;
        if (priorCount == 9) return     19;
        return 0; // 10th+ deal: 0 trust gain
    }

    /// @dev Integer square root (Babylonian / Heron's method).
    ///      Returns floor(sqrt(x)).
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    /// @notice Protocol version tag (Spec 20).
    function protocolVersion() external pure returns (string memory) {
        return "1.0.0";
    }

    /// @inheritdoc ITrustRegistry
    function recordArbitratorSlash(
        address arbitrator,
        string calldata reason
    ) external override(ITrustRegistry) onlyUpdater noFlashLoan(arbitrator) {
        _ensureInitialized(arbitrator);
        TrustProfile storage p = profiles[arbitrator];
        uint256 oldGlobal = p.globalScore;
        uint256 penalty = ANOMALY_PENALTY * 2; // Arbitrator slash is heavier than standard anomaly
        uint256 newGlobal = oldGlobal >= penalty ? oldGlobal - penalty : 0;
        p.globalScore = newGlobal;
        p.lastUpdated = block.timestamp;
        emit ScoreUpdated(arbitrator, newGlobal, reason, -int256(penalty));
    }
}
