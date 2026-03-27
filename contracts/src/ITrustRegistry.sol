// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITrustRegistry {
    function getScore(address wallet) external view returns (uint256 score);

    /// @notice Returns the effective (time-decayed) trust score.
    ///         Implementations without time decay should return the same value as getScore().
    ///         B-07: used by DisputeArbitration.isEligibleArbitrator to respect time decay.
    function getEffectiveScore(address wallet) external view returns (uint256 score);
    /// @notice Record a successful delivery. Called by ServiceAgreement on verified release / auto-release,
    ///         and only on legacy fulfill when that trusted-only compatibility path is explicitly enabled.
    /// @param wallet The provider who delivered.
    /// @param counterparty The client who paid.
    /// @param capability The service type (e.g. "legal-research").
    /// @param agreementValueWei The payment amount in wei (or token units).
    function recordSuccess(
        address wallet,
        address counterparty,
        string calldata capability,
        uint256 agreementValueWei,
        uint256 resolvedAt
    ) external;

    /// @notice Record an anomaly (dispute loss). Called by ServiceAgreement on dispute resolution.
    /// @param wallet The provider who lost the dispute.
    /// @param counterparty The client who won.
    /// @param capability The service type.
    /// @param agreementValueWei The payment amount.
    function recordAnomaly(
        address wallet,
        address counterparty,
        string calldata capability,
        uint256 agreementValueWei
    ) external;
    function initWallet(address wallet) external;

    /// @notice Record an arbitrator slash event. Decrements the arbitrator's trust score.
    /// @dev Called by DisputeArbitration on no-show, missed vote deadline, or manual rules violation.
    ///      DisputeArbitration must be registered as an authorized updater on TrustRegistry.
    /// @param arbitrator The arbitrator address being penalized.
    /// @param reason Human-readable slash reason: "no-show", "missed-deadline", "rules-violation".
    function recordArbitratorSlash(address arbitrator, string calldata reason) external;
}
