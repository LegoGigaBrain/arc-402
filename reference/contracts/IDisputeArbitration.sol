// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IDisputeArbitration
/// @notice Standalone arbitration fee, bond, and trust layer for ARC-402
/// @dev Integrates with ServiceAgreement via four call sites.
///      USD denomination uses admin-set token rates (NOT a trustless oracle).
///      Deploy DisputeArbitration, then call ServiceAgreement.setDisputeArbitration().
///      Register DisputeArbitration as an authorized updater on TrustRegistry.
/// STATUS: DRAFT — not audited, do not use in production
interface IDisputeArbitration {

    // ─── Enums ───────────────────────────────────────────────────────────────

    enum DisputeMode {
        UNILATERAL, // opener pays full fee; win = 50% refund, lose = consumed
        MUTUAL      // each party pays 50%; no winner reimbursement
    }

    enum DisputeClass {
        HARD_FAILURE,      // 1.0x fee multiplier
        AMBIGUITY_QUALITY, // 1.25x fee multiplier
        HIGH_SENSITIVITY   // 1.5x fee multiplier
    }

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct DisputeFeeState {
        DisputeMode mode;
        DisputeClass disputeClass;
        address opener;
        address client;
        address provider;
        address token;
        uint256 agreementPrice;
        uint256 feeRequired;     // total fee in tokens, locked at open-time rate
        uint256 openerPaid;
        uint256 respondentPaid;  // mutual mode only
        uint256 openedAt;
        bool active;
        bool resolved;
    }

    struct ArbitratorBondState {
        uint256 bondAmount;      // in tokens
        uint256 lockedAt;
        bool locked;
        bool slashed;
        bool returned;
    }

    // ─── ServiceAgreement integration ────────────────────────────────────────

    /// @notice Called by ServiceAgreement._openFormalDispute.
    ///         Collects fee from opener (ETH or ERC-20 per agreement token).
    ///         Fee = min(max(3% × agreementPrice, feeFloor), feeCap) × classMultiplier, capped.
    ///         USD amounts converted to tokens via admin-set tokenUsdRate18[token].
    /// @return feeRequired Total fee in tokens locked at this open-time rate.
    function openDispute(
        uint256 agreementId,
        DisputeMode mode,
        DisputeClass disputeClass,
        address opener,
        address client,
        address provider,
        uint256 agreementPrice,
        address token
    ) external payable returns (uint256 feeRequired);

    /// @notice Called by respondent (non-opener) in MUTUAL mode to fund their half.
    ///         Must be called within MUTUAL_FUNDING_WINDOW of openDispute.
    function joinMutualDispute(uint256 agreementId) external payable;

    /// @notice Called by ServiceAgreement._finalizeDispute after escrow release.
    ///         Distributes fees, returns/slashes arbitrator bonds, writes to TrustRegistry.
    /// @param outcome uint8 cast of IServiceAgreement.DisputeOutcome
    function resolveDisputeFee(uint256 agreementId, uint8 outcome) external;

    /// @notice Called by ServiceAgreement.nominateArbitrator to gate eligibility.
    function isEligibleArbitrator(address arbitrator) external view returns (bool);

    // ─── Arbitrator panel ────────────────────────────────────────────────────

    /// @notice Called by a nominated arbitrator to accept panel assignment and post bond.
    ///         Bond = max(2 × feeRequired, minBondFloor). Payable in agreement token.
    function acceptAssignment(uint256 agreementId) external payable;

    /// @notice Called by anyone when fallback conditions are met:
    ///         - MUTUAL mode and respondent has not funded within MUTUAL_FUNDING_WINDOW
    ///         - Panel not formed by selectionDeadlineAt
    ///         Emits DisputeFallbackTriggered. Owner must manually trigger human escalation.
    function triggerFallback(uint256 agreementId) external returns (bool fallbackTriggered);

    /// @notice Owner-only manual slash for rules violations not detectable automatically.
    function slashArbitrator(uint256 agreementId, address arbitrator, string calldata reason) external;

    // ─── Views ───────────────────────────────────────────────────────────────

    function getDisputeFeeState(uint256 agreementId) external view returns (DisputeFeeState memory);

    function getArbitratorBondState(address arbitrator, uint256 agreementId) external view returns (ArbitratorBondState memory);

    /// @notice Preview fee without opening a dispute.
    function getFeeQuote(
        uint256 agreementPrice,
        address token,
        DisputeMode mode,
        DisputeClass disputeClass
    ) external view returns (uint256 feeInTokens);

    function getAcceptedArbitrators(uint256 agreementId) external view returns (address[] memory);

    /// @notice Called by ServiceAgreement.castArbitrationVote to record that an arbitrator voted.
    ///         Required so DisputeArbitration can distinguish voted vs missed-deadline arbitrators
    ///         when settling bonds and fees at resolveDisputeFee time.
    function recordArbitratorVote(uint256 agreementId, address arbitrator) external;

    // ─── Admin ───────────────────────────────────────────────────────────────

    /// @notice Set USD conversion rate for a token.
    ///         e.g. ETH at $2000 = setTokenUsdRate(address(0), 2000e18)
    ///         IMPORTANT: This is an admin-custody rate, not a trustless price oracle.
    function setTokenUsdRate(address token, uint256 usdRate18) external;

    function setFeeFloorUsd(uint256 floorUsd18) external;    // default 5e18  ($5)
    function setFeeCapUsd(uint256 capUsd18) external;        // default 250e18 ($250)
    function setMinBondFloorUsd(uint256 floorUsd18) external; // default 20e18 ($20)
    function setServiceAgreement(address sa) external;
    function setTrustRegistry(address tr) external;
    function setTreasury(address treasury) external;

    // ─── Events ──────────────────────────────────────────────────────────────

    event DisputeFeeOpened(uint256 indexed agreementId, DisputeMode mode, DisputeClass disputeClass, uint256 feeRequired, address token);
    event MutualDisputeFunded(uint256 indexed agreementId, address respondent, uint256 respondentFee);
    event DisputeFeeResolved(uint256 indexed agreementId, uint8 outcome, uint256 openerRefund);
    event ArbitratorAssigned(uint256 indexed agreementId, address indexed arbitrator, uint256 bondAmount);
    event ArbitratorBondReturned(uint256 indexed agreementId, address indexed arbitrator, uint256 amount);
    event ArbitratorBondSlashed(uint256 indexed agreementId, address indexed arbitrator, uint256 amount, string reason);
    event ArbitratorFeePaid(uint256 indexed agreementId, address indexed arbitrator, uint256 feeShare);
    event DisputeFallbackTriggered(uint256 indexed agreementId, string reason);
    event TokenRateSet(address indexed token, uint256 usdRate18);
    event TreasuryUpdated(address indexed treasury);
}
