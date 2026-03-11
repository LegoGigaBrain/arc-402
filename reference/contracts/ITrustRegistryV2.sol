// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITrustRegistryV2
/// @notice Capability-specific, Sybil-resistant trust registry interface for ARC-402
/// @dev Supersedes ITrustRegistry (v1 global score). Adds: capability scoring,
///      counterparty diversity decay, value-weighted gains, time decay, asymmetric penalties.
interface ITrustRegistryV2 {
    /// @notice Compatibility alias for v1-style consumers.
    function getScore(address wallet) external view returns (uint256);

    // ─── Structs ────────────────────────────────────────────────────────────

    struct TrustProfile {
        uint256 globalScore;           // Stored score (pre-decay); use getEffectiveScore() for gating
        uint256 lastUpdated;           // block.timestamp of last qualifying activity (0 = uninitialised)
        bytes32 capabilityProfileHash; // IPFS CIDv1 hash of full capability JSON profile (bytes32 truncated)
    }

    struct CapabilityScore {
        bytes32 capabilityHash; // keccak256(capability string)
        uint256 score;          // Stored capability score (0 = uninitialised)
    }

    // ─── Events ─────────────────────────────────────────────────────────────

    /// @notice Emitted whenever a wallet's global score changes.
    /// @param delta Signed delta (positive = gain, negative = penalty)
    event ScoreUpdated(
        address indexed wallet,
        uint256 newGlobalScore,
        string capability,
        int256 delta
    );

    /// @notice Emitted on first initialisation of a wallet profile.
    event WalletInitialized(address indexed wallet, uint256 initialScore);

    // ─── Write ───────────────────────────────────────────────────────────────

    /// @notice Record a successful agreement fulfillment.
    /// @param wallet           The wallet that fulfilled the agreement (provider)
    /// @param counterparty     The wallet on the other side (client); used for diversity tracking
    /// @param capability       Human-readable capability string (hashed internally)
    /// @param agreementValueWei Agreement payment in wei; used for value-weighted scoring
    function recordSuccess(
        address wallet,
        address counterparty,
        string calldata capability,
        uint256 agreementValueWei
    ) external;

    /// @notice Record an anomaly or failed agreement. Deducts 50 points.
    /// @param wallet           The wallet being penalised
    /// @param counterparty     The wallet on the other side (for record-keeping)
    /// @param capability       Human-readable capability string
    /// @param agreementValueWei Agreement value (not used in penalty calc; stored for records)
    function recordAnomaly(
        address wallet,
        address counterparty,
        string calldata capability,
        uint256 agreementValueWei
    ) external;

    /// @notice Initialise a wallet profile. If v1 registry configured, migrates v1 score.
    /// @param wallet The wallet to initialise
    function initWallet(address wallet) external;

    // ─── Read ────────────────────────────────────────────────────────────────

    /// @notice Raw stored global score (no time decay applied).
    function getGlobalScore(address wallet) external view returns (uint256);

    /// @notice Effective global score with time decay applied. Use this for trust gating.
    function getEffectiveScore(address wallet) external view returns (uint256);

    /// @notice Raw stored capability score for a specific domain (from on-chain top-5 slots).
    /// @dev Returns 0 if capability not in top-5 on-chain slots.
    function getCapabilityScore(address wallet, string calldata capability) external view returns (uint256);

    /// @notice Check if a wallet's effective global score meets the minimum.
    function meetsThreshold(address wallet, uint256 minScore) external view returns (bool);

    /// @notice Check if a wallet's capability score meets the minimum.
    function meetsCapabilityThreshold(
        address wallet,
        uint256 minScore,
        string calldata capability
    ) external view returns (bool);
}
