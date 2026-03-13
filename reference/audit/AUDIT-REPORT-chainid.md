# Audit Report: ChainID / Replay Protection

**Date:** 2026-03-11  
**Scope:** All contracts in `contracts/*.sol`  
**Analyst:** ARC-402 Security Hardening Pass (pre-audit)

## Finding

All 16 contracts in the ARC-402 reference implementation were scanned for the use of off-chain cryptographic signatures — specifically `ecrecover`, `DOMAIN_SEPARATOR`, `chainId`, `block.chainid`, `EIP712`, `domainSeparator`, and `DOMAIN_TYPEHASH`. **None of these patterns are present in any contract.** The only signature-adjacent mention is a comment in `TrustRegistry.sol` (line 14) noting that a prior design risk involved phishing via signed transactions, but no actual `ecrecover` call or EIP-712 struct signing is implemented. All authorization in the current codebase is enforced via `msg.sender` checks (e.g. `onlyOwner`, `require(msg.sender == ag.client)`) and on-chain state transitions — no permit-style or meta-transaction patterns are used. 

**Status: N/A — no off-chain signing in current contracts; replay protection via ChainID is not applicable.** If EIP-712 signatures or `permit()` patterns are introduced in a future version (e.g. for gasless meta-transactions), a `DOMAIN_SEPARATOR` including `block.chainid`, contract address, and version string MUST be incorporated to prevent cross-chain replay attacks.
