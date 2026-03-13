# ARC-402 Audit Scope (refreeze — post-arbitration)

This scope covers the arbitration-inclusive refreeze:
- commit `7540e893bd76076c693f1ba56aaca7848f30734d`

> Previously frozen at `7c79ae7129e222da6391bb198ab93770589507ea`.
> Arbitration layer added as bounded RC extension, then refrozen.
> Delta since prior freeze: DisputeArbitration.sol, IDisputeArbitration.sol,
> and surgical modifications to ServiceAgreement, ITrustRegistry, TrustRegistry,
> TrustRegistryV2, IServiceAgreement. All surfaces audited together.

## In scope
- `reference/contracts/**`
  - NEW: `DisputeArbitration.sol`
  - NEW: `IDisputeArbitration.sol`
  - MODIFIED: `ServiceAgreement.sol` — dispute payable, fee hook, eligibility, callback, vote notify
  - MODIFIED: `IServiceAgreement.sol` — payable dispute funcs, opener field
  - MODIFIED: `ITrustRegistry.sol` — recordArbitratorSlash
  - MODIFIED: `TrustRegistry.sol` — recordArbitratorSlash implementation
  - MODIFIED: `TrustRegistryV2.sol` — recordArbitratorSlash implementation
- `reference/test/**`
- `reference/sdk/**`
  - NEW: `dispute-arbitration.ts` — DisputeArbitrationClient
  - MODIFIED: `types.ts`, `agreement.ts`, `index.ts`
- `cli/**`
  - NEW: `commands/arbitrator.ts`
  - MODIFIED: `commands/dispute.ts`, `index.ts`, `config.ts`
- `python-sdk/**`
  - NEW: `arc402/dispute_arbitration.py`
  - MODIFIED: `arc402/types.py`, `arc402/__init__.py`
- `docs/operator/**`
- `docs/operator-standard/**`
- `skills/arc402-agent/SKILL.md`
- relevant release/freeze docs under `reference/**`

## Out of scope (v1)
- Party bonding / party slashing
- DeFi insurance layer
- Bribery/collusion on-chain detection
- Trustless price oracle (admin-set rates used instead — see DisputeArbitration NatSpec)

## Target basis
- Refreeze commit: `7540e893bd76076c693f1ba56aaca7848f30734d`
- Prior baseline: `7c79ae7129e222da6391bb198ab93770589507ea`
- Compile status: `forge build` — compiler run successful (warnings only, pre-existing)
- SDK build: `npm run build` — clean
- Python SDK: `pytest` — 16/16 passed