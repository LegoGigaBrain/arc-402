pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/mux1.circom";
include "node_modules/circomlib/circuits/comparators.circom";

/*
 * CapabilityMerkleProof
 *
 * Proves that a specific capability is in an agent's capability set
 * (represented as a Merkle tree) without revealing the full set.
 *
 * Private inputs:
 *   - leaf: hash of the capability being proven (Poseidon hash)
 *   - pathElements[levels]: sibling nodes along the Merkle path
 *   - pathIndices[levels]: 0=left, 1=right at each level
 *
 * Public inputs:
 *   - root: Merkle root of the agent's capability set (stored on-chain)
 *   - capabilityHash: the specific capability hash being proven
 *
 * Output:
 *   - valid: 1 if leaf is in the tree with given root
 *
 * Use case: agent proves they have a specific capability (e.g. "legal-research")
 * without revealing their complete capability set to competitors.
 *
 * LEVELS: set to 4 (supports up to 16 capabilities = 2^4).
 * Increase for larger capability sets.
 */
template CapabilityMerkleProof(levels) {
    signal input leaf;                     // private: Poseidon(capabilityHash)
    signal input pathElements[levels];     // private: Merkle path sibling hashes
    signal input pathIndices[levels];      // private: 0=left, 1=right

    signal input root;                     // public: on-chain Merkle root
    signal input capabilityHash;           // public: the capability being proven

    signal output valid;

    // Verify that leaf = Poseidon(capabilityHash)
    component leafHasher = Poseidon(1);
    leafHasher.inputs[0] <== capabilityHash;
    leafHasher.out === leaf;

    // Compute Merkle root from leaf + path
    component hashers[levels];
    component muxes[levels];

    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        muxes[i] = MultiMux1(2);
        muxes[i].c[0][0] <== levelHashes[i];
        muxes[i].c[0][1] <== pathElements[i];
        muxes[i].c[1][0] <== pathElements[i];
        muxes[i].c[1][1] <== levelHashes[i];
        muxes[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxes[i].out[0];
        hashers[i].inputs[1] <== muxes[i].out[1];

        levelHashes[i + 1] <== hashers[i].out;
    }

    // Computed root must match public root.
    // In Groth16, this constraint IS the proof — if the proof verifies on-chain,
    // this equality was satisfied. No need to output a boolean; constrain directly.
    levelHashes[levels] === root;

    // valid is always 1 — proof generation fails if root doesn't match (circuit unsatisfiable)
    valid <== 1;
}

// LEVELS=4 supports up to 16 capabilities
component main {public [root, capabilityHash]} = CapabilityMerkleProof(4);
