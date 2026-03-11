// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISolvencyProofVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[1] calldata _pubSignals
    ) external view returns (bool);
}

/**
 * @title ZKSolvencyGate
 * @notice ZK-powered wallet solvency verification.
 *         Proves a wallet can cover a required escrow amount without revealing total balance.
 *
 * Use case: High-value ServiceAgreements can optionally require a solvency proof
 * before locking escrow, giving the counterparty confidence without the client
 * disclosing their full financial position.
 *
 * IMPORTANT: Dev keys used. Replace with proper MPC trusted setup for mainnet.
 *
 * STATUS: DRAFT — not audited, do not use in production
 */
contract ZKSolvencyGate {

    ISolvencyProofVerifier public immutable verifier;

    event SolvencyProofVerified(address indexed wallet, uint256 requiredAmount);

    constructor(address _verifier) {
        require(_verifier != address(0), "ZKSolvencyGate: zero verifier");
        verifier = ISolvencyProofVerifier(_verifier);
    }

    /**
     * @notice Verify a ZK proof that the caller's wallet balance >= requiredAmount.
     *         The actual balance is never revealed on-chain.
     *
     * @param pA Groth16 proof component A.
     * @param pB Groth16 proof component B.
     * @param pC Groth16 proof component C.
     * @param requiredAmount The escrow amount to be proven solvent against (public input).
     * @return true if the proof is valid — i.e., balance >= requiredAmount.
     */
    function verifySolvency(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint256 requiredAmount
    ) external returns (bool) {
        uint[1] memory pubSignals;
        pubSignals[0] = requiredAmount;

        bool valid = verifier.verifyProof(pA, pB, pC, pubSignals);
        if (valid) {
            emit SolvencyProofVerified(msg.sender, requiredAmount);
        }
        return valid;
    }
}
