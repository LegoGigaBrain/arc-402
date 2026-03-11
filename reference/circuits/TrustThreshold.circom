pragma circom 2.0.0;

include "node_modules/circomlib/circuits/comparators.circom";

/*
 * TrustThreshold
 * 
 * Proves that an agent's trust score >= a public threshold
 * without revealing the actual score.
 *
 * Private inputs:
 *   - actualScore: the agent's real trust score (0-1000)
 *
 * Public inputs:
 *   - threshold: the minimum required trust score
 *
 * Output:
 *   - valid: 1 if actualScore >= threshold, 0 otherwise
 *
 * Use case: counterparty verifies agent meets minimum trust
 * without learning the exact score (competitive privacy).
 */
template TrustThreshold() {
    signal input actualScore;   // private
    signal input threshold;     // public
    signal output valid;

    // GreaterEqThan(n) checks that in[0] >= in[1]
    // n=10 supports values up to 2^10 = 1024 (covers MAX_SCORE=1000)
    component gte = GreaterEqThan(10);
    gte.in[0] <== actualScore;
    gte.in[1] <== threshold;

    valid <== gte.out;
}

component main {public [threshold]} = TrustThreshold();
