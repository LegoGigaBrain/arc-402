# ARC-402 Audit Assumptions (freeze baseline)

1. Planned freeze baseline is RC-C aligned commit `7c79ae7129e222da6391bb198ab93770589507ea`.
2. Arbitration-aware preseal commits after this point are post-freeze work, not part of baseline truth.
3. Freeze closure requires reproducible verification evidence across contracts, TS SDK, CLI, and Python SDK.
4. Known verification failures at baseline are documented, not hidden, and must be resolved before a final all-green freeze seal.
5. No DeFi insurance / pooled financialization is in freeze scope.

## Known Tool Findings — Accepted and Documented

### weak-prng (ADDRESSED in commit-reveal)
selectArbitratorFromPool now uses commit-reveal scheme. Chainlink VRF remains the v2 upgrade path for trustless randomness.

### timestamp manipulation (ACCEPTED)
All time comparisons use block.timestamp. Validator manipulation is bounded to ~12s. All protocol windows are ≥1 hour. Accepted industry-standard risk for time-window protocols.

### reentrancy-eth on nonReentrant functions (FALSE POSITIVE)
Slither flags internal functions called within nonReentrant-guarded entry points. All reentrancy paths are blocked by OpenZeppelin ReentrancyGuard. Confirmed false positives.

### incorrect-return in ZK verifiers (FALSE POSITIVE)
Groth16 verifier contracts use Yul assembly `return` for gas-efficient pairing checks. This is the standard pattern for on-chain ZK proof verification. Confirmed false positive.

### arbitrary-send-eth in escrow release (FALSE POSITIVE)
_releaseEscrow and _releasePayment send ETH to addresses that are parties to a signed agreement. All callers are access-controlled. Confirmed false positives.