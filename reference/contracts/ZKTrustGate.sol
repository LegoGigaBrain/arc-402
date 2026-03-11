// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ITrustRegistry.sol";

interface ITrustThresholdVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[1] calldata _pubSignals
    ) external view returns (bool);
}

/**
 * @title ZKTrustGate
 * @notice ZK-powered trust threshold verification.
 *         Proves an agent's trust score >= a threshold without revealing the exact score.
 *
 * Two verification modes available:
 *   1. Direct: Read trust score from TrustRegistry (transparent, default)
 *   2. ZK proof: Agent submits a Groth16 proof (privacy-preserving, opt-in)
 *
 * The ZK mode is useful when agents want to prove eligibility without
 * revealing their exact reputation score to competitors.
 *
 * IMPORTANT: Dev keys used in this deployment. For mainnet, replace with
 *            keys generated from a proper multi-party trusted setup ceremony.
 *
 * STATUS: DRAFT — not audited, do not use in production
 */
contract ZKTrustGate {

    ITrustThresholdVerifier public immutable verifier;
    ITrustRegistry public immutable trustRegistry;

    /// @notice Emitted when an agent successfully proves trust threshold via ZK
    event TrustProofVerified(address indexed agent, uint256 threshold, bool zkMode);

    constructor(address _verifier, address _trustRegistry) {
        require(_verifier != address(0), "ZKTrustGate: zero verifier");
        require(_trustRegistry != address(0), "ZKTrustGate: zero trust registry");
        verifier = ITrustThresholdVerifier(_verifier);
        trustRegistry = ITrustRegistry(_trustRegistry);
    }

    // ─── Direct Verification (transparent) ───────────────────────────────────

    /**
     * @notice Verify that an agent's trust score meets the threshold by reading
     *         directly from TrustRegistry. Reveals the exact score.
     * @param agent The agent to check.
     * @param threshold The minimum required score.
     * @return true if score >= threshold.
     */
    function verifyDirect(address agent, uint256 threshold) external view returns (bool) {
        try trustRegistry.getScore(agent) returns (uint256 score) {
            return score >= threshold;
        } catch {
            return false;
        }
    }

    // ─── ZK Proof Verification (privacy-preserving) ───────────────────────────

    /**
     * @notice Verify a ZK proof that the agent's trust score >= threshold.
     *         The exact score is not revealed. Only the threshold is public.
     *
     * @param pA Groth16 proof component A.
     * @param pB Groth16 proof component B.
     * @param pC Groth16 proof component C.
     * @param threshold The minimum trust threshold (public input to the circuit).
     * @return true if the proof is valid for the given threshold.
     */
    function verifyZK(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint256 threshold
    ) external returns (bool) {
        uint[1] memory pubSignals;
        pubSignals[0] = threshold;

        bool valid = verifier.verifyProof(pA, pB, pC, pubSignals);
        if (valid) {
            emit TrustProofVerified(msg.sender, threshold, true);
        }
        return valid;
    }
}
