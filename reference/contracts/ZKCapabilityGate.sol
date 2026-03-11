// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICapabilityProofVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[2] calldata _pubSignals
    ) external view returns (bool);
}

/**
 * @title ZKCapabilityGate
 * @notice ZK-powered capability set membership verification.
 *         Proves an agent has a specific capability without revealing their full capability set.
 *
 * How it works:
 *   1. Agent builds a Merkle tree of their capabilities (off-chain, using circomlib Poseidon)
 *   2. Agent registers the Merkle root on-chain via setCapabilityRoot()
 *   3. When challenged, agent generates a proof that a capability is in their set
 *   4. Counterparty verifies the proof on-chain — sees the capability proven, not the full set
 *
 * Use case: Agents competing in high-value niches can prove capability to specific
 * counterparties without advertising their full specialization to competitors.
 *
 * IMPORTANT: Dev keys used. Replace with proper MPC trusted setup for mainnet.
 *
 * STATUS: DRAFT — not audited, do not use in production
 */
contract ZKCapabilityGate {

    ICapabilityProofVerifier public immutable verifier;

    /// @notice agent → Merkle root of their capability set
    ///         Set by the agent themselves. Updating the root is a signal (see spec 12).
    mapping(address => bytes32) public capabilityRoots;

    /// @notice agent → timestamp of last root update
    mapping(address => uint256) public rootUpdatedAt;

    event CapabilityRootSet(address indexed agent, bytes32 root);
    event CapabilityProofVerified(address indexed agent, bytes32 capabilityHash);

    constructor(address _verifier) {
        require(_verifier != address(0), "ZKCapabilityGate: zero verifier");
        verifier = ICapabilityProofVerifier(_verifier);
    }

    // ─── Root Registration ────────────────────────────────────────────────────

    /**
     * @notice Register or update the Merkle root of the caller's capability set.
     * @dev The root is the Poseidon hash of the capability set Merkle tree.
     *      Changing the root frequently is a trust signal (see spec 12).
     * @param root The Merkle root of the capability set.
     */
    function setCapabilityRoot(bytes32 root) external {
        require(root != bytes32(0), "ZKCapabilityGate: zero root");
        capabilityRoots[msg.sender] = root;
        rootUpdatedAt[msg.sender] = block.timestamp;
        emit CapabilityRootSet(msg.sender, root);
    }

    // ─── Proof Verification ───────────────────────────────────────────────────

    /**
     * @notice Verify a ZK proof that the caller has a specific capability in their set.
     * @dev The full capability set is never revealed. Only the specific capability and
     *      the Merkle root (already public) are used as public inputs to the circuit.
     *
     * @param pA Groth16 proof component A.
     * @param pB Groth16 proof component B.
     * @param pC Groth16 proof component C.
     * @param capabilityHash keccak256 hash of the capability string (e.g. keccak256("legal-research")).
     * @return true if the proof is valid — i.e., capability is in the agent's set.
     */
    function verifyCapability(
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        bytes32 capabilityHash
    ) external returns (bool) {
        bytes32 root = capabilityRoots[msg.sender];
        require(root != bytes32(0), "ZKCapabilityGate: no root registered");

        uint[2] memory pubSignals;
        pubSignals[0] = uint256(root);
        pubSignals[1] = uint256(capabilityHash);

        bool valid = verifier.verifyProof(pA, pB, pC, pubSignals);
        if (valid) {
            emit CapabilityProofVerified(msg.sender, capabilityHash);
        }
        return valid;
    }

    /**
     * @notice Check if an agent has registered a capability root.
     */
    function hasRoot(address agent) external view returns (bool) {
        return capabilityRoots[agent] != bytes32(0);
    }
}
