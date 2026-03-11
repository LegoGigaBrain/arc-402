pragma circom 2.0.0;

include "node_modules/circomlib/circuits/comparators.circom";

/*
 * SolvencyProof
 *
 * Proves that a wallet's balance >= a required escrow amount
 * without revealing the actual balance.
 *
 * Private inputs:
 *   - walletBalance: the wallet's actual balance (in wei or token units)
 *
 * Public inputs:
 *   - requiredAmount: the escrow requirement to be proven against
 *
 * Output:
 *   - valid: 1 if walletBalance >= requiredAmount, 0 otherwise
 *
 * Use case: ServiceAgreement can optionally require a solvency proof
 * before locking escrow on high-value agreements, without the client
 * disclosing their total holdings.
 *
 * Note: n=64 supports balances up to 2^64 wei (~18.4 ETH quintillion).
 * In practice, constrain off-circuit to realistic values.
 */
template SolvencyProof() {
    signal input walletBalance;   // private
    signal input requiredAmount;  // public
    signal output valid;

    component gte = GreaterEqThan(64);
    gte.in[0] <== walletBalance;
    gte.in[1] <== requiredAmount;

    valid <== gte.out;
}

component main {public [requiredAmount]} = SolvencyProof();
