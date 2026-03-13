# ARC-402 Security Assumptions — RC0

This document records the security assumptions and accepted risks for the RC0 audit baseline.

## Block Timestamp Manipulation

All time-based comparisons use `block.timestamp`. Validators can manipulate timestamp by approximately 12 seconds. All protocol time windows are measured in hours or days (minimum: 24h dispute window, 1h channel challenge window). A 12-second manipulation is economically irrelevant at these scales. This is an accepted risk, consistent with industry standard practice for time-window protocols.

Tools: Slither flags all timestamp comparisons as `[timestamp]`. These are acknowledged false positives for this protocol design.

## Weak PRNG — Addressed via Commit-Reveal

`selectArbitratorFromPool` previously used `blockhash + block.timestamp` as entropy. This has been replaced with a two-step commit-reveal scheme:

1. Owner commits `keccak256(abi.encode(reveal))` via `commitArbitratorSeed()` before the reveal block.
2. Owner reveals the pre-image via `selectArbitratorFromPool(..., reveal)`.

The on-chain verification `keccak256(abi.encode(reveal)) == commit` ensures the entropy cannot be influenced by validators after the commit is recorded. Chainlink VRF remains the v2 upgrade path for fully trustless randomness.

## Reentrancy — False Positives on nonReentrant Functions

Slither flags reentrancy on `openDispute`, `acceptAssignment`, `joinMutualDispute`, and `_settleArbitratorBondsAndFees` in `DisputeArbitration`. All of these are either directly decorated with `nonReentrant` or are internal functions called exclusively from `nonReentrant` entry points. OpenZeppelin `ReentrancyGuard` blocks all reentrant calls. Confirmed false positives.

## Incorrect-Return in ZK Verifiers

`CapabilityProofVerifier`, `SolvencyProofVerifier`, and `TrustThresholdVerifier` are snarkJS-generated Groth16 verifiers. They use Yul assembly `return(0, 0x20)` inside the `verifyProof` function for gas-efficient pairing checks. Slither incorrectly flags this as `incorrect-return`. This is the standard pattern for on-chain ZK proof verification. Confirmed false positive.

## Arbitrary-Send-ETH in Escrow Release

`ServiceAgreement._releaseEscrow` and `DisputeArbitration._releasePayment` send ETH to addresses that are parties to a signed agreement or bonded arbitrators. The recipients are always set at agreement creation or bond-acceptance time and cannot be changed by callers. All call sites are access-controlled. Confirmed false positives.

## Uninitialized Mapping in TrustRegistryV2

`_capabilitySlots` is a `mapping(address => CapabilityScore[5])`. Solidity zero-initializes all mappings; unread slots have `capabilityHash == 0`, which the code explicitly treats as "empty". Slither flags this as uninitialized-state. Confirmed false positive.
